import {
  normaliseUsername,
  passwordPolicyErrors,
  usernameFormatErrors,
} from "@stockcontrol/contracts";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import { hashPassword } from "../auth/password";
import type { PasswordHasher } from "./initial-admin";

export type AdminPasswordResetErrorCode =
  "ActiveAdminNotFound" | "InvalidUsername" | "PasswordPolicyUnmet";

export class AdminPasswordResetError extends Error {
  public constructor(public readonly code: AdminPasswordResetErrorCode) {
    super(code);
    this.name = "AdminPasswordResetError";
  }
}

export interface AdminPasswordResetInput {
  readonly username: string;
  readonly password: string;
}

export interface AdminPasswordResetRepository {
  updateActiveAdminPassword(username: string, passwordHash: string): Promise<boolean>;
}

export class PostgresAdminPasswordResetRepository implements AdminPasswordResetRepository {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async updateActiveAdminPassword(username: string, passwordHash: string): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(1398034255, 1381191758)`.execute(transaction);
      const admin = await transaction
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom("users")
        .select(["id", "role", "is_active"])
        .where("username", "=", username)
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
  const username = normaliseUsername(input.username);

  if (usernameFormatErrors(username).length > 0) {
    throw new AdminPasswordResetError("InvalidUsername");
  }

  if (passwordPolicyErrors(input.password).length > 0) {
    throw new AdminPasswordResetError("PasswordPolicyUnmet");
  }

  return { username, password: input.password };
};

export const resetAdminPassword = async (
  repository: AdminPasswordResetRepository,
  input: AdminPasswordResetInput,
  passwordHasher: PasswordHasher = hashPassword,
): Promise<void> => {
  const validatedInput = validateAdminPasswordResetInput(input);
  const passwordHash = await passwordHasher(validatedInput.password);

  if (!(await repository.updateActiveAdminPassword(validatedInput.username, passwordHash))) {
    throw new AdminPasswordResetError("ActiveAdminNotFound");
  }
};
