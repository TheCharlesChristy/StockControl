import {
  Controller,
  BadRequestException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type {
  McpActivityQuery,
  McpActivityListResponse,
  McpConnectionListResponse,
} from "@stockcontrol/contracts";

import { API_TOKENS } from "../../api.tokens";
import { requireCapability } from "../../auth/request-context";
import { parseTimestamp, requireUuidParameter } from "../../inventory/request-parsing";
import type { McpActivityService } from "./mcp-activity.service";
import type { OAuthService } from "./oauth.service";

const boundedInteger = (
  value: string | undefined,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new BadRequestException(`${field} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(
      `${field} must be between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return parsed;
};

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
    const parsedLimit = boundedInteger(limit, "limit", 50, 1, 100);
    const parsedOffset = boundedInteger(offset, "offset", 0, 0, 10_000);
    const fromTimestamp = parseTimestamp(from, "from")?.toISOString();
    const toTimestamp = parseTimestamp(to, "to")?.toISOString();
    if (
      fromTimestamp !== undefined &&
      toTimestamp !== undefined &&
      new Date(fromTimestamp).getTime() > new Date(toTimestamp).getTime()
    ) {
      throw new BadRequestException("from must be before or equal to to.");
    }
    if (tool !== undefined && tool.trim().length > 120) {
      throw new BadRequestException("tool must be 120 characters or fewer.");
    }
    if (
      outcome !== undefined &&
      !["Succeeded", "Denied", "Failed", "Interrupted", "Incomplete"].includes(outcome)
    ) {
      throw new BadRequestException("outcome is not supported.");
    }
    if (operation !== undefined && operation !== "read" && operation !== "write") {
      throw new BadRequestException("operation must be read or write.");
    }
    const query: McpActivityQuery = {
      ...(fromTimestamp === undefined ? {} : { from: fromTimestamp }),
      ...(toTimestamp === undefined ? {} : { to: toTimestamp }),
      ...(userId === undefined || userId.trim().length === 0
        ? {}
        : { userId: requireUuidParameter(userId, "user") }),
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
  ): Promise<{ readonly revoked: boolean }> {
    const user = requireCapability(request, "view");
    const outcome = await this.oauth.revokeGrant(
      requireUuidParameter(grantId, "grant"),
      user.id,
      user.role === "Admin",
    );
    if (outcome === "not-found") throw new NotFoundException("Connection not found.");
    return { revoked: outcome === "revoked" };
  }
}
