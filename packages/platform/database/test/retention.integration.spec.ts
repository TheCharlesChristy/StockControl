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

/*
 * Three rules added alongside the ones above, each carrying its own
 * safety condition that the unit spec cannot exercise without a real
 * server: a batch's own status, an image row's `deleted_at`, and a grant's
 * `revoked_at`. Each gets a fixture that should survive the run alongside
 * one that should not, so a rule that is too eager is caught here rather
 * than by a bucket orphaned in production.
 */
describe.sequential("the conditional retention rules", () => {
  let migrator: Kysely<StockControlDatabase>;

  const userId = randomUUID();
  const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1_000);

  const openBatchId = randomUUID();
  const closedBatchId = randomUUID();
  const imageGateBatchId = randomUUID();
  const openSessionId = randomUUID();
  const closedSessionId = randomUUID();
  const imageGateSessionId = randomUUID();
  const deletedImageId = randomUUID();
  const undeletedImageId = randomUUID();

  const revokedGrantId = randomUUID();
  const liveGrantId = randomUUID();
  const revokedGrantTokenId = randomUUID();
  const liveGrantTokenId = randomUUID();

  beforeAll(async () => {
    migrator = createMigratorDatabase(loadMigratorDatabaseConfiguration());
    await runMigrations(migrator, {
      runtimeRole: databaseRoleFromConnectionString(
        loadRuntimeDatabaseConfiguration().connectionString,
      ),
    });

    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("users")
      .values({
        id: userId,
        username: `retention-cond.${userId.slice(0, 12)}`,
        display_name: "Retention conditional fixture",
        email: null,
        role: "Office",
        password_hash: "not-a-real-hash",
      })
      .execute();

    /*
     * Three batches: one the app closed long ago with nothing left under it
     * (should go); one it never closed — still "Open", however stale,
     * because the app itself never said it was done with it (should stay);
     * and one it closed whose session is still held up by an undeleted image
     * (should also stay, for the batch's own sake, not the session's).
     */
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_capture_batches")
      .values([
        {
          id: closedBatchId,
          actor_user_id: userId,
          request_hash: "a".repeat(64),
          status: "Completed",
          closed_at: daysAgo(400),
          updated_at: daysAgo(400),
        },
        {
          id: openBatchId,
          actor_user_id: userId,
          request_hash: "b".repeat(64),
          status: "Open",
          updated_at: daysAgo(400),
        },
        {
          id: imageGateBatchId,
          actor_user_id: userId,
          request_hash: "1".repeat(64),
          status: "Completed",
          closed_at: daysAgo(400),
          updated_at: daysAgo(400),
        },
      ])
      .execute();

    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_recognition_sessions")
      .values([
        {
          id: closedSessionId,
          batch_id: closedBatchId,
          actor_user_id: userId,
          request_hash: "c".repeat(64),
          status: "Committed",
          photo_count: 1,
          updated_at: daysAgo(400),
          expires_at: daysAgo(399),
        },
        {
          id: openSessionId,
          batch_id: openBatchId,
          actor_user_id: userId,
          request_hash: "d".repeat(64),
          status: "Committed",
          photo_count: 0,
          updated_at: daysAgo(400),
          expires_at: daysAgo(399),
        },
        {
          id: imageGateSessionId,
          batch_id: imageGateBatchId,
          actor_user_id: userId,
          request_hash: "2".repeat(64),
          status: "Committed",
          photo_count: 1,
          updated_at: daysAgo(400),
          expires_at: daysAgo(399),
        },
      ])
      .execute();

    /* One image the worker confirmed deleted, under a session with nothing else outstanding. */
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_recognition_images")
      .values({
        id: deletedImageId,
        session_id: closedSessionId,
        ordinal: 1,
        object_key: `retention-fixture/${deletedImageId}`,
        sha256: "e".repeat(64),
        media_type: "image/jpeg",
        byte_length: 100,
        width: 10,
        height: 10,
        delete_after: daysAgo(370),
        deleted_at: daysAgo(365),
        created_at: daysAgo(400),
      })
      .execute();

    /* One image the worker has not caught up to, under its own session and batch. */
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("stock_recognition_images")
      .values({
        id: undeletedImageId,
        session_id: imageGateSessionId,
        ordinal: 1,
        object_key: `retention-fixture/${undeletedImageId}`,
        sha256: "f".repeat(64),
        media_type: "image/jpeg",
        byte_length: 100,
        width: 10,
        height: 10,
        delete_after: daysAgo(370),
        deleted_at: null,
        created_at: daysAgo(400),
      })
      .execute();

    /* A grant revoked well outside the audit window, and one still live. */
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("oauth_grants")
      .values([
        {
          id: revokedGrantId,
          user_id: userId,
          client_id: "retention-fixture",
          redirect_uri: "https://example.invalid/callback",
          revoked_at: daysAgo(400),
          updated_at: daysAgo(400),
        },
        {
          id: liveGrantId,
          user_id: userId,
          client_id: "retention-fixture",
          redirect_uri: "https://example.invalid/callback",
          revoked_at: null,
          updated_at: daysAgo(400),
        },
      ])
      .execute();

    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("oauth_refresh_tokens")
      .values([
        {
          id: revokedGrantTokenId,
          grant_id: revokedGrantId,
          client_id: "retention-fixture",
          resource_uri: "https://example.invalid/mcp",
          token_hash: "1".repeat(64),
          expires_at: daysAgo(1),
          revoked_at: daysAgo(400),
        },
        {
          id: liveGrantTokenId,
          grant_id: liveGrantId,
          client_id: "retention-fixture",
          resource_uri: "https://example.invalid/mcp",
          token_hash: "2".repeat(64),
          expires_at: daysAgo(-30),
          revoked_at: null,
        },
      ])
      .execute();
  });

  afterAll(async () => {
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("oauth_refresh_tokens")
      .where("id", "in", [revokedGrantTokenId, liveGrantTokenId])
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("oauth_grants")
      .where("id", "in", [revokedGrantId, liveGrantId])
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("stock_recognition_images")
      .where("id", "in", [deletedImageId, undeletedImageId])
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("stock_recognition_sessions")
      .where("id", "in", [closedSessionId, openSessionId, imageGateSessionId])
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("stock_capture_batches")
      .where("id", "in", [closedBatchId, openBatchId, imageGateBatchId])
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("users")
      .where("id", "=", userId)
      .execute();
    await migrator.destroy();
  });

  it("purges a closed batch, an image the worker confirmed deleted, and a revoked grant", async () => {
    await runRetention(migrator);

    const remainingBatches = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_capture_batches")
      .select("id")
      .where("id", "in", [closedBatchId, openBatchId, imageGateBatchId])
      .execute();

    /*
     * openBatchId survives because it is still Open; imageGateBatchId
     * survives because its session — and that session's restrict FK — is
     * still there, held up by the image below.
     */
    expect(new Set(remainingBatches.map((row) => row.id))).toEqual(
      new Set([openBatchId, imageGateBatchId]),
    );

    const remainingSessions = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_sessions")
      .select("id")
      .where("id", "in", [closedSessionId, openSessionId, imageGateSessionId])
      .execute();

    expect(remainingSessions.map((row) => row.id)).toEqual([imageGateSessionId]);

    const remainingImages = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("stock_recognition_images")
      .select("id")
      .where("id", "in", [deletedImageId, undeletedImageId])
      .execute();

    expect(remainingImages.map((row) => row.id)).toEqual([undeletedImageId]);

    const remainingGrants = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("oauth_grants")
      .select("id")
      .where("id", "in", [revokedGrantId, liveGrantId])
      .execute();

    expect(remainingGrants.map((row) => row.id)).toEqual([liveGrantId]);

    const remainingTokens = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("oauth_refresh_tokens")
      .select("id")
      .where("id", "in", [revokedGrantTokenId, liveGrantTokenId])
      .execute();

    expect(remainingTokens.map((row) => row.id)).toEqual([liveGrantTokenId]);
  });
});
