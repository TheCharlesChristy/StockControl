import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { DatabaseConnectionConfiguration } from "./configuration";
import type { StockControlDatabase } from "./schema";

export type UnexpectedPoolErrorHandler = (error: Error) => void;

export interface DatabaseConnectionFactoryOptions {
  readonly onUnexpectedPoolError?: UnexpectedPoolErrorHandler;
}

const reportUnexpectedPoolError: UnexpectedPoolErrorHandler = () => {
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "database.pool.unexpected_error",
    })}\n`,
  );
};

const createDatabaseConnection = (
  configuration: DatabaseConnectionConfiguration,
  options: DatabaseConnectionFactoryOptions,
): Kysely<StockControlDatabase> => {
  const pool = new Pool({
    application_name: configuration.applicationName,
    connectionString: configuration.connectionString,
    connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
    lock_timeout: configuration.lockTimeoutMilliseconds,
    max: configuration.maximumPoolSize,
    query_timeout: configuration.statementTimeoutMilliseconds,
    statement_timeout: configuration.statementTimeoutMilliseconds,
  });

  pool.on("error", options.onUnexpectedPoolError ?? reportUnexpectedPoolError);

  return new Kysely<StockControlDatabase>({
    dialect: new PostgresDialect({ pool }),
  });
};

export const createRuntimeDatabase = (
  configuration: DatabaseConnectionConfiguration,
  options: DatabaseConnectionFactoryOptions = {},
): Kysely<StockControlDatabase> => createDatabaseConnection(configuration, options);

export const createAdminDatabase = (
  configuration: DatabaseConnectionConfiguration,
  options: DatabaseConnectionFactoryOptions = {},
): Kysely<StockControlDatabase> => createDatabaseConnection(configuration, options);

export const createMigratorDatabase = (
  configuration: DatabaseConnectionConfiguration,
  options: DatabaseConnectionFactoryOptions = {},
): Kysely<StockControlDatabase> => createDatabaseConnection(configuration, options);
