import {
  type CreateSessionRecord,
  type IdentitySessionRepository,
  type PersistedSession,
  type RevokeSessionRecord,
  type TouchSessionRecord,
  type UserId,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { sessionFromRow } from "./mappers";
import {
  IdentityPersistenceInputError,
  assertReason,
  assertSessionAssurance,
  assertSessionWindow,
  assertUuid,
  assertValidDate,
  digestBytes,
  nullableDate,
  nullableString,
  optionalDigestBytes,
} from "./validation";

export class KyselyIdentitySessionRepository implements IdentitySessionRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async insert(command: CreateSessionRecord): Promise<PersistedSession> {
    assertSessionAssurance(command.authenticationMethod, command.assuranceLevel);
    assertSessionWindow(
      command.issuedAt,
      command.lastSeenAt,
      command.idleExpiresAt,
      command.absoluteExpiresAt,
      command.reauthenticatedAt,
    );
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_sessions")
      .values({
        id: assertUuid(command.id, "Session ID"),
        user_id: assertUuid(command.userId, "User ID"),
        token_hash: digestBytes(command.tokenHash, "Session token hash"),
        authentication_method: command.authenticationMethod,
        assurance_level: command.assuranceLevel,
        issued_at: command.issuedAt,
        last_seen_at: command.lastSeenAt,
        idle_expires_at: command.idleExpiresAt,
        absolute_expires_at: command.absoluteExpiresAt,
        reauthenticated_at: nullableDate(command.reauthenticatedAt),
        revoked_at: null,
        revoke_reason: null,
        created_ip_hash: optionalDigestBytes(command.createdIpHash, "Network address hash"),
        user_agent: nullableString(command.userAgent),
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return sessionFromRow(row);
  }

  public async findActiveByTokenHashForUpdate(
    tokenHash: Parameters<IdentitySessionRepository["findActiveByTokenHashForUpdate"]>[0],
    occurredAt: Date,
  ): Promise<PersistedSession | undefined> {
    const lookupTime = assertValidDate(occurredAt, "Session lookup time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_sessions")
      .innerJoin("identity_users", "identity_users.id", "identity_sessions.user_id")
      .selectAll("identity_sessions")
      .where("token_hash", "=", digestBytes(tokenHash, "Session token hash"))
      .where("identity_users.status", "=", "Active")
      .where("revoked_at", "is", null)
      .where("issued_at", "<=", lookupTime)
      .where("last_seen_at", "<=", lookupTime)
      .where("idle_expires_at", ">", lookupTime)
      .where("absolute_expires_at", ">", lookupTime)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : sessionFromRow(row);
  }

  public async touch(command: TouchSessionRecord): Promise<PersistedSession | undefined> {
    const lastSeenAt = assertValidDate(command.lastSeenAt, "Session activity time");
    const idleExpiresAt = assertValidDate(command.idleExpiresAt, "Session idle expiry");
    if (
      idleExpiresAt.getTime() <= lastSeenAt.getTime() ||
      idleExpiresAt.getTime() - lastSeenAt.getTime() > 7_200_000
    ) {
      throw new IdentityPersistenceInputError(
        "DateInvalid",
        "Session idle expiry must follow activity within the hard two-hour ceiling.",
      );
    }
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_sessions")
      .set((expression) => ({
        last_seen_at: lastSeenAt,
        idle_expires_at: idleExpiresAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "Session ID"))
      .where("version", "=", command.expectedVersion)
      .where("revoked_at", "is", null)
      .where("last_seen_at", "<=", lastSeenAt)
      .where("idle_expires_at", ">", lastSeenAt)
      .where("absolute_expires_at", ">", lastSeenAt)
      .where("absolute_expires_at", ">=", idleExpiresAt)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : sessionFromRow(row);
  }

  public async revoke(command: RevokeSessionRecord): Promise<PersistedSession | undefined> {
    const revokedAt = assertValidDate(command.revokedAt, "Session revocation time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_sessions")
      .set((expression) => ({
        revoked_at: revokedAt,
        revoke_reason: assertReason(command.reason),
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "Session ID"))
      .where("version", "=", command.expectedVersion)
      .where("revoked_at", "is", null)
      .where("issued_at", "<=", revokedAt)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : sessionFromRow(row);
  }

  public async revokeAllForUser(userId: UserId, revokedAt: Date, reason: string): Promise<number> {
    const revocationTime = assertValidDate(revokedAt, "Session revocation time");
    const result = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_sessions")
      .set((expression) => ({
        revoked_at: revocationTime,
        revoke_reason: assertReason(reason),
        version: expression("version", "+", 1),
      }))
      .where("user_id", "=", assertUuid(userId, "User ID"))
      .where("revoked_at", "is", null)
      .where("issued_at", "<=", revocationTime)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }
}
