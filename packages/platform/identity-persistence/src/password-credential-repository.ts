import {
  type CreatePasswordCredential,
  type IdentityPasswordCredentialRepository,
  type PersistedPasswordCredential,
  type ReplacePasswordCredential,
  type UserId,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { passwordCredentialFromRow } from "./mappers";
import {
  assertIntegerInRange,
  assertPasswordHash,
  assertUuid,
  assertValidDate,
} from "./validation";

export class KyselyIdentityPasswordCredentialRepository implements IdentityPasswordCredentialRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async findByUserIdForUpdate(
    userId: UserId,
  ): Promise<PersistedPasswordCredential | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_password_credentials")
      .selectAll()
      .where("user_id", "=", assertUuid(userId, "User ID"))
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : passwordCredentialFromRow(row);
  }

  public async insert(command: CreatePasswordCredential): Promise<PersistedPasswordCredential> {
    assertValidDate(command.passwordChangedAt, "Password changed time");
    assertValidDate(command.createdAt, "Password credential creation time");
    assertValidDate(command.updatedAt, "Password credential update time");

    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_password_credentials")
      .values({
        user_id: assertUuid(command.userId, "User ID"),
        password_hash: assertPasswordHash(command.passwordHash),
        password_changed_at: command.passwordChangedAt,
        created_at: command.createdAt,
        updated_at: command.updatedAt,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return passwordCredentialFromRow(row);
  }

  public async replace(
    command: ReplacePasswordCredential,
  ): Promise<PersistedPasswordCredential | undefined> {
    const changedAt = assertValidDate(command.passwordChangedAt, "Password changed time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_password_credentials")
      .set((expression) => ({
        password_hash: assertPasswordHash(command.passwordHash),
        password_changed_at: changedAt,
        updated_at: changedAt,
        version: expression("version", "+", 1),
      }))
      .where("user_id", "=", assertUuid(command.userId, "User ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("password_changed_at", "<=", changedAt)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : passwordCredentialFromRow(row);
  }
}
