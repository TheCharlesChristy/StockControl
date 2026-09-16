import { applyConfiguredRetention } from "./retention/purge";

/**
 * Applies the retention schedule. Run on a schedule in production, and by hand
 * before a data protection review.
 *
 * `--dry-run` reports what is out of policy without removing anything, which
 * is how you check a window change before it destroys records.
 */
const main = async (): Promise<void> => {
  const dryRun = process.argv.includes("--dry-run");

  try {
    const result = await applyConfiguredRetention(process.env, { dryRun });

    process.stdout.write(
      `${JSON.stringify({
        event: dryRun ? "database.retention.preview" : "database.retention.complete",
        dryRun: result.dryRun,
        ranAt: result.ranAt,
        windows: result.windows,
        totalRows: result.totalRows,
        tables: result.tables,
      })}\n`,
    );
  } catch (error: unknown) {
    process.exitCode = 1;

    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        event: "database.retention.failed",
        /*
         * The label only, never the message. A failure to connect arrives from
         * pg carrying the connection string, and so the migrator role's
         * password, into whichever platform's log runs this step.
         */
        error: error instanceof Error ? error.name : "UnknownError",
      })}\n`,
      () => {
        process.exit(1);
      },
    );
  }
};

void main();
