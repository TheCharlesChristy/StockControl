import { describe, expect, it } from "vitest";

import { DEFAULT_RETRY_POLICY, isExhausted, nextAttemptAt } from "../src/jobs/retry-policy";

const now = new Date("2026-08-09T12:00:00.000Z");
const delayFor = (attempt: number, random: number): number =>
  nextAttemptAt({ attempt, now, random: () => random }).getTime() - now.getTime();

describe("retry scheduling", () => {
  it("grows the retry window exponentially", () => {
    expect(delayFor(1, 1)).toBe(5_000);
    expect(delayFor(2, 1)).toBe(10_000);
    expect(delayFor(3, 1)).toBe(20_000);
    expect(delayFor(4, 1)).toBe(40_000);
  });

  it("caps the window so a long-failing job still retries within the hour", () => {
    expect(delayFor(30, 1)).toBe(DEFAULT_RETRY_POLICY.maximumDelayMilliseconds);
  });

  /*
   * Without jitter, a model service that goes down takes every in-flight job
   * with it and they all retry at the same instant — so the service comes back
   * to the stampede that pushed it over. This is the property that matters.
   */
  it("spreads retries across the window rather than bunching them", () => {
    const delays = [0, 0.25, 0.5, 0.75, 1].map((random) => delayFor(5, random));
    expect(new Set(delays).size).toBeGreaterThan(1);
    expect(Math.max(...delays)).toBe(80_000);
  });

  /* A job that fails instantly must not be reclaimable in the same tick. */
  it("never schedules a retry sooner than one base delay", () => {
    expect(delayFor(1, 0)).toBe(DEFAULT_RETRY_POLICY.baseDelayMilliseconds);
    expect(delayFor(9, 0)).toBe(DEFAULT_RETRY_POLICY.baseDelayMilliseconds);
  });

  /*
   * `Math.pow` would reach Infinity here, and `new Date(Infinity)` is an
   * invalid date PostgreSQL rejects with an error nobody can read.
   */
  it("stays a valid date for an absurd attempt number", () => {
    const scheduled = nextAttemptAt({ attempt: 2_000, now, random: () => 1 });
    expect(Number.isNaN(scheduled.getTime())).toBe(false);
    expect(scheduled.getTime() - now.getTime()).toBe(DEFAULT_RETRY_POLICY.maximumDelayMilliseconds);
  });

  it("treats a broken random source as no jitter rather than an invalid date", () => {
    expect(nextAttemptAt({ attempt: 3, now, random: () => Number.NaN }).getTime()).toBe(
      now.getTime() + DEFAULT_RETRY_POLICY.baseDelayMilliseconds,
    );
  });

  it("accepts a caller policy", () => {
    expect(
      nextAttemptAt({
        attempt: 2,
        now,
        random: () => 1,
        policy: { baseDelayMilliseconds: 1_000, maximumDelayMilliseconds: 4_000 },
      }).getTime() - now.getTime(),
    ).toBe(2_000);
  });

  it("clamps a zero or negative attempt to the first one", () => {
    expect(delayFor(0, 1)).toBe(5_000);
    expect(delayFor(-3, 1)).toBe(5_000);
  });
});

describe("attempt exhaustion", () => {
  it("is exhausted only once the last allowed attempt has been used", () => {
    expect(isExhausted({ attemptCount: 4, maxAttempts: 5 })).toBe(false);
    expect(isExhausted({ attemptCount: 5, maxAttempts: 5 })).toBe(true);
    expect(isExhausted({ attemptCount: 6, maxAttempts: 5 })).toBe(true);
  });
});
