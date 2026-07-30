import {
  type CompletePasswordReset,
  type CreatePasswordReset,
  type IdentityPasswordResetRepository,
  type PersistedPasswordReset,
  type Sha256Digest,
  type UserId,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { passwordResetFromRow } from "./mappers";
import {
  assertIntegerInRange,
  assertLifetime,
  assertUuid,
  assertValidDate,
  digestBytes,
} from "./validation";

export class KyselyIdentityPasswordResetRepository implements IdentityPasswordResetRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async insert(command: CreatePasswordReset): Promise<PersistedPasswordReset> {
    assertLifetime(command.requestedAt, command.expiresAt, 3_600, "Password reset");

    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_password_resets")
      .values({
        id: assertUuid(command.id, "Password reset ID"),
        user_id: assertUuid(command.userId, "User ID"),
        token_hash: digestBytes(command.tokenHash, "Password-reset token hash"),
        requested_at: command.requestedAt,
        expires_at: command.expiresAt,
        completed_at: null,
        revoked_at: null,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return passwordResetFromRow(row);
  }

  public async findOpenByTokenHashForUpdate(
    tokenHash: Sha256Digest,
    occurredAt: Date,
  ): Promise<PersistedPasswordReset | undefined> {
    const lookupTime = assertValidDate(occurredAt, "Password-reset lookup time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_password_resets")
      .selectAll()
      .where("token_hash", "=", digestBytes(tokenHash, "Password-reset token hash"))
      .where("completed_at", "is", null)
      .where("revoked_at", "is", null)
      .where("requested_at", "<=", lookupTime)
      .where("expires_at", ">", lookupTime)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : passwordResetFromRow(row);
  }

  public async complete(
    command: CompletePasswordReset,
  ): Promise<PersistedPasswordReset | undefined> {
    const completedAt = assertValidDate(command.completedAt, "Password-reset completion time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_password_resets")
      .set((expression) => ({
        completed_at: completedAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "Password reset ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("completed_at", "is", null)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", completedAt)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : passwordResetFromRow(row);
  }

  public async revokeOpenForUser(userId: UserId, revokedAt: Date): Promise<number> {
    const result = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_password_resets")
      .set((expression) => ({
        revoked_at: assertValidDate(revokedAt, "Password-reset revocation time"),
        version: expression("version", "+", 1),
      }))
      .where("user_id", "=", assertUuid(userId, "User ID"))
      .where("completed_at", "is", null)
      .where("revoked_at", "is", null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }
}
