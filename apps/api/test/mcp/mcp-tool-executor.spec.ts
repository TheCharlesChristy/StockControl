import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { McpToolExecutor } from "../../src/integrations/mcp/mcp-tool-executor";
import type { McpConfiguration } from "../../src/integrations/mcp/mcp-configuration";
import type { McpCallHandle } from "../../src/integrations/mcp/mcp-audit.service";

const configuration = {
  enabled: false,
  readToolsEnabled: true,
  writeToolsEnabled: false,
} as McpConfiguration;

describe("MCP tool audit ordering", () => {
  it("retains malformed arguments instead of throwing before Received", async () => {
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
    expect(audit.start).toHaveBeenCalledOnce();
    expect(audit.event).toHaveBeenCalledWith(
      "call-1",
      "Denied",
      expect.objectContaining({ failureCode: "mcp.authentication_required" }),
    );
  });
});
