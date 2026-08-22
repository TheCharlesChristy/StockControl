import { Body, Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";
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

const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26"]);

const idOf = (value: unknown): string | number | null =>
  typeof value === "string" || typeof value === "number" ? value : null;

const paramsOf = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

const isValidRequestId = (value: unknown): boolean =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

const acceptsMcpResponse = (value: string | readonly string[] | undefined): boolean => {
  const header = Array.isArray(value) ? value.join(",") : value;
  if (header === undefined) return false;
  const mediaTypes = String(header)
    .split(",")
    .map((part: string) => part.trim().split(";", 1)[0]);
  return mediaTypes.includes("application/json") && mediaTypes.includes("text/event-stream");
};

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

  @Get()
  @Public()
  @OriginExempt()
  public get(@Res() reply: FastifyReply): FastifyReply {
    return reply.code(405).header("allow", "POST").send();
  }

  @Post()
  @Public()
  @OriginExempt()
  public async handle(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    if (!acceptsMcpResponse(request.headers.accept)) {
      return reply.code(406).send({
        type: "about:blank",
        title: "Not Acceptable",
        status: 406,
        detail: "Accept must include application/json and text/event-stream.",
      });
    }
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      origin !== this.configuration.publicBaseUrl &&
      origin !== "https://chatgpt.com"
    ) {
      return reply.code(403).send({
        type: "about:blank",
        title: "Forbidden",
        status: 403,
        detail: "This MCP Origin is not allowed.",
      });
    }
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

    if (
      body.jsonrpc !== "2.0" ||
      method.length === 0 ||
      (body.id !== undefined && !isValidRequestId(body.id))
    ) {
      return reply.code(400).send(rpcError(id, -32600, "Invalid JSON-RPC request."));
    }

    const protocolVersion = request.headers["mcp-protocol-version"];
    if (
      protocolVersion !== undefined &&
      (Array.isArray(protocolVersion) || !SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion))
    ) {
      return reply.code(400).send(rpcError(id, -32600, "Unsupported MCP protocol version."));
    }

    const authenticate = async (): Promise<boolean> =>
      (await this.executor.authenticate(request)) !== null;

    const challenge = (): FastifyReply => {
      const metadata = `${this.configuration.publicBaseUrl}/.well-known/oauth-protected-resource`;
      return reply
        .code(401)
        .header("www-authenticate", `Bearer resource_metadata="${metadata}"`)
        .send(rpcError(id, -32001, "Authentication required."));
    };

    // A tool call is allowed through to the executor so a supplied but
    // malformed bearer header is still represented in the audit ledger. A
    // request with no credentials never creates an audit row. Session methods
    // are challenged before dispatch because they have no tool invocation to
    // record.
    if (method !== "tools/call" && !(await authenticate())) return challenge();

    if (method === "initialize") {
      const params = paramsOf(body.params);
      const requestedVersion = params["protocolVersion"];
      if (
        requestedVersion !== undefined &&
        (typeof requestedVersion !== "string" || !SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion))
      ) {
        return reply.code(400).send(rpcError(id, -32600, "Unsupported MCP protocol version."));
      }
      return reply
        .code(200)
        .header("mcp-protocol-version", "2025-06-18")
        .send({
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
      return reply.code(202).send();
    }
    if (body.id === undefined) {
      return reply.code(202).send();
    }
    if (method === "tools/list") {
      return reply.code(200).send({ jsonrpc: "2.0", id, result: { tools: this.executor.tools() } });
    }
    if (method !== "tools/call") {
      return reply.code(200).send(rpcError(id, -32601, "That MCP method is not supported."));
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
      return reply.code(200).send({
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [{ type: "text", text: result.error.message }],
        },
      });
    }

    return reply.code(200).send({
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
