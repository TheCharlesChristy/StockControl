import { createHash } from "node:crypto";

const DEFAULT_WINDOW_MILLISECONDS = 15 * 60 * 1_000;
const DEFAULT_ACCOUNT_LIMIT = 5;
const DEFAULT_SOURCE_LIMIT = 20;
const MAX_TRACKED_WINDOWS = 10_000;

interface AttemptWindow {
  count: number;
  readonly expiresAt: number;
}

export interface SignInRateLimitPolicy {
  readonly accountLimit: number;
  readonly sourceLimit: number;
  readonly windowMilliseconds: number;
}

export interface SignInRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

const keyFor = (namespace: "account" | "source", value: string): string =>
  createHash("sha256").update(namespace).update("\0").update(value).digest("base64url");

/**
 * A bounded, in-process throttle for the single API replica used by the MVP.
 * It never stores raw email addresses or IP addresses. A later multi-replica
 * deployment can replace this provider with a shared implementation.
 */
export class SignInRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();

  public constructor(
    private readonly policy: SignInRateLimitPolicy = {
      accountLimit: DEFAULT_ACCOUNT_LIMIT,
      sourceLimit: DEFAULT_SOURCE_LIMIT,
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

  public check(email: string, source: string): SignInRateLimitDecision {
    const now = this.now();
    this.prune(now);
    const account = this.current(keyFor("account", this.normaliseEmail(email)), now);
    const sourceWindow = this.current(keyFor("source", source), now);
    const blockedUntil = Math.max(
      account !== undefined && account.count >= this.policy.accountLimit ? account.expiresAt : 0,
      sourceWindow !== undefined && sourceWindow.count >= this.policy.sourceLimit
        ? sourceWindow.expiresAt
        : 0,
    );

    if (blockedUntil <= now) {
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1_000)),
    };
  }

  public recordFailure(email: string, source: string): void {
    const now = this.now();
    this.increment(keyFor("account", this.normaliseEmail(email)), now);
    this.increment(keyFor("source", source), now);
  }

  public recordSuccess(email: string): void {
    this.attempts.delete(keyFor("account", this.normaliseEmail(email)));
  }

  private normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
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
        const oldestKey = this.attempts.keys().next().value;
        if (oldestKey !== undefined) this.attempts.delete(oldestKey);
      }

      this.attempts.set(key, {
        count: 1,
        expiresAt: now + this.policy.windowMilliseconds,
      });
      return;
    }

    current.count += 1;
  }

  private prune(now: number): void {
    for (const [key, window] of this.attempts) {
      if (window.expiresAt <= now) {
        this.attempts.delete(key);
      }
    }
  }
}
