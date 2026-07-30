import { STATUS_CODES } from "node:http";

import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  CORRELATION_ID_HEADER,
  problemDetailsForFailure,
  type ProblemDetails,
} from "@stockcontrol/contracts";

import type { CorrelationContext } from "../observability/correlation-context";
import type { StructuredLogger } from "../observability/structured-logger";
import { ApplicationFailureException } from "./application-failure-exception";

const detailFromHttpException = (exception: HttpException): string => {
  const response = exception.getResponse();

  if (typeof response === "string") {
    return response;
  }

  if (typeof response === "object" && "message" in response) {
    const message = (response as { readonly message?: unknown }).message;

    if (Array.isArray(message)) {
      return message.filter((entry): entry is string => typeof entry === "string").join("; ");
    }

    if (typeof message === "string") {
      return message;
    }
  }

  return exception.message;
};

@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  public constructor(
    private readonly context: CorrelationContext,
    private readonly logger: StructuredLogger,
  ) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const response = http.getResponse<FastifyReply>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : 500;
    const headerCorrelationId = request.headers[CORRELATION_ID_HEADER];
    const correlationId =
      this.context.currentId() ??
      this.context.normalize(
        Array.isArray(headerCorrelationId) ? headerCorrelationId[0] : headerCorrelationId,
      );
    const isApplicationFailure = exception instanceof ApplicationFailureException;
    const detail = isHttpException
      ? detailFromHttpException(exception)
      : "An unexpected error occurred.";
    const title = STATUS_CODES[status] ?? "Request failed";
    const timestamp = new Date().toISOString();
    const problem: ProblemDetails = isApplicationFailure
      ? problemDetailsForFailure(exception.failure, {
          instance: request.url,
          correlationId,
          timestamp,
        })
      : {
          type: "about:blank",
          title,
          status,
          detail,
          instance: request.url,
          code: `http.${status}`,
          correlationId,
          timestamp,
        };

    const event = {
      event: "http.request.failed",
      status,
      method: request.method,
      url: request.url,
      /*
       * The failure kind and code are safe to log and make an operational
       * alert actionable. For an unexpected failure the module's log-only
       * detail is recorded here and never sent to the client.
       */
      ...(isApplicationFailure
        ? { failureKind: exception.failure.kind, failureCode: exception.failure.code }
        : {}),
      exception: isApplicationFailure
        ? exception.failure.detail
        : isHttpException
          ? exception.message
          : exception,
    };

    if (status >= 500) {
      this.logger.error(event);
    } else {
      this.logger.warn(event);
    }

    response
      .header(CORRELATION_ID_HEADER, correlationId)
      .status(status)
      .type("application/problem+json")
      .send(problem);
  }
}
