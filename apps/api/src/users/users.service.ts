import { randomUUID } from "node:crypto";

import type {
  ImageUploadRequest,
  UserActivityResponse,
  UserRole,
  UserView,
} from "@stockcontrol/contracts";
import {
  emailFormatErrors,
  normaliseUsername,
  passwordPolicyErrors,
  resourceUnavailable,
  userRoles,
  usernameFormatErrors,
  validationFailed,
} from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import { hashPassword } from "../auth/password";
import type { SessionService } from "../auth/session-service";
import type { PhotoAsset, PhotosService } from "../media/photos.service";
import {
  listOpenReservations,
  listStockRequests,
  listTransactions,
} from "../persistence/read-models";

const SCHEMA = "stockcontrol" as const;

export interface NewUser {
  readonly username: string;
  readonly email?: string | undefined;
  readonly displayName: string;
  readonly role: string;
  readonly password: string;
}

export interface UserChanges {
  readonly username?: string | undefined;
  /** `null` removes the address; `undefined` leaves it as it was. */
  readonly email?: string | null | undefined;
  readonly displayName?: string | undefined;
  readonly role?: UserRole | undefined;
  readonly isActive?: boolean | undefined;
}

/**
 * Two unique constraints now share the 23505 code, and the wrong message sends
 * an Admin to edit a field that was never the problem. The constraint name is
 * read deliberately; the driver's message is not, because driver messages carry
 * connection details.
 */
function duplicateFieldErrors(error: unknown): Record<string, readonly string[]> {
  const constraint = (error as { readonly constraint?: string }).constraint;

  return constraint === "users_username_key"
    ? { username: ["That username is already taken."] }
    : { email: ["That email address already has an account."] };
}

const ACTIVITY_LIMIT = 20;

export class UsersService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly sessions: SessionService,
    private readonly photos: PhotosService,
  ) {}

  public async list(): Promise<readonly UserView[]> {
    const rows = await this.database
      .withSchema(SCHEMA)
      .selectFrom("users")
      .select(["id", "username", "email", "display_name", "role", "is_active", "created_at"])
      .orderBy("display_name")
      .execute();

    return Promise.all(
      rows.map(async (row) => toView(row, await this.photos.profilePhotoUrl(row.id))),
    );
  }

  public async create(input: NewUser): Promise<UserView> {
    const username = normaliseUsername(input.username);
    const email = input.email === undefined ? "" : input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const { password, role } = input;
    const errors: Record<string, readonly string[]> = {};

    const usernameErrors = usernameFormatErrors(username);
    if (usernameErrors.length > 0) {
      errors["username"] = usernameErrors;
    }
    /* An address is optional, so only one that was actually supplied is judged. */
    if (email.length > 0) {
      const emailErrors = emailFormatErrors(email);
      if (emailErrors.length > 0) {
        errors["email"] = emailErrors;
      }
    }
    if (displayName.length === 0) {
      errors["displayName"] = ["Enter a name."];
    }
    if (!userRoles.includes(role as UserRole)) {
      errors["role"] = ["Choose Engineer, Office or Admin."];
    }
    const passwordErrors = passwordPolicyErrors(password);
    if (passwordErrors.length > 0) {
      errors["password"] = passwordErrors;
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
          username,
          email: email.length === 0 ? null : email,
          display_name: displayName,
          role: role as UserRole,
          password_hash: await hashPassword(password),
          /* An Admin chose this password, so its owner has to replace it. */
          must_change_password: true,
          is_active: true,
        })
        .execute();
    } catch (error: unknown) {
      if ((error as { readonly code?: string }).code === "23505") {
        throw new ApplicationFailureException(validationFailed(duplicateFieldErrors(error)));
      }

      throw error;
    }

    return this.require(id);
  }

  public profilePhoto(userId: string): Promise<PhotoAsset> {
    return this.photos.profilePhoto(userId);
  }

  public async saveProfilePhoto(userId: string, input: ImageUploadRequest): Promise<UserView> {
    await this.require(userId);
    await this.photos.saveProfilePhoto(userId, input);
    return this.require(userId);
  }

  public async deleteProfilePhoto(userId: string): Promise<UserView> {
    await this.require(userId);
    await this.photos.deleteProfilePhoto(userId);
    return this.require(userId);
  }

  /**
   * An Admin setting a password for somebody who cannot sign in.
   *
   * The account is marked as holding a password its owner did not choose, and
   * every session it had is ended — both because the person may be locked out
   * precisely because somebody else has the account, and because the Admin now
   * knows the password and should not be able to keep using it.
   */
  public async resetPassword(userId: string, newPassword: string): Promise<UserView> {
    await this.require(userId);
    const passwordErrors = passwordPolicyErrors(newPassword);

    if (passwordErrors.length > 0) {
      throw new ApplicationFailureException(validationFailed({ newPassword: passwordErrors }));
    }

    await this.sessions.setPassword(userId, await hashPassword(newPassword), true);
    await this.sessions.revokeAllForUser(userId);

    return this.require(userId);
  }

  public async update(userId: string, input: UserChanges): Promise<UserView> {
    const existing = await this.require(userId);
    const displayName = input.displayName;
    const { role, isActive } = input;
    const username = input.username === undefined ? undefined : normaliseUsername(input.username);
    /* `null` is a request to remove the address, not a malformed one. */
    const email = input.email === null ? null : input.email?.trim().toLowerCase();

    if (role !== undefined && !userRoles.includes(role)) {
      throw new ApplicationFailureException(
        validationFailed({ role: ["Choose Engineer, Office or Admin."] }),
      );
    }

    if (username !== undefined && usernameFormatErrors(username).length > 0) {
      throw new ApplicationFailureException(
        validationFailed({ username: usernameFormatErrors(username) }),
      );
    }

    if (email !== undefined && email !== null && emailFormatErrors(email).length > 0) {
      throw new ApplicationFailureException(validationFailed({ email: emailFormatErrors(email) }));
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

    try {
      await this.database
        .withSchema(SCHEMA)
        .updateTable("users")
        .set({
          ...(username === undefined ? {} : { username }),
          ...(email === undefined ? {} : { email }),
          ...(displayName === undefined || displayName.length === 0
            ? {}
            : { display_name: displayName }),
          ...(role === undefined ? {} : { role }),
          ...(isActive === undefined ? {} : { is_active: isActive }),
          updated_at: sql`now()`,
        })
        .where("id", "=", userId)
        .execute();
    } catch (error: unknown) {
      if ((error as { readonly code?: string }).code === "23505") {
        throw new ApplicationFailureException(validationFailed(duplicateFieldErrors(error)));
      }

      throw error;
    }

    /* Disabling a user must end their active sessions, not just block new ones. */
    if (isActive === false) {
      await this.sessions.revokeAllForUser(userId);
    }

    return this.require(userId);
  }

  /**
   * Deleting is only possible for an account that never did anything. Every
   * table recording an action points at users with `on delete restrict`, so a
   * person with history cannot be erased without erasing the audit trail —
   * which the product will not do. Those accounts are deactivated instead, and
   * the message says so rather than showing a foreign-key error.
   */
  public async remove(userId: string): Promise<void> {
    const existing = await this.require(userId);

    if (existing.role === "Admin" && existing.isActive && (await this.activeAdminCount()) <= 1) {
      throw new ApplicationFailureException(
        validationFailed({
          user: ["This is the only active Admin. Promote another Admin first."],
        }),
      );
    }

    if (await this.hasHistory(userId)) {
      throw new ApplicationFailureException(
        validationFailed({
          user: [
            "This person has recorded stock activity, which cannot be erased. Deactivate the account instead.",
          ],
        }),
      );
    }

    await this.sessions.revokeAllForUser(userId);
    await this.photos.deleteProfilePhoto(userId);

    await this.database
      .withSchema(SCHEMA)
      .deleteFrom("job_assignments")
      .where("user_id", "=", userId)
      .execute();

    await this.database.withSchema(SCHEMA).deleteFrom("users").where("id", "=", userId).execute();
  }

  /** What one person has been doing, for the Admin's user detail screen. */
  public async activity(userId: string): Promise<UserActivityResponse> {
    const user = await this.require(userId);
    const [transactions, openReservations, requests, pending] = await Promise.all([
      listTransactions(this.database, {
        actorUserId: userId,
        limit: ACTIVITY_LIMIT,
        offset: 0,
      }),
      listOpenReservations(this.database, {
        createdByUserId: userId,
        limit: ACTIVITY_LIMIT,
      }),
      listStockRequests(this.database, {
        requestedByUserId: userId,
        limit: ACTIVITY_LIMIT,
        offset: 0,
      }),
      listStockRequests(this.database, {
        requestedByUserId: userId,
        status: "Pending",
        limit: 1,
        offset: 0,
      }),
    ]);

    return {
      user,
      recentTransactions: transactions.rows,
      openReservations,
      stockRequests: requests.rows,
      counts: {
        transactions: transactions.total,
        openReservations: openReservations.length,
        pendingRequests: pending.total,
      },
    };
  }

  private async hasHistory(userId: string): Promise<boolean> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("users")
      .select([
        sql<string>`(select count(*) from stockcontrol.transactions where actor_user_id = ${userId})`.as(
          "transactions",
        ),
        sql<string>`(select count(*) from stockcontrol.reservations where created_by_user_id = ${userId})`.as(
          "reservations",
        ),
        sql<string>`(select count(*) from stockcontrol.stock_requests
           where requested_by_user_id = ${userId} or decided_by_user_id = ${userId})`.as(
          "requests",
        ),
        sql<string>`(select count(*) from stockcontrol.job_assignments
           where assigned_by_user_id = ${userId})`.as("assignments"),
      ])
      .where("id", "=", userId)
      .executeTakeFirst();

    return (
      Number(row?.transactions ?? 0) +
        Number(row?.reservations ?? 0) +
        Number(row?.requests ?? 0) +
        Number(row?.assignments ?? 0) >
      0
    );
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
      .select(["id", "username", "email", "display_name", "role", "is_active", "created_at"])
      .where("id", "=", userId)
      .executeTakeFirst();

    if (row === undefined) {
      throw new ApplicationFailureException(
        resourceUnavailable({ detail: "That user was not found." }),
      );
    }

    return toView(row, await this.photos.profilePhotoUrl(row.id));
  }
}

function toView(
  row: {
    readonly id: string;
    readonly username: string;
    readonly email: string | null;
    readonly display_name: string;
    readonly role: UserRole;
    readonly is_active: boolean;
    readonly created_at: Date;
  },
  profilePhotoUrl: string | null,
): UserView {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    profilePhotoUrl,
  };
}
