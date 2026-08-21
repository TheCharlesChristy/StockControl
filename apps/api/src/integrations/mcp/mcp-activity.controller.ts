import { Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type {
  McpActivityQuery,
  McpActivityListResponse,
  McpConnectionListResponse,
} from "@stockcontrol/contracts";

import { API_TOKENS } from "../../api.tokens";
import { requireCapability } from "../../auth/request-context";
import { parseTimestamp } from "../../inventory/request-parsing";
import type { McpActivityService } from "./mcp-activity.service";
import type { OAuthService } from "./oauth.service";

@Controller("mcp-activity")
export class McpActivityController {
  public constructor(
    @Inject(API_TOKENS.mcpActivityService) private readonly activity: McpActivityService,
    @Inject(API_TOKENS.mcpOAuthService) private readonly oauth: OAuthService,
  ) {}

  @Get()
  public async list(
    @Req() request: FastifyRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("userId") userId?: string,
    @Query("tool") tool?: string,
    @Query("outcome") outcome?: string,
    @Query("operation") operation?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<McpActivityListResponse> {
    const user = requireCapability(request, "view");
    const parsedLimit = limit === undefined ? 50 : Math.min(100, Math.max(1, Number(limit) || 50));
    const parsedOffset =
      offset === undefined ? 0 : Math.min(10_000, Math.max(0, Number(offset) || 0));
    const fromTimestamp = parseTimestamp(from, "from")?.toISOString();
    const toTimestamp = parseTimestamp(to, "to")?.toISOString();
    const query: McpActivityQuery = {
      ...(fromTimestamp === undefined ? {} : { from: fromTimestamp }),
      ...(toTimestamp === undefined ? {} : { to: toTimestamp }),
      ...(userId === undefined ? {} : { userId }),
      ...(tool === undefined ? {} : { tool }),
      ...(outcome === "Succeeded" ||
      outcome === "Denied" ||
      outcome === "Failed" ||
      outcome === "Interrupted" ||
      outcome === "Incomplete"
        ? { outcome }
        : {}),
      ...(operation === "read" || operation === "write" ? { operation } : {}),
      limit: parsedLimit,
      offset: parsedOffset,
    };
    return this.activity.list({ id: user.id, role: user.role }, query);
  }

  @Get("connections")
  public connections(@Req() request: FastifyRequest): Promise<McpConnectionListResponse> {
    const user = requireCapability(request, "view");
    return this.activity.connections({ id: user.id, role: user.role });
  }

  @Post("connections/:grantId/revoke")
  public async revoke(
    @Req() request: FastifyRequest,
    @Param("grantId") grantId: string,
  ): Promise<{ readonly revoked: true }> {
    const user = requireCapability(request, "view");
    await this.oauth.revokeGrant(grantId, user.id, user.role === "Admin");
    return { revoked: true };
  }
}
