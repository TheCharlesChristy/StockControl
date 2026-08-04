import { createHash, randomBytes } from "node:crypto";

import type { AuthenticatedSession, UserRole } from "@stockcontrol/contracts";
import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";

import { DUMMY_PASSWORD_HASH, verifyPassword } from "./password";

export const SESSION_COOKIE = "stockcontrol.session";

/*
 * `__Host-` is enforced by the browser rather than by us: it refuses the cookie
 * unless it is Secure, path-scoped to `/`, and carries no Domain, which stops a
 * neighbouring subdomain from writing a session cookie this API would read.
 * Only an HTTPS deployment can use it, so the plain name remains for local
 * development and is still accepted here while existing sessions age out.
 */
export const SECURE_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`;
export const SESSION_HOURS = 12;

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";
const MILLISECONDS_PER_HOUR = 3_600_000;
const SESSION_TOKEN_BYTES = 32;

const sessionKey = (token: string): string | null => {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(token, "base64url");
  } catch {
    return null;
  }

  /* Reject UUIDs, truncated values, and non-canonical base64url spellings. */
  if (decoded.length !== SESSION_TOKEN_BYTES || decoded.toString("base64url") !== token) {
    return null;
  }

  const digest = createHash("sha256").update(decoded).digest("hex").slice(0, 32);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20),
  ].join("-");
};

const createSessionIdentity = (): { readonly key: string; readonly token: string } => {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const key = sessionKey(token);

  if (key === null) {
    throw new Error("Failed to create a session identity.");
  }

  return { key, token };
};

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
 * 5.1. There is no MFA, invitation, or self-service password-reset path in the
 * MVP; operator Admin recovery is a separate private CLI.
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
      .leftJoin("user_profile_photos", "user_profile_photos.user_id", "users.id")
      .select([
        "users.id as id",
        "users.email as email",
        "users.display_name as display_name",
        "users.role as role",
        "users.password_hash as password_hash",
        "users.is_active as is_active",
        "user_profile_photos.id as profile_photo_id",
      ])
      .where("email", "=", normalisedEmail)
      .executeTakeFirst();

    /*
     * An unknown email still pays for one password verification, so the
     * response time does not distinguish "no such account" from "wrong
     * password".
     */
    const storedHash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await verifyPassword(password, storedHash);

    if (user === undefined || !user.is_active || !passwordMatches) {
      return null;
    }

    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + SESSION_HOURS * MILLISECONDS_PER_HOUR);
    const identity = createSessionIdentity();

    await this.database
      .withSchema(SCHEMA)
      .insertInto("sessions")
      .values({
        id: identity.key,
        user_id: user.id,
        issued_at: issuedAt,
        expires_at: expiresAt,
      })
      .execute();

    return {
      sessionId: identity.token,
      session: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
          profilePhotoUrl:
            user.profile_photo_id === null
              ? null
              : `/api/v1/users/${user.id}/profile-photo?v=${user.profile_photo_id}`,
        },
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  public async resolve(sessionId: string): Promise<AuthenticatedSession | null> {
    const key = sessionKey(sessionId);
    if (key === null) {
      return null;
    }

    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("sessions")
      .innerJoin("users", "users.id", "sessions.user_id")
      .leftJoin("user_profile_photos", "user_profile_photos.user_id", "users.id")
      .select([
        "sessions.issued_at as issued_at",
        "sessions.expires_at as expires_at",
        "users.id as user_id",
        "users.email as email",
        "users.display_name as display_name",
        "users.role as role",
        "users.is_active as is_active",
        "user_profile_photos.id as profile_photo_id",
      ])
      .where("sessions.id", "=", key)
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
        profilePhotoUrl:
          row.profile_photo_id === null
            ? null
            : `/api/v1/users/${row.user_id}/profile-photo?v=${row.profile_photo_id}`,
      },
      issuedAt: row.issued_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    };
  }

  public async signOut(sessionId: string): Promise<void> {
    const key = sessionKey(sessionId);
    if (key === null) {
      return;
    }

    await this.database.withSchema(SCHEMA).deleteFrom("sessions").where("id", "=", key).execute();
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
