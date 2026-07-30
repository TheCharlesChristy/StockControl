import "reflect-metadata";

import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import type { StructuredLogger } from "@stockcontrol/platform";

import { WorkerModule } from "./worker.module";
import type { WorkerRuntime } from "./worker-runtime";
import { WORKER_TOKENS } from "./worker.tokens";

export const startWorker = async (): Promise<INestApplicationContext> => {
  const application = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = application.get<StructuredLogger>(WORKER_TOKENS.logger);
  const runtime = application.get<WorkerRuntime>(WORKER_TOKENS.runtime);

  application.useLogger(logger);
  application.enableShutdownHooks();
  try {
    await runtime.start();
  } catch (startError: unknown) {
    try {
      await application.close();
    } catch (closeError: unknown) {
      throw new AggregateError(
        [startError, closeError],
        "The worker failed to start and application resources could not be closed cleanly.",
        { cause: closeError },
      );
    }

    throw startError;
  }

  return application;
};
