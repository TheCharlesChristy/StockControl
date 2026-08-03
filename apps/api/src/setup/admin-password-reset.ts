import { passwordPolicyErrors } from "@stockcontrol/contracts";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import { hashPassword } from "../auth/password";
import type { PasswordHasher } from "./initial-admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAXIMUM_EMAIL_CHARACTERS = 320;

export type AdminPasswordResetErrorCode =
  "ActiveAdminNotFound" | "InvalidEmail" | "PasswordPolicyUnmet";

export class AdminPasswordResetError extends Error {
  public constructor(public readonly code: AdminPasswordResetErrorCode) {
    super(code);
    this.name = "AdminPasswordResetError";
  }
}

export interface AdminPasswordResetInput {
  readonly email: string;
  readonly password: string;
}

export interface AdminPasswordResetRepository {
  updateActiveAdminPassword(email: string, passwordHash: string): Promise<boolean>;
}

export class PostgresAdminPasswordResetRepository implements AdminPasswordResetRepository {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async updateActiveAdminPassword(email: string, passwordHash: string): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(1398034255, 1381191758)`.execute(transaction);
      const admin = await transaction
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom("users")
        .select(["id", "role", "is_active"])
        .where("email", "=", email)
        .executeTakeFirst();

      if (admin === undefined || admin.role !== "Admin" || !admin.is_active) {
        return false;
      }

      await transaction
        .withSchema(STOCKCONTROL_SCHEMA)
        .updateTable("users")
        .set({ password_hash: passwordHash, updated_at: sql`now()` })
        .where("id", "=", admin.id)
        .execute();
      await transaction
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("sessions")
        .where("user_id", "=", admin.id)
        .execute();

      return true;
    });
  }
}

export const validateAdminPasswordResetInput = (
  input: AdminPasswordResetInput,
): AdminPasswordResetInput => {
  const email = input.email.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email) || [...email].length > MAXIMUM_EMAIL_CHARACTERS) {
    throw new AdminPasswordResetError("InvalidEmail");
  }

  if (passwordPolicyErrors(input.password).length > 0) {
    throw new AdminPasswordResetError("PasswordPolicyUnmet");
  }

  return { email, password: input.password };
};

export const resetAdminPassword = async (
  repository: AdminPasswordResetRepository,
  input: AdminPasswordResetInput,
  passwordHasher: PasswordHasher = hashPassword,
): Promise<void> => {
  const validatedInput = validateAdminPasswordResetInput(input);
  const passwordHash = await passwordHasher(validatedInput.password);

  if (!(await repository.updateActiveAdminPassword(validatedInput.email, passwordHash))) {
    throw new AdminPasswordResetError("ActiveAdminNotFound");
  }
};
