import {
  bootstrapConfiguredDatabaseRoles,
  DatabaseRoleBootstrapConfigurationError,
  DatabaseRoleBootstrapError,
} from "./role-bootstrap";

const bootstrap = async (): Promise<void> => {
  await bootstrapConfiguredDatabaseRoles(process.env);

  process.stdout.write(`${JSON.stringify({ event: "database.roles.bootstrap.complete" })}\n`);
};

void bootstrap().catch((error: unknown) => {
  const code =
    error instanceof DatabaseRoleBootstrapConfigurationError ||
    error instanceof DatabaseRoleBootstrapError
      ? error.code
      : "UnexpectedError";
  const sqlState =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { readonly severity?: unknown }).severity === "string" &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    /^[0-9A-Z]{5}$/u.test((error as { readonly code: string }).code)
      ? (error as { readonly code: string }).code
      : undefined;

  /*
   * Railway must see a failed role bootstrap as a failed deployment. Setting
   * exitCode is correct for a quiet event loop, but it is too easy for a
   * platform wrapper or a lingering handle to report the one-shot service as
   * successful. Set it before logging, then force the exit only after the
   * sanitized failure line has been flushed.
   */
  process.exitCode = 1;
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "database.roles.bootstrap.failed",
      code,
      ...(sqlState === undefined ? {} : { sqlState }),
    })}\n`,
    () => {
      process.exit(1);
    },
  );
});
