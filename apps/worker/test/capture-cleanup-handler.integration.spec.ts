import { randomUUID } from "node:crypto";

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

import { createCaptureCleanupHandler } from "../src/recognition/capture-cleanup-handler";
import type { DownloadedObject, ImageStorage } from "../src/recognition/image-storage";

const REQUEST_HASH = "a".repeat(64);

class FakeImageStorage implements ImageStorage {
  public readonly deletedKeys: string[] = [];
  private readonly objects = new Map<string, DownloadedObject>();

  public put(key: string): void {
    this.objects.set(key, { bytes: Buffer.from("fake"), mediaType: "image/jpeg" });
  }

  public async getObject(key: string): Promise<DownloadedObject> {
    const object = this.objects.get(key);
    if (object === undefined) throw new Error(`No fake object for ${key}`);
    return Promise.resolve(object);
  }

  public async putObject(): Promise<void> {
    return Promise.resolve();
  }

  public async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    this.deletedKeys.push(key);
    return Promise.resolve();
  }
}

const silentLogger = (): StructuredLogger =>
  new StructuredLogger(new CorrelationContext(), "worker-test", { write: () => undefined });

describe.sequential("capture cleanup handler", () => {
  let migrator: Kysely<StockControlDatabase>;
  let database: Kysely<StockControlDatabase>;
  const createdUserIds: string[] = [];
  const createdBatchIds: string[] = [];

  const insertUser = async (): Promise<string> => {
    const id = randomUUID();
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("users")
      .values({
        id,
        email: `${id}@example.invalid`,
        display_name: "Capture Cleanup Test User",
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
        status: "Cancelled",
        photo_count: 1,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      })
      .execute();
    return id;
  };

  const insertImage = async (sessionId: string, ordinal: number): Promise<string> => {
    const id = randomUUID();
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_recognition_images")
      .values({
        id,
        session_id: sessionId,
        ordinal,
        object_key: `stock-capture/${sessionId}/${String(ordinal)}`,
        sha256: "a".repeat(64),
        media_type: "image/jpeg",
        byte_length: 10,
        width: 10,
        height: 10,
        status: "Verified",
        delete_after: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      })
      .execute();
    return id;
  };

  const imageRow = async (
    imageId: string,
  ): Promise<{ readonly status: string; readonly deleted_at: Date | null }> =>
    database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_images")
      .select(["status", "deleted_at"])
      .where("id", "=", imageId)
      .executeTakeFirstOrThrow();

  const runHandler = (imageStorage: ImageStorage, sessionId: string): Promise<void> => {
    const handler = createCaptureCleanupHandler({ database, imageStorage, logger: silentLogger() });
    const job: BackgroundJobEnvelope<{ readonly sessionId: string }> = {
      id: randomUUID(),
      type: "DeleteObjects",
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

  it("deletes every undeleted image's object and marks it Deleted", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession(batchId, userId);
    const firstImage = await insertImage(sessionId, 1);
    const secondImage = await insertImage(sessionId, 2);

    const storage = new FakeImageStorage();
    storage.put(`stock-capture/${sessionId}/1`);
    storage.put(`stock-capture/${sessionId}/2`);

    await runHandler(storage, sessionId);

    expect(storage.deletedKeys).toContain(`stock-capture/${sessionId}/1`);
    expect(storage.deletedKeys).toContain(`stock-capture/${sessionId}/2`);

    const first = await imageRow(firstImage);
    const second = await imageRow(secondImage);
    expect(first.status).toBe("Deleted");
    expect(first.deleted_at).not.toBeNull();
    expect(second.status).toBe("Deleted");
    expect(second.deleted_at).not.toBeNull();
  });

  it("does nothing for a session with no images", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession(batchId, userId);

    await expect(runHandler(new FakeImageStorage(), sessionId)).resolves.toBeUndefined();
  });

  it("is idempotent: a retry does not re-delete an already-deleted image", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession(batchId, userId);
    await insertImage(sessionId, 1);
    const storage = new FakeImageStorage();
    storage.put(`stock-capture/${sessionId}/1`);

    await runHandler(storage, sessionId);
    expect(storage.deletedKeys).toHaveLength(1);

    await runHandler(storage, sessionId);
    expect(storage.deletedKeys).toHaveLength(1);
  });

  it("does nothing for a session that does not exist", async () => {
    await expect(runHandler(new FakeImageStorage(), randomUUID())).resolves.toBeUndefined();
  });
});
