export const SYSTEM_TOKENS = {
  clock: Symbol("system.clock"),
  correlationContext: Symbol("observability.correlation-context"),
  database: Symbol("database.connection"),
  databaseLifecycle: Symbol("database.lifecycle"),
  databaseReadiness: Symbol("database.readiness"),
  getLiveness: Symbol("system.get-liveness"),
  getReadiness: Symbol("system.get-readiness"),
  getVersion: Symbol("system.get-version"),
  logger: Symbol("observability.structured-logger"),
  readinessRegistry: Symbol("system.readiness-registry"),
  versionProvider: Symbol("system.version-provider"),
} as const;
