import { Body, Controller, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { StructuredLogger } from "@stockcontrol/platform";

import { API_TOKENS } from "../../api.tokens";
import { OriginExempt, Public } from "../../auth/public.decorator";
import { SYSTEM_TOKENS } from "../../system/system.tokens";
import type { McpConfiguration } from "./mcp-configuration";
import { McpToolExecutor } from "./mcp-tool-executor";

interface JsonRpcRequest {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

const idOf = (value: unknown): string | number | null =>
  typeof value === "string" || typeof value === "number" ? value : null;

const paramsOf = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

const rpcError = (
  id: string | number | null,
  code: number,
  message: string,
): Record<string, unknown> => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

@Controller("mcp")
export class McpController {
  public constructor(
    @Inject(API_TOKENS.mcpToolExecutor) private readonly executor: McpToolExecutor,
    @Inject(SYSTEM_TOKENS.logger) private readonly logger: StructuredLogger,
    @Inject(API_TOKENS.mcpConfiguration) private readonly configuration: McpConfiguration,
  ) {}

  @Post()
  @Public()
  @OriginExempt()
  public async handle(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const body = paramsOf(rawBody) as JsonRpcRequest;
    const id = idOf(body.id);
    const method = typeof body.method === "string" ? body.method : "";
    this.logger.log({
      event: "mcp.protocol.request",
      method: method.slice(0, 80),
      clientRequestId:
        typeof body.id === "string" || typeof body.id === "number"
          ? String(body.id).slice(0, 200)
          : null,
    });

    if (body.jsonrpc !== "2.0" || method.length === 0) {
      return reply.code(400).send(rpcError(id, -32600, "Invalid JSON-RPC request."));
    }

    if (method === "initialize") {
      return reply.send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "stockcontrol-mcp", version: "1.0" },
        },
      });
    }
    if (method === "notifications/initialized") {
      return reply.code(204).send();
    }
    if (method === "tools/list") {
      return reply.send({ jsonrpc: "2.0", id, result: { tools: this.executor.tools() } });
    }
    if (method !== "tools/call") {
      return reply.code(400).send(rpcError(id, -32601, "That MCP method is not supported."));
    }

    const params = paramsOf(body.params);
    const toolName = typeof params["name"] === "string" ? params["name"] : "";
    const result = await this.executor.execute(
      request,
      toolName,
      params["arguments"],
      typeof body.id === "string" || typeof body.id === "number" ? String(body.id) : null,
    );

    if (result.error !== undefined) {
      if (result.error.code === "mcp.authentication_required") {
        const metadata = `${this.configuration.publicBaseUrl}/.well-known/oauth-protected-resource`;
        return reply
          .code(401)
          .header("www-authenticate", `Bearer resource_metadata="${metadata}"`)
          .send(rpcError(id, -32001, "Authentication required."));
      }
      return reply.send({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: result.error.message }],
          structuredContent: { code: result.error.code, message: result.error.message },
        },
      });
    }

    return reply.send({
      jsonrpc: "2.0",
      id,
      result: {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(result.value) }],
        structuredContent: result.value,
      },
    });
  }
}
