import {
  loadMigrationDatabaseRoles,
  loadMigratorDatabaseConfiguration,
  type DatabaseEnvironment,
} from "../configuration";
import { createMigratorDatabase } from "../connection";

import { runMigrations, type MigrationRunResult } from "./runner";

/**
 * Brings the configured database to the latest checked-in schema before an
 * application opens its runtime connection. The migrator pool is always
 * closed, including when integrity validation or a migration fails.
 */
export const migrateConfiguredDatabase = async (
  environment: DatabaseEnvironment = process.env,
): Promise<MigrationRunResult> => {
  const migratorConfiguration = loadMigratorDatabaseConfiguration(environment);
  const { runtimeRole } = loadMigrationDatabaseRoles(
    environment,
    migratorConfiguration.connectionString,
  );
  const database = createMigratorDatabase(migratorConfiguration);

  try {
    return await runMigrations(database, { runtimeRole });
  } finally {
    await database.destroy();
  }
};
