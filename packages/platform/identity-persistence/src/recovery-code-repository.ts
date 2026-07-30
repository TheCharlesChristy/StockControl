import {
  type ConsumeRecoveryCode,
  type CreateRecoveryCode,
  type IdentityRecoveryCodeRepository,
  type PersistedRecoveryCode,
  type Sha256Digest,
  type UserId,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { recoveryCodeFromRow } from "./mappers";
import {
  IdentityPersistenceInputError,
  assertUuid,
  assertValidDate,
  digestBytes,
} from "./validation";

export class KyselyIdentityRecoveryCodeRepository implements IdentityRecoveryCodeRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async insertMany(
    commands: readonly CreateRecoveryCode[],
  ): Promise<readonly PersistedRecoveryCode[]> {
    if (commands.length < 1 || commands.length > 50) {
      throw new IdentityPersistenceInputError(
        "IntegerInvalid",
        "A recovery-code set must contain 1 to 50 codes.",
      );
    }

    const rows = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_recovery_codes")
      .values(
        commands.map((command) => ({
          id: assertUuid(command.id, "Recovery code ID"),
          user_id: assertUuid(command.userId, "User ID"),
          totp_credential_id: assertUuid(command.totpCredentialId, "TOTP credential ID"),
          code_hash: digestBytes(command.codeHash, "Recovery-code hash"),
          created_at: assertValidDate(command.createdAt, "Recovery-code creation time"),
          used_at: null,
          revoked_at: null,
        })),
      )
      .returningAll()
      .execute();

    return Object.freeze(rows.map(recoveryCodeFromRow));
  }

  public async hasAvailableForCredential(
    userId: UserId,
    totpCredentialId: string,
  ): Promise<boolean> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_recovery_codes")
      .select("id")
      .where("user_id", "=", assertUuid(userId, "User ID"))
      .where("totp_credential_id", "=", assertUuid(totpCredentialId, "TOTP credential ID"))
      .where("used_at", "is", null)
      .where("revoked_at", "is", null)
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }

  public async findAvailableByHashForUpdate(
    userId: UserId,
    totpCredentialId: string,
    codeHash: Sha256Digest,
  ): Promise<PersistedRecoveryCode | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_recovery_codes")
      .innerJoin(
        "identity_totp_credentials",
        "identity_totp_credentials.id",
        "identity_recovery_codes.totp_credential_id",
      )
      .innerJoin("identity_users", "identity_users.id", "identity_recovery_codes.user_id")
      .selectAll("identity_recovery_codes")
      .where("identity_recovery_codes.user_id", "=", assertUuid(userId, "User ID"))
      .where(
        "identity_recovery_codes.totp_credential_id",
        "=",
        assertUuid(totpCredentialId, "TOTP credential ID"),
      )
      .where("identity_totp_credentials.status", "=", "Active")
      .where("identity_users.status", "=", "Active")
      .where("code_hash", "=", digestBytes(codeHash, "Recovery-code hash"))
      .where("used_at", "is", null)
      .where("revoked_at", "is", null)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : recoveryCodeFromRow(row);
  }

  public async consume(command: ConsumeRecoveryCode): Promise<PersistedRecoveryCode | undefined> {
    const usedAt = assertValidDate(command.usedAt, "Recovery-code use time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_recovery_codes")
      .set({
        used_at: usedAt,
      })
      .where("id", "=", assertUuid(command.id, "Recovery code ID"))
      .where("user_id", "=", assertUuid(command.userId, "User ID"))
      .where("totp_credential_id", "=", assertUuid(command.totpCredentialId, "TOTP credential ID"))
      .where("code_hash", "=", digestBytes(command.codeHash, "Recovery-code hash"))
      .where("used_at", "is", null)
      .where("revoked_at", "is", null)
      .where("created_at", "<=", usedAt)
      .where((expression) =>
        expression.exists(
          expression
            .selectFrom("identity_totp_credentials")
            .innerJoin("identity_users", "identity_users.id", "identity_totp_credentials.user_id")
            .select("identity_totp_credentials.id")
            .whereRef(
              "identity_totp_credentials.id",
              "=",
              "identity_recovery_codes.totp_credential_id",
            )
            .whereRef("identity_totp_credentials.user_id", "=", "identity_recovery_codes.user_id")
            .where("identity_totp_credentials.status", "=", "Active")
            .where("identity_users.status", "=", "Active"),
        ),
      )
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : recoveryCodeFromRow(row);
  }

  public async revokeAvailableForCredential(
    userId: UserId,
    totpCredentialId: string,
    revokedAt: Date,
  ): Promise<number> {
    const revocationTime = assertValidDate(revokedAt, "Recovery-code revocation time");
    const result = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_recovery_codes")
      .set({
        revoked_at: revocationTime,
      })
      .where("user_id", "=", assertUuid(userId, "User ID"))
      .where("totp_credential_id", "=", assertUuid(totpCredentialId, "TOTP credential ID"))
      .where("used_at", "is", null)
      .where("revoked_at", "is", null)
      .where("created_at", "<=", revocationTime)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }
}
