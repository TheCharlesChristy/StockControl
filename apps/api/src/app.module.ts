import { Module, type Provider } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";

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

import { API_TOKENS } from "./api.tokens";
import { AuthController } from "./auth/auth.controller";
import { AuthenticationGuard } from "./auth/auth.guard";
import { SessionService } from "./auth/session-service";
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardService } from "./dashboard/dashboard.service";
import { DatabaseLifecycle } from "./database/database-lifecycle";
import { CatalogueService } from "./inventory/catalogue.service";
import { InventoryController } from "./inventory/inventory.controller";
import { StockService } from "./inventory/stock.service";
import { JobsController } from "./jobs/jobs.controller";
import { JobsService } from "./jobs/jobs.service";
import { StockRequestsController } from "./requests/requests.controller";
import { StockRequestsService } from "./requests/requests.service";
import { SystemController } from "./system/system.controller";
import { SYSTEM_TOKENS } from "./system/system.tokens";
import { UsersController } from "./users/users.controller";
import { UsersService } from "./users/users.service";
import { LocationsController } from "./locations/locations.controller";
import { LocationsService } from "./locations/locations.service";

type Database = Kysely<StockControlDatabase>;

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
    useFactory: (database: Database) => new DatabaseLifecycle(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    provide: SYSTEM_TOKENS.databaseReadiness,
    useFactory: (database: Database, registry: ReadinessRegistry) => {
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
  {
    provide: API_TOKENS.sessionService,
    useFactory: (database: Database) => new SessionService(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    provide: API_TOKENS.stockService,
    useFactory: (database: Database) => new StockService(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    provide: API_TOKENS.catalogueService,
    useFactory: (database: Database) => new CatalogueService(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    provide: API_TOKENS.jobsService,
    useFactory: (database: Database) => new JobsService(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    provide: API_TOKENS.usersService,
    useFactory: (database: Database, sessions: SessionService) =>
      new UsersService(database, sessions),
    inject: [SYSTEM_TOKENS.database, API_TOKENS.sessionService],
  },
  {
    provide: API_TOKENS.dashboardService,
    useFactory: (database: Database, jobs: JobsService) => new DashboardService(database, jobs),
    inject: [SYSTEM_TOKENS.database, API_TOKENS.jobsService],
  },
  {
    provide: API_TOKENS.stockRequestsService,
    useFactory: (database: Database, stock: StockService) =>
      new StockRequestsService(database, stock),
    inject: [SYSTEM_TOKENS.database, API_TOKENS.stockService],
  },
  {
    provide: API_TOKENS.locationsService,
    useFactory: (database: Database) => new LocationsService(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    /*
     * Registered globally so a new route is authenticated by default. A handler
     * opts out explicitly with the Public decorator, which is visible in review.
     */
    provide: APP_GUARD,
    useFactory: (sessions: SessionService, reflector: Reflector) =>
      new AuthenticationGuard(sessions, reflector),
    inject: [API_TOKENS.sessionService, Reflector],
  },
];

@Module({
  controllers: [
    SystemController,
    AuthController,
    DashboardController,
    InventoryController,
    JobsController,
    StockRequestsController,
    UsersController,
    LocationsController,
  ],
  providers,
})
export class AppModule {}
