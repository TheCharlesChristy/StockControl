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

    /*
     * A failed migration must fail the release, so the exit code is set before
     * anything else can decide otherwise.
     */
    process.exitCode = 1;

    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        event: "database.migration.failed",
        /*
         * The label only, never the message. A failure to connect arrives from
         * pg carrying the connection string, so serializing `error.message`
         * here would put the migrator role's password into the deploy log of
         * whichever platform runs this migration step.
         */
        error: error instanceof Error ? error.name : "UnknownError",
        ...(migrationError?.sqlState === undefined ? {} : { sqlState: migrationError.sqlState }),
        ...(migrationError === undefined || migrationError.results.length === 0
          ? {}
          : { results: migrationError.results }),
      })}\n`,
      /*
       * The migrator pool is already closed by this point, but the exit is
       * still forced in case anything else is holding the event loop open — a
       * migration step that hangs instead of failing stalls the whole release.
       * Forcing it from the write callback rather than immediately after the
       * call means the failure line is flushed first, which is the one line an
       * operator needs.
       */
      () => {
        process.exit(1);
      },
    );
  }
};

void main();
