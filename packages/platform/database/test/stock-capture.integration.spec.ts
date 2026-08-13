import { randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
} from "../src/configuration";
import { createMigratorDatabase, createRuntimeDatabase } from "../src/connection";
import { assistedStockCaptureMigration } from "../src/migrations/0007-assisted-stock-capture";
import { RUNTIME_TABLE_PRIVILEGES, runMigrations } from "../src/migrations/runner";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "../src/schema";

/*
 * The capture schema against a real server. The unit spec asserts the SQL text;
 * this asserts what PostgreSQL actually enforces, because a check constraint
 * that parses is not the same as one that refuses the row it was written for.
 */
describe.sequential("assisted stock capture schema", () => {
  let migrator: Kysely<StockControlDatabase>;
  let runtime: Kysely<StockControlDatabase>;
  let runtimeRole: string;

  const userId = randomUUID();
  const batchId = randomUUID();
  const sessionId = randomUUID();
  const digest = "a".repeat(64);

  beforeAll(async () => {
    const migratorConfiguration = loadMigratorDatabaseConfiguration();
    const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
    runtimeRole = databaseRoleFromConnectionString(runtimeConfiguration.connectionString);
    migrator = createMigratorDatabase(migratorConfiguration);
    await runMigrations(migrator, { runtimeRole });
    runtime = createRuntimeDatabase(runtimeConfiguration);

    await runtime
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("users")
      .values({
        id: userId,
        username: `capture.${userId.slice(0, 23)}`,
        email: `capture.${userId}@example.invalid`,
        display_name: "Capture fixture",
        role: "Office",
        password_hash: "not-a-real-hash",
      })
      .execute();
  });

  afterAll(async () => {
    const schema = runtime.withSchema(STOCKCONTROL_SCHEMA);
    await schema
      .deleteFrom("stock_recognition_images")
      .where("session_id", "=", sessionId)
      .execute();
    await schema
      .deleteFrom("stock_recognition_candidates")
      .where("session_id", "=", sessionId)
      .execute();
    await schema.deleteFrom("stock_recognition_jobs").where("session_id", "=", sessionId).execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("stock_recognition_sessions")
      .where("id", "=", sessionId)
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("stock_capture_batches")
      .where("id", "=", batchId)
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("users")
      .where("id", "=", userId)
      .execute();
    await runtime.destroy();
    await migrator.destroy();
  });

  it("lets the runtime role open a batch and a session", async () => {
    const schema = runtime.withSchema(STOCKCONTROL_SCHEMA);

    await schema
      .insertInto("stock_capture_batches")
      .values({
        id: batchId,
        actor_user_id: userId,
        default_location_id: null,
        request_hash: digest,
      })
      .execute();

    await schema
      .insertInto("stock_recognition_sessions")
      .values({
        id: sessionId,
        batch_id: batchId,
        actor_user_id: userId,
        request_hash: digest,
        photo_count: 3,
        expires_at: new Date(Date.now() + 3_600_000),
      })
      .execute();

    await expect(
      schema
        .selectFrom("stock_recognition_sessions")
        .select(["status", "photo_count"])
        .where("id", "=", sessionId)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ status: "AwaitingUpload", photo_count: 3 });
  });

  it("refuses a sixth photograph in one session", async () => {
    await expect(
      runtime
        .withSchema(STOCKCONTROL_SCHEMA)
        .insertInto("stock_recognition_images")
        .values({
          id: randomUUID(),
          session_id: sessionId,
          ordinal: 6,
          object_key: `stock-capture/${sessionId}/6`,
          sha256: digest,
          media_type: "image/jpeg",
          byte_length: 1_000,
          width: 800,
          height: 600,
          delete_after: new Date(Date.now() + 3_600_000),
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23514" });
  });

  interface ImageRow {
    readonly id: string;
    readonly session_id: string;
    readonly ordinal: number;
    readonly object_key: string;
    readonly sha256: string;
    readonly media_type: "image/jpeg";
    readonly byte_length: number;
    readonly width: number;
    readonly height: number;
    readonly delete_after: Date;
  }

  interface JobRow {
    readonly id: string;
    readonly session_id: string;
    readonly job_type: "Recognize";
    readonly payload_version: number;
    readonly deduplication_key: string;
    readonly max_attempts: number;
  }

  it("refuses two photographs in the same position", async () => {
    const schema = runtime.withSchema(STOCKCONTROL_SCHEMA);
    const image = (id: string): ImageRow => ({
      id,
      session_id: sessionId,
      ordinal: 1,
      object_key: `stock-capture/${sessionId}/${id}`,
      sha256: digest,
      media_type: "image/jpeg" as const,
      byte_length: 1_000,
      width: 800,
      height: 600,
      delete_after: new Date(Date.now() + 3_600_000),
    });

    await schema.insertInto("stock_recognition_images").values(image(randomUUID())).execute();
    await expect(
      schema.insertInto("stock_recognition_images").values(image(randomUUID())).execute(),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses an external draft that names an internal item", async () => {
    await expect(
      runtime
        .withSchema(STOCKCONTROL_SCHEMA)
        .insertInto("stock_recognition_candidates")
        .values({
          id: randomUUID(),
          session_id: sessionId,
          rank: 1,
          kind: "ExternalDraft",
          item_id: randomUUID(),
          confidence_band: "Possible",
          fusion_score: 1,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses a job holding half a lease", async () => {
    await expect(
      runtime
        .withSchema(STOCKCONTROL_SCHEMA)
        .insertInto("stock_recognition_jobs")
        .values({
          id: randomUUID(),
          session_id: sessionId,
          job_type: "Recognize",
          payload_version: 1,
          deduplication_key: `half-lease-${sessionId}`,
          max_attempts: 5,
          lease_owner: "worker-1",
          leased_until: null,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses the same deduplication key twice", async () => {
    const schema = runtime.withSchema(STOCKCONTROL_SCHEMA);
    const key = `recognize:${sessionId}`;
    const job = (): JobRow => ({
      id: randomUUID(),
      session_id: sessionId,
      job_type: "Recognize" as const,
      payload_version: 1,
      deduplication_key: key,
      max_attempts: 5,
    });

    await schema.insertInto("stock_recognition_jobs").values(job()).execute();
    await expect(
      schema.insertInto("stock_recognition_jobs").values(job()).execute(),
    ).rejects.toMatchObject({
      code: "23505",
    });
  });

  /*
   * A pending entry that already carried results would mean a commit had half
   * happened, which is exactly the state the single transaction exists to make
   * impossible. The database refuses it rather than trusting the writer.
   */
  it("refuses a pending entry that already carries a result", async () => {
    await expect(
      runtime
        .withSchema(STOCKCONTROL_SCHEMA)
        .insertInto("stock_capture_entries")
        .values({
          id: randomUUID(),
          batch_id: batchId,
          session_id: sessionId,
          actor_user_id: userId,
          request_hash: digest,
          status: "Pending",
          created_item: true,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses a batch that is closed without a closing time", async () => {
    await expect(
      runtime
        .withSchema(STOCKCONTROL_SCHEMA)
        .insertInto("stock_capture_batches")
        .values({
          id: randomUUID(),
          actor_user_id: userId,
          default_location_id: null,
          request_hash: digest,
          status: "Completed",
          closed_at: null,
        })
        .execute(),
    ).rejects.toMatchObject({ code: "23514" });
  });

  /*
   * The registry is the reviewed statement of what the runtime role may do.
   * Comparing it with what PostgreSQL granted proves the two agree — a
   * privilege added to the registry but never applied would be a silent lie.
   */
  it("grants the runtime role exactly the reviewed privileges and no more", async () => {
    const granted = await sql<{
      readonly table_name: string;
      readonly privilege_type: string;
    }>`
      select table_name, privilege_type
      from information_schema.table_privileges
      where table_schema = ${STOCKCONTROL_SCHEMA} and grantee = ${runtimeRole}
    `.execute(migrator);

    const actual = new Map<string, Set<string>>();
    for (const row of granted.rows) {
      const privileges = actual.get(row.table_name) ?? new Set<string>();
      privileges.add(row.privilege_type.toLowerCase());
      actual.set(row.table_name, privileges);
    }

    for (const [table, expected] of Object.entries(RUNTIME_TABLE_PRIVILEGES)) {
      expect([...(actual.get(table) ?? new Set<string>())].sort()).toEqual([...expected].sort());
    }
  });

  it("refuses the runtime role a delete on the entry table that proves a receipt happened", async () => {
    await expect(
      sql`delete from ${sql.id(STOCKCONTROL_SCHEMA, "stock_capture_entries")} where false`.execute(
        runtime,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses the runtime role a delete on the recognition session it must retain", async () => {
    await expect(
      sql`delete from ${sql.id(STOCKCONTROL_SCHEMA, "stock_recognition_sessions")} where false`.execute(
        runtime,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  /*
   * Rolled back rather than left applied, so the shared test database is
   * untouched. Reversibility is worth proving because a down statement is only
   * ever run in an emergency, and PostgreSQL running DDL inside a transaction
   * makes proving it this cheap.
   *
   * The rollback is forced by throwing: a callback that returns commits, and
   * committing here would drop and recreate the tables without their grants —
   * those come from `configureRuntimeDatabaseAccess`, not from the migration —
   * leaving every later test with a permission error.
   */
  it("reverses cleanly and can be reapplied", async () => {
    const captureTables = Object.keys(RUNTIME_TABLE_PRIVILEGES).filter(
      (table) =>
        table.startsWith("stock_capture_") ||
        table.startsWith("stock_recognition_") ||
        table === "item_visual_examples" ||
        table === "recognition_feedback",
    );
    expect(captureTables).toHaveLength(8);

    const countTables = async (database: Kysely<StockControlDatabase>): Promise<number> => {
      const row = await sql<{ readonly total: number }>`
        select count(*)::int as total
        from information_schema.tables
        where table_schema = ${STOCKCONTROL_SCHEMA}
          and table_name = any(${sql.val(captureTables)}::text[])
      `.execute(database);
      return row.rows[0]?.total ?? -1;
    };

    let observed: Record<string, number> | undefined;

    /* Kysely's `down` is optional; a migration of this size must have one. */
    const reverse = async (tx: Kysely<StockControlDatabase>): Promise<void> => {
      if (assistedStockCaptureMigration.down === undefined) {
        throw new Error("The capture migration must be reversible.");
      }
      await assistedStockCaptureMigration.down(tx);
    };

    await expect(
      migrator.transaction().execute(async (tx) => {
        const before = await countTables(tx);
        await reverse(tx);
        const afterDown = await countTables(tx);
        await assistedStockCaptureMigration.up(tx);
        const afterUp = await countTables(tx);

        const integrity = await sql<{ readonly total: number }>`
          select count(*)::int as total
          from ${sql.id(STOCKCONTROL_SCHEMA, "migration_integrity")}
          where migration_name = '0007_assisted_stock_capture'
        `.execute(tx);

        observed = {
          before,
          afterDown,
          afterUp,
          integrityRows: integrity.rows[0]?.total ?? -1,
        };
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");

    expect(observed).toEqual({ before: 8, afterDown: 0, afterUp: 8, integrityRows: 1 });
    expect(await countTables(migrator)).toBe(8);
  });
});
