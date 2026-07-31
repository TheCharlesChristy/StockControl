import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type {
  JobListResponse,
  JobResponse,
  JobStatus,
  StockOperationResponse,
} from "@stockcontrol/contracts";
import { jobStatuses } from "@stockcontrol/contracts";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { canViewAllActivity, currentUser, requireCapability } from "../auth/request-context";
import { bodyOf, optionalText, requireText } from "../inventory/request-parsing";
import { requireQuantity, type StockService } from "../inventory/stock.service";
import type { JobDetailOptions, JobsService } from "./jobs.service";

/** An Engineer sees their own record of a job's movements, not everyone's. */
function viewerOf(request: FastifyRequest): JobDetailOptions {
  return {
    viewerUserId: currentUser(request).id,
    scopeActivityToViewer: !canViewAllActivity(request),
  };
}

@Controller()
export class JobsController {
  public constructor(
    @Inject(API_TOKENS.jobsService) private readonly jobs: JobsService,
    @Inject(API_TOKENS.stockService) private readonly stock: StockService,
  ) {}

  @Get("jobs")
  public async list(
    @Req() request: FastifyRequest,
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("assignedTo") assignedTo?: string,
  ): Promise<JobListResponse> {
    requireCapability(request, "view");
    const filter = (jobStatuses as readonly string[]).includes(status ?? "")
      ? (status as JobStatus)
      : undefined;

    return {
      jobs: await this.jobs.list({
        status: filter,
        search,
        ...(assignedTo === undefined || assignedTo.length === 0 ? {} : { assignedTo }),
      }),
    };
  }

  @Get("jobs/:id")
  public async detail(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<JobResponse> {
    requireCapability(request, "view");

    return { job: await this.jobs.detail(id, viewerOf(request)) };
  }

  @Post("jobs")
  public async create(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<JobResponse> {
    requireCapability(request, "manageJobs");
    const body = bodyOf(rawBody);

    return {
      job: await this.jobs.create(
        {
          number: optionalText(body, "number"),
          name: requireText(body, "name", "a job name"),
          customer: requireText(body, "customer", "a customer"),
        },
        viewerOf(request),
      ),
    };
  }

  @Post("jobs/:id/assignments")
  public async assign(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<JobResponse> {
    const user = requireCapability(request, "manageJobs");
    const body = bodyOf(rawBody);

    await this.jobs.assign(id, requireText(body, "userId", "someone to assign"), user.id);

    return { job: await this.jobs.detail(id, viewerOf(request)) };
  }

  @Delete("jobs/:id/assignments/:userId")
  public async unassign(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ): Promise<JobResponse> {
    requireCapability(request, "manageJobs");
    await this.jobs.unassign(id, userId);

    return { job: await this.jobs.detail(id, viewerOf(request)) };
  }

  @Post("jobs/:id/close")
  public async close(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<JobResponse> {
    const user = requireCapability(request, "manageJobs");
    await this.stock.closeJob(user.id, id);

    return { job: await this.jobs.detail(id, viewerOf(request)) };
  }

  @Post("jobs/:id/reservations")
  public async reserve(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<StockOperationResponse> {
    const user = requireCapability(request, "reserve");
    const body = bodyOf(rawBody);

    return this.stock.reserve({
      actorUserId: user.id,
      scopeActivityToActor: !canViewAllActivity(request),
      jobId: id,
      itemId: requireText(body, "itemId", "an item to reserve"),
      quantity: requireQuantity(requireText(body, "quantity", "a quantity")),
    });
  }

  @Post("reservations/:id/collect")
  public async collect(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<StockOperationResponse> {
    const user = requireCapability(request, "collect");
    const body = bodyOf(rawBody);

    return this.stock.collect({
      actorUserId: user.id,
      scopeActivityToActor: !canViewAllActivity(request),
      reservationId: id,
      sourceLocationId: requireText(body, "sourceLocationId", "the location to collect from"),
      quantity: requireQuantity(requireText(body, "quantity", "a quantity")),
    });
  }

  @Post("reservations/:id/release")
  public async release(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() rawBody: unknown,
  ): Promise<StockOperationResponse> {
    const user = requireCapability(request, "releaseReservation");
    const body = bodyOf(rawBody);

    return this.stock.release({
      actorUserId: user.id,
      scopeActivityToActor: !canViewAllActivity(request),
      reservationId: id,
      reason: requireText(body, "reason", "a reason for releasing this reservation"),
    });
  }
}
