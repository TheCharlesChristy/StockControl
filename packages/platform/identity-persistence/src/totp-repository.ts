import {
  type ActivateTotpCredential,
  type CreateTotpCredential,
  type IdentityTotpCredentialRepository,
  type PersistedTotpCredential,
  type RecordAcceptedTotpCounter,
  type ReencryptTotpCredential,
  type RevokeTotpCredential,
  type UserId,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { totpCredentialFromRow } from "./mappers";
import {
  IdentityPersistenceInputError,
  assertIntegerInRange,
  assertUuid,
  assertValidDate,
  encryptionKeyId,
  exactBytes,
  nonnegativeCounter,
} from "./validation";

export class KyselyIdentityTotpCredentialRepository implements IdentityTotpCredentialRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async insert(command: CreateTotpCredential): Promise<PersistedTotpCredential> {
    const createdAt = assertValidDate(command.createdAt, "TOTP credential creation time");
    const updatedAt = assertValidDate(command.updatedAt, "TOTP credential update time");
    const runtimeEncryptionVersion: unknown = command.secretEncryptionVersion;
    if (runtimeEncryptionVersion !== 1 || updatedAt.getTime() < createdAt.getTime()) {
      throw new IdentityPersistenceInputError(
        "DateInvalid",
        "TOTP credential version and timestamps are invalid.",
      );
    }
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_totp_credentials")
      .values({
        id: assertUuid(command.id, "TOTP credential ID"),
        user_id: assertUuid(command.userId, "User ID"),
        status: "Pending",
        secret_encryption_version: command.secretEncryptionVersion,
        secret_key_id: encryptionKeyId(command.secretKeyId),
        secret_nonce: exactBytes(command.secretNonce, 12, "TOTP secret nonce"),
        secret_ciphertext: exactBytes(command.secretCiphertext, 32, "TOTP secret ciphertext"),
        secret_auth_tag: exactBytes(command.secretAuthTag, 16, "TOTP secret authentication tag"),
        last_accepted_counter: null,
        verified_at: null,
        recovery_codes_acknowledged_at: null,
        revoked_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return totpCredentialFromRow(row);
  }

  public async findByIdForUpdate(id: string): Promise<PersistedTotpCredential | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_totp_credentials")
      .selectAll()
      .where("id", "=", assertUuid(id, "TOTP credential ID"))
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : totpCredentialFromRow(row);
  }

  public async findActiveForUserForUpdate(
    userId: UserId,
  ): Promise<PersistedTotpCredential | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_totp_credentials")
      .selectAll()
      .where("user_id", "=", assertUuid(userId, "User ID"))
      .where("status", "=", "Active")
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : totpCredentialFromRow(row);
  }

  public async activate(
    command: ActivateTotpCredential,
  ): Promise<PersistedTotpCredential | undefined> {
    const verifiedAt = assertValidDate(command.verifiedAt, "TOTP verification time");
    const acknowledgedAt = assertValidDate(
      command.recoveryCodesAcknowledgedAt,
      "Recovery-code acknowledgement time",
    );
    if (acknowledgedAt.getTime() < verifiedAt.getTime()) {
      throw new IdentityPersistenceInputError(
        "DateInvalid",
        "Recovery codes cannot be acknowledged before TOTP verification.",
      );
    }
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_totp_credentials")
      .set((expression) => ({
        status: "Active",
        last_accepted_counter: nonnegativeCounter(command.acceptedCounter, "Accepted TOTP counter"),
        verified_at: verifiedAt,
        recovery_codes_acknowledged_at: acknowledgedAt,
        updated_at: acknowledgedAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "TOTP credential ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("status", "=", "Pending")
      .where("created_at", "<=", verifiedAt)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : totpCredentialFromRow(row);
  }

  public async reencrypt(
    command: ReencryptTotpCredential,
  ): Promise<PersistedTotpCredential | undefined> {
    const occurredAt = assertValidDate(command.occurredAt, "TOTP re-encryption time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_totp_credentials")
      .set((expression) => ({
        secret_encryption_version: command.secretEncryptionVersion,
        secret_key_id: encryptionKeyId(command.secretKeyId),
        secret_nonce: exactBytes(command.secretNonce, 12, "TOTP secret nonce"),
        secret_ciphertext: exactBytes(command.secretCiphertext, 32, "TOTP secret ciphertext"),
        secret_auth_tag: exactBytes(command.secretAuthTag, 16, "TOTP secret authentication tag"),
        updated_at: occurredAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "TOTP credential ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("revoked_at", "is", null)
      .where("updated_at", "<=", occurredAt)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : totpCredentialFromRow(row);
  }

  public async recordAcceptedCounter(
    command: RecordAcceptedTotpCounter,
  ): Promise<PersistedTotpCredential | undefined> {
    const acceptedCounter = nonnegativeCounter(command.acceptedCounter, "Accepted TOTP counter");
    const occurredAt = assertValidDate(command.occurredAt, "TOTP acceptance time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_totp_credentials")
      .set((expression) => ({
        last_accepted_counter: acceptedCounter,
        updated_at: occurredAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "TOTP credential ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("status", "=", "Active")
      .where("updated_at", "<=", occurredAt)
      .where((expression) =>
        expression.or([
          expression("last_accepted_counter", "is", null),
          expression("last_accepted_counter", "<", acceptedCounter),
        ]),
      )
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : totpCredentialFromRow(row);
  }

  public async revoke(command: RevokeTotpCredential): Promise<PersistedTotpCredential | undefined> {
    const revokedAt = assertValidDate(command.revokedAt, "TOTP revocation time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_totp_credentials")
      .set((expression) => ({
        status: "Revoked",
        revoked_at: revokedAt,
        updated_at: revokedAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "TOTP credential ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("revoked_at", "is", null)
      .where("created_at", "<=", revokedAt)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : totpCredentialFromRow(row);
  }

  public async revokePendingForUser(userId: UserId, revokedAt: Date): Promise<number> {
    const revocationTime = assertValidDate(revokedAt, "TOTP revocation time");
    const result = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_totp_credentials")
      .set((expression) => ({
        status: "Revoked",
        revoked_at: revocationTime,
        updated_at: revocationTime,
        version: expression("version", "+", 1),
      }))
      .where("user_id", "=", assertUuid(userId, "User ID"))
      .where("status", "=", "Pending")
      .where("created_at", "<=", revocationTime)
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }
}
