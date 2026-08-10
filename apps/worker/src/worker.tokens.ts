export const WORKER_TOKENS = {
  correlationContext: Symbol("observability.correlation-context"),
  database: Symbol("database.connection"),
  databaseLifecycle: Symbol("database.lifecycle"),
  dispatcher: Symbol("background.dispatcher"),
  healthEndpoint: Symbol("worker.health-endpoint"),
  imageStorage: Symbol("recognition.image-storage"),
  logger: Symbol("observability.structured-logger"),
  readinessChecks: Symbol("health.readiness-checks"),
  recognitionDispatcher: Symbol("recognition.dispatcher"),
  runtime: Symbol("worker.runtime"),
  versionProvider: Symbol("system.version-provider"),
} as const;
