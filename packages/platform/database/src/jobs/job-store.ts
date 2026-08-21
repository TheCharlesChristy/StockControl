import { sql, type Kysely, type Transaction } from "kysely";

import type {
  JsonObject,
  RecognitionJobStatus,
  RecognitionJobType,
  StockControlDatabase,
} from "../schema";
import { STOCKCONTROL_SCHEMA } from "../schema";
import { DEFAULT_RETRY_POLICY, isExhausted, nextAttemptAt, type RetryPolicy } from "./retry-policy";

/*
 * The durable queue from ADR 0004, over `stock_recognition_jobs`.
 *
 * The rule the whole design rests on: a job is claimed in one short
 * transaction, and the work itself happens outside it. Holding a transaction
 * open across a model call would pin a connection for a minute at a time and
 * turn a slow inference into a database incident. Instead the claim writes a
 * lease with an expiry, and a worker that dies simply stops extending it —
 * the next poll finds the lease expired and takes the job back.
 *
 * That means every handler must be idempotent: a job whose lease expired
 * mid-flight will run again, and there is no way to know from here whether the
 * first attempt had already had an effect.
 */

export type JobLeaseOwner = string;

export interface ClaimableJob {
  readonly id: string;
  readonly sessionId: string | null;
  readonly jobType: RecognitionJobType;
  readonly payloadVersion: number;
  readonly payload: JsonObject;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly deduplicationKey: string;
  readonly leasedUntil: Date;
}

export interface EnqueueJobInput {
  readonly id: string;
  readonly sessionId: string | null;
  readonly jobType: RecognitionJobType;
  readonly payloadVersion: number;
  readonly payload: JsonObject;
  readonly deduplicationKey: string;
  readonly maxAttempts: number;
  readonly availableAt?: Date;
}

export interface ClaimJobsOptions {
  readonly leaseOwner: JobLeaseOwner;
  readonly limit: number;
  readonly leaseMilliseconds: number;
  readonly now?: Date;
}

export interface QueueDepth {
  readonly ready: number;
  readonly running: number;
  readonly retrying: number;
  readonly failed: number;
  /** Age in milliseconds of the oldest claimable job, or null when idle. */
  readonly oldestReadyAgeMilliseconds: number | null;
}

type AnyDatabase = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

const schemaOf = (database: AnyDatabase): ReturnType<AnyDatabase["withSchema"]> =>
  database.withSchema(STOCKCONTROL_SCHEMA);

/**
 * Enqueues work. Takes a transaction so a session and the job that will process
 * it are inserted together: a session written without its job would sit in
 * `Queued` forever, and a job written without its session would fail on its
 * first attempt.
 *
 * Returns false when the deduplication key already exists, which is the whole
 * point — enqueueing the same work twice is a no-op rather than a duplicate.
 */
export const enqueueJob = async (
  tx: Transaction<StockControlDatabase>,
  input: EnqueueJobInput,
): Promise<boolean> => {
  const inserted = await schemaOf(tx)
    .insertInto("stock_recognition_jobs")
    .values({
      id: input.id,
      session_id: input.sessionId,
      job_type: input.jobType,
      payload_version: input.payloadVersion,
      payload: JSON.stringify(input.payload),
      deduplication_key: input.deduplicationKey,
      max_attempts: input.maxAttempts,
      ...(input.availableAt === undefined ? {} : { available_at: input.availableAt }),
    })
    .onConflict((conflict) => conflict.column("deduplication_key").doNothing())
    .executeTakeFirst();

  return Number(inserted.numInsertedOrUpdatedRows) > 0;
};

/**
 * Claims up to `limit` jobs for this worker.
 *
 * `for update skip locked` is what lets several workers poll the same table
 * without coordinating: a row another worker is already claiming is skipped
 * rather than waited for, so two workers never block each other and never take
 * the same job. `Running` rows are included because a lease that has expired is
 * exactly the crash-recovery case — the previous owner is gone and the work
 * must be picked up again.
 */
export const claimJobs = async (
  database: Kysely<StockControlDatabase>,
  options: ClaimJobsOptions,
): Promise<readonly ClaimableJob[]> => {
  const now = options.now ?? new Date();
  const leasedUntil = new Date(now.getTime() + options.leaseMilliseconds);
  if (options.limit < 1) return [];

  /*
   * What counts as "due" is asked of the server's clock, not this process's,
   * unless the caller pinned the time. `available_at` is stamped by PostgreSQL
   * on insert and keeps microseconds; a JavaScript Date stops at the
   * millisecond. Comparing the two hid every job enqueued during the same
   * millisecond as a poll: stamped a few microseconds past a cutoff that
   * cannot express microseconds, it read as not yet due. The following poll
   * collected it, so this surfaced as a rare late job rather than a stuck one
   * -- which is why it survived until it made the concurrent claim test flake.
   */
  const dueBy = options.now ?? sql<Date>`now()`;

  return database.transaction().execute(async (tx) => {
    const candidates = await schemaOf(tx)
      .selectFrom("stock_recognition_jobs")
      .select("id")
      .where((eb) =>
        eb.or([
          eb.and([
            eb("status", "in", ["Ready", "Retry"] satisfies RecognitionJobStatus[]),
            eb("available_at", "<=", dueBy),
          ]),
          /* A lease nobody is extending: the worker that held it is gone. */
          eb.and([eb("status", "=", "Running"), eb("leased_until", "<=", dueBy)]),
        ]),
      )
      .orderBy("available_at")
      .orderBy("id")
      .limit(options.limit)
      .forUpdate()
      .skipLocked()
      .execute();

    if (candidates.length === 0) return [];

    const claimed = await schemaOf(tx)
      .updateTable("stock_recognition_jobs")
      .set({
        status: "Running",
        lease_owner: options.leaseOwner,
        leased_until: leasedUntil,
        attempt_count: sql<number>`attempt_count + 1`,
        updated_at: now,
      })
      .where(
        "id",
        "in",
        candidates.map(({ id }) => id),
      )
      .returning([
        "id",
        "session_id",
        "job_type",
        "payload_version",
        "payload",
        "attempt_count",
        "max_attempts",
        "deduplication_key",
      ])
      .execute();

    return claimed.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      jobType: row.job_type,
      payloadVersion: row.payload_version,
      payload: row.payload,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      deduplicationKey: row.deduplication_key,
      leasedUntil,
    }));
  });
};

/**
 * Pushes a lease out while work is still running. Conditioned on this worker
 * still owning it, so a worker whose lease already expired and was taken by
 * somebody else cannot reclaim it by extending — it discovers it lost instead.
 */
export const extendLease = async (
  database: Kysely<StockControlDatabase>,
  input: {
    readonly jobId: string;
    readonly leaseOwner: JobLeaseOwner;
    readonly leaseMilliseconds: number;
    readonly now?: Date;
  },
): Promise<boolean> => {
  const now = input.now ?? new Date();
  const result = await schemaOf(database)
    .updateTable("stock_recognition_jobs")
    .set({ leased_until: new Date(now.getTime() + input.leaseMilliseconds), updated_at: now })
    .where("id", "=", input.jobId)
    .where("lease_owner", "=", input.leaseOwner)
    .where("status", "=", "Running")
    .executeTakeFirst();

  return Number(result.numUpdatedRows) > 0;
};

export const completeJob = async (
  database: Kysely<StockControlDatabase>,
  input: { readonly jobId: string; readonly leaseOwner: JobLeaseOwner; readonly now?: Date },
): Promise<boolean> => {
  const now = input.now ?? new Date();
  const result = await schemaOf(database)
    .updateTable("stock_recognition_jobs")
    .set({
      status: "Succeeded",
      lease_owner: null,
      leased_until: null,
      last_error_code: null,
      completed_at: now,
      updated_at: now,
    })
    .where("id", "=", input.jobId)
    .where("lease_owner", "=", input.leaseOwner)
    .executeTakeFirst();

  return Number(result.numUpdatedRows) > 0;
};

export type JobFailureOutcome = "Retry" | "Failed";

/**
 * Records a failure and decides whether the job gets another attempt.
 *
 * `errorCode` is a stable code and nothing else. A driver error carries the
 * connection string, a model error carries the prompt, and an OCR error can
 * carry a customer's label text; none of that belongs in a queue row somebody
 * will later paste into a support ticket.
 */
export const failJob = async (
  database: Kysely<StockControlDatabase>,
  input: {
    readonly jobId: string;
    readonly leaseOwner: JobLeaseOwner;
    readonly errorCode: string;
    readonly now?: Date;
    readonly random?: () => number;
    readonly policy?: RetryPolicy;
  },
): Promise<JobFailureOutcome | null> => {
  const now = input.now ?? new Date();

  const job = await schemaOf(database)
    .selectFrom("stock_recognition_jobs")
    .select(["attempt_count", "max_attempts"])
    .where("id", "=", input.jobId)
    .where("lease_owner", "=", input.leaseOwner)
    .executeTakeFirst();

  if (job === undefined) return null;

  const exhausted = isExhausted({
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
  });

  /*
   * An exhausted job moves to a visible failed state rather than being retried
   * forever or quietly dropped. ADR 0004 is explicit that this must be
   * actionable, which is why the queue-depth query below counts it.
   */
  const availableAt = exhausted
    ? now
    : nextAttemptAt({
        attempt: job.attempt_count,
        now,
        random: input.random ?? Math.random,
        ...(input.policy === undefined ? {} : { policy: input.policy }),
      });

  const result = await schemaOf(database)
    .updateTable("stock_recognition_jobs")
    .set({
      status: exhausted ? "Failed" : "Retry",
      lease_owner: null,
      leased_until: null,
      last_error_code: input.errorCode.slice(0, 80),
      available_at: availableAt,
      updated_at: now,
      ...(exhausted ? { completed_at: now } : {}),
    })
    .where("id", "=", input.jobId)
    .where("lease_owner", "=", input.leaseOwner)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) return null;
  return exhausted ? "Failed" : "Retry";
};

/**
 * Releases a lease without counting the attempt against the job. Used when the
 * worker is shutting down: the work did not fail, it simply did not start, and
 * charging it an attempt would eventually dead-letter a job that a deployment
 * interrupted often enough.
 */
export const releaseLease = async (
  database: Kysely<StockControlDatabase>,
  input: { readonly jobId: string; readonly leaseOwner: JobLeaseOwner; readonly now?: Date },
): Promise<boolean> => {
  const now = input.now ?? new Date();
  const result = await schemaOf(database)
    .updateTable("stock_recognition_jobs")
    .set({
      status: "Retry",
      lease_owner: null,
      leased_until: null,
      available_at: now,
      attempt_count: sql<number>`greatest(attempt_count - 1, 0)`,
      updated_at: now,
    })
    .where("id", "=", input.jobId)
    .where("lease_owner", "=", input.leaseOwner)
    .where("status", "=", "Running")
    .executeTakeFirst();

  return Number(result.numUpdatedRows) > 0;
};

/** The numbers section 17 requires an operator to be able to alert on. */
export const queueDepth = async (
  database: Kysely<StockControlDatabase>,
  now: Date = new Date(),
): Promise<QueueDepth> => {
  const counts = await schemaOf(database)
    .selectFrom("stock_recognition_jobs")
    .select(({ fn }) => [
      "status",
      fn.count<string>("id").as("total"),
      fn.min<Date | null>("available_at").as("oldest"),
    ])
    .groupBy("status")
    .execute();

  const totalFor = (status: RecognitionJobStatus): number =>
    Number(counts.find((row) => row.status === status)?.total ?? 0);

  const claimableOldest = counts
    .filter((row) => row.status === "Ready" || row.status === "Retry")
    .map((row) => row.oldest)
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.getTime() - right.getTime())[0];

  return {
    ready: totalFor("Ready"),
    running: totalFor("Running"),
    retrying: totalFor("Retry"),
    failed: totalFor("Failed"),
    oldestReadyAgeMilliseconds:
      claimableOldest === undefined ? null : Math.max(0, now.getTime() - claimableOldest.getTime()),
  };
};

export { DEFAULT_RETRY_POLICY, isExhausted, nextAttemptAt, type RetryPolicy };
