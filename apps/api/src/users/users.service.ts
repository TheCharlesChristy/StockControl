import { randomUUID } from "node:crypto";

import type { UserRole, UserView } from "@stockcontrol/contracts";
import { resourceUnavailable, userRoles, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import { hashPassword } from "../auth/password";
import type { SessionService } from "../auth/session-service";

const SCHEMA = "stockcontrol" as const;
const MINIMUM_PASSWORD_CHARACTERS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface NewUser {
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
  readonly password: string;
}

export interface UserChanges {
  readonly displayName?: string | undefined;
  readonly role?: UserRole | undefined;
  readonly isActive?: boolean | undefined;
}

export class UsersService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly sessions: SessionService,
  ) {}

  public async list(): Promise<readonly UserView[]> {
    const rows = await this.database
      .withSchema(SCHEMA)
      .selectFrom("users")
      .select(["id", "email", "display_name", "role", "is_active", "created_at"])
      .orderBy("display_name")
      .execute();

    return rows.map(toView);
  }

  public async create(input: NewUser): Promise<UserView> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const { password, role } = input;
    const errors: Record<string, readonly string[]> = {};

    if (!EMAIL_PATTERN.test(email)) {
      errors["email"] = ["Enter a valid email address."];
    }
    if (displayName.length === 0) {
      errors["displayName"] = ["Enter a name."];
    }
    if (!userRoles.includes(role as UserRole)) {
      errors["role"] = ["Choose Engineer, Office or Admin."];
    }
    if (password.length < MINIMUM_PASSWORD_CHARACTERS) {
      errors["password"] = [`Use at least ${String(MINIMUM_PASSWORD_CHARACTERS)} characters.`];
    }

    if (Object.keys(errors).length > 0) {
      throw new ApplicationFailureException(validationFailed(errors));
    }

    const id = randomUUID();

    try {
      await this.database
        .withSchema(SCHEMA)
        .insertInto("users")
        .values({
          id,
          email,
          display_name: displayName,
          role: role as UserRole,
          password_hash: await hashPassword(password),
          is_active: true,
        })
        .execute();
    } catch (error: unknown) {
      if ((error as { readonly code?: string }).code === "23505") {
        throw new ApplicationFailureException(
          validationFailed({ email: ["That email address already has an account."] }),
        );
      }

      throw error;
    }

    return this.require(id);
  }

  public async update(userId: string, input: UserChanges): Promise<UserView> {
    const existing = await this.require(userId);
    const displayName = input.displayName;
    const { role, isActive } = input;

    if (role !== undefined && !userRoles.includes(role)) {
      throw new ApplicationFailureException(
        validationFailed({ role: ["Choose Engineer, Office or Admin."] }),
      );
    }

    /*
     * Requirements section 5 gives only Admins user management, so the last
     * active Admin may not be demoted or disabled — that would lock everyone
     * out of the demo with no way back in.
     */
    const losingLastAdmin =
      existing.role === "Admin" &&
      existing.isActive &&
      ((role !== undefined && role !== "Admin") || isActive === false);

    if (losingLastAdmin && (await this.activeAdminCount()) <= 1) {
      throw new ApplicationFailureException(
        validationFailed({
          role: ["This is the only active Admin. Promote another Admin first."],
        }),
      );
    }

    await this.database
      .withSchema(SCHEMA)
      .updateTable("users")
      .set({
        ...(displayName === undefined || displayName.length === 0
          ? {}
          : { display_name: displayName }),
        ...(role === undefined ? {} : { role }),
        ...(isActive === undefined ? {} : { is_active: isActive }),
        updated_at: sql`now()`,
      })
      .where("id", "=", userId)
      .execute();

    /* Disabling a user must end their active sessions, not just block new ones. */
    if (isActive === false) {
      await this.sessions.revokeAllForUser(userId);
    }

    return this.require(userId);
  }

  private async activeAdminCount(): Promise<number> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("users")
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .where("role", "=", "Admin")
      .where("is_active", "=", true)
      .executeTakeFirst();

    return Number(row?.total ?? 0);
  }

  private async require(userId: string): Promise<UserView> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("users")
      .select(["id", "email", "display_name", "role", "is_active", "created_at"])
      .where("id", "=", userId)
      .executeTakeFirst();

    if (row === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That user was not found." }),
      );
    }

    return toView(row);
  }
}

function toView(row: {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: UserRole;
  readonly is_active: boolean;
  readonly created_at: Date;
}): UserView {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  };
}
