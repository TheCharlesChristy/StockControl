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

import {
  PERSONAL_DATA_SOURCES,
  exportPersonalData,
  hasRecordedActivity,
} from "../src/users/personal-data";

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

  /** The columns a source's own scope names, whatever shape that scope takes. */
  const scopeColumns = (source: (typeof PERSONAL_DATA_SOURCES)[number]): readonly string[] => {
    switch (source.scope.kind) {
      case "direct":
        return source.scope.columns;
      case "viaSession":
        return [source.scope.column];
      case "mcpToolCallsActor":
        /* The column its coalesce resolution reads first. */
        return ["actor_user_id"];
    }
  };

  it("names a real column on a real table for every source", async () => {
    for (const source of PERSONAL_DATA_SOURCES) {
      const columns = await sql<{ readonly column_name: string }>`
        select column_name
        from information_schema.columns
        where table_schema = ${SCHEMA} and table_name = ${source.table}
      `.execute(migrator);

      const names = columns.rows.map((row) => row.column_name);

      expect(names, `${source.table} should exist`).not.toEqual([]);

      for (const column of [...scopeColumns(source), source.orderBy, ...(source.withhold ?? [])]) {
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

  /*
   * A tool call is written before it is authorised, so its own actor_user_id
   * can still be null at that point — the person is only known once a later
   * event on the same call records it. A source that only matched the call's
   * own column would silently drop this row from the export.
   */
  it("finds a tool call whose actor is only known from a later event", async () => {
    const callId = randomUUID();

    await database
      .withSchema(SCHEMA)
      .insertInto("mcp_tool_calls")
      .values({
        id: callId,
        correlation_id: randomUUID(),
        actor_user_id: null,
        tool_name: "stock.list",
        contract_version: "1",
        operation: "read",
        arguments: JSON.stringify({}),
        arguments_sha256: "a".repeat(64),
      })
      .execute();

    await database
      .withSchema(SCHEMA)
      .insertInto("mcp_tool_call_events")
      .values({
        id: randomUUID(),
        call_id: callId,
        actor_user_id: userId,
        event_type: "Authorised",
        result_summary: JSON.stringify({}),
        record_types: JSON.stringify([]),
      })
      .execute();

    const exported = await exportPersonalData(database, userId);
    const calls = exported?.sections.find((section) => section.table === "mcp_tool_calls");

    expect(calls?.rows.map((row) => row.id)).toContain(callId);

    /* Neither table grants the runtime role delete; only the migrator can clean these up. */
    await migrator
      .withSchema(SCHEMA)
      .deleteFrom("mcp_tool_call_events")
      .where("call_id", "=", callId)
      .execute();
    await migrator
      .withSchema(SCHEMA)
      .deleteFrom("mcp_tool_calls")
      .where("id", "=", callId)
      .execute();
  });

  /*
   * The raw capture evidence — an image, a candidate, a queued job — has no
   * column of its own pointing at a person. It only points at the session
   * that does, so a `viaSession` source has to resolve through it correctly.
   */
  it("finds capture evidence that only points at the person through its session", async () => {
    const batchId = randomUUID();
    const sessionId = randomUUID();
    const imageId = randomUUID();

    await database
      .withSchema(SCHEMA)
      .insertInto("stock_capture_batches")
      .values({
        id: batchId,
        actor_user_id: userId,
        request_hash: "b".repeat(64),
      })
      .execute();

    await database
      .withSchema(SCHEMA)
      .insertInto("stock_recognition_sessions")
      .values({
        id: sessionId,
        batch_id: batchId,
        actor_user_id: userId,
        request_hash: "c".repeat(64),
        photo_count: 1,
        expires_at: new Date(Date.now() + 60_000),
      })
      .execute();

    await database
      .withSchema(SCHEMA)
      .insertInto("stock_recognition_images")
      .values({
        id: imageId,
        session_id: sessionId,
        ordinal: 1,
        object_key: `personal-data-fixture/${imageId}`,
        sha256: "d".repeat(64),
        media_type: "image/jpeg",
        byte_length: 100,
        width: 10,
        height: 10,
        delete_after: new Date(Date.now() + 60_000),
      })
      .execute();

    const exported = await exportPersonalData(database, userId);
    const images = exported?.sections.find(
      (section) => section.table === "stock_recognition_images",
    );

    expect(images?.rows.map((row) => row.id)).toContain(imageId);

    /* Sessions and batches do not grant the runtime role delete; only the migrator can clean these up. */
    await database
      .withSchema(SCHEMA)
      .deleteFrom("stock_recognition_images")
      .where("id", "=", imageId)
      .execute();
    await migrator
      .withSchema(SCHEMA)
      .deleteFrom("stock_recognition_sessions")
      .where("id", "=", sessionId)
      .execute();
    await migrator
      .withSchema(SCHEMA)
      .deleteFrom("stock_capture_batches")
      .where("id", "=", batchId)
      .execute();
  });

  it("has nothing to say about somebody who does not exist", async () => {
    expect(await exportPersonalData(database, randomUUID())).toBeUndefined();
  });
});

/*
 * `UsersService.remove` refuses to delete an account this function says has
 * activity, so it has to agree with the export on what counts — the very
 * regression under test: a person whose only trace is a map edit was
 * previously invisible to the deletion gate (which checked four columns by
 * hand) while being very visible in their own export, so deleting them threw
 * a raw foreign-key error instead of the friendly refusal.
 */
describe.sequential("hasRecordedActivity", () => {
  let migrator: Kysely<StockControlDatabase>;
  let database: Kysely<StockControlDatabase>;

  const userId = randomUUID();
  const mapId = randomUUID();
  const editId = randomUUID();

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
        username: `history.${userId.slice(0, 20)}`,
        email: "history.fixture@example.invalid",
        display_name: "History fixture",
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

  it("is false for an account with nothing recorded against it", async () => {
    expect(await hasRecordedActivity(database, userId)).toBe(false);
  });

  it("is true for a table no direct-column check would think to look at", async () => {
    await database
      .withSchema(SCHEMA)
      .insertInto("maps")
      .values({
        id: mapId,
        code: `HIST${mapId.slice(0, 4)}`,
        name: "History fixture map",
        background_metadata: {},
      })
      .execute();
    await database
      .withSchema(SCHEMA)
      .insertInto("map_edit_events")
      .values({
        id: editId,
        map_id: mapId,
        actor_user_id: userId,
        action: "MoveLocation",
      })
      .execute();

    expect(await hasRecordedActivity(database, userId)).toBe(true);

    /* Neither table grants the runtime role delete; only the migrator can clean these up. */
    await migrator
      .withSchema(SCHEMA)
      .deleteFrom("map_edit_events")
      .where("id", "=", editId)
      .execute();
    await migrator.withSchema(SCHEMA).deleteFrom("maps").where("id", "=", mapId).execute();
  });

  it("ignores a session, which deletion clears on its own", async () => {
    const sessionId = randomUUID();

    await database
      .withSchema(SCHEMA)
      .insertInto("sessions")
      .values({ id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 60_000) })
      .execute();

    expect(await hasRecordedActivity(database, userId)).toBe(false);

    await database.withSchema(SCHEMA).deleteFrom("sessions").where("id", "=", sessionId).execute();
  });
});
