import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { McpToolExecutor, mcpToolDefinitions } from "../../src/integrations/mcp/mcp-tool-executor";
import type { McpConfiguration } from "../../src/integrations/mcp/mcp-configuration";
import type { McpCallHandle } from "../../src/integrations/mcp/mcp-audit.service";

const configuration = {
  enabled: false,
  readToolsEnabled: true,
  writeToolsEnabled: false,
} as McpConfiguration;

describe("MCP tool audit ordering", () => {
  it("publishes an output schema for every enabled tool", () => {
    const definitions = mcpToolDefinitions({
      enabled: true,
      readToolsEnabled: true,
      writeToolsEnabled: true,
    } as McpConfiguration);

    expect(definitions).not.toHaveLength(0);
    expect(definitions.every((definition) => definition.outputSchema.type === "object")).toBe(true);
    expect(
      definitions.find((definition) => definition.name === "search_items")?.outputSchema,
    ).toEqual(
      expect.objectContaining({
        required: ["rows", "total", "limit", "offset", "hasMore"],
      }),
    );
  });

  it("does not create audit rows for anonymous requests without credentials", async () => {
    const handle = {
      callId: "call-1",
      correlationId: "correlation-1",
      actorUserId: null,
      grantId: null,
      toolName: "search_items",
      contractVersion: "1.0",
      operation: "read",
      arguments: {},
      actionSummary: null,
      clientRequestId: null,
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
      argumentFingerprint: "fingerprint",
    } as McpCallHandle;
    const audit = {
      start: vi.fn().mockResolvedValue(handle),
      event: vi.fn().mockResolvedValue(undefined),
      failureFrom: vi.fn(),
    };
    const oauth = { resolveAccessToken: vi.fn().mockResolvedValue(null) };
    const correlation = { normalize: vi.fn().mockReturnValue("correlation-1") };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const executor = new McpToolExecutor(
      {} as never,
      audit as never,
      oauth as never,
      configuration,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      correlation as never,
      logger as never,
    );

    const result = await executor.execute(
      { headers: {} } as FastifyRequest,
      "search_items",
      { search: 42 },
      "request-1",
    );

    expect(result.error?.code).toBe("mcp.authentication_required");
    expect(audit.start).not.toHaveBeenCalled();
    expect(audit.event).not.toHaveBeenCalled();
  });

  it("retains malformed arguments after a credential is supplied", async () => {
    const handle = {
      callId: "call-2",
      correlationId: "correlation-1",
      actorUserId: null,
      grantId: null,
      toolName: "search_items",
      contractVersion: "1.0",
      operation: "read",
      arguments: {},
      actionSummary: null,
      clientRequestId: null,
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
      argumentFingerprint: "fingerprint",
    } as McpCallHandle;
    const audit = {
      start: vi.fn().mockResolvedValue(handle),
      event: vi.fn().mockResolvedValue(undefined),
      failureFrom: vi.fn(),
    };
    const oauth = { resolveAccessToken: vi.fn().mockResolvedValue(null) };
    const correlation = { normalize: vi.fn().mockReturnValue("correlation-1") };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const executor = new McpToolExecutor(
      {} as never,
      audit as never,
      oauth as never,
      configuration,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      correlation as never,
      logger as never,
    );

    const result = await executor.execute(
      { headers: { authorization: "Bearer malformed" } } as FastifyRequest,
      "search_items",
      { search: 42 },
      "request-1",
    );

    expect(result.error?.code).toBe("mcp.authentication_required");
    expect(audit.start).toHaveBeenCalledOnce();
  });
});
