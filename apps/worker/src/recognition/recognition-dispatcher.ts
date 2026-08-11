import type { Kysely } from "kysely";

import type { BackgroundJobEnvelope } from "@stockcontrol/contracts";
import type { BackgroundJobDispatcher, StructuredLogger } from "@stockcontrol/platform";
import {
  claimJobs,
  completeJob,
  extendLease,
  failJob,
  queueDepth,
  releaseLease,
  type ClaimableJob,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";

/*
 * The poller that turns queued rows into handler calls.
 *
 * It is a self-scheduling loop rather than a `setInterval`. An interval fires
 * whether or not the previous tick finished, so the first job that outlasts the
 * interval gets a second poll running beside it, and by the time a model call
 * takes thirty seconds there are several. Scheduling the next poll only after
 * the current one returns makes overlap impossible without any locking.
 */

export interface RecognitionDispatcherOptions {
  /** Identifies this process in a lease. Distinct per replica. */
  readonly leaseOwner: string;
  readonly pollIntervalMilliseconds: number;
  readonly batchSize: number;
  readonly leaseMilliseconds: number;
  /** How often a running job's lease is pushed out. */
  readonly leaseRenewalMilliseconds: number;
}

export const DEFAULT_DISPATCHER_OPTIONS: Omit<RecognitionDispatcherOptions, "leaseOwner"> =
  Object.freeze({
    pollIntervalMilliseconds: 2_000,
    batchSize: 2,
    /*
     * Comfortably longer than the slowest expected job, because a lease that
     * expires under a healthy worker hands live work to a second one. Renewal
     * runs at well under half of it so a single missed tick cannot lose it.
     */
    leaseMilliseconds: 180_000,
    leaseRenewalMilliseconds: 45_000,
  });

/** A stable code for a handler that threw something with no code of its own. */
const UNCLASSIFIED_FAILURE = "worker.handler_failed";

/**
 * Errors may carry a stable code. Nothing else from the error is used: a
 * driver error's message carries the connection string, and a model error's
 * carries the prompt.
 */
const failureCodeOf = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { readonly code?: unknown };
    if (typeof code === "string" && /^[a-z][a-z0-9_.]{2,79}$/u.test(code)) return code;
  }
  return UNCLASSIFIED_FAILURE;
};

export class RecognitionDispatcher {
  private running = false;
  private draining = false;
  private timer: NodeJS.Timeout | undefined;
  private cycle: Promise<void> = Promise.resolve();
  /** Leases held right now, so a shutdown can hand them straight back. */
  private readonly inFlight = new Map<string, NodeJS.Timeout>();

  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly dispatcher: BackgroundJobDispatcher,
    private readonly logger: StructuredLogger,
    private readonly options: RecognitionDispatcherOptions,
  ) {}

  public start(): void {
    if (this.running) throw new Error("The recognition dispatcher has already started.");
    this.running = true;
    this.draining = false;
    this.scheduleNextPoll(0);
  }

  /**
   * Stops claiming, waits for work already running, and hands its leases back.
   * Returning a lease is not the same as failing the job: a deployment is not
   * the work going wrong, and charging it an attempt would eventually
   * dead-letter jobs that only ever met a restart.
   */
  public async drain(): Promise<void> {
    this.draining = true;
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.cycle;
  }

  /** One poll. Exposed so a test drives it directly instead of waiting. */
  public async pollOnce(): Promise<number> {
    if (this.draining) return 0;

    const claimed = await claimJobs(this.database, {
      leaseOwner: this.options.leaseOwner,
      limit: this.options.batchSize,
      leaseMilliseconds: this.options.leaseMilliseconds,
    });

    for (const job of claimed) {
      await this.run(job);
    }

    return claimed.length;
  }

  public async reportQueueDepth(): Promise<void> {
    const depth = await queueDepth(this.database);
    this.logger.log({ event: "recognition.queue.depth", ...depth });
  }

  private async run(job: ClaimableJob): Promise<void> {
    this.startLeaseRenewal(job);

    const envelope: BackgroundJobEnvelope = {
      id: job.id,
      type: job.jobType,
      payload: job.payload,
      attempt: job.attemptCount,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.dispatcher.dispatch(envelope);
      await completeJob(this.database, { jobId: job.id, leaseOwner: this.options.leaseOwner });
    } catch (error: unknown) {
      const outcome = await failJob(this.database, {
        jobId: job.id,
        leaseOwner: this.options.leaseOwner,
        errorCode: failureCodeOf(error),
      });
      this.logger.error({
        event: "recognition.job.failed",
        jobId: job.id,
        jobType: job.jobType,
        attempt: job.attemptCount,
        outcome: outcome ?? "lease_lost",
        errorCode: failureCodeOf(error),
      });
    } finally {
      this.stopLeaseRenewal(job.id);
    }
  }

  /**
   * Keeps the lease alive while a job runs. If the renewal ever fails the
   * worker has lost the job to somebody else and must stop renewing; carrying
   * on would let two workers believe they hold the same work.
   */
  private startLeaseRenewal(job: ClaimableJob): void {
    const timer = setInterval(() => {
      void extendLease(this.database, {
        jobId: job.id,
        leaseOwner: this.options.leaseOwner,
        leaseMilliseconds: this.options.leaseMilliseconds,
      })
        .then((held) => {
          if (!held) this.stopLeaseRenewal(job.id);
        })
        .catch(() => {
          this.stopLeaseRenewal(job.id);
        });
    }, this.options.leaseRenewalMilliseconds);

    timer.unref();
    this.inFlight.set(job.id, timer);
  }

  private stopLeaseRenewal(jobId: string): void {
    const timer = this.inFlight.get(jobId);
    if (timer !== undefined) {
      clearInterval(timer);
      this.inFlight.delete(jobId);
    }
  }

  /** Releases any lease still held. Called when the process is stopping. */
  public async releaseHeldLeases(): Promise<void> {
    const held = [...this.inFlight.keys()];
    for (const jobId of held) {
      this.stopLeaseRenewal(jobId);
      await releaseLease(this.database, { jobId, leaseOwner: this.options.leaseOwner }).catch(
        () => false,
      );
    }
  }

  private scheduleNextPoll(delayMilliseconds: number): void {
    if (!this.running) return;

    this.timer = setTimeout(() => {
      this.cycle = this.runCycle();
      void this.cycle;
    }, delayMilliseconds);
    this.timer.unref();
  }

  private async runCycle(): Promise<void> {
    try {
      const claimed = await this.pollOnce();
      /*
       * A poll that filled its batch is followed immediately by another: a
       * backlog should drain at the speed of the work, not at the speed of the
       * poll interval.
       */
      this.scheduleNextPoll(
        claimed >= this.options.batchSize ? 0 : this.options.pollIntervalMilliseconds,
      );
    } catch (error: unknown) {
      this.logger.error({
        event: "recognition.poll.failed",
        errorName: error instanceof Error ? error.name : "Unknown",
      });
      this.scheduleNextPoll(this.options.pollIntervalMilliseconds);
    }
  }
}
