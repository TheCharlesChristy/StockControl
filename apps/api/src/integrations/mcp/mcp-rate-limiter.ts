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

const bucketKey = (userId: string, grantId: string, toolName: string): string =>
  createHash("sha256")
    .update(userId)
    .update("\0")
    .update(grantId)
    .update("\0")
    .update(toolName)
    .digest("base64url");

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
    const key = bucketKey(userId, grantId, toolName);
    const current = this.windows.get(key);
    if (current === undefined) {
      this.windows.set(key, { count: 1, expiresAt: currentTime + this.windowMilliseconds });
      return { allowed: true };
    }
    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - currentTime) / 1_000)),
      };
    }
    current.count += 1;
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
