import { randomUUID } from "node:crypto";

import {
  createMigratorDatabase,
  createRuntimeDatabase,
  loadMigrationDatabaseRoles,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
  runMigrations,
  STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { McpActivityService } from "../../src/integrations/mcp/mcp-activity.service";
import { McpAuditService, type McpCallHandle } from "../../src/integrations/mcp/mcp-audit.service";
import { McpReconciliationJob } from "../../src/integrations/mcp/mcp-reconciliation";

const clientId = "mcp-persistence-integration-client";
const redirectUri = "https://chatgpt.example/oauth/callback";
const resourceUri = "https://stockcontrol.example/mcp";

describe.sequential("MCP persistence against PostgreSQL", () => {
  let migrator: Kysely<StockControlDatabase>;
  let runtime: Kysely<StockControlDatabase>;
  let audit: McpAuditService;
  let activity: McpActivityService;
  let currentTime = Date.parse("2026-08-22T00:00:00.000Z");
  const userIds = [randomUUID(), randomUUID(), randomUUID()];
  const grantIds = [randomUUID(), randomUUID()];
  const callIds: string[] = [];

  const schema = (): Kysely<StockControlDatabase> => migrator.withSchema(STOCKCONTROL_SCHEMA);

  const createCall = async (
    userId: string | null,
    grantId: string | null,
    toolName: string,
  ): Promise<McpCallHandle> => {
    const handle = await audit.start({
      callId: randomUUID(),
      correlationId: randomUUID(),
      actorUserId: null,
      grantId: null,
      toolName,
      contractVersion: "1.1",
      operation: "read",
      arguments: { search: toolName },
      actionSummary: null,
      clientRequestId: null,
    });
    callIds.push(handle.callId);
    if (userId !== null) {
      await audit.event(handle.callId, "Authorised", { actorUserId: userId, grantId });
    }
    return handle;
  };

  beforeAll(async () => {
    const migratorConfiguration = loadMigratorDatabaseConfiguration();
    const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
    const { runtimeRole } = loadMigrationDatabaseRoles(
      process.env,
      migratorConfiguration.connectionString,
    );
    migrator = createMigratorDatabase(migratorConfiguration);
    await runMigrations(migrator, { runtimeRole });
    runtime = createRuntimeDatabase(runtimeConfiguration);
    audit = new McpAuditService(runtime, () => new Date(currentTime));
    activity = new McpActivityService(runtime, {} as never);

    await schema()
      .insertInto("users")
      .values([
        {
          id: userIds[0] as string,
          username: `mcp.audit.${process.pid}.${Date.now()}`,
          email: null,
          display_name: "MCP audit user",
          role: "Engineer",
          password_hash: "unused",
          is_active: true,
        },
        {
          id: userIds[1] as string,
          username: `mcp.activity.${process.pid}.${Date.now()}`,
          email: null,
          display_name: "MCP activity user",
          role: "Engineer",
          password_hash: "unused",
          is_active: true,
        },
        {
          id: userIds[2] as string,
          username: `mcp.admin.${process.pid}.${Date.now()}`,
          email: null,
          display_name: "MCP admin user",
          role: "Admin",
          password_hash: "unused",
          is_active: true,
        },
      ])
      .execute();

    await schema()
      .insertInto("oauth_grants")
      .values(
        grantIds.map((id, index) => ({
          id,
          user_id: userIds[index] as string,
          client_id: clientId,
          redirect_uri: redirectUri,
          resource_uri: resourceUri,
          granted_scopes: JSON.stringify(["stock:read"]),
          authorization_code_hash: null,
          authorization_code_challenge: null,
          authorization_code_method: null,
          authorization_code_expires_at: null,
          authorization_code_used_at: null,
          access_token_hash: null,
          access_token_expires_at: null,
          refresh_token_hash: null,
          refresh_token_expires_at: null,
          revoked_at: null,
        })),
      )
      .execute();
  });

  afterAll(async () => {
    if (callIds.length > 0) {
      await schema().deleteFrom("mcp_effect_links").where("call_id", "in", callIds).execute();
      await schema().deleteFrom("mcp_command_receipts").where("call_id", "in", callIds).execute();
      await schema().deleteFrom("mcp_tool_call_events").where("call_id", "in", callIds).execute();
      await schema().deleteFrom("mcp_tool_calls").where("id", "in", callIds).execute();
    }
    await schema().deleteFrom("oauth_grants").where("id", "in", grantIds).execute();
    await schema().deleteFrom("users").where("id", "in", userIds).execute();
    await runtime.destroy();
    await migrator.destroy();
  });

  it("scopes activity, pages it, and identifies incomplete calls by terminal events", async () => {
    currentTime = Date.parse("2026-08-22T00:00:00.000Z");
    const incomplete = await createCall(
      userIds[0] as string,
      grantIds[0] as string,
      "search_items",
    );

    currentTime += 60_000;
    const succeeded = await createCall(userIds[1] as string, grantIds[1] as string, "list_jobs");
    await audit.event(succeeded.callId, "Succeeded", {
      actorUserId: userIds[1],
      grantId: grantIds[1],
      resultSummary: { outcome: "succeeded" },
    });

    currentTime += 60_000;
    const terminalWithLaterEvent = await createCall(
      userIds[0] as string,
      grantIds[0] as string,
      "list_locations",
    );
    await audit.event(terminalWithLaterEvent.callId, "Succeeded", {
      actorUserId: userIds[0],
      grantId: grantIds[0],
      resultSummary: { outcome: "succeeded" },
    });
    // A non-terminal event after success must not turn the call back into
    // Incomplete. This is the regression the terminal-event subquery protects.
    await audit.event(terminalWithLaterEvent.callId, "Authorised", {
      actorUserId: userIds[0],
      grantId: grantIds[0],
    });

    const adminPage = await activity.list(
      { id: userIds[2] as string, role: "Admin" },
      { limit: 1, offset: 1 },
    );
    expect(adminPage.total).toBe(3);
    expect(adminPage.rows).toHaveLength(1);

    const incompletePage = await activity.list(
      { id: userIds[2] as string, role: "Admin" },
      { outcome: "Incomplete", limit: 10, offset: 0 },
    );
    expect(incompletePage.rows.map((row) => row.id)).toEqual([incomplete.callId]);

    const engineerPage = await activity.list(
      { id: userIds[0] as string, role: "Engineer" },
      { limit: 10, offset: 0 },
    );
    expect(engineerPage.rows).toHaveLength(2);
    expect(engineerPage.rows.every((row) => row.actorUserId === userIds[0])).toBe(true);

    const filtered = await activity.list(
      { id: userIds[2] as string, role: "Admin" },
      {
        userId: userIds[1] as string,
        from: new Date(currentTime - 60_000).toISOString(),
        limit: 10,
        offset: 0,
      },
    );
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]?.actorUserId).toBe(userIds[1]);

    // Leave the next test with only the calls it deliberately creates for
    // reconciliation; this call has already served its incomplete-filter assertion.
    await audit.event(incomplete.callId, "Denied", {
      actorUserId: userIds[0],
      grantId: grantIds[0],
      failureCode: "test.complete",
    });
  });

  it("serializes concurrent idempotency retries and returns the original receipt", async () => {
    currentTime += 60_000;
    const call = await createCall(userIds[0] as string, grantIds[0] as string, "receive_stock");
    const receipt = {
      actorUserId: userIds[0] as string,
      toolName: "receive_stock",
      idempotencyKey: `integration-${call.callId}`,
      requestFingerprint: "a".repeat(64),
      callId: call.callId,
      result: { itemId: randomUUID(), transactionId: randomUUID(), reservationId: null },
    };
    let firstLockAcquired: (() => void) | undefined;
    const firstReady = new Promise<void>((resolve) => {
      firstLockAcquired = resolve;
    });
    let releaseFirst: (() => void) | undefined;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runtime.transaction().execute(async (tx) => {
      await audit.lockIdempotency(
        tx,
        receipt.actorUserId,
        receipt.toolName,
        receipt.idempotencyKey,
      );
      firstLockAcquired?.();
      await firstReleased;
      await audit.insertReceipt(tx, receipt);
    });
    await firstReady;
    const retry = runtime.transaction().execute(async (tx) => {
      await audit.lockIdempotency(
        tx,
        receipt.actorUserId,
        receipt.toolName,
        receipt.idempotencyKey,
      );
      return audit.findReceipt(tx, receipt.actorUserId, receipt.toolName, receipt.idempotencyKey);
    });
    releaseFirst?.();

    const [, prior] = await Promise.all([first, retry]);
    expect(prior?.callId).toBe(call.callId);
    expect(prior?.requestFingerprint).toBe(receipt.requestFingerprint);
    await audit.event(call.callId, "Succeeded", {
      actorUserId: userIds[0],
      grantId: grantIds[0],
      resultSummary: { outcome: "succeeded" },
    });
  });

  it("reconciles abandoned calls without creating a second terminal event", async () => {
    currentTime += 60_000;
    const abandoned = await createCall(userIds[0] as string, grantIds[0] as string, "search_items");
    const reconciliationNow = currentTime + 10 * 60_000;
    const job = new McpReconciliationJob(
      runtime,
      audit,
      () => new Date(reconciliationNow),
      300,
      undefined,
      true,
      () => false,
    );

    expect(await job.reconcile(300)).toBe(1);

    const race = await createCall(userIds[0] as string, grantIds[0] as string, "search_items");
    currentTime = reconciliationNow;
    await Promise.all([
      audit.event(race.callId, "Succeeded", {
        actorUserId: userIds[0],
        grantId: grantIds[0],
      }),
      audit.eventIfIncomplete(race.callId, {
        failureCode: "mcp.timeout",
        resultSummary: { outcome: "interrupted" },
      }),
    ]);

    const terminalEvents = await runtime
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("mcp_tool_call_events")
      .select("event_type")
      .where("call_id", "=", race.callId)
      .where("event_type", "in", ["Denied", "Succeeded", "Failed", "Interrupted"])
      .execute();
    expect(terminalEvents).toHaveLength(1);
    expect(["Succeeded", "Interrupted"]).toContain(terminalEvents[0]?.event_type);

    const abandonedEvents = await runtime
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("mcp_tool_call_events")
      .select("event_type")
      .where("call_id", "=", abandoned.callId)
      .where("event_type", "=", "Interrupted")
      .execute();
    expect(abandonedEvents).toHaveLength(1);
  });
});
