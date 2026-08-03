import { randomUUID } from "node:crypto";

import { passwordPolicyErrors } from "@stockcontrol/contracts";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import { hashPassword } from "../auth/password";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAXIMUM_EMAIL_CHARACTERS = 320;
const MAXIMUM_DISPLAY_NAME_CHARACTERS = 200;

export type InitialAdminSetupErrorCode =
  "InvalidEmail" | "InvalidDisplayName" | "PasswordPolicyUnmet" | "UsersAlreadyExist";

export class InitialAdminSetupError extends Error {
  public constructor(public readonly code: InitialAdminSetupErrorCode) {
    super(code);
    this.name = "InitialAdminSetupError";
  }
}

export interface InitialAdminInput {
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
}

export interface InitialAdminResult {
  readonly id: string;
  readonly email: string;
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
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (!EMAIL_PATTERN.test(email) || [...email].length > MAXIMUM_EMAIL_CHARACTERS) {
    throw new InitialAdminSetupError("InvalidEmail");
  }

  if (displayName.length === 0 || [...displayName].length > MAXIMUM_DISPLAY_NAME_CHARACTERS) {
    throw new InitialAdminSetupError("InvalidDisplayName");
  }

  if (passwordPolicyErrors(input.password).length > 0) {
    throw new InitialAdminSetupError("PasswordPolicyUnmet");
  }

  return { email, displayName, password: input.password };
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
    email: validatedInput.email,
    displayName: validatedInput.displayName,
    passwordHash: await passwordHasher(validatedInput.password),
  };

  if (!(await repository.insertWhenUsersEmpty(user))) {
    throw new InitialAdminSetupError("UsersAlreadyExist");
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
};
