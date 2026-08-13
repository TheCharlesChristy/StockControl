import { randomUUID } from "node:crypto";

import {
  emailFormatErrors,
  normaliseUsername,
  passwordPolicyErrors,
  usernameFormatErrors,
} from "@stockcontrol/contracts";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import { hashPassword } from "../auth/password";

const MAXIMUM_DISPLAY_NAME_CHARACTERS = 200;

export type InitialAdminSetupErrorCode =
  | "InvalidUsername"
  | "InvalidEmail"
  | "InvalidDisplayName"
  | "PasswordPolicyUnmet"
  | "UsersAlreadyExist";

export class InitialAdminSetupError extends Error {
  public constructor(public readonly code: InitialAdminSetupErrorCode) {
    super(code);
    this.name = "InitialAdminSetupError";
  }
}

export interface InitialAdminInput {
  readonly username: string;
  readonly email?: string | undefined;
  readonly displayName: string;
  readonly password: string;
}

export interface InitialAdminResult {
  readonly id: string;
  readonly username: string;
  readonly email: string | null;
  readonly displayName: string;
}

interface PreparedInitialAdmin extends InitialAdminResult {
  readonly passwordHash: string;
}

export interface InitialAdminRepository {
  insertWhenUsersEmpty(user: PreparedInitialAdmin): Promise<boolean>;
}

export type PasswordHasher = (password: string) => Promise<string>;

export const validateInitialAdminInput = (input: InitialAdminInput): InitialAdminInput => {
  const username = normaliseUsername(input.username);
  const email = input.email === undefined ? undefined : input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (usernameFormatErrors(username).length > 0) {
    throw new InitialAdminSetupError("InvalidUsername");
  }

  /* An address is optional here too; only a supplied one has to be plausible. */
  if (email !== undefined && emailFormatErrors(email).length > 0) {
    throw new InitialAdminSetupError("InvalidEmail");
  }

  if (displayName.length === 0 || [...displayName].length > MAXIMUM_DISPLAY_NAME_CHARACTERS) {
    throw new InitialAdminSetupError("InvalidDisplayName");
  }

  if (passwordPolicyErrors(input.password).length > 0) {
    throw new InitialAdminSetupError("PasswordPolicyUnmet");
  }

  return {
    username,
    ...(email === undefined ? {} : { email }),
    displayName,
    password: input.password,
  };
};

export class PostgresInitialAdminRepository implements InitialAdminRepository {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async insertWhenUsersEmpty(user: PreparedInitialAdmin): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      /*
       * The transaction-scoped lock serialises separate setup processes. The
       * second process acquires it only after the first commits, then observes
       * the new user and exits without creating another Admin.
       */
      await sql`select pg_advisory_xact_lock(1398034255, 1094995277)`.execute(transaction);

      const existingUser = await transaction
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom("users")
        .select("id")
        .limit(1)
        .executeTakeFirst();

      if (existingUser !== undefined) {
        return false;
      }

      await transaction
        .withSchema(STOCKCONTROL_SCHEMA)
        .insertInto("users")
        .values({
          id: user.id,
          username: user.username,
          email: user.email,
          display_name: user.displayName,
          role: "Admin",
          password_hash: user.passwordHash,
          is_active: true,
        })
        .execute();

      return true;
    });
  }
}

export const createInitialAdmin = async (
  repository: InitialAdminRepository,
  input: InitialAdminInput,
  passwordHasher: PasswordHasher = hashPassword,
): Promise<InitialAdminResult> => {
  const validatedInput = validateInitialAdminInput(input);

  const user = {
    id: randomUUID(),
    username: validatedInput.username,
    email: validatedInput.email ?? null,
    displayName: validatedInput.displayName,
    passwordHash: await passwordHasher(validatedInput.password),
  };

  if (!(await repository.insertWhenUsersEmpty(user))) {
    throw new InitialAdminSetupError("UsersAlreadyExist");
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
  };
};
