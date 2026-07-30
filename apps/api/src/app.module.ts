import { Module, type Provider } from "@nestjs/common";

import {
  GetLiveness,
  GetReadiness,
  GetVersion,
  type Clock,
  type ReadinessChecks,
  type VersionInformationProvider,
} from "@stockcontrol/module-system";
import {
  CorrelationContext,
  EnvironmentVersionProvider,
  ReadinessRegistry,
  StructuredLogger,
  SystemClock,
} from "@stockcontrol/platform";
import {
  createRuntimeDatabase,
  loadRuntimeDatabaseConfiguration,
  PostgresReadinessCheck,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import { DatabaseLifecycle } from "./database/database-lifecycle";
import { SystemController } from "./system/system.controller";
import { SYSTEM_TOKENS } from "./system/system.tokens";

const providers: Provider[] = [
  {
    provide: SYSTEM_TOKENS.correlationContext,
    useFactory: () => new CorrelationContext(),
  },
  {
    provide: SYSTEM_TOKENS.logger,
    useFactory: (context: CorrelationContext) => new StructuredLogger(context, "stockcontrol-api"),
    inject: [SYSTEM_TOKENS.correlationContext],
  },
  {
    provide: SYSTEM_TOKENS.clock,
    useFactory: () => new SystemClock(),
  },
  {
    provide: SYSTEM_TOKENS.readinessRegistry,
    useFactory: () => new ReadinessRegistry(),
  },
  {
    provide: SYSTEM_TOKENS.database,
    useFactory: () => createRuntimeDatabase(loadRuntimeDatabaseConfiguration()),
  },
  {
    provide: SYSTEM_TOKENS.databaseLifecycle,
    useFactory: (database: Kysely<StockControlDatabase>) => new DatabaseLifecycle(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    provide: SYSTEM_TOKENS.databaseReadiness,
    useFactory: (database: Kysely<StockControlDatabase>, registry: ReadinessRegistry) => {
      const check = new PostgresReadinessCheck(database);
      registry.register(check);
      return check;
    },
    inject: [SYSTEM_TOKENS.database, SYSTEM_TOKENS.readinessRegistry],
  },
  {
    provide: SYSTEM_TOKENS.versionProvider,
    useFactory: () => new EnvironmentVersionProvider("stockcontrol-api", process.env),
  },
  {
    provide: SYSTEM_TOKENS.getLiveness,
    useFactory: (clock: Clock) => new GetLiveness(clock),
    inject: [SYSTEM_TOKENS.clock],
  },
  {
    provide: SYSTEM_TOKENS.getReadiness,
    useFactory: (clock: Clock, checks: ReadinessChecks) => new GetReadiness(clock, checks),
    inject: [SYSTEM_TOKENS.clock, SYSTEM_TOKENS.readinessRegistry],
  },
  {
    provide: SYSTEM_TOKENS.getVersion,
    useFactory: (versionProvider: VersionInformationProvider) => new GetVersion(versionProvider),
    inject: [SYSTEM_TOKENS.versionProvider],
  },
];

@Module({
  controllers: [SystemController],
  providers,
})
export class AppModule {}
