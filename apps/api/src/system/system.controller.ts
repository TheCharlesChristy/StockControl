import { Controller, Get, Header, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import type { LivenessResponse, ReadinessResponse, VersionResponse } from "@stockcontrol/contracts";
import type { GetLiveness, GetReadiness, GetVersion } from "@stockcontrol/module-system";

import { Public } from "../auth/public.decorator";
import { SYSTEM_TOKENS } from "./system.tokens";

@Controller()
@Public()
export class SystemController {
  public constructor(
    @Inject(SYSTEM_TOKENS.getLiveness)
    private readonly getLiveness: GetLiveness,
    @Inject(SYSTEM_TOKENS.getReadiness)
    private readonly getReadiness: GetReadiness,
    @Inject(SYSTEM_TOKENS.getVersion)
    private readonly getVersion: GetVersion,
  ) {}

  @Get("health/live")
  @Header("cache-control", "no-store")
  public live(): LivenessResponse {
    return this.getLiveness.execute();
  }

  @Get("health/ready")
  @Header("cache-control", "no-store")
  public async ready(
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<ReadinessResponse> {
    const result = await this.getReadiness.execute();

    if (result.status === "not_ready") {
      response.status(503);
    }

    return result;
  }

  @Get("version")
  @Header("cache-control", "no-store")
  public version(): VersionResponse {
    return this.getVersion.execute();
  }
}
