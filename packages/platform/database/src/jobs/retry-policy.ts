/*
 * When a failed job may be tried again. Pure, so the schedule can be asserted
 * rather than observed by waiting.
 *
 * Exponential with full jitter, as ADR 0004 requires. The jitter is the point:
 * without it, a model service that goes down takes every in-flight job with it
 * and every one of them retries at the same instant, so the service comes back
 * to the same stampede that pushed it over. Spreading the retries across the
 * window is what turns an outage into a queue rather than a loop.
 */

export interface RetryPolicy {
  readonly baseDelayMilliseconds: number;
  /** Caps the exponential so a long-failing job still retries within the hour. */
  readonly maximumDelayMilliseconds: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  baseDelayMilliseconds: 5_000,
  maximumDelayMilliseconds: 900_000,
});

/**
 * `random` is injected rather than called directly so a test can pin the
 * jitter. It must return a value in [0, 1).
 */
export const nextAttemptAt = (input: {
  readonly attempt: number;
  readonly now: Date;
  readonly random: () => number;
  readonly policy?: RetryPolicy;
}): Date => {
  const policy = input.policy ?? DEFAULT_RETRY_POLICY;
  const attempt = Math.max(1, Math.floor(input.attempt));

  /*
   * Shifting rather than `Math.pow` keeps the intermediate finite: attempt 2000
   * would otherwise produce Infinity, and `new Date(Infinity)` is an invalid
   * date that PostgreSQL rejects with an error nobody can read.
   */
  const exponent = Math.min(attempt - 1, 30);
  const ceiling = Math.min(
    policy.maximumDelayMilliseconds,
    policy.baseDelayMilliseconds * 2 ** exponent,
  );

  const jittered = Math.floor(ceiling * clampRandom(input.random()));

  /*
   * A floor of one base delay, so a job that fails instantly cannot be
   * reclaimed in the same tick and spin the worker.
   */
  const delay = Math.max(policy.baseDelayMilliseconds, jittered);
  return new Date(input.now.getTime() + delay);
};

const clampRandom = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

/** Whether this failure was the last one the job was allowed. */
export const isExhausted = (input: {
  readonly attemptCount: number;
  readonly maxAttempts: number;
}): boolean => input.attemptCount >= input.maxAttempts;
