import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { CorrelationContext, StructuredLogger } from "@stockcontrol/platform";
import {
  createMigratorDatabase,
  createRuntimeDatabase,
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadWorkerDatabaseConfiguration,
  runMigrations,
  STOCKCONTROL_SCHEMA,
  type RecognitionSessionStatus,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";

import { sweepCaptureLifecycle } from "../src/recognition/capture-expiry-sweeper";

const REQUEST_HASH = "a".repeat(64);
const HOUR_MS = 60 * 60 * 1_000;

const silentLogger = (): StructuredLogger =>
  new StructuredLogger(new CorrelationContext(), "worker-test", { write: () => undefined });

describe.sequential("capture expiry sweeper", () => {
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
        display_name: "Capture Expiry Sweeper Test User",
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
    readonly status: RecognitionSessionStatus;
    readonly expiresAt: Date;
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
        status: input.status,
        photo_count: 1,
        expires_at: input.expiresAt,
      })
      .execute();
    return id;
  };

  const insertImage = async (sessionId: string, deleteAfter: Date): Promise<string> => {
    const id = randomUUID();
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_recognition_images")
      .values({
        id,
        session_id: sessionId,
        ordinal: 1,
        object_key: `stock-capture/${sessionId}/1`,
        sha256: "a".repeat(64),
        media_type: "image/jpeg",
        byte_length: 10,
        width: 10,
        height: 10,
        status: "Verified",
        delete_after: deleteAfter,
      })
      .execute();
    return id;
  };

  const sessionStatus = async (sessionId: string): Promise<string> =>
    database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_sessions")
      .select("status")
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow()
      .then((row) => row.status);

  const deleteObjectsJobFor = async (
    sessionId: string,
  ): Promise<{ readonly id: string } | undefined> =>
    database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_jobs")
      .select("id")
      .where("session_id", "=", sessionId)
      .where("job_type", "=", "DeleteObjects")
      .executeTakeFirst();

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
          .deleteFrom("stock_recognition_jobs")
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

  it("expires an overdue, still-open session and schedules its object deletion", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "ReviewReady",
      expiresAt: new Date(Date.now() - HOUR_MS),
    });

    const result = await sweepCaptureLifecycle(database, silentLogger());

    expect(result.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(await sessionStatus(sessionId)).toBe("Expired");
    expect(await deleteObjectsJobFor(sessionId)).toBeDefined();
  });

  it("leaves a committed session alone even though its expiry has passed", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Committed",
      expiresAt: new Date(Date.now() - HOUR_MS),
    });

    await sweepCaptureLifecycle(database, silentLogger());

    expect(await sessionStatus(sessionId)).toBe("Committed");
    expect(await deleteObjectsJobFor(sessionId)).toBeUndefined();
  });

  it("leaves a session with a future expiry untouched", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "Queued",
      expiresAt: new Date(Date.now() + HOUR_MS),
    });

    await sweepCaptureLifecycle(database, silentLogger());

    expect(await sessionStatus(sessionId)).toBe("Queued");
    expect(await deleteObjectsJobFor(sessionId)).toBeUndefined();
  });

  it("is idempotent: sweeping twice enqueues exactly one DeleteObjects job", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "ReviewReady",
      expiresAt: new Date(Date.now() - HOUR_MS),
    });

    await sweepCaptureLifecycle(database, silentLogger());
    await sweepCaptureLifecycle(database, silentLogger());

    const jobs = await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_jobs")
      .select("id")
      .where("session_id", "=", sessionId)
      .where("job_type", "=", "DeleteObjects")
      .execute();
    expect(jobs).toHaveLength(1);
  });

  it("schedules deletion for a session whose image is overdue even though the session has not expired", async () => {
    const userId = await insertUser();
    const batchId = await insertBatch(userId);
    const sessionId = await insertSession({
      batchId,
      actorUserId: userId,
      status: "ReviewReady",
      expiresAt: new Date(Date.now() + HOUR_MS),
    });
    await insertImage(sessionId, new Date(Date.now() - HOUR_MS));

    const result = await sweepCaptureLifecycle(database, silentLogger());

    expect(result.backstoppedSessions).toBeGreaterThanOrEqual(1);
    // The session itself is untouched: only its images were overdue.
    expect(await sessionStatus(sessionId)).toBe("ReviewReady");
    expect(await deleteObjectsJobFor(sessionId)).toBeDefined();
  });
});
