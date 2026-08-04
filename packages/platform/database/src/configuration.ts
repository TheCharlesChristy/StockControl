export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export interface DatabaseConnectionConfiguration {
  readonly applicationName: string;
  readonly connectionString: string;
  readonly connectionTimeoutMilliseconds: number;
  readonly lockTimeoutMilliseconds: number;
  readonly maximumPoolSize: number;
  readonly statementTimeoutMilliseconds: number;
}

export interface MigrationDatabaseRoles {
  readonly migratorRole: string;
  readonly runtimeRole: string;
}

export class DatabaseConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

const DEFAULT_CONNECTION_TIMEOUT_MILLISECONDS = 5_000;
const DEFAULT_LOCK_TIMEOUT_MILLISECONDS = 5_000;
const DEFAULT_MIGRATION_LOCK_TIMEOUT_MILLISECONDS = 10_000;
const DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MILLISECONDS = 120_000;
const DEFAULT_RUNTIME_POOL_SIZE = 10;
const DEFAULT_STATEMENT_TIMEOUT_MILLISECONDS = 15_000;

const readRequiredValue = (environment: DatabaseEnvironment, name: string): string => {
  const value = environment[name]?.trim();

  if (value === undefined || value.length === 0) {
    throw new DatabaseConfigurationError(`${name} is required.`);
  }

  return value;
};

const readPositiveInteger = (
  environment: DatabaseEnvironment,
  name: string,
  defaultValue: number,
): number => {
  const value = environment[name]?.trim();

  if (value === undefined || value.length === 0) {
    return defaultValue;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new DatabaseConfigurationError(`${name} must be a positive integer.`);
  }

  const parsedValue = Number(value);

  if (!Number.isSafeInteger(parsedValue)) {
    throw new DatabaseConfigurationError(`${name} must be a safe positive integer.`);
  }

  return parsedValue;
};

const parsePostgresUrl = (connectionString: string, variableName: string): URL => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new DatabaseConfigurationError(
      `${variableName} must be a valid PostgreSQL connection URL.`,
    );
  }

  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new DatabaseConfigurationError(
      `${variableName} must use the postgres or postgresql scheme.`,
    );
  }

  if (parsedUrl.username.length === 0) {
    throw new DatabaseConfigurationError(`${variableName} must include a database role.`);
  }

  return parsedUrl;
};

/*
 * Hosts that are only reachable from inside the deployment's own private
 * network. Traffic to these never crosses a network the operator does not
 * control, which is the property TLS would otherwise have to provide.
 */
const isPrivateDatabaseHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".railway.internal") ||
    host.endsWith(".internal")
  );
};

const ENCRYPTED_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

/**
 * Production must not reach a database over an unencrypted public connection.
 * Following `loadPublicAppOrigin`, production gets no inferred fallback: either
 * the host is private, or the URL says plainly that it wants TLS. Repointing a
 * connection string at a public proxy during an incident is exactly when this
 * would otherwise go unnoticed, and it puts the role's password on the wire.
 */
const assertConnectionIsEncrypted = (
  parsedUrl: URL,
  variableName: string,
  environment: DatabaseEnvironment,
): void => {
  if (environment.NODE_ENV !== "production" || isPrivateDatabaseHost(parsedUrl.hostname)) {
    return;
  }

  const sslMode = parsedUrl.searchParams.get("sslmode")?.trim().toLowerCase();

  if (sslMode === undefined || !ENCRYPTED_SSL_MODES.has(sslMode)) {
    throw new DatabaseConfigurationError(
      `${variableName} reaches a public host, so it must request TLS: add sslmode=require (or verify-full) to the connection URL.`,
    );
  }
};

const readConnectionString = (environment: DatabaseEnvironment, variableName: string): string => {
  const connectionString = readRequiredValue(environment, variableName);
  const parsedUrl = parsePostgresUrl(connectionString, variableName);
  assertConnectionIsEncrypted(parsedUrl, variableName, environment);
  return connectionString;
};

const readConnectionTimeout = (environment: DatabaseEnvironment): number =>
  readPositiveInteger(
    environment,
    "DATABASE_CONNECTION_TIMEOUT_MS",
    DEFAULT_CONNECTION_TIMEOUT_MILLISECONDS,
  );

const validateDatabaseRole = (role: string, variableName: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(role)) {
    throw new DatabaseConfigurationError(
      `${variableName} must be a valid database role of at most 63 ASCII characters.`,
    );
  }

  return role;
};

export const loadRuntimeDatabaseConfiguration = (
  environment: DatabaseEnvironment = process.env,
): DatabaseConnectionConfiguration => ({
  applicationName: "stockcontrol-api",
  connectionString: readConnectionString(environment, "DATABASE_URL"),
  connectionTimeoutMilliseconds: readConnectionTimeout(environment),
  lockTimeoutMilliseconds: readPositiveInteger(
    environment,
    "DATABASE_LOCK_TIMEOUT_MS",
    DEFAULT_LOCK_TIMEOUT_MILLISECONDS,
  ),
  maximumPoolSize: readPositiveInteger(environment, "DATABASE_POOL_MAX", DEFAULT_RUNTIME_POOL_SIZE),
  statementTimeoutMilliseconds: readPositiveInteger(
    environment,
    "DATABASE_STATEMENT_TIMEOUT_MS",
    DEFAULT_STATEMENT_TIMEOUT_MILLISECONDS,
  ),
});

export const loadMigratorDatabaseConfiguration = (
  environment: DatabaseEnvironment = process.env,
): DatabaseConnectionConfiguration => ({
  applicationName: "stockcontrol-migrator",
  connectionString: readConnectionString(environment, "DATABASE_MIGRATOR_URL"),
  connectionTimeoutMilliseconds: readConnectionTimeout(environment),
  lockTimeoutMilliseconds: readPositiveInteger(
    environment,
    "DATABASE_MIGRATION_LOCK_TIMEOUT_MS",
    DEFAULT_MIGRATION_LOCK_TIMEOUT_MILLISECONDS,
  ),
  maximumPoolSize: 1,
  statementTimeoutMilliseconds: readPositiveInteger(
    environment,
    "DATABASE_MIGRATION_STATEMENT_TIMEOUT_MS",
    DEFAULT_MIGRATION_STATEMENT_TIMEOUT_MILLISECONDS,
  ),
});

const databaseRoleFromNamedConnectionString = (
  connectionString: string,
  variableName: string,
): string => {
  const parsedUrl = parsePostgresUrl(connectionString, variableName);
  let role: string;

  try {
    role = decodeURIComponent(parsedUrl.username);
  } catch {
    throw new DatabaseConfigurationError(
      `${variableName} must contain a valid percent-encoded database role.`,
    );
  }

  if (role.trim().length === 0) {
    throw new DatabaseConfigurationError(`${variableName} must include a database role.`);
  }

  return validateDatabaseRole(role, variableName);
};

export const databaseRoleFromConnectionString = (connectionString: string): string =>
  databaseRoleFromNamedConnectionString(connectionString, "DATABASE_URL");

export const databaseRolesForMigration = (
  migratorConnectionString: string,
  runtimeConnectionString: string,
): MigrationDatabaseRoles => {
  const migratorRole = databaseRoleFromNamedConnectionString(
    migratorConnectionString,
    "DATABASE_MIGRATOR_URL",
  );
  const runtimeRole = databaseRoleFromNamedConnectionString(
    runtimeConnectionString,
    "DATABASE_URL",
  );

  if (migratorRole === runtimeRole) {
    throw new DatabaseConfigurationError(
      "DATABASE_MIGRATOR_URL and DATABASE_URL must use distinct database roles.",
    );
  }

  return {
    migratorRole,
    runtimeRole,
  };
};

export const databaseRolesForMigrationRole = (
  migratorConnectionString: string,
  runtimeRoleValue: string,
): MigrationDatabaseRoles => {
  const migratorRole = databaseRoleFromNamedConnectionString(
    migratorConnectionString,
    "DATABASE_MIGRATOR_URL",
  );
  const runtimeRole = validateDatabaseRole(runtimeRoleValue.trim(), "DATABASE_RUNTIME_ROLE");

  if (migratorRole === runtimeRole) {
    throw new DatabaseConfigurationError(
      "DATABASE_MIGRATOR_URL and DATABASE_RUNTIME_ROLE must identify distinct database roles.",
    );
  }

  return { migratorRole, runtimeRole };
};

export const loadMigrationDatabaseRoles = (
  environment: DatabaseEnvironment,
  migratorConnectionString: string,
): MigrationDatabaseRoles =>
  databaseRolesForMigrationRole(
    migratorConnectionString,
    readRequiredValue(environment, "DATABASE_RUNTIME_ROLE"),
  );
