import {
  type CompleteBootstrapState,
  type CompletedBootstrapState,
  type IdentityBootstrapStateRepository,
  type InitialiseBootstrapState,
  type PersistedBootstrapState,
  type RotatePendingBootstrapState,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { bootstrapStateFromRow } from "./mappers";
import {
  assertIntegerInRange,
  assertLifetime,
  assertUuid,
  assertValidDate,
  digestBytes,
} from "./validation";

export class KyselyIdentityBootstrapStateRepository implements IdentityBootstrapStateRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async get(): Promise<PersistedBootstrapState | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_bootstrap_state")
      .selectAll()
      .where("singleton_key", "=", 1)
      .executeTakeFirst();

    return row === undefined ? undefined : bootstrapStateFromRow(row);
  }

  public async getForUpdate(): Promise<PersistedBootstrapState | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_bootstrap_state")
      .selectAll()
      .where("singleton_key", "=", 1)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? undefined : bootstrapStateFromRow(row);
  }

  public async initialise(command: InitialiseBootstrapState): Promise<PersistedBootstrapState> {
    assertLifetime(command.occurredAt, command.expiresAt, 3_600, "Bootstrap secret");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_bootstrap_state")
      .values({
        singleton_key: 1,
        secret_hash: digestBytes(command.secretHash, "Bootstrap token hash"),
        expires_at: command.expiresAt,
        completed_at: null,
        completed_by_user_id: null,
        created_at: command.occurredAt,
        updated_at: command.occurredAt,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return bootstrapStateFromRow(row);
  }

  public async rotatePending(
    command: RotatePendingBootstrapState,
  ): Promise<Extract<PersistedBootstrapState, { readonly status: "Pending" }> | undefined> {
    assertLifetime(command.occurredAt, command.expiresAt, 3_600, "Bootstrap secret");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_bootstrap_state")
      .set((expression) => ({
        secret_hash: digestBytes(command.secretHash, "Bootstrap token hash"),
        expires_at: command.expiresAt,
        updated_at: command.occurredAt,
        version: expression("version", "+", 1),
      }))
      .where("singleton_key", "=", 1)
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("completed_at", "is", null)
      .where("created_at", "<=", command.occurredAt)
      .returningAll()
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    const state = bootstrapStateFromRow(row);
    if (state.status !== "Pending") {
      throw new Error("Pending bootstrap rotation returned a completed state.");
    }
    return state;
  }

  public async complete(
    command: CompleteBootstrapState,
  ): Promise<CompletedBootstrapState | undefined> {
    const completedAt = assertValidDate(command.completedAt, "Bootstrap completion time");
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_bootstrap_state")
      .set((expression) => ({
        secret_hash: null,
        expires_at: null,
        completed_at: completedAt,
        completed_by_user_id: assertUuid(command.completedByUserId, "Completing user ID"),
        updated_at: completedAt,
        version: expression("version", "+", 1),
      }))
      .where("singleton_key", "=", 1)
      .where(
        "version",
        "=",
        assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version"),
      )
      .where("completed_at", "is", null)
      .where("expires_at", ">", completedAt)
      .returningAll()
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    const state = bootstrapStateFromRow(row);
    if (state.status !== "Completed") {
      throw new Error("Completed bootstrap update returned a pending state.");
    }

    return state;
  }
}
