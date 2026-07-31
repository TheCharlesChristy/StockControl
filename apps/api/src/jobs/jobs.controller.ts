import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type {
  JobListResponse,
  JobResponse,
  JobStatus,
  StockOperationResponse,
} from "@stockcontrol/contracts";
import { jobStatuses } from "@stockcontrol/contracts";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { requireCapability } from "../auth/request-context";
import { bodyOf, optionalText, requireText } from "../inventory/request-parsing";
import { requireQuantity, type StockService } from "../inventory/stock.service";
import type { JobsService } from "./jobs.service";

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
  ): Promise<JobListResponse> {
    requireCapability(request, "view");
    const filter = (jobStatuses as readonly string[]).includes(status ?? "")
      ? (status as JobStatus)
      : undefined;

    return { jobs: await this.jobs.list(filter) };
  }

  @Get("jobs/:id")
  public async detail(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<JobResponse> {
    requireCapability(request, "view");

    return { job: await this.jobs.detail(id) };
  }

  @Post("jobs")
  public async create(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<JobResponse> {
    requireCapability(request, "manageJobs");
    const body = bodyOf(rawBody);

    return {
      job: await this.jobs.create({
        number: optionalText(body, "number"),
        name: requireText(body, "name", "a job name"),
        customer: requireText(body, "customer", "a customer"),
      }),
    };
  }

  @Post("jobs/:id/close")
  public async close(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<JobResponse> {
    const user = requireCapability(request, "manageJobs");
    await this.stock.closeJob(user.id, id);

    return { job: await this.jobs.detail(id) };
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
      reservationId: id,
      reason: requireText(body, "reason", "a reason for releasing this reservation"),
    });
  }
}
