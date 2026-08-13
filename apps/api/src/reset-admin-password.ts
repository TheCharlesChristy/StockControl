import {
  createRuntimeDatabase,
  loadRuntimeDatabaseConfiguration,
} from "@stockcontrol/platform-database";

import {
  AdminPasswordResetError,
  PostgresAdminPasswordResetRepository,
  resetAdminPassword,
  validateAdminPasswordResetInput,
} from "./setup/admin-password-reset";
import {
  ConfirmedPasswordPromptError,
  promptForConfirmedPassword,
} from "./setup/confirmed-password-prompt";

type AdminPasswordResetCliErrorCode =
  "DuplicateArgument" | "MissingArgument" | "UnknownArgument" | "UseUsernameArgument";

class AdminPasswordResetCliError extends Error {
  public constructor(public readonly code: AdminPasswordResetCliErrorCode) {
    super(code);
    this.name = "AdminPasswordResetCliError";
  }
}

/*
 * This is the only account recovery the product has, and an operator reaches
 * for it from a printed runbook at the worst possible moment. `--email` gets
 * its own code rather than falling into "unknown argument", so somebody
 * following an older runbook is told the flag was renamed instead of being
 * told, accurately but uselessly, that nothing matched.
 */
const parseUsernameArgument = (arguments_: readonly string[]): string => {
  if (arguments_.length === 0) {
    throw new AdminPasswordResetCliError("MissingArgument");
  }

  let username: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--email") {
      throw new AdminPasswordResetCliError("UseUsernameArgument");
    }
    if (argument !== "--username") {
      throw new AdminPasswordResetCliError("UnknownArgument");
    }
    if (username !== undefined) {
      throw new AdminPasswordResetCliError("DuplicateArgument");
    }

    username = arguments_[index + 1];
    if (username === undefined || username.startsWith("--")) {
      throw new AdminPasswordResetCliError("MissingArgument");
    }
    index += 1;
  }

  if (username === undefined) {
    throw new AdminPasswordResetCliError("MissingArgument");
  }

  return username;
};

const run = async (): Promise<void> => {
  const username = parseUsernameArgument(process.argv.slice(2));
  const password = await promptForConfirmedPassword(
    process.stdin,
    process.stderr,
    "New Admin password",
  );
  const input = validateAdminPasswordResetInput({ username, password });
  const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
  const database = createRuntimeDatabase({
    ...runtimeConfiguration,
    applicationName: "stockcontrol-admin-password-reset",
    maximumPoolSize: 1,
  });

  try {
    await resetAdminPassword(new PostgresAdminPasswordResetRepository(database), input);
    process.stdout.write(`${JSON.stringify({ event: "admin.password-reset.complete" })}\n`);
  } finally {
    await database.destroy();
  }
};

void run().catch((error: unknown) => {
  const code =
    error instanceof AdminPasswordResetCliError ||
    error instanceof AdminPasswordResetError ||
    error instanceof ConfirmedPasswordPromptError
      ? error.code
      : "UnexpectedError";

  process.stderr.write(
    `${JSON.stringify({ level: "error", event: "admin.password-reset.failed", code })}\n`,
  );
  process.exitCode = 1;
});
