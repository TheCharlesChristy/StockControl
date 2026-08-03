import { migrateConfiguredDatabase } from "./migrations/service";
import { DatabaseMigrationError } from "./migrations/runner";

const migrate = async (): Promise<void> => {
  const result = await migrateConfiguredDatabase(process.env);

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
};

const main = async (): Promise<void> => {
  try {
    await migrate();
  } catch (error: unknown) {
    const migrationError = error instanceof DatabaseMigrationError ? error : undefined;

    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        event: "database.migration.failed",
        error: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : undefined,
        ...(migrationError?.sqlState === undefined ? {} : { sqlState: migrationError.sqlState }),
        ...(migrationError === undefined || migrationError.results.length === 0
          ? {}
          : { results: migrationError.results }),
      })}\n`,
    );

    process.exit(1);
  }
};

void main();
