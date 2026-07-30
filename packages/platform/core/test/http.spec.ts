import { HttpException, type ArgumentsHost } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { CORRELATION_ID_HEADER } from "@stockcontrol/contracts";

import { registerCorrelationIdHook } from "../src/http/correlation-hook";
import { ProblemDetailsExceptionFilter } from "../src/http/problem-details-exception-filter";
import { CorrelationContext } from "../src/observability/correlation-context";
import { StructuredLogger } from "../src/observability/structured-logger";

type CorrelationHook = (
  request: { readonly headers: Record<string, unknown> },
  reply: { readonly header: (name: string, value: string) => void },
  done: () => void,
) => void;

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

const makeHost = (
  request: {
    readonly headers: Record<string, string | readonly string[] | undefined>;
    readonly method: string;
    readonly url: string;
  },
  reply: RecordedReply,
): ArgumentsHost =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
      getNext: () => undefined,
    }),
  }) as ArgumentsHost;

const makeFilter = (): {
  readonly context: CorrelationContext;
  readonly filter: ProblemDetailsExceptionFilter;
  readonly logLevels: string[];
} => {
  const context = new CorrelationContext();
  const logLevels: string[] = [];
  const logger = new StructuredLogger(context, "api-test", {
    write: (_line, level) => logLevels.push(level),
  });
  return {
    context,
    filter: new ProblemDetailsExceptionFilter(context, logger),
    logLevels,
  };
};

describe("HTTP platform adapters", () => {
  it("registers a request hook that returns and scopes a valid correlation ID", () => {
    const context = new CorrelationContext();
    const addHook = vi.fn();
    registerCorrelationIdHook({ addHook } as unknown as FastifyInstance, context);
    const hook = addHook.mock.calls[0]?.[1] as CorrelationHook;
    const header = vi.fn();
    let activeId: string | undefined;

    hook({ headers: { [CORRELATION_ID_HEADER]: "request-123" } }, { header }, () => {
      activeId = context.currentId();
    });

    expect(addHook.mock.calls[0]?.[0]).toBe("onRequest");
    expect(header).toHaveBeenCalledWith(CORRELATION_ID_HEADER, "request-123");
    expect(activeId).toBe("request-123");
    expect(context.currentId()).toBeUndefined();
  });

  it("replaces an unsupported correlation header with a generated identifier", () => {
    const context = new CorrelationContext();
    const addHook = vi.fn();
    registerCorrelationIdHook({ addHook } as unknown as FastifyInstance, context);
    const hook = addHook.mock.calls[0]?.[1] as CorrelationHook;
    const header = vi.fn();

    hook({ headers: { [CORRELATION_ID_HEADER]: ["not", "scalar"] } }, { header }, vi.fn());

    expect(header.mock.calls[0]?.[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("returns validation details from a message array and keeps active correlation", () => {
    const { context, filter, logLevels } = makeFilter();
    const reply = makeReply();
    const host = makeHost(
      {
        headers: { [CORRELATION_ID_HEADER]: "ignored-header" },
        method: "POST",
        url: "/items",
      },
      reply,
    );
    const exception = new HttpException({ message: ["name is required", 12, "quantity"] }, 400);

    context.run("active-correlation", () => filter.catch(exception, host));

    expect(logLevels).toEqual(["warn"]);
    expect(reply.header).toHaveBeenCalledWith(CORRELATION_ID_HEADER, "active-correlation");
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.type).toHaveBeenCalledWith("application/problem+json");
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Bad Request",
        status: 400,
        detail: "name is required; quantity",
        instance: "/items",
        code: "http.400",
        correlationId: "active-correlation",
      }),
    );
  });

  it.each([
    {
      name: "plain response",
      exception: new HttpException("plain detail", 418),
      detail: "plain detail",
      title: "I'm a Teapot",
    },
    {
      name: "object string message",
      exception: new HttpException({ message: "object detail" }, 409),
      detail: "object detail",
      title: "Conflict",
    },
    {
      name: "response without a message",
      exception: new HttpException({ reason: "private" }, 599),
      detail: "Http Exception",
      title: "Request failed",
    },
  ])("supports $name HTTP exceptions", ({ exception, detail, title }) => {
    const { filter, logLevels } = makeFilter();
    const reply = makeReply();
    const host = makeHost(
      {
        headers: { [CORRELATION_ID_HEADER]: ["header-correlation", "ignored"] },
        method: "GET",
        url: "/health",
      },
      reply,
    );

    filter.catch(exception, host);

    expect(logLevels).toEqual([exception.getStatus() >= 500 ? "error" : "warn"]);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        detail,
        title,
        correlationId: "header-correlation",
      }),
    );
  });

  it("hides unexpected exception details behind a generic server problem", () => {
    const { filter, logLevels } = makeFilter();
    const reply = makeReply();
    const host = makeHost(
      {
        headers: {},
        method: "GET",
        url: "/inventory",
      },
      reply,
    );

    filter.catch(new Error("database credentials leaked"), host);

    expect(logLevels).toEqual(["error"]);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Internal Server Error",
        status: 500,
        detail: "An unexpected error occurred.",
        correlationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
      }),
    );
  });
});
