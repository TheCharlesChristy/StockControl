import { randomUUID } from "node:crypto";

import type { AuthenticatedSession, UserRole } from "@stockcontrol/contracts";
import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import { verifyPassword } from "./password";

export const SESSION_COOKIE = "stockcontrol.session";
export const SESSION_HOURS = 12;

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";
const MILLISECONDS_PER_HOUR = 3_600_000;

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
}

export interface SignInOutcome {
  readonly session: AuthenticatedSession;
  readonly sessionId: string;
}

/**
 * Password sign-in with a database-backed session, per requirements section
 * 5.1. There is no MFA, no invitation, and no password-reset path in the demo.
 */
export class SessionService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async signIn(email: string, password: string): Promise<SignInOutcome | null> {
    const normalisedEmail = email.trim().toLowerCase();
    const user = await this.database
      .withSchema(SCHEMA)
      .selectFrom("users")
      .select(["id", "email", "display_name", "role", "password_hash", "is_active"])
      .where("email", "=", normalisedEmail)
      .executeTakeFirst();

    /*
     * An unknown email still pays for one password verification, so the
     * response time does not distinguish "no such account" from "wrong
     * password".
     */
    const storedHash = user?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA";
    const passwordMatches = await verifyPassword(password, storedHash);

    if (user === undefined || !user.is_active || !passwordMatches) {
      return null;
    }

    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + SESSION_HOURS * MILLISECONDS_PER_HOUR);
    const sessionId = randomUUID();

    await this.database
      .withSchema(SCHEMA)
      .insertInto("sessions")
      .values({
        id: sessionId,
        user_id: user.id,
        issued_at: issuedAt,
        expires_at: expiresAt,
      })
      .execute();

    return {
      sessionId,
      session: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
        },
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  public async resolve(sessionId: string): Promise<AuthenticatedSession | null> {
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("sessions")
      .innerJoin("users", "users.id", "sessions.user_id")
      .select([
        "sessions.issued_at as issued_at",
        "sessions.expires_at as expires_at",
        "users.id as user_id",
        "users.email as email",
        "users.display_name as display_name",
        "users.role as role",
        "users.is_active as is_active",
      ])
      .where("sessions.id", "=", sessionId)
      .executeTakeFirst();

    if (row === undefined || !row.is_active || row.expires_at.getTime() <= this.now().getTime()) {
      return null;
    }

    return {
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
      },
      issuedAt: row.issued_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    };
  }

  public async signOut(sessionId: string): Promise<void> {
    await this.database
      .withSchema(SCHEMA)
      .deleteFrom("sessions")
      .where("id", "=", sessionId)
      .execute();
  }

  /** Disabling a user must end their active sessions, not just block new ones. */
  public async revokeAllForUser(userId: string): Promise<void> {
    await this.database
      .withSchema(SCHEMA)
      .deleteFrom("sessions")
      .where("user_id", "=", userId)
      .execute();
  }

  public async deleteExpired(): Promise<number> {
    const result = await this.database
      .withSchema(SCHEMA)
      .deleteFrom("sessions")
      .where("expires_at", "<=", this.now())
      .executeTakeFirst();

    return Number(result.numDeletedRows);
  }
}
