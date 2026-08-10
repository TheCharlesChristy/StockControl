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
import { createCaptureCleanupHandler } from "./recognition/capture-cleanup-handler";
import { sweepCaptureLifecycle } from "./recognition/capture-expiry-sweeper";
import { createExemplarHandler } from "./recognition/exemplar-handler";
import { S3ImageStorage, type ImageStorage } from "./recognition/image-storage";
import {
  RecognitionDispatcher,
  type RecognitionDispatcherOptions,
} from "./recognition/recognition-dispatcher";
import { resolveDispatcherOptions } from "./recognition/dispatcher-configuration";
import { loadRecognitionPipelineConfiguration } from "./recognition/recognition-configuration";
import { createRecognitionHandler } from "./recognition/recognition-handler";
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
    provide: WORKER_TOKENS.imageStorage,
    useFactory: (): ImageStorage => new S3ImageStorage(process.env),
  },
  {
    provide: WORKER_TOKENS.dispatcher,
    useFactory: (
      context: CorrelationContext,
      logger: StructuredLogger,
      database: Kysely<StockControlDatabase>,
      imageStorage: ImageStorage,
    ) => {
      const jobs = new BackgroundJobDispatcher(context, logger);
      const configuration = loadRecognitionPipelineConfiguration(process.env);
      jobs.register(
        "Recognize",
        createRecognitionHandler({ database, imageStorage, configuration, logger }),
      );
      jobs.register(
        "BuildExemplars",
        createExemplarHandler({ database, imageStorage, configuration, logger }),
      );
      jobs.register(
        "DeleteObjects",
        createCaptureCleanupHandler({ database, imageStorage, logger }),
      );
      return jobs;
    },
    inject: [
      WORKER_TOKENS.correlationContext,
      WORKER_TOKENS.logger,
      WORKER_TOKENS.database,
      WORKER_TOKENS.imageStorage,
    ],
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
      database: Kysely<StockControlDatabase>,
    ) =>
      new WorkerRuntime(
        context,
        logger,
        versionProvider,
        healthEndpoint,
        recognition,
        undefined,
        () => sweepCaptureLifecycle(database, logger).then(() => undefined),
      ),
    inject: [
      WORKER_TOKENS.correlationContext,
      WORKER_TOKENS.logger,
      WORKER_TOKENS.versionProvider,
      WORKER_TOKENS.healthEndpoint,
      WORKER_TOKENS.recognitionDispatcher,
      WORKER_TOKENS.database,
    ],
  },
];

@Module({
  providers,
})
export class WorkerModule {}
