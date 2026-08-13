import { createHash } from "node:crypto";

import { normaliseUsername } from "@stockcontrol/contracts";

const DEFAULT_WINDOW_MILLISECONDS = 15 * 60 * 1_000;
const DEFAULT_ACCOUNT_LIMIT = 5;
const DEFAULT_SOURCE_LIMIT = 20;
/*
 * Deliberately far above what a small installation's genuine users produce in a
 * quarter hour, because this is a backstop rather than a working limit: a whole
 * customer failing every sign-in this many times means something is wrong
 * regardless of who is doing it.
 */
const DEFAULT_GLOBAL_LIMIT = 200;
const MAX_TRACKED_WINDOWS = 10_000;

interface AttemptWindow {
  count: number;
  readonly expiresAt: number;
}

export interface SignInRateLimitPolicy {
  readonly accountLimit: number;
  readonly sourceLimit: number;
  readonly globalLimit: number;
  readonly windowMilliseconds: number;
}

export interface SignInRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

const GLOBAL_KEY = "global";

const keyFor = (namespace: "account" | "source", value: string): string =>
  createHash("sha256").update(namespace).update("\0").update(value).digest("base64url");

/**
 * A bounded, in-process throttle for the single API replica used by the MVP.
 * It never stores raw usernames or IP addresses. A later multi-replica
 * deployment can replace this provider with a shared implementation.
 *
 * Three buckets, because the first two can each be sidestepped. Spreading
 * attempts across accounts defeats the per-account limit. The per-source limit
 * is only as trustworthy as the address the platform's proxies report, and this
 * service cannot verify that on its own — so the global bucket is keyed on
 * nothing at all and no request header can move it.
 */
export class SignInRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();

  public constructor(
    private readonly policy: SignInRateLimitPolicy = {
      accountLimit: DEFAULT_ACCOUNT_LIMIT,
      sourceLimit: DEFAULT_SOURCE_LIMIT,
      globalLimit: DEFAULT_GLOBAL_LIMIT,
      windowMilliseconds: DEFAULT_WINDOW_MILLISECONDS,
    },
    private readonly now: () => number = Date.now,
  ) {
    for (const [name, value] of Object.entries(policy)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Sign-in rate-limit ${name} must be a positive integer.`);
      }
    }
  }

  public check(username: string, source: string): SignInRateLimitDecision {
    const now = this.now();
    this.prune(now);
    const account = this.current(keyFor("account", normaliseUsername(username)), now);
    const sourceWindow = this.current(keyFor("source", source), now);
    const global = this.current(GLOBAL_KEY, now);
    const blockedUntil = Math.max(
      account !== undefined && account.count >= this.policy.accountLimit ? account.expiresAt : 0,
      sourceWindow !== undefined && sourceWindow.count >= this.policy.sourceLimit
        ? sourceWindow.expiresAt
        : 0,
      global !== undefined && global.count >= this.policy.globalLimit ? global.expiresAt : 0,
    );

    if (blockedUntil <= now) {
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1_000)),
    };
  }

  public recordFailure(username: string, source: string): void {
    const now = this.now();
    this.increment(keyFor("account", normaliseUsername(username)), now);
    this.increment(keyFor("source", source), now);
    this.increment(GLOBAL_KEY, now);
  }

  public recordSuccess(username: string): void {
    this.attempts.delete(keyFor("account", normaliseUsername(username)));
  }

  private current(key: string, now: number): AttemptWindow | undefined {
    const window = this.attempts.get(key);

    if (window !== undefined && window.expiresAt <= now) {
      this.attempts.delete(key);
      return undefined;
    }

    return window;
  }

  private increment(key: string, now: number): void {
    const current = this.current(key, now);

    if (current === undefined) {
      if (this.attempts.size >= MAX_TRACKED_WINDOWS) {
        this.evictOldest();
      }

      this.attempts.set(key, {
        count: 1,
        expiresAt: now + this.policy.windowMilliseconds,
      });
      return;
    }

    current.count += 1;
  }

  /**
   * The map is bounded, so a flood of distinct sources evicts earlier entries.
   * The global window must survive that: it is created on the first failure, so
   * insertion order would otherwise make it the first thing discarded — under
   * precisely the flood it exists to catch.
   */
  private evictOldest(): void {
    for (const key of this.attempts.keys()) {
      if (key !== GLOBAL_KEY) {
        this.attempts.delete(key);
        return;
      }
    }
  }

  private prune(now: number): void {
    for (const [key, window] of this.attempts) {
      if (window.expiresAt <= now) {
        this.attempts.delete(key);
      }
    }
  }
}
