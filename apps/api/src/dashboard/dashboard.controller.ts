import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { DashboardResponse } from "@stockcontrol/contracts";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { requireCapability } from "../auth/request-context";
import type { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  public constructor(
    @Inject(API_TOKENS.dashboardService) private readonly dashboard: DashboardService,
  ) {}

  @Get()
  public async overview(@Req() request: FastifyRequest): Promise<DashboardResponse> {
    const user = requireCapability(request, "view");

    return this.dashboard.forUser({ id: user.id, role: user.role });
  }
}
