import { describe, expect, it } from "vitest";

import { SignInRateLimiter } from "../../src/auth/sign-in-rate-limiter";

describe("sign-in rate limiter", () => {
  it("blocks an account after its failure allowance and reports when to retry", () => {
    let now = 1_000;
    const limiter = new SignInRateLimiter(
      { accountLimit: 2, sourceLimit: 10, windowMilliseconds: 60_000 },
      () => now,
    );

    limiter.recordFailure(" Admin@Example.com ", "192.0.2.10");
    limiter.recordFailure("admin@example.com", "192.0.2.11");

    expect(limiter.check("ADMIN@example.com", "192.0.2.12")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });

    now += 60_000;
    expect(limiter.check("admin@example.com", "192.0.2.12")).toEqual({ allowed: true });
  });

  it("limits failures from one source across multiple accounts", () => {
    const limiter = new SignInRateLimiter({
      accountLimit: 10,
      sourceLimit: 2,
      windowMilliseconds: 60_000,
    });

    limiter.recordFailure("one@example.com", "192.0.2.10");
    limiter.recordFailure("two@example.com", "192.0.2.10");

    expect(limiter.check("three@example.com", "192.0.2.10").allowed).toBe(false);
  });

  it("clears the account failures after a successful sign-in", () => {
    const limiter = new SignInRateLimiter({
      accountLimit: 1,
      sourceLimit: 10,
      windowMilliseconds: 60_000,
    });

    limiter.recordFailure("admin@example.com", "192.0.2.10");
    expect(limiter.check("admin@example.com", "192.0.2.11").allowed).toBe(false);

    limiter.recordSuccess("ADMIN@example.com");
    expect(limiter.check("admin@example.com", "192.0.2.11").allowed).toBe(true);
  });
});
