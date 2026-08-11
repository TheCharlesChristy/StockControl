import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BackgroundJobDispatcher,
  CorrelationContext,
  StructuredLogger,
} from "@stockcontrol/platform";
import {
  createRuntimeDatabase,
  databaseRoleFromConnectionString,
  enqueueJob,
  loadMigratorDatabaseConfiguration,
  loadWorkerDatabaseConfiguration,
  createMigratorDatabase,
  runMigrations,
  STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";

import { RecognitionDispatcher } from "../src/recognition/recognition-dispatcher";

/*
 * The dispatcher against a real queue. A faked store would prove the
 * dispatcher calls the functions we wrote; what needs proving is that a job
 * genuinely leaves the queue when a handler succeeds, comes back when it
 * throws, and is handed straight back when the process is stopping.
 */
describe.sequential("recognition dispatcher", () => {
  let migrator: Kysely<StockControlDatabase>;
  let database: Kysely<StockControlDatabase>;

  const suite = randomUUID();
  const enqueued: string[] = [];

  const silentLogger = (): StructuredLogger =>
    new StructuredLogger(new CorrelationContext(), "worker-test", { write: () => undefined });

  const dispatcherFor = (
    jobs: BackgroundJobDispatcher,
    leaseOwner: string,
  ): RecognitionDispatcher =>
    new RecognitionDispatcher(database, jobs, silentLogger(), {
      leaseOwner,
      pollIntervalMilliseconds: 50,
      batchSize: 5,
      leaseMilliseconds: 60_000,
      leaseRenewalMilliseconds: 20_000,
    });

  const enqueue = async (jobType: "Recognize" | "DeleteObjects" = "Recognize"): Promise<string> => {
    const id = randomUUID();
    await database.transaction().execute((tx) =>
      enqueueJob(tx, {
        id,
        sessionId: null,
        jobType,
        payloadVersion: 1,
        payload: { suite },
        deduplicationKey: `${suite}:${id}`,
        maxAttempts: 3,
      }),
    );
    enqueued.push(id);
    return id;
  };

  const rowOf = async (
    id: string,
  ): Promise<{
    readonly status: string;
    readonly attempt_count: number;
    readonly lease_owner: string | null;
  }> =>
    database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_jobs")
      .select(["status", "attempt_count", "lease_owner"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

  /* Polls rather than sleeping: the claim lands on its own schedule. */
  const waitFor = async (condition: () => Promise<boolean>): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await condition()) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("The expected queue state never arrived.");
  };

  const statusOf = async (id: string): Promise<string> =>
    (
      await database
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom("stock_recognition_jobs")
        .select("status")
        .where("id", "=", id)
        .executeTakeFirstOrThrow()
    ).status;

  beforeAll(async () => {
    const workerConfiguration = loadWorkerDatabaseConfiguration();
    migrator = createMigratorDatabase(loadMigratorDatabaseConfiguration());
    await runMigrations(migrator, {
      runtimeRole: databaseRoleFromConnectionString(workerConfiguration.connectionString),
    });
    database = createRuntimeDatabase(workerConfiguration);
  });

  afterEach(async () => {
    if (enqueued.length === 0) return;
    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("stock_recognition_jobs")
      .where("id", "in", enqueued)
      .execute();
    enqueued.length = 0;
  });

  afterAll(async () => {
    await database.destroy();
    await migrator.destroy();
  });

  it("runs a claimed job through its registered handler and clears it", async () => {
    const seen: string[] = [];
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    jobs.register("Recognize", (job) => {
      seen.push(job.id);
      return Promise.resolve();
    });

    const id = await enqueue();
    const claimed = await dispatcherFor(jobs, "worker-a").pollOnce();

    expect(claimed).toBe(1);
    expect(seen).toEqual([id]);
    await expect(statusOf(id)).resolves.toBe("Succeeded");
  });

  it("passes the stored payload and attempt number to the handler", async () => {
    let envelope: { readonly payload: unknown; readonly attempt: number } | undefined;
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    jobs.register("Recognize", (job) => {
      envelope = { payload: job.payload, attempt: job.attempt };
      return Promise.resolve();
    });

    await enqueue();
    await dispatcherFor(jobs, "worker-a").pollOnce();

    expect(envelope).toEqual({ payload: { suite }, attempt: 1 });
  });

  it("returns a job to the queue when its handler throws", async () => {
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    jobs.register("Recognize", () => Promise.reject(new Error("core unreachable")));

    const id = await enqueue();
    await dispatcherFor(jobs, "worker-a").pollOnce();

    await expect(statusOf(id)).resolves.toBe("Retry");
  });

  /*
   * An unregistered type is a deployment mistake, not a transient fault, but it
   * must still leave the job in a state somebody can see rather than crashing
   * the poll loop and stalling everything behind it.
   */
  it("survives a job type nothing is registered for", async () => {
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    jobs.register("Recognize", () => Promise.resolve());

    const id = await enqueue("DeleteObjects");
    await expect(dispatcherFor(jobs, "worker-a").pollOnce()).resolves.toBe(1);

    await expect(statusOf(id)).resolves.toBe("Retry");
  });

  it("records a stable failure code and never the error's message", async () => {
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    jobs.register("Recognize", () =>
      Promise.reject(
        Object.assign(new Error("postgresql://app:hunter2@db.internal/stock"), {
          code: "core.unavailable",
        }),
      ),
    );

    const id = await enqueue();
    await dispatcherFor(jobs, "worker-a").pollOnce();

    const row = await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_jobs")
      .select("last_error_code")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

    expect(row.last_error_code).toBe("core.unavailable");
  });

  it("does not let an error's own message become the failure code", async () => {
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    jobs.register("Recognize", () =>
      Promise.reject(new Error("connection to db.internal refused for user app")),
    );

    const id = await enqueue();
    await dispatcherFor(jobs, "worker-a").pollOnce();

    const row = await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_jobs")
      .select("last_error_code")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();

    expect(row.last_error_code).toBe("worker.handler_failed");
  });

  it("claims nothing once it has been told to drain", async () => {
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    jobs.register("Recognize", () => Promise.resolve());

    const id = await enqueue();
    const dispatcher = dispatcherFor(jobs, "worker-a");
    await dispatcher.drain();

    await expect(dispatcher.pollOnce()).resolves.toBe(0);
    await expect(statusOf(id)).resolves.toBe("Ready");
  });

  /*
   * A deployment interrupting a worker is not the job failing. Handing the
   * lease straight back lets another replica start immediately instead of
   * waiting out the lease, and costs the job no attempt — otherwise frequent
   * deployments would eventually dead-letter work nothing was wrong with.
   */
  it("hands a lease back mid-flight without spending an attempt", async () => {
    let release: (() => void) | undefined;
    const inHandler = new Promise<void>((resolve) => {
      release = resolve;
    });
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    jobs.register("Recognize", () => inHandler);

    const id = await enqueue();
    const dispatcher = dispatcherFor(jobs, "worker-a");
    const polling = dispatcher.pollOnce();

    await waitFor(async () => (await statusOf(id)) === "Running");
    await expect(rowOf(id)).resolves.toMatchObject({ attempt_count: 1, lease_owner: "worker-a" });

    await dispatcher.releaseHeldLeases();

    await expect(rowOf(id)).resolves.toMatchObject({
      status: "Retry",
      attempt_count: 0,
      lease_owner: null,
    });

    /*
     * The handler finishing afterwards must not resurrect the claim: the job
     * belongs to whoever picks it up next, and completing it here would mark
     * work done that another worker is about to redo.
     */
    release?.();
    await polling;
    await expect(rowOf(id)).resolves.toMatchObject({ status: "Retry", lease_owner: null });
  });

  it("reports queue depth without throwing on an empty queue", async () => {
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    await expect(dispatcherFor(jobs, "worker-a").reportQueueDepth()).resolves.toBeUndefined();
  });

  it("refuses to start twice", () => {
    const jobs = new BackgroundJobDispatcher(new CorrelationContext(), silentLogger());
    const dispatcher = dispatcherFor(jobs, "worker-a");
    dispatcher.start();
    try {
      expect(() => {
        dispatcher.start();
      }).toThrow(/already started/u);
    } finally {
      void dispatcher.drain();
    }
  });
});
