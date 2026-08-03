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

type AdminPasswordResetCliErrorCode = "DuplicateArgument" | "MissingArgument" | "UnknownArgument";

class AdminPasswordResetCliError extends Error {
  public constructor(public readonly code: AdminPasswordResetCliErrorCode) {
    super(code);
    this.name = "AdminPasswordResetCliError";
  }
}

const parseEmailArgument = (arguments_: readonly string[]): string => {
  if (arguments_.length === 0) {
    throw new AdminPasswordResetCliError("MissingArgument");
  }

  let email: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--email") {
      throw new AdminPasswordResetCliError("UnknownArgument");
    }
    if (email !== undefined) {
      throw new AdminPasswordResetCliError("DuplicateArgument");
    }

    email = arguments_[index + 1];
    if (email === undefined || email.startsWith("--")) {
      throw new AdminPasswordResetCliError("MissingArgument");
    }
    index += 1;
  }

  if (email === undefined) {
    throw new AdminPasswordResetCliError("MissingArgument");
  }

  return email;
};

const run = async (): Promise<void> => {
  const email = parseEmailArgument(process.argv.slice(2));
  const password = await promptForConfirmedPassword(
    process.stdin,
    process.stderr,
    "New Admin password",
  );
  const input = validateAdminPasswordResetInput({ email, password });
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
