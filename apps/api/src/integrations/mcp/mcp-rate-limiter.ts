import { createHash } from "node:crypto";

interface Window {
  count: number;
  readonly expiresAt: number;
}

export interface McpRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

const WINDOW_MILLISECONDS = 60_000;
const DEFAULT_LIMIT = 60;
const MAX_BUCKETS = 10_000;

const bucketKey = (dimension: string, value: string): string =>
  createHash("sha256").update(dimension).update("\0").update(value).digest("base64url");

/** Bounded per-principal/tool throttling for the single-replica deployment. */
export class McpRateLimiter {
  private readonly windows = new Map<string, Window>();

  public constructor(
    private readonly limit = DEFAULT_LIMIT,
    private readonly windowMilliseconds = WINDOW_MILLISECONDS,
    private readonly now: () => number = Date.now,
  ) {}

  public check(userId: string, grantId: string, toolName: string): McpRateLimitDecision {
    const currentTime = this.now();
    this.prune(currentTime);
    /*
     * Keep three independent ceilings. A tuple bucket alone lets a caller
     * evade the limit by changing tools or grants, while a globally shared
     * tool bucket would let one customer throttle every other customer using
     * that tool. Tool calls therefore use a per-user/tool bucket.
     */
    const keys = [
      bucketKey("user", userId),
      bucketKey("grant", grantId),
      bucketKey("tool", `${userId}\0${toolName}`),
    ];
    const blocked = keys
      .map((key) => this.windows.get(key))
      .filter((window): window is Window => window !== undefined && window.count >= this.limit);
    if (blocked.length > 0) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(Math.max(...blocked.map((window) => window.expiresAt - currentTime)) / 1_000),
        ),
      };
    }

    for (const key of keys) {
      const current = this.windows.get(key);
      if (current === undefined) {
        this.windows.set(key, { count: 1, expiresAt: currentTime + this.windowMilliseconds });
      } else {
        current.count += 1;
      }
    }
    return { allowed: true };
  }

  private prune(currentTime: number): void {
    for (const [key, window] of this.windows) {
      if (window.expiresAt <= currentTime) this.windows.delete(key);
    }
    while (this.windows.size >= MAX_BUCKETS) {
      const first = this.windows.keys().next().value;
      if (first === undefined) return;
      this.windows.delete(first);
    }
  }
}
