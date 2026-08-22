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
      apiKey: "never-store-this-too",
      bearer: "token",
      itemId: "item-1",
    });

    expect(result).toEqual({
      accessToken: "[REDACTED]",
      apiKey: "[REDACTED]",
      bearer: "[REDACTED]",
      cookie: "[REDACTED]",
      itemId: "item-1",
    });
  });

  it("redacts credential-shaped free text and cycles without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(
      safeJsonObject({
        summary: "Bearer opaque-secret",
        nested: circular,
      }),
    ).toEqual({
      summary: "[REDACTED]",
      nested: { self: "[CIRCULAR]" },
    });
  });

  it("does not let throwing getters break audit projection", () => {
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "secret", {
      enumerable: true,
      get: () => {
        throw new Error("getter failed");
      },
    });

    expect(safeJsonObject(hostile)).toEqual({});
    expect(safeJsonObject({ note: "prefix sk-1234567890123456 suffix" })).toEqual({
      note: "[REDACTED]",
    });
  });
});
