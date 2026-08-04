import { describe, expect, it } from "vitest";

import { SignInRateLimiter, type SignInRateLimitPolicy } from "../../src/auth/sign-in-rate-limiter";

const policy = (overrides: Partial<SignInRateLimitPolicy> = {}): SignInRateLimitPolicy => ({
  accountLimit: 10,
  sourceLimit: 10,
  globalLimit: 1_000,
  windowMilliseconds: 60_000,
  ...overrides,
});

describe("sign-in rate limiter", () => {
  it("blocks an account after its failure allowance and reports when to retry", () => {
    let now = 1_000;
    const limiter = new SignInRateLimiter(policy({ accountLimit: 2 }), () => now);

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
    const limiter = new SignInRateLimiter(policy({ sourceLimit: 2 }));

    limiter.recordFailure("one@example.com", "192.0.2.10");
    limiter.recordFailure("two@example.com", "192.0.2.10");

    expect(limiter.check("three@example.com", "192.0.2.10").allowed).toBe(false);
  });

  it("clears the account failures after a successful sign-in", () => {
    const limiter = new SignInRateLimiter(policy({ accountLimit: 1 }));

    limiter.recordFailure("admin@example.com", "192.0.2.10");
    expect(limiter.check("admin@example.com", "192.0.2.11").allowed).toBe(false);

    limiter.recordSuccess("ADMIN@example.com");
    expect(limiter.check("admin@example.com", "192.0.2.11").allowed).toBe(true);
  });

  /*
   * The per-account and per-source buckets can each be sidestepped: spread the
   * attempts over many accounts, and vary the address the proxy chain reports.
   * These cover the bucket that neither trick moves.
   */
  describe("the global ceiling", () => {
    it("engages once total failures pass the limit, whatever the account or source", () => {
      const limiter = new SignInRateLimiter(policy({ globalLimit: 3 }));

      for (let attempt = 0; attempt < 3; attempt += 1) {
        limiter.recordFailure(`user-${String(attempt)}@example.com`, `192.0.2.${String(attempt)}`);
      }

      expect(limiter.check("never-seen@example.com", "198.51.100.7").allowed).toBe(false);
    });

    it("releases after the window", () => {
      let now = 1_000;
      const limiter = new SignInRateLimiter(policy({ globalLimit: 1 }), () => now);

      limiter.recordFailure("one@example.com", "192.0.2.10");
      expect(limiter.check("two@example.com", "192.0.2.11").allowed).toBe(false);

      now += 60_001;
      expect(limiter.check("two@example.com", "192.0.2.11").allowed).toBe(true);
    });

    it("is not cleared by one account signing in successfully", () => {
      const limiter = new SignInRateLimiter(policy({ globalLimit: 2 }));

      limiter.recordFailure("one@example.com", "192.0.2.10");
      limiter.recordFailure("two@example.com", "192.0.2.11");
      limiter.recordSuccess("one@example.com");

      expect(limiter.check("three@example.com", "192.0.2.12").allowed).toBe(false);
    });

    /*
     * The tracking map is bounded, and the global window is created on the very
     * first failure — so plain insertion-order eviction would discard it first,
     * under exactly the flood of distinct sources it exists to catch.
     */
    it("survives an eviction flood of distinct sources", () => {
      const limiter = new SignInRateLimiter(policy({ globalLimit: 5 }));

      for (let attempt = 0; attempt < 25_000; attempt += 1) {
        limiter.recordFailure(
          `user-${String(attempt)}@example.com`,
          `10.0.${String(attempt >> 8)}.${String(attempt & 0xff)}`,
        );
      }

      expect(limiter.check("fresh@example.com", "203.0.113.9").allowed).toBe(false);
    });
  });
});
