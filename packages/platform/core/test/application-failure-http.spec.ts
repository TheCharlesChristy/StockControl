import { HttpException, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  applicationFailure,
  applicationFailureKinds,
  APPLICATION_FAILURE_POLICY,
  CORRELATION_ID_HEADER,
  GENERIC_INTERNAL_FAILURE_DETAIL,
  internalFailure,
  permissionDenied,
  resourceExpired,
  validationFailed,
  type ProblemDetails,
} from "@stockcontrol/contracts";

import { ApplicationFailureException } from "../src/http/application-failure-exception";
import { ProblemDetailsExceptionFilter } from "../src/http/problem-details-exception-filter";
import { CorrelationContext } from "../src/observability/correlation-context";
import { StructuredLogger } from "../src/observability/structured-logger";

interface RecordedReply {
  readonly header: (name: string, value: string) => RecordedReply;
  readonly send: (body: unknown) => RecordedReply;
  readonly status: (statusCode: number) => RecordedReply;
  readonly type: (contentType: string) => RecordedReply;
}

const makeReply = (): RecordedReply => {
  const reply = {
    header: vi.fn(),
    send: vi.fn(),
    status: vi.fn(),
    type: vi.fn(),
  } as unknown as RecordedReply;
  vi.mocked(reply.header).mockReturnValue(reply);
  vi.mocked(reply.send).mockReturnValue(reply);
  vi.mocked(reply.status).mockReturnValue(reply);
  vi.mocked(reply.type).mockReturnValue(reply);
  return reply;
};

const makeHost = (reply: RecordedReply, url = "/api/v1/users/user-1/role"): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { [CORRELATION_ID_HEADER]: "correlation-1" },
        method: "POST",
        url,
      }),
      getResponse: () => reply,
      getNext: () => undefined,
    }),
  }) as ArgumentsHost;

interface FilterHarness {
  readonly filter: ProblemDetailsExceptionFilter;
  readonly logLines: { readonly level: string; readonly line: string }[];
}

const makeFilter = (): FilterHarness => {
  const context = new CorrelationContext();
  const logLines: { level: string; line: string }[] = [];
  const logger = new StructuredLogger(context, "api-test", {
    write: (line, level) => logLines.push({ level, line }),
  });

  return { filter: new ProblemDetailsExceptionFilter(context, logger), logLines };
};

const sentProblem = (reply: RecordedReply): ProblemDetails =>
  vi.mocked(reply.send).mock.calls[0]?.[0] as ProblemDetails;

describe("rendering an application failure as problem details", () => {
  it.each([...applicationFailureKinds])("renders %s with its mapped status and code", (kind) => {
    const { filter } = makeFilter();
    const reply = makeReply();

    filter.catch(new ApplicationFailureException(applicationFailure(kind)), makeHost(reply));

    expect(reply.status).toHaveBeenCalledWith(APPLICATION_FAILURE_POLICY[kind].status);
    expect(reply.type).toHaveBeenCalledWith("application/problem+json");
    expect(sentProblem(reply)).toMatchObject({
      status: APPLICATION_FAILURE_POLICY[kind].status,
      code: APPLICATION_FAILURE_POLICY[kind].code,
      title: APPLICATION_FAILURE_POLICY[kind].title,
      instance: "/api/v1/users/user-1/role",
      correlationId: "correlation-1",
    });
  });

  it("preserves a module-specific code and its detail", () => {
    const { filter } = makeFilter();
    const reply = makeReply();

    filter.catch(
      new ApplicationFailureException(
        resourceExpired({
          code: "identity.invitation_expired",
          detail: "That invitation link has expired.",
        }),
      ),
      makeHost(reply),
    );

    expect(sentProblem(reply)).toMatchObject({
      status: 410,
      code: "identity.invitation_expired",
      detail: "That invitation link has expired.",
    });
  });

  it("preserves field errors and the correlation identifier", () => {
    const { filter } = makeFilter();
    const reply = makeReply();

    filter.catch(
      new ApplicationFailureException(
        validationFailed({
          password: ["Must contain at least 12 characters"],
          email: ["Enter a valid email address"],
        }),
      ),
      makeHost(reply),
    );

    const problem = sentProblem(reply);

    expect(problem.status).toBe(422);
    expect(problem.errors).toEqual({
      email: ["Enter a valid email address"],
      password: ["Must contain at least 12 characters"],
    });
    expect(problem.correlationId).toBe("correlation-1");
    expect(reply.header).toHaveBeenCalledWith(CORRELATION_ID_HEADER, "correlation-1");
  });

  it("logs a client failure as a warning with its kind and code", () => {
    const { filter, logLines } = makeFilter();

    filter.catch(new ApplicationFailureException(permissionDenied()), makeHost(makeReply()));

    expect(logLines).toHaveLength(1);
    expect(logLines[0]?.level).toBe("warn");
    expect(logLines[0]?.line).toContain("PermissionDenied");
    expect(logLines[0]?.line).toContain("auth.permission_denied");
  });

  it("logs an unexpected failure as an error but never returns its detail", () => {
    const { filter, logLines } = makeFilter();
    const reply = makeReply();

    filter.catch(
      new ApplicationFailureException(internalFailure('relation "identity_users" does not exist')),
      makeHost(reply),
    );

    const problem = sentProblem(reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(problem.detail).toBe(GENERIC_INTERNAL_FAILURE_DETAIL);
    expect(problem.code).toBe("internal.error");
    expect(JSON.stringify(problem)).not.toContain("identity_users");
    expect(logLines[0]?.level).toBe("error");
    expect(logLines[0]?.line).toContain("identity_users");
  });

  it("keeps the exception message generic for an unexpected failure", () => {
    const exception = new ApplicationFailureException(
      internalFailure("connection to postgres://app:secret@db failed"),
    );

    expect(exception.message).toBe(GENERIC_INTERNAL_FAILURE_DETAIL);
    expect(exception.getStatus()).toBe(500);
  });

  it("leaves framework exceptions on the existing transport contract", () => {
    const { filter } = makeFilter();
    const reply = makeReply();

    filter.catch(new HttpException("Not Found", 404), makeHost(reply));

    expect(sentProblem(reply)).toMatchObject({
      status: 404,
      code: "http.404",
      detail: "Not Found",
    });
  });
});
