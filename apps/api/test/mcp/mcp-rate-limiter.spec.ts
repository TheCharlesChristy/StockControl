import { describe, expect, it } from "vitest";

import { McpRateLimiter } from "../../src/integrations/mcp/mcp-rate-limiter";

describe("MCP per-principal throttling", () => {
  it("bounds calls per user, grant and tool and resets the window", () => {
    let now = 1_000;
    const limiter = new McpRateLimiter(2, 60_000, () => now);

    expect(limiter.check("user-1", "grant-1", "search_items")).toEqual({ allowed: true });
    expect(limiter.check("user-1", "grant-1", "search_items")).toEqual({ allowed: true });
    expect(limiter.check("user-1", "grant-1", "search_items")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(limiter.check("user-1", "grant-1", "list_jobs")).toEqual({ allowed: true });

    now += 60_000;
    expect(limiter.check("user-1", "grant-1", "search_items")).toEqual({ allowed: true });
  });
});
