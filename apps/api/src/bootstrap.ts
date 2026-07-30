import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";

import { API_V1_PREFIX } from "@stockcontrol/contracts";
import {
  type CorrelationContext,
  ProblemDetailsExceptionFilter,
  registerCorrelationIdHook,
  type StructuredLogger,
} from "@stockcontrol/platform";

import { AppModule } from "./app.module";
import { SYSTEM_TOKENS } from "./system/system.tokens";

export interface ApiListenerEnvironment {
  readonly HOST?: string;
  readonly PORT?: string;
}

export interface ApiListenerConfiguration {
  readonly host: string;
  readonly port: number;
}

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

export const createApiApplication = async (): Promise<NestFastifyApplication> => {
  const adapter = new FastifyAdapter({
    logger: false,
    trustProxy: "loopback, linklocal, uniquelocal",
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  const context = app.get<CorrelationContext>(SYSTEM_TOKENS.correlationContext);
  const logger = app.get<StructuredLogger>(SYSTEM_TOKENS.logger);
  const fastify: FastifyInstance = app.getHttpAdapter().getInstance();

  registerCorrelationIdHook(fastify, context);
  app.setGlobalPrefix(API_V1_PREFIX);
  app.useLogger(logger);
  app.useGlobalFilters(new ProblemDetailsExceptionFilter(context, logger));

  await app.init();
  await fastify.ready();
  return app;
};

export const startApi = async (
  environment: ApiListenerEnvironment = process.env,
): Promise<NestFastifyApplication> => {
  const { host, port } = resolveApiListenerConfiguration(environment);
  const app = await createApiApplication();
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
