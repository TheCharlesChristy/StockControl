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
import { ExpiredSessionSweeper } from "./auth/expired-session-sweeper";
import { loadPublicAppOrigin, RequestOriginGuard } from "./auth/request-origin.guard";
import { SessionService } from "./auth/session-service";
import { SignInRateLimiter } from "./auth/sign-in-rate-limiter";
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardService } from "./dashboard/dashboard.service";
import { DatabaseLifecycle } from "./database/database-lifecycle";
import { CatalogueService } from "./inventory/catalogue.service";
import { InventoryController } from "./inventory/inventory.controller";
import { StockService } from "./inventory/stock.service";
import { IssuesController } from "./issues/issues.controller";
import { IssuesService } from "./issues/issues.service";
import { JobsController } from "./jobs/jobs.controller";
import { JobsService } from "./jobs/jobs.service";
import { StockRequestsController } from "./requests/requests.controller";
import { StockRequestsService } from "./requests/requests.service";
import { SystemController } from "./system/system.controller";
import { SYSTEM_TOKENS } from "./system/system.tokens";
import { resolveLogLevels } from "./system/log-level";
import { UsersController } from "./users/users.controller";
import { UsersService } from "./users/users.service";
import { LocationsController } from "./locations/locations.controller";
import { LocationsService } from "./locations/locations.service";
import { PhotosService } from "./media/photos.service";
import {
  isStockCaptureEnabled,
  loadStockCaptureConfiguration,
  type StockCaptureConfiguration,
} from "./stock-capture/capture-configuration";
import { StockCaptureController } from "./stock-capture/stock-capture.controller";
import { StockCaptureService } from "./stock-capture/stock-capture.service";
import { McpActivityController } from "./integrations/mcp/mcp-activity.controller";
import { McpActivityService } from "./integrations/mcp/mcp-activity.service";
import { McpController } from "./integrations/mcp/mcp.controller";
import { McpAuditService } from "./integrations/mcp/mcp-audit.service";
import {
  isMcpEnabled,
  loadMcpConfiguration,
  type McpConfiguration,
} from "./integrations/mcp/mcp-configuration";
import { McpToolExecutor } from "./integrations/mcp/mcp-tool-executor";
import { McpReconciliationJob } from "./integrations/mcp/mcp-reconciliation";
import { McpRateLimiter } from "./integrations/mcp/mcp-rate-limiter";
import { OAuthAuthorizationRequestSweeper } from "./integrations/mcp/oauth-authorization-request-sweeper";
import { OAuthController } from "./integrations/mcp/oauth.controller";
import { OAuthService } from "./integrations/mcp/oauth.service";

type Database = Kysely<StockControlDatabase>;

const providers: Provider[] = [
  {
    provide: SYSTEM_TOKENS.correlationContext,
    useFactory: () => new CorrelationContext(),
  },
  {
    provide: SYSTEM_TOKENS.logger,
    useFactory: (context: CorrelationContext) => {
      const logger = new StructuredLogger(context, "stockcontrol-api");
      logger.setLogLevels(resolveLogLevels(process.env["LOG_LEVEL"]));
      return logger;
    },
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
    provide: API_TOKENS.signInRateLimiter,
    useFactory: () => new SignInRateLimiter(),
  },
  {
    /*
     * Resolved once at startup so the origin is validated while the process is
     * still starting, and so the guard and the cookie cannot disagree about
     * which origin this deployment serves.
     */
    provide: API_TOKENS.publicAppOrigin,
    useFactory: () => loadPublicAppOrigin(),
  },
  {
    provide: API_TOKENS.expiredSessionSweeper,
    useFactory: (sessions: SessionService, logger: StructuredLogger) =>
      new ExpiredSessionSweeper(sessions, logger),
    inject: [API_TOKENS.sessionService, SYSTEM_TOKENS.logger],
  },
  {
    provide: API_TOKENS.stockService,
    useFactory: (database: Database) => new StockService(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    provide: API_TOKENS.catalogueService,
    useFactory: (database: Database, photos: PhotosService) =>
      new CatalogueService(database, photos),
    inject: [SYSTEM_TOKENS.database, API_TOKENS.photosService],
  },
  {
    provide: API_TOKENS.jobsService,
    useFactory: (database: Database) => new JobsService(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    provide: API_TOKENS.issuesService,
    useFactory: () => new IssuesService(),
  },
  {
    provide: API_TOKENS.usersService,
    useFactory: (database: Database, sessions: SessionService, photos: PhotosService) =>
      new UsersService(database, sessions, photos),
    inject: [SYSTEM_TOKENS.database, API_TOKENS.sessionService, API_TOKENS.photosService],
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
    provide: API_TOKENS.photosService,
    useFactory: (database: Database) => new PhotosService(database),
    inject: [SYSTEM_TOKENS.database],
  },
  {
    /*
     * Run the browser-origin check before authentication. Sign-in and sign-out
     * are public routes, but they still mutate authentication state.
     */
    provide: APP_GUARD,
    useFactory: (allowedOrigin: string | null, reflector: Reflector) =>
      new RequestOriginGuard(allowedOrigin, reflector),
    inject: [API_TOKENS.publicAppOrigin, Reflector],
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

/*
 * Assisted stock capture stays off an existing deployment until this is set.
 * Both the provider and the controller are conditional, not only the route
 * list: `loadStockCaptureConfiguration` validates several numbers, and
 * letting it run unconditionally on every boot would mean a typo in a
 * setting nobody is using yet could take an otherwise-healthy API down.
 */
const stockCaptureEnabled = isStockCaptureEnabled();
const mcpEnabled = isMcpEnabled();

const stockCaptureProviders: Provider[] = stockCaptureEnabled
  ? [
      {
        provide: API_TOKENS.stockCaptureConfiguration,
        useFactory: () => loadStockCaptureConfiguration(),
      },
      {
        provide: API_TOKENS.stockCaptureService,
        useFactory: (database: Database, configuration: StockCaptureConfiguration) =>
          new StockCaptureService(database, configuration),
        inject: [SYSTEM_TOKENS.database, API_TOKENS.stockCaptureConfiguration],
      },
    ]
  : [];

const mcpProviders: Provider[] = mcpEnabled
  ? [
      {
        provide: API_TOKENS.mcpConfiguration,
        useFactory: (): McpConfiguration => loadMcpConfiguration(),
      },
      {
        provide: API_TOKENS.mcpAuditService,
        useFactory: (database: Database) => new McpAuditService(database),
        inject: [SYSTEM_TOKENS.database],
      },
      {
        provide: API_TOKENS.mcpOAuthService,
        useFactory: (database: Database, configuration: McpConfiguration) =>
          new OAuthService(database, configuration),
        inject: [SYSTEM_TOKENS.database, API_TOKENS.mcpConfiguration],
      },
      {
        provide: API_TOKENS.mcpActivityService,
        useFactory: (database: Database, oauth: OAuthService) =>
          new McpActivityService(database, oauth),
        inject: [SYSTEM_TOKENS.database, API_TOKENS.mcpOAuthService],
      },
      {
        provide: API_TOKENS.mcpReconciliationJob,
        useFactory: (
          database: Database,
          audit: McpAuditService,
          configuration: McpConfiguration,
          logger: StructuredLogger,
          executor: McpToolExecutor,
        ) =>
          new McpReconciliationJob(
            database,
            audit,
            () => new Date(),
            configuration.abandonedCallSeconds,
            logger,
            configuration.enabled,
            (callId) => executor.isInFlight(callId),
          ),
        inject: [
          SYSTEM_TOKENS.database,
          API_TOKENS.mcpAuditService,
          API_TOKENS.mcpConfiguration,
          SYSTEM_TOKENS.logger,
          API_TOKENS.mcpToolExecutor,
        ],
      },
      {
        provide: API_TOKENS.mcpToolExecutor,
        useFactory: (
          database: Database,
          audit: McpAuditService,
          oauth: OAuthService,
          configuration: McpConfiguration,
          dashboard: DashboardService,
          catalogue: CatalogueService,
          stock: StockService,
          jobs: JobsService,
          requests: StockRequestsService,
          correlation: CorrelationContext,
          logger: StructuredLogger,
          rateLimiter: McpRateLimiter,
        ) =>
          new McpToolExecutor(
            database,
            audit,
            oauth,
            configuration,
            dashboard,
            catalogue,
            stock,
            jobs,
            requests,
            correlation,
            logger,
            rateLimiter,
          ),
        inject: [
          SYSTEM_TOKENS.database,
          API_TOKENS.mcpAuditService,
          API_TOKENS.mcpOAuthService,
          API_TOKENS.mcpConfiguration,
          API_TOKENS.dashboardService,
          API_TOKENS.catalogueService,
          API_TOKENS.stockService,
          API_TOKENS.jobsService,
          API_TOKENS.stockRequestsService,
          SYSTEM_TOKENS.correlationContext,
          SYSTEM_TOKENS.logger,
          API_TOKENS.mcpRateLimiter,
        ],
      },
      {
        provide: API_TOKENS.mcpRateLimiter,
        useFactory: () => new McpRateLimiter(),
      },
      {
        provide: API_TOKENS.mcpAuthorizationRequestSweeper,
        useFactory: (oauth: OAuthService, logger: StructuredLogger) =>
          new OAuthAuthorizationRequestSweeper(oauth, logger),
        inject: [API_TOKENS.mcpOAuthService, SYSTEM_TOKENS.logger],
      },
    ]
  : [];

@Module({
  controllers: [
    SystemController,
    AuthController,
    DashboardController,
    InventoryController,
    JobsController,
    IssuesController,
    StockRequestsController,
    UsersController,
    LocationsController,
    ...(stockCaptureEnabled ? [StockCaptureController] : []),
    ...(mcpEnabled ? [OAuthController, McpController, McpActivityController] : []),
  ],
  providers: [...providers, ...stockCaptureProviders, ...mcpProviders],
})
export class AppModule {}
