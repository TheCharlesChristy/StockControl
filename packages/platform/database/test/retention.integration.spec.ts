import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
} from "../src/configuration";
import { createMigratorDatabase, createRuntimeDatabase } from "../src/connection";
import { runMigrations } from "../src/migrations/runner";
import { runRetention } from "../src/retention/purge";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "../src/schema";

/*
 * The retention schedule against a real server. The unit spec asserts the
 * policy — which tables, in which order, on which clock. This asserts what
 * PostgreSQL does with it, because the whole schedule turns on `on delete
 * restrict` behaving as declared: a rule that deletes a parent before its
 * children throws rather than orphaning anything, and no amount of reading the
 * schedule proves the ordering that avoids it is right.
 */
describe.sequential("applying the retention schedule", () => {
  let migrator: Kysely<StockControlDatabase>;
  let runtime: Kysely<StockControlDatabase>;

  const userId = randomUUID();
  const staleCallId = randomUUID();
  const freshCallId = randomUUID();
  const staleMapId = randomUUID();
  const staleEditId = randomUUID();
  const freshEditId = randomUUID();

  const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1_000);

  const insertToolCall = async (id: string, receivedAt: Date): Promise<void> => {
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("mcp_tool_calls")
      .values({
        id,
        correlation_id: randomUUID(),
        actor_user_id: userId,
        tool_name: "stock.list",
        contract_version: "1",
        operation: "read",
        arguments: JSON.stringify({ page: 1 }),
        arguments_sha256: "b".repeat(64),
        received_at: receivedAt,
      })
      .execute();

    /*
     * One of each dependent kind, so the ordering assertion has something to
     * trip over if the schedule ever puts the parent first.
     */
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("mcp_tool_call_events")
      .values({
        id: randomUUID(),
        call_id: id,
        actor_user_id: userId,
        event_type: "Received",
        occurred_at: receivedAt,
        result_summary: JSON.stringify({}),
        record_types: JSON.stringify([]),
      })
      .execute();

    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("mcp_effect_links")
      .values({
        id: randomUUID(),
        call_id: id,
        effect_type: "transaction",
        effect_id: randomUUID(),
      })
      .execute();

    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("mcp_command_receipts")
      .values({
        id: randomUUID(),
        actor_user_id: userId,
        tool_name: "stock.list",
        idempotency_key: randomUUID(),
        request_fingerprint: "c".repeat(64),
        call_id: id,
        result: JSON.stringify({ ok: true }),
        result_digest: "d".repeat(64),
      })
      .execute();
  };

  beforeAll(async () => {
    const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
    migrator = createMigratorDatabase(loadMigratorDatabaseConfiguration());
    await runMigrations(migrator, {
      runtimeRole: databaseRoleFromConnectionString(runtimeConfiguration.connectionString),
    });
    runtime = createRuntimeDatabase(runtimeConfiguration);

    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("users")
      .values({
        id: userId,
        username: `retention.${userId.slice(0, 20)}`,
        display_name: "Retention fixture",
        email: null,
        role: "Office",
        password_hash: "not-a-real-hash",
      })
      .execute();

    await insertToolCall(staleCallId, daysAgo(400));
    await insertToolCall(freshCallId, daysAgo(10));

    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("maps")
      .values({
        id: staleMapId,
        code: `RET${staleMapId.slice(0, 5)}`,
        name: "Retention fixture map",
        background_metadata: {},
      })
      .execute();

    for (const [id, occurredAt] of [
      [staleEditId, daysAgo(400)],
      [freshEditId, daysAgo(10)],
    ] as const) {
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .insertInto("map_edit_events")
        .values({
          id,
          map_id: staleMapId,
          actor_user_id: userId,
          action: "MoveLocation",
          before_state: null,
          after_state: null,
          reason: null,
          occurred_at: occurredAt,
        })
        .execute();
    }
  });

  afterAll(async () => {
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("map_edit_events")
      .where("map_id", "=", staleMapId)
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("maps")
      .where("id", "=", staleMapId)
      .execute();

    for (const table of [
      "mcp_effect_links",
      "mcp_command_receipts",
      "mcp_tool_call_events",
    ] as const) {
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom(table)
        .where("call_id", "in", [staleCallId, freshCallId])
        .execute();
    }

    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("mcp_tool_calls")
      .where("id", "in", [staleCallId, freshCallId])
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("users")
      .where("id", "=", userId)
      .execute();

    await runtime.destroy();
    await migrator.destroy();
  });

  const toolCallIds = async (): Promise<readonly string[]> =>
    (
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom("mcp_tool_calls")
        .select("id")
        .where("id", "in", [staleCallId, freshCallId])
        .execute()
    ).map((row) => row.id);

  it("reports what is out of policy without removing it", async () => {
    const preview = await runRetention(migrator, { dryRun: true });

    expect(preview.dryRun).toBe(true);
    expect(preview.tables.find((table) => table.table === "mcp_tool_calls")?.rows).toBe(1);
    expect(await toolCallIds()).toEqual(expect.arrayContaining([staleCallId, freshCallId]));
  });

  it("removes records past their window and leaves the rest", async () => {
    const result = await runRetention(migrator);

    expect(result.dryRun).toBe(false);
    expect(await toolCallIds()).toEqual([freshCallId]);

    const remainingEdits = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("map_edit_events")
      .select("id")
      .where("map_id", "=", staleMapId)
      .execute();

    expect(remainingEdits.map((row) => row.id)).toEqual([freshEditId]);
  });

  /*
   * The dependent rows have to go with their parent. If any survived, the
   * restrict constraint would have failed the delete above rather than leaving
   * them — so this asserts the ordering did its job rather than that PostgreSQL
   * silently cascaded.
   */
  it("takes the dependent rows with it", async () => {
    for (const table of [
      "mcp_effect_links",
      "mcp_command_receipts",
      "mcp_tool_call_events",
    ] as const) {
      const rows = await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom(table)
        .select("id")
        .where("call_id", "=", staleCallId)
        .execute();

      expect(rows).toEqual([]);
    }
  });

  it("is safe to run again when nothing is left to remove", async () => {
    const result = await runRetention(migrator);

    expect(result.totalRows).toBe(0);
  });

  /*
   * The API must not be able to erase the record of what it did. Retention is
   * a maintenance step with its own credential precisely so that the runtime
   * role never needs delete on an audit table.
   */
  it("is refused to the runtime role", async () => {
    await expect(
      runtime
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("mcp_tool_calls")
        .where("id", "=", freshCallId)
        .execute(),
    ).rejects.toThrow(/permission denied/iu);
  });
});
