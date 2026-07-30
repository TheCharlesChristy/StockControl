import {
  identityAuthChallengePurposes,
  type ConsumeAuthChallenge,
  type CreateAuthChallenge,
  type IdentityAuthChallengeRepository,
  type PersistedAuthChallenge,
  type RecordAuthChallengeFailure,
  type Sha256Digest,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { authChallengeFromRow } from "./mappers";
import {
  IdentityPersistenceInputError,
  assertIntegerInRange,
  assertLifetime,
  assertUuid,
  assertValidDate,
  digestBytes,
  identityContextJson,
} from "./validation";

const knownPurposes = new Set<string>(identityAuthChallengePurposes);

const assertPurpose = (value: string): CreateAuthChallenge["purpose"] => {
  if (!knownPurposes.has(value)) {
    throw new IdentityPersistenceInputError(
      "ScopeInvalid",
      "Authentication challenge purpose is not supported.",
    );
  }
  return value as CreateAuthChallenge["purpose"];
};

export class KyselyIdentityAuthChallengeRepository implements IdentityAuthChallengeRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async insert(command: CreateAuthChallenge): Promise<PersistedAuthChallenge> {
    assertLifetime(command.createdAt, command.expiresAt, 3_600, "Authentication challenge");

    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_auth_challenges")
      .values({
        id: assertUuid(command.id, "Authentication challenge ID"),
        user_id: assertUuid(command.userId, "Challenge user ID"),
        purpose: assertPurpose(command.purpose),
        token_hash: digestBytes(command.tokenHash, "Authentication challenge token hash"),
        context: identityContextJson(command.context),
        created_at: command.createdAt,
        expires_at: command.expiresAt,
        consumed_at: null,
        attempt_count: 0,
        maximum_attempts: assertIntegerInRange(
          command.maximumAttempts,
          1,
          100,
          "Maximum challenge attempts",
        ),
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return authChallengeFromRow(row);
  }

  public async findOpenByTokenHashForUpdate(
    tokenHash: Sha256Digest,
    occurredAt: Date,
  ): Promise<PersistedAuthChallenge | undefined> {
    const lookupTime = assertValidDate(occurredAt, "Challenge lookup time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_auth_challenges")
      .selectAll()
      .where("token_hash", "=", digestBytes(tokenHash, "Authentication challenge token hash"))
      .where("consumed_at", "is", null)
      .where("created_at", "<=", lookupTime)
      .where("expires_at", ">", lookupTime)
      .whereRef("attempt_count", "<", "maximum_attempts")
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : authChallengeFromRow(row);
  }

  public async recordFailure(
    command: RecordAuthChallengeFailure,
  ): Promise<PersistedAuthChallenge | undefined> {
    const occurredAt = assertValidDate(command.occurredAt, "Challenge failure time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_auth_challenges")
      .set((expression) => ({
        attempt_count: expression("attempt_count", "+", 1),
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "Authentication challenge ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("consumed_at", "is", null)
      .where("expires_at", ">", occurredAt)
      .whereRef("attempt_count", "<", "maximum_attempts")
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : authChallengeFromRow(row);
  }

  public async consume(command: ConsumeAuthChallenge): Promise<PersistedAuthChallenge | undefined> {
    const consumedAt = assertValidDate(command.consumedAt, "Challenge consumption time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_auth_challenges")
      .set((expression) => ({
        consumed_at: consumedAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "Authentication challenge ID"))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("consumed_at", "is", null)
      .where("expires_at", ">", consumedAt)
      .whereRef("attempt_count", "<", "maximum_attempts")
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : authChallengeFromRow(row);
  }
}
