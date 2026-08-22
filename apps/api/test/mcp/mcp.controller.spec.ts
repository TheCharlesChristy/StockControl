import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { McpController } from "../../src/integrations/mcp/mcp.controller";
import type { McpConfiguration } from "../../src/integrations/mcp/mcp-configuration";

const configuration = {
  publicBaseUrl: "https://stockcontrol.example",
  resourceUri: "https://stockcontrol.example/mcp",
} as McpConfiguration;

describe("MCP transport authentication", () => {
  it("returns a transport-level OAuth challenge for unauthenticated tool calls", async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        error: {
          code: "mcp.authentication_required",
          message: "Authenticate with an OAuth bearer token.",
        },
        isError: true,
      }),
      tools: vi.fn(),
      authenticate: vi.fn().mockResolvedValue(null),
    };
    const logger = { log: vi.fn() };
    const code = vi.fn();
    const header = vi.fn();
    const send = vi.fn();
    const reply = {
      code,
      header,
      send,
    } as unknown as FastifyReply;
    code.mockReturnValue(reply);
    header.mockReturnValue(reply);
    send.mockReturnValue(reply);

    const controller = new McpController(executor as never, logger as never, configuration);
    await controller.handle(
      { headers: { accept: "application/json, text/event-stream" } } as FastifyRequest,
      {
        jsonrpc: "2.0",
        id: "request-1",
        method: "tools/call",
        params: { name: "search_items", arguments: {} },
      },
      reply,
    );

    expect(code).toHaveBeenCalledWith(401);
    expect(header).toHaveBeenCalledWith(
      "www-authenticate",
      'Bearer resource_metadata="https://stockcontrol.example/.well-known/oauth-protected-resource"',
    );
    expect(send).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: "request-1",
      error: { code: -32001, message: "Authentication required." },
    });
  });
});
