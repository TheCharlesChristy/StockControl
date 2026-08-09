import { Module, type Provider } from "@nestjs/common";
import type { Kysely } from "kysely";

import { type ReadinessChecks, type VersionInformationProvider } from "@stockcontrol/module-system";
import {
  BackgroundJobDispatcher,
  CorrelationContext,
  EnvironmentVersionProvider,
  ReadinessRegistry,
  StructuredLogger,
} from "@stockcontrol/platform";
import {
  createRuntimeDatabase,
  loadWorkerDatabaseConfiguration,
  PostgresReadinessCheck,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";

import { DatabaseLifecycle } from "./database-lifecycle";
import {
  RecognitionDispatcher,
  type RecognitionDispatcherOptions,
} from "./recognition/recognition-dispatcher";
import { resolveDispatcherOptions } from "./recognition/dispatcher-configuration";
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
    provide: WORKER_TOKENS.database,
    useFactory: () => createRuntimeDatabase(loadWorkerDatabaseConfiguration(process.env)),
  },
  {
    provide: WORKER_TOKENS.databaseLifecycle,
    useFactory: (database: Kysely<StockControlDatabase>) => new DatabaseLifecycle(database),
    inject: [WORKER_TOKENS.database],
  },
  {
    provide: WORKER_TOKENS.readinessChecks,
    useFactory: (database: Kysely<StockControlDatabase>) => {
      const registry = new ReadinessRegistry();
      registry.register(new PostgresReadinessCheck(database));
      return registry;
    },
    inject: [WORKER_TOKENS.database],
  },
  {
    provide: WORKER_TOKENS.dispatcher,
    useFactory: (context: CorrelationContext, logger: StructuredLogger) =>
      new BackgroundJobDispatcher(context, logger),
    inject: [WORKER_TOKENS.correlationContext, WORKER_TOKENS.logger],
  },
  {
    provide: WORKER_TOKENS.recognitionDispatcher,
    useFactory: (
      database: Kysely<StockControlDatabase>,
      jobs: BackgroundJobDispatcher,
      logger: StructuredLogger,
    ) =>
      new RecognitionDispatcher(
        database,
        jobs,
        logger,
        resolveDispatcherOptions(process.env) satisfies RecognitionDispatcherOptions,
      ),
    inject: [WORKER_TOKENS.database, WORKER_TOKENS.dispatcher, WORKER_TOKENS.logger],
  },
  {
    provide: WORKER_TOKENS.healthEndpoint,
    useFactory: (readiness: ReadinessChecks) =>
      new WorkerHealthEndpoint(resolveWorkerHealthConfiguration(process.env), readiness),
    inject: [WORKER_TOKENS.readinessChecks],
  },
  {
    provide: WORKER_TOKENS.runtime,
    useFactory: (
      context: CorrelationContext,
      logger: StructuredLogger,
      versionProvider: VersionInformationProvider,
      healthEndpoint: WorkerHealthEndpoint,
      recognition: RecognitionDispatcher,
    ) => new WorkerRuntime(context, logger, versionProvider, healthEndpoint, recognition),
    inject: [
      WORKER_TOKENS.correlationContext,
      WORKER_TOKENS.logger,
      WORKER_TOKENS.versionProvider,
      WORKER_TOKENS.healthEndpoint,
      WORKER_TOKENS.recognitionDispatcher,
    ],
  },
];

@Module({
  providers,
})
export class WorkerModule {}
