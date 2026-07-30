import { Module, type Provider } from "@nestjs/common";

import { type VersionInformationProvider } from "@stockcontrol/module-system";
import {
  BackgroundJobDispatcher,
  CorrelationContext,
  EnvironmentVersionProvider,
  StructuredLogger,
} from "@stockcontrol/platform";

import { WorkerRuntime } from "./worker-runtime";
import { resolveWorkerHealthConfiguration, WorkerHealthEndpoint } from "./worker-health";
import { WORKER_TOKENS } from "./worker.tokens";

const providers: Provider[] = [
  {
    provide: WORKER_TOKENS.correlationContext,
    useFactory: () => new CorrelationContext(),
  },
  {
    provide: WORKER_TOKENS.logger,
    useFactory: (context: CorrelationContext) =>
      new StructuredLogger(context, "stockcontrol-worker"),
    inject: [WORKER_TOKENS.correlationContext],
  },
  {
    provide: WORKER_TOKENS.versionProvider,
    useFactory: () => new EnvironmentVersionProvider("stockcontrol-worker", process.env),
  },
  {
    provide: WORKER_TOKENS.dispatcher,
    useFactory: (context: CorrelationContext, logger: StructuredLogger) =>
      new BackgroundJobDispatcher(context, logger),
    inject: [WORKER_TOKENS.correlationContext, WORKER_TOKENS.logger],
  },
  {
    provide: WORKER_TOKENS.healthEndpoint,
    useFactory: () => new WorkerHealthEndpoint(resolveWorkerHealthConfiguration(process.env)),
  },
  {
    provide: WORKER_TOKENS.runtime,
    useFactory: (
      context: CorrelationContext,
      logger: StructuredLogger,
      versionProvider: VersionInformationProvider,
      healthEndpoint: WorkerHealthEndpoint,
    ) => new WorkerRuntime(context, logger, versionProvider, healthEndpoint),
    inject: [
      WORKER_TOKENS.correlationContext,
      WORKER_TOKENS.logger,
      WORKER_TOKENS.versionProvider,
      WORKER_TOKENS.healthEndpoint,
    ],
  },
];

@Module({
  providers,
})
export class WorkerModule {}
