import { createHash, randomUUID } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";

import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { BackgroundJobEnvelope } from "@stockcontrol/contracts";
import { CorrelationContext, StructuredLogger } from "@stockcontrol/platform";
import {
  createMigratorDatabase,
  createRuntimeDatabase,
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadWorkerDatabaseConfiguration,
  runMigrations,
  STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";

import type { DownloadedObject, ImageStorage } from "../src/recognition/image-storage";
import type { RecognitionPipelineConfiguration } from "../src/recognition/recognition-configuration";
import { createRecognitionHandler } from "../src/recognition/recognition-handler";

const REQUEST_HASH = "a".repeat(64);

class FakeImageStorage implements ImageStorage {
  private readonly objects = new Map<string, DownloadedObject>();

  public put(key: string, bytes: Buffer, mediaType = "image/jpeg"): void {
    this.objects.set(key, { bytes, mediaType });
  }

  public async getObject(key: string): Promise<DownloadedObject> {
    const object = this.objects.get(key);
    if (object === undefined) throw new Error(`No fake object for ${key}`);
    return Promise.resolve(object);
  }

  public async putObject(key: string, bytes: Buffer, mediaType: string): Promise<void> {
    this.objects.set(key, { bytes, mediaType });
    return Promise.resolve();
  }

  public async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

const silentLogger = (): StructuredLogger =>
  new StructuredLogger(new CorrelationContext(), "worker-test", { write: () => undefined });

const servers: Server[] = [];

/** A stand-in recogniser on a real port, so an unreachable service is tested
 * as an HTTP outcome rather than a mocked rejection. */
const startServer = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Server did not bind.");
  return `http://127.0.0.1:${String(address.port)}`;
};

const stopServers = async (): Promise<void> => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server === undefined) continue;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
};

describe.sequential("recognition handler", () => {
  let migrator: Kysely<StockControlDatabase>;
  let database: Kysely<StockControlDatabase>;
  const createdUserIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdItemIds: string[] = [];

  const insertUser = async (): Promise<string> => {
    const id = randomUUID();
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("users")
      .values({
        id,
        username: `worker.${id.slice(0, 23)}`,
        email: `${id}@example.invalid`,
        display_name: "Recognition Handler Test User",
        role: "Office",
        password_hash: "not-a-real-hash",
      })
      .execute();
    createdUserIds.push(id);
    return id;
  };

  const insertBatch = async (actorUserId: string): Promise<string> => {
    const id = randomUUID();
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_capture_batches")
      .values({ id, actor_user_id: actorUserId, request_hash: REQUEST_HASH })
      .execute();
    createdBatchIds.push(id);
    return id;
  };

  const insertSession = async (input: {
    readonly batchId: string;
    readonly actorUserId: string;
    readonly status: string;
    readonly photoCount: number;
    readonly localCodes?: readonly { value: string; symbology: string }[];
  }): Promise<string> => {
    const id = randomUUID();
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_recognition_sessions")
      .values({
        id,
        batch_id: input.batchId,
        actor_user_id: input.actorUserId,
        request_hash: REQUEST_HASH,
        status: input.status as never,
        photo_count: input.photoCount,
        local_codes: JSON.stringify(input.localCodes ?? []),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      })
      .execute();
    return id;
  };

  const insertImage = async (input: {
    readonly sessionId: string;
    readonly ordinal: number;
    readonly bytes: Buffer;
    readonly correctDigest: boolean;
  }): Promise<string> => {
    const id = randomUUID();
    const realDigest = createHash("sha256").update(input.bytes).digest("hex");
    const declaredDigest = input.correctDigest ? realDigest : "f".repeat(64);
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_recognition_images")
      .values({
        id,
        session_id: input.sessionId,
        ordinal: input.ordinal,
        object_key: `stock-capture/${input.sessionId}/${String(input.ordinal)}`,
        sha256: declaredDigest,
        media_type: "image/jpeg",
        byte_length: input.bytes.length,
        width: 100,
        height: 100,
        delete_after: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      })
      .execute();
    return id;
  };

  const sessionStatus = async (sessionId: string): Promise<string> => {
    const row = await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_sessions")
      .select(["status", "failure_code"])
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow();
    return row.status;
  };

  /** The stage record the API reads back to decide what to tell the user. */
  const stagesFor = async (
    sessionId: string,
  ): Promise<
    readonly {
      readonly stage: string;
      readonly outcome: string;
      readonly observations?: readonly string[];
    }[]
  > => {
    const row = await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_sessions")
      .select(["model_manifest"])
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow();
    const manifest = row.model_manifest as { readonly stages?: unknown } | null;
    const stages = manifest?.stages;
    return Array.isArray(stages)
      ? (stages as readonly {
          readonly stage: string;
          readonly outcome: string;
          readonly observations?: readonly string[];
        }[])
      : [];
  };

  const sessionFailureCode = async (sessionId: string): Promise<string | null> => {
    const row = await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_sessions")
      .select(["failure_code"])
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow();
    return row.failure_code;
  };

  const imageStatus = async (imageId: string): Promise<string> => {
    const row = await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_images")
      .select(["status"])
      .where("id", "=", imageId)
      .executeTakeFirstOrThrow();
    return row.status;
  };

  const candidatesFor = async (
    sessionId: string,
  ): Promise<
    readonly { readonly rank: number; readonly kind: string; readonly item_id: string | null }[]
  > =>
    database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_candidates")
      .select(["rank", "kind", "item_id"])
      .where("session_id", "=", sessionId)
      .orderBy("rank")
      .execute();

  const runHandler = (
    imageStorage: ImageStorage,
    sessionId: string,
    over: {
      readonly configuration?: Partial<RecognitionPipelineConfiguration>;
      readonly attempt?: number;
      readonly maxAttempts?: number;
    } = {},
  ): Promise<void> => {
    const handler = createRecognitionHandler({
      database,
      imageStorage,
      configuration: {
        recognitionCoreUrl: undefined,
        recognitionCoreTimeoutMilliseconds: 1_000,
        recognitionFusionUrl: undefined,
        recognitionFusionApiKey: undefined,
        recognitionFusionTimeoutMilliseconds: 1_000,
        braveSearchApiKey: undefined,
        webFetchTimeoutMilliseconds: 1_000,
        visualIndexEmbeddingModel: "unset",
        ...over.configuration,
      },
      logger: silentLogger(),
    });
    const job: BackgroundJobEnvelope<{ readonly sessionId: string }> = {
      id: randomUUID(),
      type: "Recognize",
      payload: { sessionId },
      attempt: over.attempt ?? 1,
      maxAttempts: over.maxAttempts ?? 3,
      createdAt: new Date().toISOString(),
    };
    return handler(job);
  };

  const insertCatalogueItem = async (barcode: string): Promise<string> => {
    const itemId = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("items")
      .values({
        id: randomUUID(),
        reference: `RH-${randomUUID()}`,
        name: "Recognition Handler Test Item",
        unit: "each",
        barcode,
      })
      .returning("id")
      .executeTakeFirstOrThrow()
      .then((row) => row.id);
    createdItemIds.push(itemId);
    return itemId;
  };

  /** A photographed session whose recognisers are pointed at `baseUrl`. */
  const sessionWithOnePhotograph = async (input: {
    readonly localCodes?: readonly { value: string; symbology: string }[];
  }): Promise<{ readonly sessionId: string; readonly storage: FakeImageStorage }> => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Queued",
      photoCount: 1,
      ...(input.localCodes === undefined ? {} : { localCodes: input.localCodes }),
    });
    const bytes = Buffer.from("real image bytes");
    await insertImage({ sessionId, ordinal: 1, bytes, correctDigest: true });
    const storage = new FakeImageStorage();
    storage.put(`stock-capture/${sessionId}/1`, bytes);
    return { sessionId, storage };
  };

  beforeAll(async () => {
    const workerConfiguration = loadWorkerDatabaseConfiguration();
    migrator = createMigratorDatabase(loadMigratorDatabaseConfiguration());
    await runMigrations(migrator, {
      runtimeRole: databaseRoleFromConnectionString(workerConfiguration.connectionString),
    });
    database = createRuntimeDatabase(workerConfiguration);
  });

  afterEach(async () => {
    if (createdBatchIds.length > 0) {
      const sessions = await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom("stock_recognition_sessions")
        .select(["id"])
        .where("batch_id", "in", createdBatchIds)
        .execute();
      const sessionIds = sessions.map((row) => row.id);
      if (sessionIds.length > 0) {
        await migrator
          .withSchema(STOCKCONTROL_SCHEMA)
          .deleteFrom("stock_recognition_candidates")
          .where("session_id", "in", sessionIds)
          .execute();
        await migrator
          .withSchema(STOCKCONTROL_SCHEMA)
          .deleteFrom("stock_recognition_images")
          .where("session_id", "in", sessionIds)
          .execute();
        await migrator
          .withSchema(STOCKCONTROL_SCHEMA)
          .deleteFrom("stock_recognition_sessions")
          .where("id", "in", sessionIds)
          .execute();
      }
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("stock_capture_batches")
        .where("id", "in", createdBatchIds)
        .execute();
      createdBatchIds.length = 0;
    }
    if (createdItemIds.length > 0) {
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("items")
        .where("id", "in", createdItemIds)
        .execute();
      createdItemIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("users")
        .where("id", "in", createdUserIds)
        .execute();
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await stopServers();
    await database.destroy();
    await migrator.destroy();
  });

  it("reaches ReviewReady from Queued with a local code but no configured model services", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Queued",
      photoCount: 0,
      localCodes: [{ value: "not-a-valid-code", symbology: "Code128" }],
    });

    await runHandler(new FakeImageStorage(), sessionId);

    expect(await sessionStatus(sessionId)).toBe("ReviewReady");
  });

  it("marks the session Failed when there are no images and no local codes", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Queued",
      photoCount: 0,
      localCodes: [],
    });

    await runHandler(new FakeImageStorage(), sessionId);

    expect(await sessionStatus(sessionId)).toBe("Failed");
  });

  it("verifies an image whose downloaded bytes match the declared digest", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Queued",
      photoCount: 1,
    });
    const bytes = Buffer.from("real image bytes");
    const imageId = await insertImage({ sessionId, ordinal: 1, bytes, correctDigest: true });
    const storage = new FakeImageStorage();
    storage.put(`stock-capture/${sessionId}/1`, bytes);

    await runHandler(storage, sessionId);

    expect(await imageStatus(imageId)).toBe("Verified");
    expect(await sessionStatus(sessionId)).toBe("ReviewReady");
  });

  it("rejects an image whose downloaded bytes do not match the declared digest", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Queued",
      photoCount: 1,
    });
    const bytes = Buffer.from("tampered image bytes");
    const imageId = await insertImage({ sessionId, ordinal: 1, bytes, correctDigest: false });
    const storage = new FakeImageStorage();
    storage.put(`stock-capture/${sessionId}/1`, bytes);

    await runHandler(storage, sessionId);

    expect(await imageStatus(imageId)).toBe("Rejected");
    // No verified image and no local code — the same "nothing to review" path.
    expect(await sessionStatus(sessionId)).toBe("Failed");
  });

  it("does nothing for a session that is not in a processing status", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Cancelled",
      photoCount: 0,
    });

    await runHandler(new FakeImageStorage(), sessionId);

    expect(await sessionStatus(sessionId)).toBe("Cancelled");
  });

  it("does nothing for a session that does not exist", async () => {
    // Only proves the handler returns cleanly rather than throwing; there is
    // no row to assert against.
    await expect(runHandler(new FakeImageStorage(), randomUUID())).resolves.toBeUndefined();
  });

  it("resumes a session left mid-pipeline by a crashed, retried job", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Enriching",
      photoCount: 0,
      localCodes: [{ value: "not-a-valid-code", symbology: "Code128" }],
    });

    await runHandler(new FakeImageStorage(), sessionId);

    expect(await sessionStatus(sessionId)).toBe("ReviewReady");
  });

  it("matches a validated barcode local code against the catalogue and publishes a candidate", async () => {
    const userId = await insertUser();
    const itemId = await insertCatalogueItem("5012345678900");

    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Queued",
      photoCount: 0,
      localCodes: [{ value: "5012345678900", symbology: "EAN-13" }],
    });

    await runHandler(new FakeImageStorage(), sessionId);

    expect(await sessionStatus(sessionId)).toBe("ReviewReady");
    const candidates = await candidatesFor(sessionId);
    expect(candidates.some((candidate) => candidate.item_id === itemId)).toBe(true);
  });

  /*
   * The 14 August staging incident. Both recognisers were configured and
   * neither answered; the handler wrote ReviewReady with no candidates and the
   * job was reported completed, so the queue never retried and the only
   * evidence of an outage was a person saying the photograph "returned
   * nothing". These tests pin the distinction the fix turns on: a recogniser
   * that is *not configured* is a deployment decision and still reaches
   * review, while a recogniser that is configured and does not answer is an
   * outage and must not be reported as a finished job.
   */
  describe("when a configured recogniser does not answer", () => {
    let refusingUrl: string;

    beforeAll(async () => {
      refusingUrl = await startServer((_request, response) => {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "model backend unavailable" }));
      });
    });

    /* A function, not a constant: `refusingUrl` is only known once the server
     * has bound a port, which happens after this block is evaluated. */
    const bothRecognisersDown = (): Partial<RecognitionPipelineConfiguration> => ({
      recognitionCoreUrl: refusingUrl,
      recognitionFusionUrl: refusingUrl,
      recognitionFusionApiKey: "test-key",
    });

    it("fails the job instead of reporting an empty result as a completed one", async () => {
      const { sessionId, storage } = await sessionWithOnePhotograph({});

      await expect(
        runHandler(storage, sessionId, { configuration: bothRecognisersDown() }),
      ).rejects.toMatchObject({ code: "capture.recognition_unavailable" });

      expect(await candidatesFor(sessionId)).toEqual([]);
      expect(await sessionStatus(sessionId)).not.toBe("ReviewReady");
    });

    it("leaves the session mid-pipeline while the queue still has attempts left", async () => {
      const { sessionId, storage } = await sessionWithOnePhotograph({});

      await expect(
        runHandler(storage, sessionId, {
          configuration: bothRecognisersDown(),
          attempt: 1,
          maxAttempts: 3,
        }),
      ).rejects.toThrow();

      /* Not Failed: a retry may still succeed, and showing a person a failure
       * that the next attempt disproves is worse than showing progress. */
      expect(await sessionStatus(sessionId)).toBe("Fusing");
      expect(await sessionFailureCode(sessionId)).toBeNull();
    });

    it("tells the person once the queue has run out of attempts", async () => {
      const { sessionId, storage } = await sessionWithOnePhotograph({});

      await expect(
        runHandler(storage, sessionId, {
          configuration: bothRecognisersDown(),
          attempt: 3,
          maxAttempts: 3,
        }),
      ).rejects.toThrow();

      expect(await sessionStatus(sessionId)).toBe("Failed");
      expect(await sessionFailureCode(sessionId)).toBe("capture.recognition_unavailable");
    });

    /*
     * A 401 is a wrong key, and it will still be a wrong key after the backoff.
     * Waiting out three attempts before telling anybody just makes the same
     * answer arrive later, so a failure that cannot change is terminal at once.
     */
    it("does not make a person wait out retries for a key that will stay refused", async () => {
      const refusingKeyUrl = await startServer((_request, response) => {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid api key" }));
      });
      const { sessionId, storage } = await sessionWithOnePhotograph({});

      await expect(
        runHandler(storage, sessionId, {
          configuration: {
            recognitionCoreUrl: refusingKeyUrl,
            recognitionFusionUrl: refusingKeyUrl,
            recognitionFusionApiKey: "wrong-key",
          },
          attempt: 1,
          maxAttempts: 3,
        }),
      ).rejects.toMatchObject({ code: "capture.recognition_unavailable" });

      expect(await sessionStatus(sessionId)).toBe("Failed");
      expect(await sessionFailureCode(sessionId)).toBe("capture.recognition_unavailable");
    });

    /* The note a person reads has to match what actually happened: a service
     * that answered and refused was not "unreachable". */
    it("says a service refused the request rather than that it could not be reached", async () => {
      const refusingKeyUrl = await startServer((_request, response) => {
        response.writeHead(403);
        response.end("forbidden");
      });
      /* A catalogue match, so the session reaches review and writes the stage
       * record — an outage alone never gets that far. */
      await insertCatalogueItem("5012345678900");
      const { sessionId, storage } = await sessionWithOnePhotograph({
        localCodes: [{ value: "5012345678900", symbology: "EAN-13" }],
      });

      await runHandler(storage, sessionId, {
        configuration: { recognitionCoreUrl: refusingKeyUrl },
      });

      const stages = await stagesFor(sessionId);
      const ocr = stages.find((stage) => stage.stage === "Ocr");
      expect(ocr?.outcome).toBe("Failed");
      expect(ocr?.observations?.[0]).toMatch(/refused the request/iu);
      expect(ocr?.observations?.[0]).not.toMatch(/could not be reached/iu);
    });

    it("still reaches review when another stage identified the item anyway", async () => {
      const itemId = await insertCatalogueItem("5012345678900");

      const { sessionId, storage } = await sessionWithOnePhotograph({
        localCodes: [{ value: "5012345678900", symbology: "EAN-13" }],
      });

      await expect(
        runHandler(storage, sessionId, { configuration: bothRecognisersDown() }),
      ).resolves.toBeUndefined();

      expect(await sessionStatus(sessionId)).toBe("ReviewReady");
      const candidates = await candidatesFor(sessionId);
      expect(candidates.some((candidate) => candidate.item_id === itemId)).toBe(true);
    });
  });

  /*
   * Path A: barcode and manual entry only, no recogniser deployed. Retrying
   * this would burn every attempt and dead-letter a job that was never going
   * to succeed, so an unconfigured stage must stay distinct from a failed one.
   */
  it("finishes a session normally on an installation with no recognisers configured", async () => {
    const { sessionId, storage } = await sessionWithOnePhotograph({});

    await expect(runHandler(storage, sessionId)).resolves.toBeUndefined();

    expect(await sessionStatus(sessionId)).toBe("ReviewReady");
    expect(await candidatesFor(sessionId)).toEqual([]);
    /* Nothing looked, so nothing is claimed to have looked — this is what
     * makes the review screen say so instead of "no match found". */
    const stages = await stagesFor(sessionId);
    expect(stages.find((stage) => stage.stage === "Ocr")?.outcome).toBe("Unavailable");
    expect(stages.some((stage) => stage.outcome === "Succeeded")).toBe(false);
  });

  /*
   * The other half of the same distinction, and the case the user's report
   * actually described: a clear photograph that genuinely matched nothing.
   * This must not be retried and must not be called a failure — but the stage
   * record has to say the analysis ran, or the screen cannot tell a person
   * that their photograph was looked at.
   */
  it("records a completed analysis that simply found no match", async () => {
    const analysingUrl = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          requestId: "req-1",
          modelManifestVersion: "test-manifest",
          photoResults: [
            {
              imageOrdinal: 1,
              barcodeOutcome: "NotApplicable",
              barcodes: [],
              ocrOutcome: "Succeeded",
              ocrLines: [{ text: "NOTHING IDENTIFYING", score: 0.9 }],
              identifiers: {
                manufacturerTokens: [],
                nameFragments: [],
                partNumberCandidates: [],
                barcodeLikeCandidates: [],
                variantAttributes: [],
                labelledPackQuantity: null,
              },
              embeddingOutcome: "NotApplicable",
              embedding: null,
              categoryOutcome: "Succeeded",
              categories: [],
              quality: { blurScore: 0.1, foregroundAreaRatio: 0.5 },
              crops: [],
            },
          ],
        }),
      );
    });
    const { sessionId, storage } = await sessionWithOnePhotograph({});

    await expect(
      runHandler(storage, sessionId, { configuration: { recognitionCoreUrl: analysingUrl } }),
    ).resolves.toBeUndefined();

    expect(await sessionStatus(sessionId)).toBe("ReviewReady");
    expect(await candidatesFor(sessionId)).toEqual([]);
    const stages = await stagesFor(sessionId);
    expect(stages.find((stage) => stage.stage === "Ocr")?.outcome).toBe("Succeeded");
    expect(stages.some((stage) => stage.outcome === "Failed")).toBe(false);
  });

  it("writes no candidates for an already-cancelled session", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Cancelled",
      photoCount: 0,
      localCodes: [],
    });

    await runHandler(new FakeImageStorage(), sessionId);

    expect(await sessionStatus(sessionId)).toBe("Cancelled");
    expect(await candidatesFor(sessionId)).toEqual([]);
  });
});
