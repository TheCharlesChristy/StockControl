import "reflect-metadata";

import fastifyCookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { parse as parseFormBody } from "node:querystring";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { RequestMethod } from "@nestjs/common";
import type { FastifyInstance } from "fastify";

import { API_V1_PREFIX } from "@stockcontrol/contracts";
import {
  type CorrelationContext,
  ProblemDetailsExceptionFilter,
  registerCorrelationIdHook,
  registerSecurityHeadersHook,
  type StructuredLogger,
} from "@stockcontrol/platform";
import type { DatabaseEnvironment } from "@stockcontrol/platform-database";

import { AppModule } from "./app.module";
import { SYSTEM_TOKENS } from "./system/system.tokens";

export type ApiListenerEnvironment = DatabaseEnvironment & {
  readonly HOST?: string;
  readonly PORT?: string;
  readonly TRUSTED_PROXY_HOPS?: string;
};

export interface ApiListenerConfiguration {
  readonly host: string;
  readonly port: number;
}

/*
 * One hop: the Nginx service that is the only thing allowed to reach this API.
 * Raise it only if a deployment genuinely places more reverse proxies in front
 * of the API and every one of them rewrites X-Forwarded-For.
 */
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * How many reverse proxies sit in front of this API.
 *
 * A hop count rather than a list of trusted subnets. Trusting a subnet means
 * trusting every address inside it, and on a platform whose private network is
 * entirely unique-local that walks the whole X-Forwarded-For chain — down to
 * the leftmost entry, which the client wrote. `request.ip` then reports
 * whatever a caller claimed, and the per-source sign-in throttle is keyed on a
 * value the caller chooses. Counting hops instead makes the resolved address
 * depend on the deployment's shape rather than on the request's contents.
 */
export const resolveTrustedProxyHops = (environment: ApiListenerEnvironment): number => {
  const candidate = environment.TRUSTED_PROXY_HOPS?.trim();

  if (candidate === undefined || candidate.length === 0) {
    return DEFAULT_TRUSTED_PROXY_HOPS;
  }

  const hops = Number(candidate);

  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error(`Invalid TRUSTED_PROXY_HOPS value: ${candidate}`);
  }

  return hops;
};

export const resolveApiListenerConfiguration = (
  environment: ApiListenerEnvironment,
): ApiListenerConfiguration => {
  const candidate = environment.PORT ?? "3000";
  const port = Number(candidate);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT value: ${candidate}`);
  }

  return {
    host: environment.HOST?.trim() || "0.0.0.0",
    port,
  };
};

export const createApiApplication = async (
  environment: ApiListenerEnvironment = process.env,
): Promise<NestFastifyApplication> => {
  const adapter = new FastifyAdapter({
    bodyLimit: 16 * 1024 * 1024,
    logger: false,
    trustProxy: resolveTrustedProxyHops(environment),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  const context = app.get<CorrelationContext>(SYSTEM_TOKENS.correlationContext);
  const logger = app.get<StructuredLogger>(SYSTEM_TOKENS.logger);
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();

  await fastify.register(fastifyCookie);
  registerCorrelationIdHook(fastify, context);
  registerSecurityHeadersHook(fastify);
  app.setGlobalPrefix(API_V1_PREFIX, {
    exclude: [
      { path: "mcp", method: RequestMethod.ALL },
      { path: "oauth/{*path}", method: RequestMethod.ALL },
      { path: ".well-known/{*path}", method: RequestMethod.ALL },
    ],
  });
  app.useLogger(logger);
  app.useGlobalFilters(new ProblemDetailsExceptionFilter(context, logger));

  await app.init();
  registerApiContentTypeParsers(fastify);
  await fastify.ready();
  return app;
};

export const registerApiContentTypeParsers = (fastify: FastifyInstance): void => {
  fastify.addContentTypeParser(
    /^image\/(?:jpeg|webp)(?:\s*;.*)?$/iu,
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  if (!fastify.hasContentTypeParser("application/x-www-form-urlencoded")) {
    fastify.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_request, body, done) => done(null, parseFormBody(String(body))),
    );
  }
};

export const startApi = async (
  environment: ApiListenerEnvironment = process.env,
): Promise<NestFastifyApplication> => {
  const { host, port } = resolveApiListenerConfiguration(environment);
  const app = await createApiApplication(environment);
  const logger = app.get<StructuredLogger>(SYSTEM_TOKENS.logger);

  app.enableShutdownHooks();
  try {
    await app.listen(port, host);
  } catch (listenError: unknown) {
    try {
      await app.close();
    } catch (closeError: unknown) {
      throw new AggregateError(
        [listenError, closeError],
        "The API listener failed and application resources could not be closed cleanly.",
        { cause: closeError },
      );
    }

    throw listenError;
  }

  logger.log({
    event: "api.started",
    host,
    port,
    prefix: API_V1_PREFIX,
  });
  return app;
};
