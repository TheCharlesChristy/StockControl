import "reflect-metadata";

import { Controller, Get } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  API_V1_PREFIX,
  CORRELATION_ID_HEADER,
  GENERIC_INTERNAL_FAILURE_DETAIL,
  permissionDenied,
  recentAuthenticationRequired,
  resourceExpired,
  validationFailed,
  type ProblemDetails,
} from "@stockcontrol/contracts";
import {
  ApplicationFailureException,
  CorrelationContext,
  ProblemDetailsExceptionFilter,
  registerCorrelationIdHook,
  StructuredLogger,
} from "@stockcontrol/platform";

/**
 * A transport fixture for the shared failure vocabulary.
 *
 * Real protected routes arrive with P1-E1-W09; this controller exists so the
 * HTTP contract for every failure kind — status, stable code, field errors,
 * correlation ID, and the absence of internal detail — is proven now and
 * cannot regress when those routes are added.
 */
@Controller("failure-fixtures")
class FailureFixtureController {
  @Get("permission-denied")
  public permissionDenied(): never {
    throw new ApplicationFailureException(
      permissionDenied({
        code: "identity.permission_change_denied",
        detail: "You cannot change your own permissions.",
      }),
    );
  }

  @Get("recent-authentication-required")
  public recentAuthenticationRequired(): never {
    throw new ApplicationFailureException(recentAuthenticationRequired());
  }

  @Get("expired")
  public expired(): never {
    throw new ApplicationFailureException(resourceExpired({ code: "identity.invitation_expired" }));
  }

  @Get("validation")
  public validation(): never {
    throw new ApplicationFailureException(
      validationFailed(
        {
          password: ["Must contain at least 12 characters", "Must not be a previous password"],
          email: ["Enter a valid email address"],
        },
        { code: "identity.invitation_acceptance_invalid" },
      ),
    );
  }

  @Get("unexpected")
  public unexpected(): never {
    throw new Error('relation "identity_users" does not exist; postgres://app:hunter2@db:5432');
  }
}

const logLines: string[] = [];

let app: NestFastifyApplication;

const request = async (
  path: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<{
  readonly status: number;
  readonly contentType: string;
  readonly problem: ProblemDetails;
  readonly correlationHeader: string;
}> => {
  const response = await app.inject({
    method: "GET",
    url: `/${API_V1_PREFIX}/failure-fixtures/${path}`,
    headers,
  });

  return {
    status: response.statusCode,
    contentType: response.headers["content-type"] as string,
    problem: response.json<ProblemDetails>(),
    correlationHeader: response.headers[CORRELATION_ID_HEADER] as string,
  };
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [FailureFixtureController],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );

  const context = new CorrelationContext();
  const logger = new StructuredLogger(context, "stockcontrol-api-test", {
    write: (line) => logLines.push(line),
  });
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();

  registerCorrelationIdHook(fastify, context);
  app.setGlobalPrefix(API_V1_PREFIX);
  app.useLogger(logger);
  app.useGlobalFilters(new ProblemDetailsExceptionFilter(context, logger));

  await app.init();
  await fastify.ready();
});

afterAll(async () => {
  await app.close();
});

describe("application failures over HTTP", () => {
  it("returns a module code and detail with the kind's status", async () => {
    const { status, contentType, problem } = await request("permission-denied");

    expect(status).toBe(403);
    expect(contentType).toContain("application/problem+json");
    expect(problem).toMatchObject({
      type: "about:blank",
      title: "Permission denied",
      status: 403,
      code: "identity.permission_change_denied",
      detail: "You cannot change your own permissions.",
      instance: "/api/v1/failure-fixtures/permission-denied",
    });
  });

  it("distinguishes recent-authentication from permission denial at the same status", async () => {
    const denied = await request("permission-denied");
    const recent = await request("recent-authentication-required");

    expect(recent.status).toBe(denied.status);
    expect(recent.problem.code).toBe("auth.recent_authentication_required");
    expect(recent.problem.code).not.toBe(denied.problem.code);
  });

  it("returns 410 with the module's expiry code", async () => {
    const { status, problem } = await request("expired");

    expect(status).toBe(410);
    expect(problem.code).toBe("identity.invitation_expired");
  });

  it("preserves field errors and the caller's correlation identifier", async () => {
    const { status, problem, correlationHeader } = await request("validation", {
      [CORRELATION_ID_HEADER]: "caller-correlation-1",
    });

    expect(status).toBe(422);
    expect(problem.code).toBe("identity.invitation_acceptance_invalid");
    expect(problem.errors).toEqual({
      email: ["Enter a valid email address"],
      password: ["Must contain at least 12 characters", "Must not be a previous password"],
    });
    expect(problem.correlationId).toBe("caller-correlation-1");
    expect(correlationHeader).toBe("caller-correlation-1");
  });

  it("generates a correlation identifier when the caller supplies none", async () => {
    const { problem, correlationHeader } = await request("permission-denied");

    expect(problem.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(correlationHeader).toBe(problem.correlationId);
  });

  it("keeps an unexpected error generic and free of database detail", async () => {
    const { status, problem } = await request("unexpected", {
      [CORRELATION_ID_HEADER]: "caller-correlation-2",
    });
    const body = JSON.stringify(problem);

    expect(status).toBe(500);
    expect(problem.detail).toBe(GENERIC_INTERNAL_FAILURE_DETAIL);
    expect(problem.correlationId).toBe("caller-correlation-2");
    expect(body).not.toContain("identity_users");
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("postgres://");
    expect(problem).not.toHaveProperty("stack");
    expect(logLines.some((line) => line.includes("caller-correlation-2"))).toBe(true);
  });

  it("returns the transport contract for an unknown route", async () => {
    const response = await app.inject({ method: "GET", url: `/${API_V1_PREFIX}/not-a-route` });

    expect(response.statusCode).toBe(404);
    expect(response.json<ProblemDetails>().code).toBe("http.404");
  });
});
