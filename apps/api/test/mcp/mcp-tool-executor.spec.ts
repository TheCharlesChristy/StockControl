import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { McpToolExecutor, mcpToolDefinitions } from "../../src/integrations/mcp/mcp-tool-executor";
import type { McpConfiguration } from "../../src/integrations/mcp/mcp-configuration";
import type { McpCallHandle } from "../../src/integrations/mcp/mcp-audit.service";

const configuration = {
  enabled: false,
  readToolsEnabled: true,
  writeToolsEnabled: false,
} as McpConfiguration;

describe("MCP tool audit ordering", () => {
  it("publishes an output schema for every enabled tool", () => {
    const definitions = mcpToolDefinitions({
      enabled: true,
      readToolsEnabled: true,
      writeToolsEnabled: true,
    } as McpConfiguration);

    expect(definitions).not.toHaveLength(0);
    expect(definitions.every((definition) => definition.outputSchema.type === "object")).toBe(true);
    expect(
      definitions.find((definition) => definition.name === "search_items")?.outputSchema,
    ).toEqual(
      expect.objectContaining({
        required: ["rows", "total", "limit", "offset", "hasMore"],
      }),
    );
  });

  it("does not create audit rows for anonymous requests without credentials", async () => {
    const handle = {
      callId: "call-1",
      correlationId: "correlation-1",
      actorUserId: null,
      grantId: null,
      toolName: "search_items",
      contractVersion: "1.0",
      operation: "read",
      arguments: {},
      actionSummary: null,
      clientRequestId: null,
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
      argumentFingerprint: "fingerprint",
    } as McpCallHandle;
    const audit = {
      start: vi.fn().mockResolvedValue(handle),
      event: vi.fn().mockResolvedValue(undefined),
      failureFrom: vi.fn(),
    };
    const oauth = { resolveAccessToken: vi.fn().mockResolvedValue(null) };
    const correlation = { normalize: vi.fn().mockReturnValue("correlation-1") };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const executor = new McpToolExecutor({
      database: {} as never,
      audit: audit as never,
      oauth: oauth as never,
      configuration,
      dashboard: {} as never,
      catalogue: {} as never,
      stock: {} as never,
      jobs: {} as never,
      requests: {} as never,
      locations: {} as never,
      users: {} as never,
      photos: {} as never,
      mcpActivity: {} as never,
      correlation: correlation as never,
      logger: logger as never,
    });

    const result = await executor.execute(
      { headers: {} } as FastifyRequest,
      "search_items",
      { search: 42 },
      "request-1",
    );

    expect(result.error?.code).toBe("mcp.authentication_required");
    expect(audit.start).not.toHaveBeenCalled();
    expect(audit.event).not.toHaveBeenCalled();
  });

  it("retains malformed arguments after a credential is supplied", async () => {
    const handle = {
      callId: "call-2",
      correlationId: "correlation-1",
      actorUserId: null,
      grantId: null,
      toolName: "search_items",
      contractVersion: "1.0",
      operation: "read",
      arguments: {},
      actionSummary: null,
      clientRequestId: null,
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
      argumentFingerprint: "fingerprint",
    } as McpCallHandle;
    const audit = {
      start: vi.fn().mockResolvedValue(handle),
      event: vi.fn().mockResolvedValue(undefined),
      failureFrom: vi.fn(),
    };
    const oauth = { resolveAccessToken: vi.fn().mockResolvedValue(null) };
    const correlation = { normalize: vi.fn().mockReturnValue("correlation-1") };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const executor = new McpToolExecutor({
      database: {} as never,
      audit: audit as never,
      oauth: oauth as never,
      configuration,
      dashboard: {} as never,
      catalogue: {} as never,
      stock: {} as never,
      jobs: {} as never,
      requests: {} as never,
      locations: {} as never,
      users: {} as never,
      photos: {} as never,
      mcpActivity: {} as never,
      correlation: correlation as never,
      logger: logger as never,
    });

    const result = await executor.execute(
      { headers: { authorization: "Bearer malformed" } } as FastifyRequest,
      "search_items",
      { search: 42 },
      "request-1",
    );

    expect(result.error?.code).toBe("mcp.authentication_required");
    expect(audit.start).toHaveBeenCalledOnce();
  });

  /*
   * update_user and deactivate_user reach UsersService.updateInTransaction
   * directly, with nothing upstream of it playing the role
   * UsersController.update's own actor check used to. The self-protection
   * invariant now lives in that shared method instead (see
   * users.service.ts), so what this executor has to get right is passing
   * the *caller's* id as the actor — not the target's, not nothing at all —
   * so that method can tell a self-demotion apart from an ordinary one.
   */
  it.each(["update_user", "deactivate_user"] as const)(
    "attributes an MCP %s call to the authenticated caller, not the target",
    async (toolName) => {
      const actorId = "11111111-1111-4111-8111-111111111111";
      const targetId = "22222222-2222-4222-8222-222222222222";
      const handle = {
        callId: "call-write",
        correlationId: "correlation-write",
        actorUserId: null,
        grantId: null,
        toolName,
        contractVersion: "1.0",
        operation: "write",
        arguments: {},
        actionSummary: null,
        clientRequestId: null,
        receivedAt: new Date("2026-08-21T00:00:00.000Z"),
        argumentFingerprint: "fingerprint",
      } as McpCallHandle;
      const audit = {
        start: vi.fn().mockResolvedValue(handle),
        event: vi.fn().mockResolvedValue(undefined),
        failureFrom: vi.fn(),
        lockIdempotency: vi.fn().mockResolvedValue(undefined),
        findReceipt: vi.fn().mockResolvedValue(null),
        insertReceipt: vi.fn().mockResolvedValue(undefined),
        copyEffectLinks: vi.fn().mockResolvedValue(undefined),
        linkEffects: vi.fn().mockResolvedValue(undefined),
      };
      const principal = {
        grantId: "grant-1",
        clientId: "client-1",
        scopes: ["users:write"],
        user: {
          id: actorId,
          username: "admin.caller",
          email: null,
          displayName: "Admin Caller",
          role: "Admin",
        },
      };
      const oauth = { resolveAccessToken: vi.fn().mockResolvedValue(principal) };
      const correlation = { normalize: vi.fn().mockReturnValue("correlation-write") };
      const logger = { log: vi.fn(), warn: vi.fn() };
      const updateInTransaction = vi.fn().mockResolvedValue({ id: targetId });
      const database = {
        transaction: () => ({
          execute: (callback: (tx: unknown) => Promise<unknown>) => callback({}),
        }),
      };
      const executor = new McpToolExecutor({
        database: database as never,
        audit: audit as never,
        oauth: oauth as never,
        configuration: {
          enabled: true,
          readToolsEnabled: true,
          writeToolsEnabled: true,
        } as McpConfiguration,
        dashboard: {} as never,
        catalogue: {} as never,
        stock: {} as never,
        jobs: {} as never,
        requests: {} as never,
        locations: {} as never,
        users: { updateInTransaction } as never,
        photos: {} as never,
        mcpActivity: {} as never,
        correlation: correlation as never,
        logger: logger as never,
      });

      const result = await executor.execute(
        { headers: { authorization: "Bearer token" } } as FastifyRequest,
        toolName,
        {
          userId: targetId,
          actionSummary: "test",
          idempotencyKey: "key-1",
          ...(toolName === "update_user" ? { role: "Engineer" } : {}),
        },
        "request-write",
      );

      expect(result.isError, JSON.stringify(result)).toBe(false);
      expect(updateInTransaction).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        actorId,
        targetId,
        expect.anything(),
      );
    },
  );

  const writeHandle = (toolName: string): McpCallHandle => ({
    callId: "call-write",
    correlationId: "correlation-write",
    actorUserId: null,
    grantId: null,
    toolName,
    contractVersion: "1.0",
    operation: "write",
    arguments: {},
    actionSummary: null,
    clientRequestId: null,
    receivedAt: new Date("2026-08-21T00:00:00.000Z"),
    argumentFingerprint: "fingerprint",
  });

  const writeAudit = (): Readonly<Record<string, ReturnType<typeof vi.fn>>> => ({
    start: vi.fn(),
    event: vi.fn().mockResolvedValue(undefined),
    failureFrom: vi.fn(),
    lockIdempotency: vi.fn().mockResolvedValue(undefined),
    findReceipt: vi.fn().mockResolvedValue(null),
    insertReceipt: vi.fn().mockResolvedValue(undefined),
    copyEffectLinks: vi.fn().mockResolvedValue(undefined),
    linkEffects: vi.fn().mockResolvedValue(undefined),
  });

  it("never sends create_user a password to store", async () => {
    const actorId = "11111111-1111-4111-8111-111111111111";
    const handle = writeHandle("create_user");
    const audit = { ...writeAudit(), start: vi.fn().mockResolvedValue(handle) };
    const principal = {
      grantId: "grant-1",
      clientId: "client-1",
      scopes: ["users:write"],
      user: {
        id: actorId,
        username: "admin.caller",
        email: null,
        displayName: "Admin Caller",
        role: "Admin",
      },
    };
    const oauth = { resolveAccessToken: vi.fn().mockResolvedValue(principal) };
    const correlation = { normalize: vi.fn().mockReturnValue("correlation-write") };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const createInTransaction = vi.fn().mockResolvedValue({ id: "new-user-id" });
    const database = {
      transaction: () => ({
        execute: (callback: (tx: unknown) => Promise<unknown>) => callback({}),
      }),
    };
    const executor = new McpToolExecutor({
      database: database as never,
      audit: audit as never,
      oauth: oauth as never,
      configuration: {
        enabled: true,
        readToolsEnabled: true,
        writeToolsEnabled: true,
      } as McpConfiguration,
      dashboard: {} as never,
      catalogue: {} as never,
      stock: {} as never,
      jobs: {} as never,
      requests: {} as never,
      locations: {} as never,
      users: { createInTransaction } as never,
      photos: {} as never,
      mcpActivity: {} as never,
      correlation: correlation as never,
      logger: logger as never,
    });

    const result = await executor.execute(
      { headers: { authorization: "Bearer token" } } as FastifyRequest,
      "create_user",
      {
        username: "newuser",
        displayName: "New User",
        role: "Engineer",
        actionSummary: "test",
        idempotencyKey: "key-1",
      },
      "request-write",
    );

    expect(result.isError, JSON.stringify(result)).toBe(false);
    expect(createInTransaction).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      username: "newuser",
      displayName: "New User",
      role: "Engineer",
    });
  });

  /*
   * delete_item_photo removes the DB row inside the executor's own
   * transaction but must not delete the underlying object until that
   * transaction has actually committed — deleting it earlier and then having
   * the transaction roll back for an unrelated reason would restore a row
   * pointing at bytes that no longer exist.
   */
  it("deletes an item photo's storage object only after its transaction commits", async () => {
    const actorId = "11111111-1111-4111-8111-111111111111";
    const itemId = "22222222-2222-4222-8222-222222222222";
    const photoId = "33333333-3333-4333-8333-333333333333";
    const handle = writeHandle("delete_item_photo");
    const audit = { ...writeAudit(), start: vi.fn().mockResolvedValue(handle) };
    const principal = {
      grantId: "grant-1",
      clientId: "client-1",
      scopes: ["catalogue:write"],
      user: {
        id: actorId,
        username: "admin.caller",
        email: null,
        displayName: "Admin Caller",
        role: "Admin",
      },
    };
    const oauth = { resolveAccessToken: vi.fn().mockResolvedValue(principal) };
    const correlation = { normalize: vi.fn().mockReturnValue("correlation-write") };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const order: string[] = [];
    const deleteItemPhotoInTransaction = vi
      .fn()
      .mockResolvedValue({ item: { id: itemId }, objectKey: "item-photos/abc" });
    const deleteStoredObject = vi.fn().mockImplementation(() => {
      order.push("deleted");
    });
    const database = {
      transaction: () => ({
        execute: async (callback: (tx: unknown) => Promise<unknown>) => {
          const value = await callback({});
          order.push("committed");
          return value;
        },
      }),
    };
    const executor = new McpToolExecutor({
      database: database as never,
      audit: audit as never,
      oauth: oauth as never,
      configuration: {
        enabled: true,
        readToolsEnabled: true,
        writeToolsEnabled: true,
      } as McpConfiguration,
      dashboard: {} as never,
      catalogue: { deleteItemPhotoInTransaction } as never,
      stock: {} as never,
      jobs: {} as never,
      requests: {} as never,
      locations: {} as never,
      users: {} as never,
      photos: { deleteStoredObject } as never,
      mcpActivity: {} as never,
      correlation: correlation as never,
      logger: logger as never,
    });

    const result = await executor.execute(
      { headers: { authorization: "Bearer token" } } as FastifyRequest,
      "delete_item_photo",
      { itemId, photoId, actionSummary: "test", idempotencyKey: "key-1" },
      "request-write",
    );

    expect(result.isError, JSON.stringify(result)).toBe(false);
    expect(deleteStoredObject).toHaveBeenCalledExactlyOnceWith("item-photos/abc");
    expect(order).toEqual(["committed", "deleted"]);
  });

  /*
   * A connected client can only ever see its own MCP activity through this
   * tool, even when its StockControl role could otherwise see everyone's —
   * the tool's input schema has no userId field, so this has to be enforced
   * by the executor itself rather than left to the caller's request.
   */
  it("always scopes list_mcp_activity to the caller, regardless of role", async () => {
    const actorId = "11111111-1111-4111-8111-111111111111";
    const handle = {
      callId: "call-read",
      correlationId: "correlation-read",
      actorUserId: null,
      grantId: null,
      toolName: "list_mcp_activity",
      contractVersion: "1.0",
      operation: "read",
      arguments: {},
      actionSummary: null,
      clientRequestId: null,
      receivedAt: new Date("2026-08-21T00:00:00.000Z"),
      argumentFingerprint: "fingerprint",
    } as McpCallHandle;
    const audit = {
      start: vi.fn().mockResolvedValue(handle),
      event: vi.fn().mockResolvedValue(undefined),
      failureFrom: vi.fn(),
    };
    const principal = {
      grantId: "grant-1",
      clientId: "client-1",
      scopes: ["activity:read"],
      user: {
        id: actorId,
        username: "admin.caller",
        email: null,
        displayName: "Admin Caller",
        role: "Admin",
      },
    };
    const oauth = { resolveAccessToken: vi.fn().mockResolvedValue(principal) };
    const correlation = { normalize: vi.fn().mockReturnValue("correlation-read") };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const list = vi.fn().mockResolvedValue({ rows: [], total: 0, limit: 50, offset: 0 });
    const executor = new McpToolExecutor({
      database: {} as never,
      audit: audit as never,
      oauth: oauth as never,
      configuration: {
        enabled: true,
        readToolsEnabled: true,
        writeToolsEnabled: true,
      } as McpConfiguration,
      dashboard: {} as never,
      catalogue: {} as never,
      stock: {} as never,
      jobs: {} as never,
      requests: {} as never,
      locations: {} as never,
      users: {} as never,
      photos: {} as never,
      mcpActivity: { list } as never,
      correlation: correlation as never,
      logger: logger as never,
    });

    const result = await executor.execute(
      { headers: { authorization: "Bearer token" } } as FastifyRequest,
      "list_mcp_activity",
      {},
      "request-read",
    );

    expect(result.isError, JSON.stringify(result)).toBe(false);
    expect(list).toHaveBeenCalledExactlyOnceWith(
      { id: actorId, role: "Admin" },
      expect.objectContaining({ userId: actorId }),
    );
  });
});
