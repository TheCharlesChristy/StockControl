import { randomUUID } from "node:crypto";

import { sql, type Kysely, type Transaction } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
} from "../src/configuration";
import { createMigratorDatabase, createRuntimeDatabase } from "../src/connection";
import { runMigrations } from "../src/migrations/runner";
import { PostgresReadinessCheck } from "../src/readiness";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "../src/schema";

const insertAuditChainEvent = async (
  transaction: Transaction<StockControlDatabase>,
  input: {
    readonly eventHash: Uint8Array;
    readonly eventId: string;
    readonly previousEventHash: Uint8Array | null;
    readonly sequence: bigint;
  },
): Promise<void> => {
  await transaction
    .withSchema(STOCKCONTROL_SCHEMA)
    .updateTable("identity_audit_chain_head")
    .set({
      last_sequence: input.sequence,
      last_event_id: input.eventId,
      last_event_hash: input.eventHash,
      updated_at: new Date(),
    })
    .where("singleton_key", "=", 1)
    .executeTakeFirst();
  await transaction
    .withSchema(STOCKCONTROL_SCHEMA)
    .insertInto("identity_audit_events")
    .values({
      id: input.eventId,
      sequence: input.sequence,
      occurred_at: new Date(),
      event_type: "integration.audit-chain-probe",
      outcome: "Succeeded",
      actor_user_id: null,
      subject_user_id: null,
      session_id: null,
      correlation_id: randomUUID(),
      remote_address_hash: null,
      details: {},
      previous_event_hash: input.previousEventHash,
      integrity_version: 1,
      integrity_key_id: "integration-key",
      event_hash: input.eventHash,
    })
    .executeTakeFirst();
};

const lockAuditChainTail = async (
  transaction: Transaction<StockControlDatabase>,
): Promise<{
  readonly eventHash: Uint8Array | null;
  readonly sequence: bigint;
}> => {
  const row = await transaction
    .withSchema(STOCKCONTROL_SCHEMA)
    .selectFrom("identity_audit_chain_head")
    .select(["last_sequence", "last_event_hash"])
    .where("singleton_key", "=", 1)
    .forUpdate()
    .executeTakeFirstOrThrow();

  return {
    eventHash: row.last_event_hash,
    sequence: BigInt(row.last_sequence),
  };
};

describe.sequential("PostgreSQL database foundation", () => {
  const metadataKey = `integration.${process.pid}.${Date.now()}`;
  let migratorDatabase: Kysely<StockControlDatabase> | undefined;
  let runtimeDatabase: Kysely<StockControlDatabase> | undefined;
  let runtimeRole: string;
  let initialMigrationNames: readonly string[] = [];

  beforeAll(async () => {
    const migratorConfiguration = loadMigratorDatabaseConfiguration();
    const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
    runtimeRole = databaseRoleFromConnectionString(runtimeConfiguration.connectionString);
    migratorDatabase = createMigratorDatabase(migratorConfiguration);

    const migration = await runMigrations(migratorDatabase, { runtimeRole });
    initialMigrationNames = migration.results.map(({ migrationName }) => migrationName);
    runtimeDatabase = createRuntimeDatabase(runtimeConfiguration);
  });

  afterAll(async () => {
    if (runtimeDatabase !== undefined) {
      await runtimeDatabase
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("system_metadata")
        .where("key", "=", metadataKey)
        .execute();
      await runtimeDatabase.destroy();
    }

    if (migratorDatabase !== undefined) {
      await migratorDatabase.destroy();
    }
  });

  it("is ready and permits runtime reads and writes after migration", async () => {
    expect(runtimeDatabase).toBeDefined();

    const database = runtimeDatabase as Kysely<StockControlDatabase>;
    const metadata = {
      source: "database.integration.spec.ts",
    };

    expect(await new PostgresReadinessCheck(database).check()).toEqual({
      name: "database.postgresql",
      status: "ok",
    });

    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("system_metadata")
      .values({
        key: metadataKey,
        value: metadata,
      })
      .onConflict((conflict) =>
        conflict.column("key").doUpdateSet({
          updated_at: sql`now()`,
          value: metadata,
        }),
      )
      .execute();

    await expect(
      database
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom("system_metadata")
        .select(["key", "value"])
        .where("key", "=", metadataKey)
        .executeTakeFirstOrThrow(),
    ).resolves.toMatchObject({
      key: metadataKey,
      value: metadata,
    });
  });

  it("can be rerun without applying migrations twice", async () => {
    expect(migratorDatabase).toBeDefined();

    const result = await runMigrations(migratorDatabase as Kysely<StockControlDatabase>, {
      runtimeRole,
    });

    expect(result.results).toEqual([]);
  });

  it("installs the foundation and identity migrations in deterministic order", () => {
    expect(initialMigrationNames).toEqual(["0001_foundation", "0002_identity"]);
  });

  it("creates every identity table without requiring PostgreSQL extensions", async () => {
    expect(migratorDatabase).toBeDefined();

    const tables = await (
      migratorDatabase as Kysely<StockControlDatabase>
    ).introspection.getTables();
    const stockControlTables = tables
      .filter(({ schema }) => schema === STOCKCONTROL_SCHEMA)
      .map(({ name }) => name)
      .sort();

    expect(stockControlTables).toEqual(
      expect.arrayContaining([
        "identity_audit_events",
        "identity_auth_challenges",
        "identity_bootstrap_state",
        "identity_invitations",
        "identity_mfa_recovery_requests",
        "identity_password_credentials",
        "identity_password_resets",
        "identity_permission_overrides",
        "identity_rate_limit_buckets",
        "identity_recovery_codes",
        "identity_security_policy",
        "identity_sessions",
        "identity_totp_credentials",
        "identity_users",
        "migration_integrity",
        "system_metadata",
      ]),
    );
  });

  it("gives runtime audit access only SELECT and INSERT and hides migration integrity", async () => {
    expect(runtimeDatabase).toBeDefined();

    const runtime = runtimeDatabase as Kysely<StockControlDatabase>;
    const privileges = await sql<{
      audit_delete: boolean;
      audit_insert: boolean;
      audit_select: boolean;
      audit_update: boolean;
      integrity_select: boolean;
    }>`
      select
        has_table_privilege(current_user, 'stockcontrol.identity_audit_events', 'SELECT')
          as audit_select,
        has_table_privilege(current_user, 'stockcontrol.identity_audit_events', 'INSERT')
          as audit_insert,
        has_table_privilege(current_user, 'stockcontrol.identity_audit_events', 'UPDATE')
          as audit_update,
        has_table_privilege(current_user, 'stockcontrol.identity_audit_events', 'DELETE')
          as audit_delete,
        has_table_privilege(current_user, 'stockcontrol.migration_integrity', 'SELECT')
          as integrity_select
    `.execute(runtime);

    expect(privileges.rows[0]).toEqual({
      audit_delete: false,
      audit_insert: true,
      audit_select: true,
      audit_update: false,
      integrity_select: false,
    });
  });

  it("allows runtime audit append/read while denying update and delete", async () => {
    expect(runtimeDatabase).toBeDefined();

    const runtime = runtimeDatabase as Kysely<StockControlDatabase>;
    const eventId = randomUUID();
    const rollback = new Error("rollback audit probe");

    await expect(
      runtime.transaction().execute(async (transaction) => {
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_audit_events")
          .values({
            id: eventId,
            sequence: 1n,
            occurred_at: new Date(),
            event_type: "integration.audit-probe",
            outcome: "Succeeded",
            actor_user_id: null,
            subject_user_id: null,
            session_id: null,
            correlation_id: randomUUID(),
            remote_address_hash: null,
            details: { source: "database.integration.spec.ts" },
            previous_event_hash: null,
            integrity_version: 1,
            integrity_key_id: "integration-key",
            event_hash: new Uint8Array(32).fill(7),
          })
          .executeTakeFirst();

        await expect(
          transaction
            .withSchema(STOCKCONTROL_SCHEMA)
            .selectFrom("identity_audit_events")
            .select("id")
            .where("id", "=", eventId)
            .executeTakeFirstOrThrow(),
        ).resolves.toEqual({ id: eventId });

        throw rollback;
      }),
    ).rejects.toBe(rollback);

    await expect(
      sql`update stockcontrol.identity_audit_events set event_type = 'forbidden' where false`.execute(
        runtime,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      sql`delete from stockcontrol.identity_audit_events where false`.execute(runtime),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("enforces append-only audit history even for the migrator role", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const eventId = randomUUID();

    await expect(
      migrator.transaction().execute(async (transaction) => {
        const tail = await lockAuditChainTail(transaction);
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_audit_events")
          .values({
            id: eventId,
            sequence: tail.sequence + 1n,
            occurred_at: new Date(),
            event_type: "integration.audit-immutability",
            outcome: "Succeeded",
            actor_user_id: null,
            subject_user_id: null,
            session_id: null,
            correlation_id: randomUUID(),
            remote_address_hash: null,
            details: {},
            previous_event_hash: tail.eventHash,
            integrity_version: 1,
            integrity_key_id: "integration-key",
            event_hash: new Uint8Array(32).fill(8),
          })
          .executeTakeFirst();
        await sql`
          update stockcontrol.identity_audit_events
          set event_type = 'tampered'
          where id = ${eventId}::uuid
        `.execute(transaction);
      }),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("rejects an audit event inserted without atomically advancing the head", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    await expect(
      migrator.transaction().execute(async (transaction) => {
        const tail = await lockAuditChainTail(transaction);
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_audit_events")
          .values({
            id: randomUUID(),
            sequence: tail.sequence + 1n,
            occurred_at: new Date(),
            event_type: "integration.event-only",
            outcome: "Failed",
            actor_user_id: null,
            subject_user_id: null,
            session_id: null,
            correlation_id: randomUUID(),
            remote_address_hash: null,
            details: {},
            previous_event_hash: tail.eventHash,
            integrity_version: 1,
            integrity_key_id: "integration-key",
            event_hash: new Uint8Array(32).fill(11),
          })
          .executeTakeFirst();
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "identity_audit_chain_link_required",
    });
  });

  it("rejects a head update without its matching event", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    await expect(
      migrator.transaction().execute(async (transaction) => {
        const tail = await lockAuditChainTail(transaction);
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .updateTable("identity_audit_chain_head")
          .set({
            last_sequence: tail.sequence + 1n,
            last_event_id: randomUUID(),
            last_event_hash: new Uint8Array(32).fill(12),
            updated_at: new Date(),
          })
          .where("singleton_key", "=", 1)
          .executeTakeFirst();
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "identity_audit_chain_head_consistent",
    });
  });

  it("rejects skipped audit sequence numbers", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    await expect(
      migrator.transaction().execute(async (transaction) => {
        const tail = await lockAuditChainTail(transaction);
        await insertAuditChainEvent(transaction, {
          eventHash: new Uint8Array(32).fill(13),
          eventId: randomUUID(),
          previousEventHash: tail.eventHash ?? new Uint8Array(32).fill(99),
          sequence: tail.sequence + 2n,
        });
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects an audit event linked to the wrong previous hash", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const firstHash = new Uint8Array(32).fill(14);

    await expect(
      migrator.transaction().execute(async (transaction) => {
        const tail = await lockAuditChainTail(transaction);
        await insertAuditChainEvent(transaction, {
          eventHash: firstHash,
          eventId: randomUUID(),
          previousEventHash: tail.eventHash,
          sequence: tail.sequence + 1n,
        });
        await insertAuditChainEvent(transaction, {
          eventHash: new Uint8Array(32).fill(15),
          eventId: randomUUID(),
          previousEventHash: new Uint8Array(32).fill(98),
          sequence: tail.sequence + 2n,
        });
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "identity_audit_chain_link_required",
    });
  });

  it("rejects regression of an established audit-chain head", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const firstId = randomUUID();
    const firstHash = new Uint8Array(32).fill(16);
    const secondHash = new Uint8Array(32).fill(17);

    await expect(
      migrator.transaction().execute(async (transaction) => {
        const tail = await lockAuditChainTail(transaction);
        await insertAuditChainEvent(transaction, {
          eventHash: firstHash,
          eventId: firstId,
          previousEventHash: tail.eventHash,
          sequence: tail.sequence + 1n,
        });
        await insertAuditChainEvent(transaction, {
          eventHash: secondHash,
          eventId: randomUUID(),
          previousEventHash: firstHash,
          sequence: tail.sequence + 2n,
        });
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .updateTable("identity_audit_chain_head")
          .set({
            last_sequence: tail.sequence + 1n,
            last_event_id: firstId,
            last_event_hash: firstHash,
            updated_at: new Date(),
          })
          .where("singleton_key", "=", 1)
          .executeTakeFirst();
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("forces lowercase normalised email and case-insensitive uniqueness", async () => {
    expect(runtimeDatabase).toBeDefined();

    const runtime = runtimeDatabase as Kysely<StockControlDatabase>;
    await expect(
      runtime
        .withSchema(STOCKCONTROL_SCHEMA)
        .insertInto("identity_users")
        .values({
          id: randomUUID(),
          normalised_email: "MixedCase@example.com",
          display_name: "Invalid Email Probe",
          role: "Engineer",
          status: "Invited",
        })
        .executeTakeFirst(),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("requires versioned identity rows to start at one and advance exactly once", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const invalidInitialVersionUserId = randomUUID();
    const skippedVersionUserId = randomUUID();
    const now = new Date();

    await expect(
      migrator.transaction().execute(async (transaction) => {
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_users")
          .values({
            id: invalidInitialVersionUserId,
            normalised_email: `${invalidInitialVersionUserId}@example.test`,
            display_name: "Invalid Initial Version",
            role: "Engineer",
            status: "Invited",
            created_at: now,
            updated_at: now,
            version: 2,
          })
          .executeTakeFirst();
      }),
    ).rejects.toMatchObject({
      code: "55000",
      message: expect.stringContaining("must start at version 1"),
    });

    await expect(
      migrator.transaction().execute(async (transaction) => {
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_users")
          .values({
            id: skippedVersionUserId,
            normalised_email: `${skippedVersionUserId}@example.test`,
            display_name: "Skipped Version",
            role: "Engineer",
            status: "Invited",
            created_at: now,
            updated_at: now,
          })
          .executeTakeFirst();
        await sql`
          update stockcontrol.identity_users
          set
            display_name = 'Skipped Version Update',
            updated_at = ${new Date(now.getTime() + 1)},
            version = version + 2
          where id = ${skippedVersionUserId}::uuid
        `.execute(transaction);
      }),
    ).rejects.toMatchObject({
      code: "55000",
      message: expect.stringContaining("version must advance by exactly one"),
    });
  });

  it("does not allow immutable authentication material to be replaced", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const userId = randomUUID();
    const challengeId = randomUUID();
    const now = new Date();

    await expect(
      migrator.transaction().execute(async (transaction) => {
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_users")
          .values({
            id: userId,
            normalised_email: `${userId}@example.test`,
            display_name: "Immutable Challenge Owner",
            role: "Engineer",
            status: "Invited",
            created_at: now,
            updated_at: now,
          })
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_auth_challenges")
          .values({
            id: challengeId,
            user_id: userId,
            purpose: "SignInMfa",
            token_hash: new Uint8Array(32).fill(31),
            context: {},
            created_at: now,
            expires_at: new Date(now.getTime() + 60_000),
            consumed_at: null,
            attempt_count: 0,
            maximum_attempts: 5,
          })
          .executeTakeFirst();
        await sql`
          update stockcontrol.identity_auth_challenges
          set
            token_hash = decode(repeat('7f', 32), 'hex'),
            version = version + 1
          where id = ${challengeId}::uuid
        `.execute(transaction);
      }),
    ).rejects.toMatchObject({
      code: "55000",
      message: expect.stringContaining(
        "Immutable identity column identity_auth_challenges.token_hash cannot be changed",
      ),
    });
  });

  it("does not allow authentication attempt counters to regress", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const userId = randomUUID();
    const challengeId = randomUUID();
    const now = new Date();

    await expect(
      migrator.transaction().execute(async (transaction) => {
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_users")
          .values({
            id: userId,
            normalised_email: `${userId}@example.test`,
            display_name: "Challenge Counter Owner",
            role: "Engineer",
            status: "Invited",
            created_at: now,
            updated_at: now,
          })
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_auth_challenges")
          .values({
            id: challengeId,
            user_id: userId,
            purpose: "SignInMfa",
            token_hash: new Uint8Array(32).fill(32),
            context: {},
            created_at: now,
            expires_at: new Date(now.getTime() + 60_000),
            consumed_at: null,
            attempt_count: 2,
            maximum_attempts: 5,
          })
          .executeTakeFirst();
        await sql`
          update stockcontrol.identity_auth_challenges
          set
            attempt_count = 1,
            version = version + 1
          where id = ${challengeId}::uuid
        `.execute(transaction);
      }),
    ).rejects.toMatchObject({
      code: "55000",
      message: expect.stringContaining("security state cannot regress"),
    });
  });

  it("requires live sessions to belong to active users in the same transaction", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const userId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();

    await expect(
      migrator.transaction().execute(async (transaction) => {
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_users")
          .values({
            id: userId,
            normalised_email: `${userId}@example.test`,
            display_name: "Session Owner",
            role: "Engineer",
            status: "Active",
            created_at: now,
            updated_at: now,
          })
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_sessions")
          .values({
            id: sessionId,
            user_id: userId,
            token_hash: new Uint8Array(32).fill(21),
            authentication_method: "Password",
            assurance_level: "SingleFactor",
            issued_at: now,
            last_seen_at: now,
            idle_expires_at: new Date(now.getTime() + 60_000),
            absolute_expires_at: new Date(now.getTime() + 120_000),
            reauthenticated_at: now,
            revoked_at: null,
            revoke_reason: null,
            created_ip_hash: null,
            user_agent: "integration-test",
          })
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .updateTable("identity_users")
          .set((expression) => ({
            status: "Disabled",
            updated_at: new Date(now.getTime() + 1),
            version: expression("version", "+", 1),
          }))
          .where("id", "=", userId)
          .executeTakeFirst();
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "identity_active_session_user_required",
    });
  });

  it("does not allow a terminal session to be resurrected", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const userId = randomUUID();
    const sessionId = randomUUID();
    const now = new Date();

    await expect(
      migrator.transaction().execute(async (transaction) => {
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_users")
          .values({
            id: userId,
            normalised_email: `${userId}@example.test`,
            display_name: "Terminal Session Owner",
            role: "Engineer",
            status: "Active",
            created_at: now,
            updated_at: now,
          })
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_sessions")
          .values({
            id: sessionId,
            user_id: userId,
            token_hash: new Uint8Array(32).fill(22),
            authentication_method: "Password",
            assurance_level: "SingleFactor",
            issued_at: now,
            last_seen_at: now,
            idle_expires_at: new Date(now.getTime() + 60_000),
            absolute_expires_at: new Date(now.getTime() + 120_000),
            reauthenticated_at: now,
            revoked_at: null,
            revoke_reason: null,
            created_ip_hash: null,
            user_agent: "integration-test",
          })
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .updateTable("identity_sessions")
          .set((expression) => ({
            revoked_at: new Date(now.getTime() + 1),
            revoke_reason: "Test revocation",
            version: expression("version", "+", 1),
          }))
          .where("id", "=", sessionId)
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .updateTable("identity_sessions")
          .set((expression) => ({
            revoked_at: null,
            revoke_reason: null,
            version: expression("version", "+", 1),
          }))
          .where("id", "=", sessionId)
          .executeTakeFirst();
      }),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("binds every recovery code to a TOTP credential owned by the same user", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const firstUserId = randomUUID();
    const secondUserId = randomUUID();
    const credentialId = randomUUID();
    const now = new Date();

    await expect(
      migrator.transaction().execute(async (transaction) => {
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_users")
          .values([
            {
              id: firstUserId,
              normalised_email: `${firstUserId}@example.test`,
              display_name: "First Recovery User",
              role: "Engineer",
              status: "Invited",
              created_at: now,
              updated_at: now,
            },
            {
              id: secondUserId,
              normalised_email: `${secondUserId}@example.test`,
              display_name: "Second Recovery User",
              role: "Engineer",
              status: "Invited",
              created_at: now,
              updated_at: now,
            },
          ])
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_totp_credentials")
          .values({
            id: credentialId,
            user_id: firstUserId,
            status: "Pending",
            secret_encryption_version: 1,
            secret_key_id: "identity-key-1",
            secret_nonce: new Uint8Array(12),
            secret_ciphertext: new Uint8Array(32),
            secret_auth_tag: new Uint8Array(16),
            last_accepted_counter: null,
            verified_at: null,
            recovery_codes_acknowledged_at: null,
            revoked_at: null,
            created_at: now,
            updated_at: now,
          })
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_recovery_codes")
          .values({
            id: randomUUID(),
            user_id: secondUserId,
            totp_credential_id: credentialId,
            code_hash: new Uint8Array(32).fill(23),
            created_at: now,
            used_at: null,
            revoked_at: null,
          })
          .executeTakeFirst();
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("defers and enforces the final active capable Admin invariant after bootstrap", async () => {
    expect(migratorDatabase).toBeDefined();

    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const adminId = randomUUID();

    await expect(
      migrator.transaction().execute(async (transaction) => {
        const now = new Date();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_users")
          .values({
            id: adminId,
            normalised_email: `${adminId}@example.test`,
            display_name: "Bootstrap Admin",
            role: "Admin",
            status: "Active",
            created_at: now,
            updated_at: now,
          })
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("identity_bootstrap_state")
          .values({
            singleton_key: 1,
            secret_hash: new Uint8Array(32).fill(3),
            expires_at: new Date(now.getTime() + 60_000),
            completed_at: null,
            completed_by_user_id: null,
            created_at: now,
            updated_at: now,
          })
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .updateTable("identity_bootstrap_state")
          .set((expression) => ({
            secret_hash: null,
            expires_at: null,
            completed_at: now,
            completed_by_user_id: adminId,
            updated_at: now,
            version: expression("version", "+", 1),
          }))
          .where("singleton_key", "=", 1)
          .executeTakeFirst();
        await transaction
          .withSchema(STOCKCONTROL_SCHEMA)
          .updateTable("identity_users")
          .set((expression) => ({
            status: "Disabled",
            updated_at: now,
            version: expression("version", "+", 1),
          }))
          .where("id", "=", adminId)
          .executeTakeFirst();
      }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "identity_final_capable_admin_required",
    });
  });

  it("does not permit the runtime role to create or drop schema objects", async () => {
    expect(runtimeDatabase).toBeDefined();
    expect(migratorDatabase).toBeDefined();

    const runtime = runtimeDatabase as Kysely<StockControlDatabase>;
    const migrator = migratorDatabase as Kysely<StockControlDatabase>;
    const createProbeTable = `runtime_create_probe_${process.pid}`;
    const dropProbeTable = `runtime_drop_probe_${process.pid}`;

    try {
      await expect(
        sql`create table ${sql.id(STOCKCONTROL_SCHEMA, createProbeTable)} (id integer)`.execute(
          runtime,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await sql`drop table if exists ${sql.id(STOCKCONTROL_SCHEMA, createProbeTable)}`.execute(
        migrator,
      );
    }

    await sql`create table ${sql.id(STOCKCONTROL_SCHEMA, dropProbeTable)} (id integer)`.execute(
      migrator,
    );

    try {
      await expect(
        sql`drop table ${sql.id(STOCKCONTROL_SCHEMA, dropProbeTable)}`.execute(runtime),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await sql`drop table if exists ${sql.id(STOCKCONTROL_SCHEMA, dropProbeTable)}`.execute(
        migrator,
      );
    }
  });
});
