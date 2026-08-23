import { randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createMigratorDatabase,
  createRuntimeDatabase,
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
  runMigrations,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";

import { PERSONAL_DATA_SOURCES, exportPersonalData } from "../src/users/personal-data";

const SCHEMA = "stockcontrol" as const;

describe.sequential("the personal data export", () => {
  let migrator: Kysely<StockControlDatabase>;
  let database: Kysely<StockControlDatabase>;

  const userId = randomUUID();
  const username = `export.${userId.slice(0, 22)}`;

  beforeAll(async () => {
    const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
    migrator = createMigratorDatabase(loadMigratorDatabaseConfiguration());
    await runMigrations(migrator, {
      runtimeRole: databaseRoleFromConnectionString(runtimeConfiguration.connectionString),
    });
    database = createRuntimeDatabase(runtimeConfiguration);

    await database
      .withSchema(SCHEMA)
      .insertInto("users")
      .values({
        id: userId,
        username,
        email: "export.fixture@example.invalid",
        display_name: "Export fixture",
        role: "Engineer",
        password_hash: "scrypt$not-a-real-hash",
      })
      .execute();
  });

  afterAll(async () => {
    await database.withSchema(SCHEMA).deleteFrom("users").where("id", "=", userId).execute();
    await database.destroy();
    await migrator.destroy();
  });

  /*
   * The invariant this whole file exists for. A subject access request answered
   * from a hand-maintained list is only right until somebody adds a table, and
   * an export that silently omits one looks complete while being wrong. So the
   * live schema is asked which tables point at a person, and every one of them
   * has to be accounted for here.
   */
  it("covers every table that records who someone is or what they did", async () => {
    const referencing = await sql<{
      readonly table_name: string;
    }>`
      select distinct child.relname as table_name
      from pg_constraint constraint_
      join pg_class child on child.oid = constraint_.conrelid
      join pg_class parent on parent.oid = constraint_.confrelid
      join pg_namespace namespace on namespace.oid = child.relnamespace
      where constraint_.contype = 'f'
        and parent.relname = 'users'
        and namespace.nspname = ${SCHEMA}
    `.execute(migrator);

    const covered = new Set<string>(PERSONAL_DATA_SOURCES.map((source) => source.table));
    /* The subject block, assembled by hand so the password hash cannot ride along. */
    covered.add("users");

    const missing = referencing.rows
      .map((row) => row.table_name)
      .filter((table) => !covered.has(table));

    expect(missing).toEqual([]);
  });

  it("names a real column on a real table for every source", async () => {
    for (const source of PERSONAL_DATA_SOURCES) {
      const columns = await sql<{ readonly column_name: string }>`
        select column_name
        from information_schema.columns
        where table_schema = ${SCHEMA} and table_name = ${source.table}
      `.execute(migrator);

      const names = columns.rows.map((row) => row.column_name);

      expect(names, `${source.table} should exist`).not.toEqual([]);

      for (const column of [...source.columns, source.orderBy, ...(source.withhold ?? [])]) {
        expect(names, `${source.table}.${column}`).toContain(column);
      }
    }
  });

  it("returns the person's own record and nothing about their password", async () => {
    const exported = await exportPersonalData(database, userId);

    expect(exported?.subject).toMatchObject({
      id: userId,
      username,
      displayName: "Export fixture",
      role: "Engineer",
      email: "export.fixture@example.invalid",
    });

    expect(JSON.stringify(exported)).not.toContain("not-a-real-hash");
    expect(JSON.stringify(exported)).not.toContain("password_hash");
  });

  it("includes a section for every source, empty or not", async () => {
    const exported = await exportPersonalData(database, userId);

    expect(exported?.sections.map((section) => section.table)).toEqual(
      PERSONAL_DATA_SOURCES.map((source) => source.table),
    );
  });

  it("finds the rows that belong to the person", async () => {
    const sessionId = randomUUID();

    await database
      .withSchema(SCHEMA)
      .insertInto("sessions")
      .values({
        id: sessionId,
        user_id: userId,
        expires_at: new Date(Date.now() + 60_000),
      })
      .execute();

    const exported = await exportPersonalData(database, userId);
    const sessions = exported?.sections.find((section) => section.table === "sessions");

    expect(sessions?.rowCount).toBe(1);
    expect(sessions?.rows[0]).toMatchObject({ user_id: userId });

    /*
     * The session id is a digest of the token. It is not a usable credential,
     * and it is not sent — an Admin can produce this file for somebody else,
     * and nothing derived from their credentials should travel in it.
     */
    expect(sessions?.rows[0]).not.toHaveProperty("id");
    expect(JSON.stringify(exported)).not.toContain(sessionId);

    await database.withSchema(SCHEMA).deleteFrom("sessions").where("id", "=", sessionId).execute();
  });

  it("has nothing to say about somebody who does not exist", async () => {
    expect(await exportPersonalData(database, randomUUID())).toBeUndefined();
  });
});
