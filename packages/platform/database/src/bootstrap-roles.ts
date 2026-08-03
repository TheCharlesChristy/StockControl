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

  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "database.roles.bootstrap.failed",
      code,
      ...(sqlState === undefined ? {} : { sqlState }),
    })}\n`,
  );
  process.exitCode = 1;
});
