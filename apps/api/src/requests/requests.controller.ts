import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type {
  StockRequestListResponse,
  StockRequestResponse,
  StockRequestStatus,
} from "@stockcontrol/contracts";
import { roleHasCapability, stockRequestStatuses } from "@stockcontrol/contracts";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { canViewAllActivity, currentUser, requireCapability } from "../auth/request-context";
import { bodyOf, optionalText, parsePaging, requireText } from "../inventory/request-parsing";
import type { StockRequestsService } from "./requests.service";

@Controller()
export class StockRequestsController {
  public constructor(
    @Inject(API_TOKENS.stockRequestsService) private readonly requests: StockRequestsService,
  ) {}

  /**
   * Reviewers see the whole queue; everybody else sees what they asked for.
   * Narrowing rather than refusing keeps the Engineer's own list on the same
   * endpoint the Office queue uses.
   */
  @Get("stock-requests")
  public async list(
    @Req() request: FastifyRequest,
    @Query("status") status?: string,
    @Query("mine") mine?: string,
    @Query("itemId") itemId?: string,
    @Query("jobId") jobId?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<StockRequestListResponse> {
    const user = requireCapability(request, "view");
    const mayReviewAll = roleHasCapability(user.role, "reviewStockRequests");
    const requestedByUserId = mayReviewAll && mine !== "true" ? undefined : user.id;

    return this.requests.list({
      ...parsePaging(limit, offset),
      ...(requestedByUserId === undefined ? {} : { requestedByUserId }),
      ...((stockRequestStatuses as readonly string[]).includes(status ?? "")
        ? { status: status as StockRequestStatus }
        : {}),
      ...(itemId === undefined || itemId.length === 0 ? {} : { itemId }),
      ...(jobId === undefined || jobId.length === 0 ? {} : { jobId }),
    });
  }

  @Post("stock-requests")
  public async create(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<StockRequestResponse> {
    const user = requireCapability(request, "requestStock");
    const body = bodyOf(rawBody);

    return {
      request: await this.requests.create({
        requestedByUserId: user.id,
        itemId: requireText(body, "itemId", "an item"),
        quantity: requireText(body, "quantity", "a quantity"),
        jobId: optionalText(body, "jobId"),
        note: optionalText(body, "note"),
      }),
    };
  }

  @Post("stock-requests/:id/approve")
  public async approve(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<StockRequestResponse> {
    const user = requireCapability(request, "reviewStockRequests");
    const body = bodyOf(rawBody);
    const quantity = optionalText(body, "quantity");

    return {
      request: await this.requests.approve({
        requestId: id,
        decidedByUserId: user.id,
        decisionNote: optionalText(body, "decisionNote"),
        scopeActivityToActor: !canViewAllActivity(request),
        ...(quantity === null ? {} : { quantity }),
      }),
    };
  }

  @Post("stock-requests/:id/reject")
  public async reject(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<StockRequestResponse> {
    const user = requireCapability(request, "reviewStockRequests");
    const body = bodyOf(rawBody);

    return {
      request: await this.requests.reject({
        requestId: id,
        decidedByUserId: user.id,
        decisionNote: requireText(body, "decisionNote", "a reason"),
        scopeActivityToActor: !canViewAllActivity(request),
      }),
    };
  }

  @Post("stock-requests/:id/cancel")
  public async cancel(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<StockRequestResponse> {
    requireCapability(request, "requestStock");

    return { request: await this.requests.cancel(id, currentUser(request).id) };
  }
}
