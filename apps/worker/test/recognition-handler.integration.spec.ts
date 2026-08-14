import { createHash, randomUUID } from "node:crypto";

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

  const sessionModelManifest = async (sessionId: string): Promise<unknown> => {
    const row = await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_sessions")
      .select("model_manifest")
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow();
    return row.model_manifest;
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

  const runHandler = (imageStorage: ImageStorage, sessionId: string): Promise<void> => {
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
      },
      logger: silentLogger(),
    });
    const job: BackgroundJobEnvelope<{ readonly sessionId: string }> = {
      id: randomUUID(),
      type: "Recognize",
      payload: { sessionId },
      attempt: 1,
      createdAt: new Date().toISOString(),
    };
    return handler(job);
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
    await expect(sessionModelManifest(sessionId)).resolves.toMatchObject({
      stageReports: expect.arrayContaining([
        expect.objectContaining({ stage: "Ocr", outcome: "Unavailable", imageOrdinal: 1 }),
        expect.objectContaining({ stage: "Vlm", outcome: "Unavailable", imageOrdinal: null }),
      ]),
    });
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
    const itemId = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("items")
      .values({
        id: randomUUID(),
        reference: `RH-${randomUUID()}`,
        name: "Recognition Handler Test Item",
        unit: "each",
        barcode: "5012345678900",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
      .then((row) => row.id);
    createdItemIds.push(itemId);

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
