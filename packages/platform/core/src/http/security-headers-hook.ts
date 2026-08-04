import type { FastifyInstance } from "fastify";

/*
 * The API answers with JSON and with image bytes that a user uploaded. It never
 * answers with a document, so the strictest policy is also the correct one:
 * nothing this response contains may be loaded or executed as a resource.
 */
const RESOURCE_POLICY = "default-src 'none'; frame-ancestors 'none'; sandbox";

/**
 * Sets the response headers the API is responsible for on its own.
 *
 * The public deployment puts Nginx in front of this service and Nginx already
 * sets a fuller set for the browser application it serves. These are the ones
 * that must not depend on that: a header set in a different service, in a
 * different repository directory, is a header that can be removed by someone
 * who has no idea this service was relying on it — and the endpoints serving
 * uploaded bytes are the ones that would suffer for it.
 *
 * `cache-control` is only defaulted, never overridden. Handlers that have
 * decided an asset is privately cacheable keep that decision.
 */
export const registerSecurityHeadersHook = (fastify: FastifyInstance): void => {
  fastify.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", RESOURCE_POLICY);
    reply.header("referrer-policy", "no-referrer");

    if (reply.getHeader("cache-control") === undefined) {
      reply.header("cache-control", "no-store");
    }

    done(null, payload);
  });
};
