import {
  type AcceptInvitationRecord,
  type CreateInvitationRecord,
  type IdentityInvitationRepository,
  type PersistedInvitation,
  type UserId,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { invitationFromRow } from "./mappers";
import {
  assertIntegerInRange,
  assertLifetime,
  assertUuid,
  assertValidDate,
  digestBytes,
} from "./validation";

export class KyselyIdentityInvitationRepository implements IdentityInvitationRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async insert(command: CreateInvitationRecord): Promise<PersistedInvitation> {
    assertLifetime(command.createdAt, command.expiresAt, 259_200, "Invitation");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_invitations")
      .values({
        id: assertUuid(command.id, "Invitation ID"),
        user_id: assertUuid(command.userId, "User ID"),
        invited_by_user_id: assertUuid(command.invitedByUserId, "Inviting user ID"),
        token_hash: digestBytes(command.tokenHash, "Invitation token hash"),
        created_at: command.createdAt,
        expires_at: command.expiresAt,
        accepted_at: null,
        revoked_at: null,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return invitationFromRow(row);
  }

  public async findOpenByTokenHashForUpdate(
    tokenHash: Parameters<IdentityInvitationRepository["findOpenByTokenHashForUpdate"]>[0],
    occurredAt: Date,
  ): Promise<PersistedInvitation | undefined> {
    const lookupTime = assertValidDate(occurredAt, "Invitation lookup time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_invitations")
      .selectAll()
      .where("token_hash", "=", digestBytes(tokenHash, "Invitation token hash"))
      .where("accepted_at", "is", null)
      .where("revoked_at", "is", null)
      .where("created_at", "<=", lookupTime)
      .where("expires_at", ">", lookupTime)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : invitationFromRow(row);
  }

  public async accept(command: AcceptInvitationRecord): Promise<PersistedInvitation | undefined> {
    const acceptedAt = assertValidDate(command.acceptedAt, "Invitation acceptance time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_invitations")
      .set((expression) => ({
        accepted_at: acceptedAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "Invitation ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("accepted_at", "is", null)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", acceptedAt)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : invitationFromRow(row);
  }

  public async revokeOpenForUser(userId: UserId, revokedAt: Date): Promise<number> {
    const revocationTime = assertValidDate(revokedAt, "Invitation revocation time");
    const result = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_invitations")
      .set((expression) => ({
        revoked_at: revocationTime,
        version: expression("version", "+", 1),
      }))
      .where("user_id", "=", assertUuid(userId, "User ID"))
      .where("accepted_at", "is", null)
      .where("revoked_at", "is", null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }
}
