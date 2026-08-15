import { randomUUID } from "node:crypto";
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

import { createExemplarHandler } from "../src/recognition/exemplar-handler";
import type { DownloadedObject, ImageStorage } from "../src/recognition/image-storage";
import type { RecognitionPipelineConfiguration } from "../src/recognition/recognition-configuration";
import { encodeFloat16Buffer } from "../src/recognition/visual-index";

const REQUEST_HASH = "a".repeat(64);
const EMBEDDING_MODEL = "test-embedding-1";

class FakeImageStorage implements ImageStorage {
  public readonly putCalls: { readonly key: string; readonly mediaType: string }[] = [];
  private readonly objects = new Map<string, DownloadedObject>();

  public put(key: string): void {
    this.objects.set(key, { bytes: Buffer.from("source bytes"), mediaType: "image/jpeg" });
  }

  public async getObject(key: string): Promise<DownloadedObject> {
    const object = this.objects.get(key);
    if (object === undefined) throw new Error(`No fake object for ${key}`);
    return Promise.resolve(object);
  }

  public async putObject(key: string, bytes: Buffer, mediaType: string): Promise<void> {
    this.objects.set(key, { bytes, mediaType });
    this.putCalls.push({ key, mediaType });
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

const startRenderExemplarServer = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the fake recognition-core server to be listening.");
  }
  return `http://127.0.0.1:${String(address.port)}`;
};

const respondingExemplarServer = (): Promise<string> =>
  startRenderExemplarServer((request, response) => {
    response.writeHead(200, {
      "content-type": "image/webp",
      "x-recognition-width": "64",
      "x-recognition-height": "64",
    });
    response.end(Buffer.from("cropped bytes"));
    void request;
  });

const baseConfiguration = (
  recognitionCoreUrl: string | undefined,
): RecognitionPipelineConfiguration => ({
  recognitionCoreUrl,
  recognitionCoreTimeoutMilliseconds: 2_000,
  recognitionFusionUrl: undefined,
  recognitionFusionApiKey: undefined,
  recognitionFusionTimeoutMilliseconds: 1_000,
  recognitionFusionConcurrency: 2,
  braveSearchApiKey: undefined,
  webFetchTimeoutMilliseconds: 1_000,
  visualIndexEmbeddingModel: EMBEDDING_MODEL,
});

describe.sequential("exemplar handler", () => {
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
        display_name: "Exemplar Handler Test User",
        role: "Office",
        password_hash: "not-a-real-hash",
      })
      .execute();
    createdUserIds.push(id);
    return id;
  };

  const insertItem = async (): Promise<string> => {
    const id = randomUUID();
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("items")
      .values({ id, reference: `EX-${randomUUID()}`, name: "Exemplar Test Item", unit: "each" })
      .execute();
    createdItemIds.push(id);
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

  const insertSession = async (batchId: string, actorUserId: string): Promise<string> => {
    const id = randomUUID();
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_recognition_sessions")
      .values({
        id,
        batch_id: batchId,
        actor_user_id: actorUserId,
        request_hash: REQUEST_HASH,
        status: "Committed",
        photo_count: 1,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      })
      .execute();
    return id;
  };

  const insertVerifiedImage = async (input: {
    readonly sessionId: string;
    readonly withCrop: boolean;
  }): Promise<string> => {
    const id = randomUUID();
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_recognition_images")
      .values({
        id,
        session_id: input.sessionId,
        ordinal: 1,
        object_key: `stock-capture/${input.sessionId}/1`,
        sha256: "a".repeat(64),
        media_type: "image/jpeg",
        byte_length: 10,
        width: 10,
        height: 10,
        status: "Verified",
        embedding: encodeFloat16Buffer([0.1, 0.2, 0.3]),
        embedding_model: EMBEDDING_MODEL,
        crop_metadata: JSON.stringify({
          crops: input.withCrop ? [{ x: 0, y: 0, width: 1, height: 1, label: "full" }] : [],
          quality: { blurScore: 0.8, foregroundAreaRatio: 0.6 },
        }),
        delete_after: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      })
      .execute();
    return id;
  };

  const insertActiveExemplar = async (itemId: string): Promise<void> => {
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("item_visual_examples")
      .values({
        id: randomUUID(),
        item_id: itemId,
        embedding: encodeFloat16Buffer([0.4, 0.5]),
        embedding_model: EMBEDDING_MODEL,
        verified_by_user_id: createdUserIds[0] ?? (await insertUser()),
        quality_score: 0.5,
      })
      .execute();
  };

  const exemplarsFor = async (
    itemId: string,
  ): Promise<
    readonly {
      readonly id: string;
      readonly source_session_id: string | null;
      readonly source_image_id: string | null;
      readonly crop_object_key: string | null;
      readonly quality_score: number;
    }[]
  > =>
    database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("item_visual_examples")
      .select(["id", "source_session_id", "source_image_id", "crop_object_key", "quality_score"])
      .where("item_id", "=", itemId)
      .execute();

  const runHandler = (
    imageStorage: ImageStorage,
    configuration: RecognitionPipelineConfiguration,
    payload: { readonly sessionId: string; readonly itemId: string },
  ): Promise<void> => {
    const handler = createExemplarHandler({
      database,
      imageStorage,
      configuration,
      logger: silentLogger(),
    });
    const job: BackgroundJobEnvelope<{ readonly sessionId: string; readonly itemId: string }> = {
      id: randomUUID(),
      type: "BuildExemplars",
      payload,
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
    while (servers.length > 0) {
      const server = servers.pop();
      if (server === undefined) continue;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    if (createdItemIds.length > 0) {
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("item_visual_examples")
        .where("item_id", "in", createdItemIds)
        .execute();
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("items")
        .where("id", "in", createdItemIds)
        .execute();
      createdItemIds.length = 0;
    }
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

  it("builds an exemplar from a verified image's stored embedding and crop", async () => {
    const userId = await insertUser();
    const itemId = await insertItem();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession(batchId, userId);
    const imageId = await insertVerifiedImage({ sessionId, withCrop: true });

    const baseUrl = await respondingExemplarServer();
    const storage = new FakeImageStorage();
    storage.put(`stock-capture/${sessionId}/1`);

    await runHandler(storage, baseConfiguration(baseUrl), { sessionId, itemId });

    const exemplars = await exemplarsFor(itemId);
    expect(exemplars).toHaveLength(1);
    expect(exemplars[0]?.source_session_id).toBe(sessionId);
    expect(exemplars[0]?.source_image_id).toBe(imageId);
    expect(exemplars[0]?.quality_score).toBeGreaterThanOrEqual(0);
    expect(exemplars[0]?.quality_score).toBeLessThanOrEqual(1);
    expect(storage.putCalls).toHaveLength(1);
    expect(storage.putCalls[0]?.key).toBe(exemplars[0]?.crop_object_key);
  });

  it("does nothing when recognition-core is not configured", async () => {
    const userId = await insertUser();
    const itemId = await insertItem();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession(batchId, userId);
    await insertVerifiedImage({ sessionId, withCrop: true });

    await runHandler(new FakeImageStorage(), baseConfiguration(undefined), { sessionId, itemId });

    expect(await exemplarsFor(itemId)).toEqual([]);
  });

  it("does nothing once the item already holds the maximum number of exemplars", async () => {
    const userId = await insertUser();
    const itemId = await insertItem();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession(batchId, userId);
    await insertVerifiedImage({ sessionId, withCrop: true });
    await insertActiveExemplar(itemId);
    await insertActiveExemplar(itemId);
    await insertActiveExemplar(itemId);

    const baseUrl = await respondingExemplarServer();
    const storage = new FakeImageStorage();
    storage.put(`stock-capture/${sessionId}/1`);

    await runHandler(storage, baseConfiguration(baseUrl), { sessionId, itemId });

    expect(await exemplarsFor(itemId)).toHaveLength(3);
    expect(storage.putCalls).toHaveLength(0);
  });

  it("skips an image with no stored crop", async () => {
    const userId = await insertUser();
    const itemId = await insertItem();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession(batchId, userId);
    await insertVerifiedImage({ sessionId, withCrop: false });

    const baseUrl = await respondingExemplarServer();
    await runHandler(new FakeImageStorage(), baseConfiguration(baseUrl), { sessionId, itemId });

    expect(await exemplarsFor(itemId)).toEqual([]);
  });

  it("does nothing for a session that does not exist", async () => {
    const itemId = await insertItem();
    const baseUrl = await respondingExemplarServer();

    await expect(
      runHandler(new FakeImageStorage(), baseConfiguration(baseUrl), {
        sessionId: randomUUID(),
        itemId,
      }),
    ).resolves.toBeUndefined();
  });
});
