import {
  createRuntimeDatabase,
  loadRuntimeDatabaseConfiguration,
} from "@stockcontrol/platform-database";

import {
  createInitialAdmin,
  InitialAdminSetupError,
  PostgresInitialAdminRepository,
  validateInitialAdminInput,
} from "./setup/initial-admin";
import {
  ConfirmedPasswordPromptError,
  promptForConfirmedPassword,
} from "./setup/confirmed-password-prompt";

export interface InitialAdminCliArguments {
  readonly email: string;
  readonly displayName: string;
}

export type InitialAdminCliErrorCode = "DuplicateArgument" | "MissingArgument" | "UnknownArgument";

export class InitialAdminCliError extends Error {
  public constructor(public readonly code: InitialAdminCliErrorCode) {
    super(code);
    this.name = "InitialAdminCliError";
  }
}

const readArgumentValue = (arguments_: readonly string[], index: number): string => {
  const value = arguments_[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new InitialAdminCliError("MissingArgument");
  }

  return value;
};

export const parseInitialAdminArguments = (
  arguments_: readonly string[],
): InitialAdminCliArguments => {
  let email: string | undefined;
  let displayName: string | undefined;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument === "--email") {
      if (email !== undefined) {
        throw new InitialAdminCliError("DuplicateArgument");
      }
      email = readArgumentValue(arguments_, index);
      index += 1;
      continue;
    }

    if (argument === "--display-name") {
      if (displayName !== undefined) {
        throw new InitialAdminCliError("DuplicateArgument");
      }
      displayName = readArgumentValue(arguments_, index);
      index += 1;
      continue;
    }

    throw new InitialAdminCliError("UnknownArgument");
  }

  if (email === undefined || displayName === undefined) {
    throw new InitialAdminCliError("MissingArgument");
  }

  return { email, displayName };
};

const run = async (): Promise<void> => {
  const arguments_ = parseInitialAdminArguments(process.argv.slice(2));
  const password = await promptForConfirmedPassword(
    process.stdin,
    process.stderr,
    "Initial Admin password",
  );
  const input = validateInitialAdminInput({ ...arguments_, password });
  const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
  const database = createRuntimeDatabase({
    ...runtimeConfiguration,
    applicationName: "stockcontrol-initial-admin",
    maximumPoolSize: 1,
  });

  try {
    const result = await createInitialAdmin(new PostgresInitialAdminRepository(database), input);

    process.stdout.write(
      `${JSON.stringify({ event: "initial-admin.created", userId: result.id })}\n`,
    );
  } finally {
    await database.destroy();
  }
};

void run().catch((error: unknown) => {
  const code =
    error instanceof ConfirmedPasswordPromptError ||
    error instanceof InitialAdminCliError ||
    error instanceof InitialAdminSetupError
      ? error.code
      : "UnexpectedError";

  process.stderr.write(
    `${JSON.stringify({ level: "error", event: "initial-admin.failed", code })}\n`,
  );
  process.exitCode = 1;
});
