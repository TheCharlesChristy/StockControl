import { randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
} from "../src/configuration";
import { createMigratorDatabase, createRuntimeDatabase } from "../src/connection";
import {
  claimJobs,
  completeJob,
  enqueueJob,
  extendLease,
  failJob,
  queueDepth,
  releaseLease,
} from "../src/jobs/job-store";
import { runMigrations } from "../src/migrations/runner";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "../src/schema";

/*
 * The queue against a real server. None of this is provable with a fake: the
 * behaviour under test is what PostgreSQL does when two transactions reach for
 * the same row, and `for update skip locked` is precisely the thing a mock
 * cannot simulate.
 */
describe.sequential("durable recognition job queue", () => {
  let migrator: Kysely<StockControlDatabase>;
  let runtime: Kysely<StockControlDatabase>;

  const suite = randomUUID();
  const enqueued: string[] = [];

  const enqueue = async (
    over: {
      readonly deduplicationKey?: string;
      readonly maxAttempts?: number;
      readonly availableAt?: Date;
    } = {},
  ): Promise<string> => {
    const id = randomUUID();
    const key = over.deduplicationKey ?? `${suite}:${id}`;
    const inserted = await runtime.transaction().execute((tx) =>
      enqueueJob(tx, {
        id,
        sessionId: null,
        jobType: "DeleteObjects",
        payloadVersion: 1,
        payload: { suite },
        deduplicationKey: key,
        maxAttempts: over.maxAttempts ?? 3,
        ...(over.availableAt === undefined ? {} : { availableAt: over.availableAt }),
      }),
    );
    if (inserted) enqueued.push(id);
    return id;
  };

  const rowOf = async (
    id: string,
  ): Promise<{
    readonly status: string;
    readonly attempt_count: number;
    readonly lease_owner: string | null;
    readonly available_at: Date;
    readonly last_error_code: string | null;
    readonly completed_at: Date | null;
  }> =>
    runtime
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_jobs")
      .select([
        "status",
        "attempt_count",
        "lease_owner",
        "available_at",
        "last_error_code",
        "completed_at",
      ])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

  beforeAll(async () => {
    const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
    migrator = createMigratorDatabase(loadMigratorDatabaseConfiguration());
    await runMigrations(migrator, {
      runtimeRole: databaseRoleFromConnectionString(runtimeConfiguration.connectionString),
    });
    runtime = createRuntimeDatabase(runtimeConfiguration);
  });

  afterEach(async () => {
    if (enqueued.length === 0) return;
    await runtime
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("stock_recognition_jobs")
      .where("id", "in", enqueued)
      .execute();
    enqueued.length = 0;
  });

  afterAll(async () => {
    await runtime.destroy();
    await migrator.destroy();
  });

  it("enqueues once for a deduplication key and reports the duplicate", async () => {
    const key = `${suite}:dedupe`;
    await enqueue({ deduplicationKey: key });

    const secondId = randomUUID();
    const inserted = await runtime.transaction().execute((tx) =>
      enqueueJob(tx, {
        id: secondId,
        sessionId: null,
        jobType: "DeleteObjects",
        payloadVersion: 1,
        payload: {},
        deduplicationKey: key,
        maxAttempts: 3,
      }),
    );

    expect(inserted).toBe(false);
  });

  it("claims a ready job, counts the attempt and takes a lease", async () => {
    const id = await enqueue();

    const [claimed] = await claimJobs(runtime, {
      leaseOwner: "worker-a",
      limit: 10,
      leaseMilliseconds: 60_000,
    });

    expect(claimed).toMatchObject({ id, attemptCount: 1, jobType: "DeleteObjects" });
    expect(claimed?.payload).toEqual({ suite });
    await expect(rowOf(id)).resolves.toMatchObject({ status: "Running", lease_owner: "worker-a" });
  });

  it("leaves work scheduled for later alone", async () => {
    await enqueue({ availableAt: new Date(Date.now() + 3_600_000) });

    const claimed = await claimJobs(runtime, {
      leaseOwner: "worker-a",
      limit: 10,
      leaseMilliseconds: 60_000,
    });

    expect(claimed).toEqual([]);
  });

  /*
   * The property the whole queue rests on. Two workers polling at the same
   * instant must partition the work, not duplicate it and not block on each
   * other — which is what `skip locked` buys and why the claim runs in its own
   * short transaction.
   */
  it("never hands the same job to two workers polling together", async () => {
    const ids = new Set<string>();
    for (let index = 0; index < 12; index += 1) ids.add(await enqueue());

    const [first, second, third] = await Promise.all([
      claimJobs(runtime, { leaseOwner: "worker-a", limit: 12, leaseMilliseconds: 60_000 }),
      claimJobs(runtime, { leaseOwner: "worker-b", limit: 12, leaseMilliseconds: 60_000 }),
      claimJobs(runtime, { leaseOwner: "worker-c", limit: 12, leaseMilliseconds: 60_000 }),
    ]);

    const claimedIds = [...first, ...second, ...third]
      .map(({ id }) => id)
      .filter((id) => ids.has(id));

    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(claimedIds).toHaveLength(ids.size);
  });

  /*
   * This is why the claim above used to flake roughly once in a hundred runs.
   * PostgreSQL stamps `available_at` with microseconds and a JavaScript Date
   * stops at the millisecond, so a job enqueued during the same millisecond as
   * a poll sat a few microseconds beyond a cutoff that could not express them
   * and read as not yet due. Freezing this process's clock inside that
   * millisecond is what turns a rare race into a test that fails every time
   * the cutoff is taken from this process instead of the server.
   */
  it("claims a job stamped later in the same millisecond as the poll", async () => {
    const id = await enqueue();

    const stamped = await runtime
      .withSchema(STOCKCONTROL_SCHEMA)
      .updateTable("stock_recognition_jobs")
      .set({
        available_at: sql<Date>`date_trunc('milliseconds', clock_timestamp()) + interval '900 microseconds'`,
      })
      .where("id", "=", id)
      .returning("available_at")
      .executeTakeFirstOrThrow();

    vi.useFakeTimers({ toFake: ["Date"], now: stamped.available_at });
    try {
      const claimed = await claimJobs(runtime, {
        leaseOwner: "worker-a",
        limit: 10,
        leaseMilliseconds: 60_000,
      });

      expect(claimed.map(({ id: claimedId }) => claimedId)).toContain(id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours the claim limit", async () => {
    for (let index = 0; index < 4; index += 1) await enqueue();

    const claimed = await claimJobs(runtime, {
      leaseOwner: "worker-a",
      limit: 2,
      leaseMilliseconds: 60_000,
    });

    expect(claimed).toHaveLength(2);
  });

  it("claims nothing when asked for nothing", async () => {
    await enqueue();
    await expect(
      claimJobs(runtime, { leaseOwner: "worker-a", limit: 0, leaseMilliseconds: 60_000 }),
    ).resolves.toEqual([]);
  });

  /* A worker that dies stops extending its lease; the work must come back. */
  it("recovers a job whose owner died mid-flight", async () => {
    const id = await enqueue();

    /* Took a one-millisecond lease and never came back. */
    await claimJobs(runtime, { leaseOwner: "worker-dead", limit: 10, leaseMilliseconds: 1 });
    await expect(rowOf(id)).resolves.toMatchObject({ status: "Running", attempt_count: 1 });

    const [reclaimed] = await claimJobs(runtime, {
      leaseOwner: "worker-b",
      limit: 10,
      leaseMilliseconds: 60_000,
      now: new Date(Date.now() + 1_000),
    });

    expect(reclaimed?.id).toBe(id);
    expect(reclaimed?.attemptCount).toBe(2);
    await expect(rowOf(id)).resolves.toMatchObject({ lease_owner: "worker-b" });
  });

  it("does not reclaim a job whose lease is still live", async () => {
    await enqueue();
    await claimJobs(runtime, { leaseOwner: "worker-a", limit: 10, leaseMilliseconds: 600_000 });

    await expect(
      claimJobs(runtime, { leaseOwner: "worker-b", limit: 10, leaseMilliseconds: 60_000 }),
    ).resolves.toEqual([]);
  });

  it("extends a lease for the worker that holds it", async () => {
    const id = await enqueue();
    await claimJobs(runtime, { leaseOwner: "worker-a", limit: 10, leaseMilliseconds: 60_000 });

    await expect(
      extendLease(runtime, { jobId: id, leaseOwner: "worker-a", leaseMilliseconds: 600_000 }),
    ).resolves.toBe(true);
  });

  /*
   * A worker whose lease expired must discover it lost the job rather than
   * quietly extending a lease somebody else now owns.
   */
  it("refuses to extend a lease the worker no longer owns", async () => {
    const id = await enqueue();
    await claimJobs(runtime, { leaseOwner: "worker-dead", limit: 10, leaseMilliseconds: 1 });
    await claimJobs(runtime, {
      leaseOwner: "worker-b",
      limit: 10,
      leaseMilliseconds: 60_000,
      now: new Date(Date.now() + 1_000),
    });

    await expect(
      extendLease(runtime, { jobId: id, leaseOwner: "worker-dead", leaseMilliseconds: 60_000 }),
    ).resolves.toBe(false);
  });

  it("completes a job and clears its lease", async () => {
    const id = await enqueue();
    await claimJobs(runtime, { leaseOwner: "worker-a", limit: 10, leaseMilliseconds: 60_000 });

    await expect(completeJob(runtime, { jobId: id, leaseOwner: "worker-a" })).resolves.toBe(true);
    const row = await rowOf(id);
    expect(row).toMatchObject({ status: "Succeeded", lease_owner: null });
    expect(row.completed_at).not.toBeNull();

    await expect(
      claimJobs(runtime, { leaseOwner: "worker-b", limit: 10, leaseMilliseconds: 60_000 }),
    ).resolves.toEqual([]);
  });

  it("refuses to complete a job another worker holds", async () => {
    const id = await enqueue();
    await claimJobs(runtime, { leaseOwner: "worker-a", limit: 10, leaseMilliseconds: 60_000 });

    await expect(completeJob(runtime, { jobId: id, leaseOwner: "worker-b" })).resolves.toBe(false);
  });

  it("schedules a retry in the future after a failure", async () => {
    const id = await enqueue({ maxAttempts: 3 });
    await claimJobs(runtime, { leaseOwner: "worker-a", limit: 10, leaseMilliseconds: 60_000 });

    await expect(
      failJob(runtime, { jobId: id, leaseOwner: "worker-a", errorCode: "core.unavailable" }),
    ).resolves.toBe("Retry");

    const row = await rowOf(id);
    expect(row).toMatchObject({
      status: "Retry",
      lease_owner: null,
      last_error_code: "core.unavailable",
    });
    expect(row.available_at.getTime()).toBeGreaterThan(Date.now());

    /* Backed off, so it is not immediately claimable again. */
    await expect(
      claimJobs(runtime, { leaseOwner: "worker-b", limit: 10, leaseMilliseconds: 60_000 }),
    ).resolves.toEqual([]);
  });

  it("dead-letters a job once its attempts are spent", async () => {
    const id = await enqueue({ maxAttempts: 2 });

    for (const attempt of [1, 2]) {
      await claimJobs(runtime, {
        leaseOwner: `worker-${String(attempt)}`,
        limit: 10,
        leaseMilliseconds: 60_000,
        now: new Date(Date.now() + 3_600_000),
      });
      const outcome = await failJob(runtime, {
        jobId: id,
        leaseOwner: `worker-${String(attempt)}`,
        errorCode: "core.unavailable",
        random: () => 0,
      });
      expect(outcome).toBe(attempt === 2 ? "Failed" : "Retry");
    }

    await expect(rowOf(id)).resolves.toMatchObject({ status: "Failed", attempt_count: 2 });

    /* A dead-lettered job is never picked up again by any worker. */
    await expect(
      claimJobs(runtime, {
        leaseOwner: "worker-3",
        limit: 10,
        leaseMilliseconds: 60_000,
        now: new Date(Date.now() + 86_400_000),
      }),
    ).resolves.toEqual([]);
  });

  it("truncates an over-long error code rather than failing the write", async () => {
    const id = await enqueue();
    await claimJobs(runtime, { leaseOwner: "worker-a", limit: 10, leaseMilliseconds: 60_000 });

    await failJob(runtime, { jobId: id, leaseOwner: "worker-a", errorCode: "x".repeat(400) });

    const row = await rowOf(id);
    expect(row.last_error_code).toHaveLength(80);
  });

  it("reports nothing when the failing worker does not hold the job", async () => {
    const id = await enqueue();
    await claimJobs(runtime, { leaseOwner: "worker-a", limit: 10, leaseMilliseconds: 60_000 });

    await expect(
      failJob(runtime, { jobId: id, leaseOwner: "worker-b", errorCode: "core.unavailable" }),
    ).resolves.toBeNull();
  });

  /*
   * A deployment interrupting a worker is not the job failing. Charging it an
   * attempt would eventually dead-letter work that nothing was ever wrong with.
   */
  it("returns work on shutdown without spending an attempt", async () => {
    const id = await enqueue();
    await claimJobs(runtime, { leaseOwner: "worker-a", limit: 10, leaseMilliseconds: 60_000 });
    await expect(rowOf(id)).resolves.toMatchObject({ attempt_count: 1 });

    await expect(releaseLease(runtime, { jobId: id, leaseOwner: "worker-a" })).resolves.toBe(true);
    await expect(rowOf(id)).resolves.toMatchObject({ attempt_count: 0, lease_owner: null });

    const [reclaimed] = await claimJobs(runtime, {
      leaseOwner: "worker-b",
      limit: 10,
      leaseMilliseconds: 60_000,
    });
    expect(reclaimed?.id).toBe(id);
    expect(reclaimed?.attemptCount).toBe(1);
  });

  it("reports the depth and oldest age an operator alerts on", async () => {
    const oldest = new Date(Date.now() - 600_000);
    await enqueue({ availableAt: oldest });
    await enqueue();

    const depth = await queueDepth(runtime);

    expect(depth.ready).toBeGreaterThanOrEqual(2);
    expect(depth.oldestReadyAgeMilliseconds).not.toBeNull();
    expect(depth.oldestReadyAgeMilliseconds ?? 0).toBeGreaterThanOrEqual(590_000);
  });
});
