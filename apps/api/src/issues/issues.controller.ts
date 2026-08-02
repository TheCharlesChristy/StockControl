import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import type { ReportIssueResponse } from "@stockcontrol/contracts";
import type { FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { currentUser } from "../auth/request-context";
import { bodyOf, optionalText, requireText } from "../inventory/request-parsing";
import type { IssuesService } from "./issues.service";

@Controller("issues")
export class IssuesController {
  public constructor(@Inject(API_TOKENS.issuesService) private readonly issues: IssuesService) {}

  @Post()
  public report(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<ReportIssueResponse> {
    const body = bodyOf(rawBody);

    return this.issues.create({
      title: requireText(body, "title", "a title"),
      description: requireText(body, "description", "a description"),
      page: optionalText(body, "page") ?? "/",
      reporter: currentUser(request),
    });
  }
}
