export const WORKER_TOKENS = {
  correlationContext: Symbol("observability.correlation-context"),
  dispatcher: Symbol("background.dispatcher"),
  healthEndpoint: Symbol("worker.health-endpoint"),
  logger: Symbol("observability.structured-logger"),
  runtime: Symbol("worker.runtime"),
  versionProvider: Symbol("system.version-provider"),
} as const;
