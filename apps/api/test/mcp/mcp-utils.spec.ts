import { describe, expect, it } from "vitest";

import { canonicalJson, safeJsonObject, sha256 } from "../../src/integrations/mcp/mcp-utils";

describe("MCP audit-safe serialization", () => {
  it("canonicalizes object key order for idempotency fingerprints", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(sha256(canonicalJson({ b: 2, a: 1 }))).toBe(sha256(canonicalJson({ a: 1, b: 2 })));
  });

  it("redacts secret-shaped input keys and bounds nested values", () => {
    const result = safeJsonObject({
      accessToken: "never-store-this",
      cookie: "session",
      itemId: "item-1",
    });

    expect(result).toEqual({
      accessToken: "[REDACTED]",
      cookie: "[REDACTED]",
      itemId: "item-1",
    });
  });
});
