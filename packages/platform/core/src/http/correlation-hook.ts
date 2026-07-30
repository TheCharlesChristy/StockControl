import type { FastifyInstance } from "fastify";

import { CORRELATION_ID_HEADER } from "@stockcontrol/contracts";

import type { CorrelationContext } from "../observability/correlation-context";

export const registerCorrelationIdHook = (
  fastify: FastifyInstance,
  context: CorrelationContext,
): void => {
  fastify.addHook("onRequest", (request, reply, done) => {
    const correlationId = context.normalize(request.headers[CORRELATION_ID_HEADER]);

    reply.header(CORRELATION_ID_HEADER, correlationId);
    context.run(correlationId, done);
  });
};
