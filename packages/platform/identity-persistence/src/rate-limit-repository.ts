import {
  type AuthenticationRateLimitScope,
  type CreateRateLimitBucket,
  type IdentityRateLimitBucketRepository,
  type PersistedRateLimitBucket,
  type ReplaceRateLimitBucket,
  type Sha256Digest,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { rateLimitBucketFromRow } from "./mappers";
import {
  IdentityPersistenceInputError,
  assertIntegerInRange,
  assertLifetime,
  assertRateLimitScope,
  assertValidDate,
  digestBytes,
  nullableDate,
} from "./validation";

const validateBucket = (
  command: CreateRateLimitBucket | ReplaceRateLimitBucket,
): CreateRateLimitBucket | ReplaceRateLimitBucket => {
  assertLifetime(command.windowStartedAt, command.expiresAt, 86_400, "Rate-limit window");
  assertIntegerInRange(command.failureCount, 0, 1_000, "Rate-limit failure count");
  assertValidDate(command.updatedAt, "Rate-limit update time");
  if (
    command.blockedUntil !== undefined &&
    (assertValidDate(command.blockedUntil, "Rate-limit block expiry").getTime() <
      command.windowStartedAt.getTime() ||
      command.blockedUntil.getTime() - command.updatedAt.getTime() > 86_400_000)
  ) {
    throw new IdentityPersistenceInputError(
      "DateInvalid",
      "Rate-limit block expiry must be within 24 hours and not precede its window.",
    );
  }
  assertRateLimitScope(command.scope);
  digestBytes(command.bucketKeyHash, "Rate-limit bucket key hash");
  return command;
};

export class KyselyIdentityRateLimitBucketRepository implements IdentityRateLimitBucketRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async findForUpdate(
    bucketKeyHash: Sha256Digest,
    scope: AuthenticationRateLimitScope,
  ): Promise<PersistedRateLimitBucket | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_rate_limit_buckets")
      .selectAll()
      .where("bucket_key_hash", "=", digestBytes(bucketKeyHash, "Rate-limit bucket key hash"))
      .where("scope", "=", assertRateLimitScope(scope))
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : rateLimitBucketFromRow(row);
  }

  public async insert(commandInput: CreateRateLimitBucket): Promise<PersistedRateLimitBucket> {
    const command = validateBucket(commandInput);
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_rate_limit_buckets")
      .values({
        bucket_key_hash: digestBytes(command.bucketKeyHash, "Rate-limit bucket key hash"),
        scope: assertRateLimitScope(command.scope),
        window_started_at: command.windowStartedAt,
        expires_at: command.expiresAt,
        attempt_count: command.failureCount,
        blocked_until: nullableDate(command.blockedUntil),
        updated_at: command.updatedAt,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return rateLimitBucketFromRow(row);
  }

  public async replace(
    commandInput: ReplaceRateLimitBucket,
  ): Promise<PersistedRateLimitBucket | undefined> {
    const command = validateBucket(commandInput) as ReplaceRateLimitBucket;
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_rate_limit_buckets")
      .set((expression) => ({
        window_started_at: command.windowStartedAt,
        expires_at: command.expiresAt,
        attempt_count: command.failureCount,
        blocked_until: nullableDate(command.blockedUntil),
        updated_at: command.updatedAt,
        version: expression("version", "+", 1),
      }))
      .where(
        "bucket_key_hash",
        "=",
        digestBytes(command.bucketKeyHash, "Rate-limit bucket key hash"),
      )
      .where("scope", "=", assertRateLimitScope(command.scope))
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : rateLimitBucketFromRow(row);
  }

  public async clear(
    bucketKeyHash: Sha256Digest,
    scope: AuthenticationRateLimitScope,
  ): Promise<boolean> {
    const result = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .deleteFrom("identity_rate_limit_buckets")
      .where("bucket_key_hash", "=", digestBytes(bucketKeyHash, "Rate-limit bucket key hash"))
      .where("scope", "=", assertRateLimitScope(scope))
      .executeTakeFirst();

    return result.numDeletedRows === 1n;
  }
}
