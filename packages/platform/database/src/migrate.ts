import { loadMigrationDatabaseRoles, loadMigratorDatabaseConfiguration } from "./configuration";
import { createMigratorDatabase } from "./connection";
import { DatabaseMigrationError, runMigrations } from "./migrations/runner";

const migrate = async (): Promise<void> => {
  const migratorConfiguration = loadMigratorDatabaseConfiguration();
  const { runtimeRole } = loadMigrationDatabaseRoles(
    process.env,
    migratorConfiguration.connectionString,
  );
  const database = createMigratorDatabase(migratorConfiguration);

  try {
    const result = await runMigrations(database, { runtimeRole });

    process.stdout.write(
      `${JSON.stringify({
        event: "database.migration.complete",
        results: result.results.map(({ direction, migrationName, status }) => ({
          direction,
          migrationName,
          status,
        })),
      })}\n`,
    );
  } finally {
    await database.destroy();
  }
};

void migrate().catch((error: unknown) => {
  const migrationError = error instanceof DatabaseMigrationError ? error : undefined;
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "database.migration.failed",
      error: error instanceof Error ? error.name : "UnknownError",
      ...(migrationError?.sqlState === undefined ? {} : { sqlState: migrationError.sqlState }),
      ...(migrationError === undefined || migrationError.results.length === 0
        ? {}
        : { results: migrationError.results }),
    })}\n`,
  );
  process.exitCode = 1;
});
