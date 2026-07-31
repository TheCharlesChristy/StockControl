import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
} from "../src/configuration";
import { createMigratorDatabase, createRuntimeDatabase } from "../src/connection";
import { MIGRATION_NAMES } from "../src/migrations/provider";
import { RUNTIME_TABLE_PRIVILEGES, runMigrations } from "../src/migrations/runner";
import { PostgresReadinessCheck } from "../src/readiness";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "../src/schema";

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

  it("has every canonical migration recorded, in order", async () => {
    expect(migratorDatabase).toBeDefined();

    /*
     * Asserted against what the database holds rather than what this run
     * applied, so the check is true whether the database was already migrated
     * or migrated by this suite.
     */
    const recorded = await (migratorDatabase as Kysely<StockControlDatabase>)
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("migration_integrity")
      .select("migration_name")
      .orderBy("migration_version")
      .execute();

    expect(recorded.map(({ migration_name }) => migration_name)).toEqual([...MIGRATION_NAMES]);
    expect(initialMigrationNames.every((name) => MIGRATION_NAMES.includes(name as never))).toBe(
      true,
    );
  });

  /*
   * Compared against the privilege registry rather than a third hand-written
   * list. That registry is typed against the Kysely schema, so this asserts the
   * migration SQL, the schema types and the runtime grants all describe the
   * same set of tables — a table created but never granted would be invisible
   * at runtime, and one granted but never created would fail on first use.
   */
  it("creates exactly the tables the runtime privilege registry covers", async () => {
    expect(migratorDatabase).toBeDefined();

    const tables = await (
      migratorDatabase as Kysely<StockControlDatabase>
    ).introspection.getTables();

    expect(
      tables
        .filter(({ schema }) => schema === STOCKCONTROL_SCHEMA)
        .map(({ name }) => name)
        .sort(),
    ).toEqual(Object.keys(RUNTIME_TABLE_PRIVILEGES).sort());
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
