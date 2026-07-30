import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTHENTICATION_RATE_LIMITS,
  clearAuthenticationFailures,
  createAuthenticationRateLimitRule,
  evaluateAuthenticationRateLimit,
  recordAuthenticationFailure,
} from "../src/identity/policies/rate-limit-policy";

const instant = (value: string): Date => new Date(value);
const rule = DEFAULT_AUTHENTICATION_RATE_LIMITS.SignInAccount;

describe("authentication rate limiting", () => {
  it("allows an empty bucket and records a bounded first failure", () => {
    const now = instant("2026-07-29T10:00:00.000Z");
    expect(evaluateAuthenticationRateLimit(undefined, now, rule)).toEqual({
      allowed: true,
    });
    expect(recordAuthenticationFailure(undefined, now, rule)).toEqual({
      windowStartedAt: now,
      expiresAt: instant("2026-07-29T10:15:00.000Z"),
      failureCount: 1,
    });
  });

  it("blocks at the failure threshold and returns one generic retry instant", () => {
    const startedAt = instant("2026-07-29T10:00:00.000Z");
    let bucket = recordAuthenticationFailure(undefined, startedAt, rule);
    for (let attempt = 2; attempt <= rule.maximumFailures; attempt += 1) {
      bucket = recordAuthenticationFailure(
        bucket,
        instant(`2026-07-29T10:0${String(attempt)}:00.000Z`),
        rule,
      );
    }

    expect(bucket.failureCount).toBe(5);
    expect(bucket.blockedUntil).toEqual(instant("2026-07-29T10:20:00.000Z"));
    expect(
      evaluateAuthenticationRateLimit(bucket, instant("2026-07-29T10:19:59.999Z"), rule),
    ).toEqual({
      allowed: false,
      reason: "Blocked",
      retryAt: instant("2026-07-29T10:20:00.000Z"),
    });
  });

  it("uses the window expiry when a threshold bucket has no explicit block", () => {
    expect(
      evaluateAuthenticationRateLimit(
        {
          windowStartedAt: instant("2026-07-29T10:00:00.000Z"),
          expiresAt: instant("2026-07-29T10:15:00.000Z"),
          failureCount: 5,
        },
        instant("2026-07-29T10:10:00.000Z"),
        rule,
      ),
    ).toEqual({
      allowed: false,
      reason: "FailureLimitReached",
      retryAt: instant("2026-07-29T10:15:00.000Z"),
    });
  });

  it("starts a clean window after expiry and discards an expired block", () => {
    const expired = {
      windowStartedAt: instant("2026-07-29T10:00:00.000Z"),
      expiresAt: instant("2026-07-29T10:15:00.000Z"),
      failureCount: 5,
      blockedUntil: instant("2026-07-29T10:14:00.000Z"),
    };
    const now = instant("2026-07-29T10:16:00.000Z");

    expect(evaluateAuthenticationRateLimit(expired, now, rule)).toEqual({
      allowed: true,
    });
    expect(recordAuthenticationFailure(expired, now, rule)).toEqual({
      windowStartedAt: now,
      expiresAt: instant("2026-07-29T10:31:00.000Z"),
      failureCount: 1,
    });
  });

  it("never shortens an active block while recording another failure", () => {
    const bucket = {
      windowStartedAt: instant("2026-07-29T10:00:00.000Z"),
      expiresAt: instant("2026-07-29T10:15:00.000Z"),
      failureCount: 4,
      blockedUntil: instant("2026-07-29T10:30:00.000Z"),
    };

    expect(recordAuthenticationFailure(bucket, instant("2026-07-29T10:05:00.000Z"), rule)).toEqual({
      windowStartedAt: bucket.windowStartedAt,
      expiresAt: bucket.expiresAt,
      failureCount: 5,
      blockedUntil: instant("2026-07-29T10:30:00.000Z"),
    });
  });

  it("clears account failures after successful authentication", () => {
    expect(clearAuthenticationFailures()).toBeUndefined();
  });

  it.each([
    { windowSeconds: 59, maximumFailures: 5, blockSeconds: 60 },
    { windowSeconds: 86_401, maximumFailures: 5, blockSeconds: 60 },
    { windowSeconds: 60, maximumFailures: 0, blockSeconds: 60 },
    { windowSeconds: 60, maximumFailures: 1_001, blockSeconds: 60 },
    { windowSeconds: 60, maximumFailures: 5, blockSeconds: 59 },
    { windowSeconds: 60.5, maximumFailures: 5, blockSeconds: 60 },
  ])("rejects the unsafe rule $windowSeconds/$maximumFailures/$blockSeconds", (candidate) => {
    expect(() => createAuthenticationRateLimitRule(candidate)).toThrow("1-minute to 24-hour");
  });

  it("rejects corrupt buckets and invalid time values", () => {
    const now = instant("2026-07-29T10:00:00.000Z");
    expect(() =>
      evaluateAuthenticationRateLimit(
        {
          windowStartedAt: now,
          expiresAt: now,
          failureCount: 0,
        },
        now,
        rule,
      ),
    ).toThrow("internally inconsistent");
    expect(() =>
      evaluateAuthenticationRateLimit(
        {
          windowStartedAt: now,
          expiresAt: instant("2026-07-29T10:15:00.000Z"),
          failureCount: -1,
        },
        now,
        rule,
      ),
    ).toThrow("internally inconsistent");
    expect(() => evaluateAuthenticationRateLimit(undefined, new Date(Number.NaN), rule)).toThrow(
      "valid instant",
    );
  });
});
