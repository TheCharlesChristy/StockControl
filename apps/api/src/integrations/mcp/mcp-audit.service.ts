import { randomUUID } from "node:crypto";

import type {
  McpOperation,
  McpToolCallEventType,
  StockControlDatabase,
} from "@stockcontrol/platform-database";
import {
  internalFailure,
  isApplicationFailure,
  type ApplicationFailure,
} from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import { sql, type Kysely, type Transaction } from "kysely";

import { canonicalJson, safeJsonObject, sha256 } from "./mcp-utils";

const SCHEMA = "stockcontrol" as const;
const databaseFor = (
  database: Kysely<StockControlDatabase> | Transaction<StockControlDatabase>,
): Kysely<StockControlDatabase> | Transaction<StockControlDatabase> => database.withSchema(SCHEMA);

const isTerminalEvent = (eventType: McpToolCallEventType): boolean =>
  eventType === "Denied" ||
  eventType === "Succeeded" ||
  eventType === "Failed" ||
  eventType === "Interrupted";

export interface StartMcpCallInput {
  readonly callId: string;
  readonly correlationId: string;
  readonly actorUserId: string | null;
  readonly grantId: string | null;
  readonly toolName: string;
  readonly contractVersion: string;
  readonly operation: McpOperation;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly actionSummary: string | null;
  readonly clientRequestId: string | null;
}

export interface McpCallHandle extends StartMcpCallInput {
  readonly receivedAt: Date;
  readonly argumentFingerprint: string;
}

export interface McpEventResult {
  readonly actorUserId?: string | null | undefined;
  readonly grantId?: string | null | undefined;
  readonly failureCode?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly resultSummary?: Readonly<Record<string, unknown>> | undefined;
  readonly recordCount?: number | undefined;
  readonly recordTypes?: readonly string[] | undefined;
  readonly responseDigest?: string | undefined;
}

export interface McpEffectLinkInput {
  readonly type: "transaction" | "reservation" | "request" | "job" | "item" | "location";
  readonly id: string;
}

export interface McpCommandReceipt {
  readonly id: string;
  readonly callId: string;
  readonly requestFingerprint: string;
  readonly result: Readonly<Record<string, unknown>>;
}

export class McpAuditService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The only entry point that starts a call. Failure is deliberately thrown. */
  public async start(input: StartMcpCallInput): Promise<McpCallHandle> {
    const receivedAt = this.now();
    const argumentsJson = canonicalJson(safeJsonObject(input.arguments));
    const argumentFingerprint = sha256(argumentsJson);
    await databaseFor(this.database)
      .insertInto("mcp_tool_calls")
      .values({
        id: input.callId,
        correlation_id: input.correlationId,
        actor_user_id: input.actorUserId,
        oauth_grant_id: input.grantId,
        tool_name: input.toolName,
        contract_version: input.contractVersion,
        operation: input.operation,
        arguments: argumentsJson,
        arguments_sha256: argumentFingerprint,
        action_summary: input.actionSummary,
        client_request_id: input.clientRequestId,
        received_at: receivedAt,
      })
      .execute();
    await this.event(input.callId, "Received", {});
    return { ...input, receivedAt, argumentFingerprint };
  }

  public async event(
    callId: string,
    eventType: McpToolCallEventType,
    result: McpEventResult,
    database: Kysely<StockControlDatabase> | Transaction<StockControlDatabase> = this.database,
  ): Promise<void> {
    if (isTerminalEvent(eventType)) {
      if (database === this.database) {
        await this.database
          .transaction()
          .execute((tx) => this.insertTerminalEvent(tx, callId, eventType, result));
        return;
      }
      await this.insertTerminalEvent(database, callId, eventType, result);
      return;
    }

    await databaseFor(database)
      .insertInto("mcp_tool_call_events")
      .values({
        id: randomUUID(),
        call_id: callId,
        actor_user_id: result.actorUserId ?? null,
        oauth_grant_id: result.grantId ?? null,
        event_type: eventType,
        occurred_at: this.now(),
        failure_code: result.failureCode ?? null,
        duration_ms: result.durationMs ?? null,
        result_summary: JSON.stringify(safeJsonObject(result.resultSummary ?? {})),
        record_count: result.recordCount ?? null,
        record_types: JSON.stringify((result.recordTypes ?? []).slice(0, 50)),
        response_digest: result.responseDigest ?? null,
      })
      .execute()
      .then(() => undefined);
  }

  private async insertTerminalEvent(
    database: Kysely<StockControlDatabase> | Transaction<StockControlDatabase>,
    callId: string,
    eventType: McpToolCallEventType,
    result: McpEventResult,
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${callId}, 0))`.execute(database);
    const existing = await databaseFor(database)
      .selectFrom("mcp_tool_call_events")
      .select("id")
      .where("call_id", "=", callId)
      .where("event_type", "in", ["Denied", "Succeeded", "Failed", "Interrupted"])
      .executeTakeFirst();
    if (existing !== undefined) return;
    await databaseFor(database)
      .insertInto("mcp_tool_call_events")
      .values({
        id: randomUUID(),
        call_id: callId,
        actor_user_id: result.actorUserId ?? null,
        oauth_grant_id: result.grantId ?? null,
        event_type: eventType,
        occurred_at: this.now(),
        failure_code: result.failureCode ?? null,
        duration_ms: result.durationMs ?? null,
        result_summary: JSON.stringify(safeJsonObject(result.resultSummary ?? {})),
        record_count: result.recordCount ?? null,
        record_types: JSON.stringify((result.recordTypes ?? []).slice(0, 50)),
        response_digest: result.responseDigest ?? null,
      })
      .execute();
  }

  public async eventIfIncomplete(callId: string, result: McpEventResult): Promise<boolean> {
    return this.database.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${callId}, 0))`.execute(tx);
      const existing = await tx
        .withSchema(SCHEMA)
        .selectFrom("mcp_tool_call_events")
        .select("id")
        .where("call_id", "=", callId)
        .where("event_type", "in", ["Denied", "Succeeded", "Failed", "Interrupted"])
        .executeTakeFirst();
      if (existing !== undefined) return false;
      await this.event(callId, "Interrupted", result, tx);
      return true;
    });
  }

  public async fail(
    handle: McpCallHandle,
    eventType: "Denied" | "Failed" | "Interrupted",
    failure: unknown,
  ): Promise<ApplicationFailure> {
    const safeFailure = this.failureFrom(failure);
    await this.event(handle.callId, eventType, {
      failureCode: safeFailure.code,
      durationMs: this.now().getTime() - handle.receivedAt.getTime(),
      resultSummary: { outcome: eventType.toLowerCase() },
    });
    return safeFailure;
  }

  public failureFrom(error: unknown): ApplicationFailure {
    if (error instanceof ApplicationFailureException) {
      return error.failure;
    }
    if (isApplicationFailure(error)) {
      return error;
    }
    return internalFailure(error instanceof Error ? error.name : undefined);
  }

  public static resultSummary(value: unknown): {
    readonly recordCount: number;
    readonly recordTypes: readonly string[];
    readonly responseDigest: string;
    readonly resultSummary: Readonly<Record<string, unknown>>;
  } {
    const safe = safeJsonObject(value);
    const arrays = Object.entries(safe).filter(([, entry]) => Array.isArray(entry));
    const recordCount = arrays.reduce(
      (total, [, entry]) => total + (Array.isArray(entry) ? entry.length : 0),
      0,
    );
    return {
      recordCount,
      recordTypes: arrays.map(([key]) => key),
      responseDigest: sha256(canonicalJson(safe)),
      resultSummary: {
        keys: Object.keys(safe).slice(0, 50),
        recordCount,
      },
    };
  }

  public static compactWriteResult(value: unknown): Readonly<Record<string, unknown>> {
    const safe = safeJsonObject(value);
    const entries: [string, string][] = [];
    for (const key of ["transactionId", "reservationId", "requestId", "itemId", "jobId", "id"]) {
      if (typeof safe[key] === "string") {
        entries.push([key, safe[key]]);
      }
    }
    for (const [container, idKey] of [
      ["item", "itemId"],
      ["request", "requestId"],
    ] as const) {
      const nested = safe[container];
      if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
        const nestedId = (nested as Readonly<Record<string, unknown>>)["id"];
        if (typeof nestedId === "string") {
          entries.push([idKey, nestedId]);
        }
      }
    }
    return Object.fromEntries(entries);
  }

  public async findReceipt(
    database: Kysely<StockControlDatabase> | Transaction<StockControlDatabase>,
    actorUserId: string,
    toolName: string,
    idempotencyKey: string,
  ): Promise<McpCommandReceipt | null> {
    const row = await databaseFor(database)
      .selectFrom("mcp_command_receipts")
      .select(["id", "call_id", "request_fingerprint", "result"])
      .where("actor_user_id", "=", actorUserId)
      .where("tool_name", "=", toolName)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    return row === undefined
      ? null
      : {
          id: row.id,
          callId: row.call_id,
          requestFingerprint: row.request_fingerprint,
          result: row.result,
        };
  }

  public async lockIdempotency(
    database: Transaction<StockControlDatabase>,
    actorUserId: string,
    toolName: string,
    idempotencyKey: string,
  ): Promise<void> {
    const lockKey = `${actorUserId}\0${toolName}\0${idempotencyKey}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(database);
  }

  public async insertReceipt(
    database: Transaction<StockControlDatabase>,
    input: {
      readonly actorUserId: string;
      readonly toolName: string;
      readonly idempotencyKey: string;
      readonly requestFingerprint: string;
      readonly callId: string;
      readonly result: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    const resultJson = canonicalJson(safeJsonObject(input.result));
    await databaseFor(database)
      .insertInto("mcp_command_receipts")
      .values({
        id: randomUUID(),
        actor_user_id: input.actorUserId,
        tool_name: input.toolName,
        idempotency_key: input.idempotencyKey,
        request_fingerprint: input.requestFingerprint,
        call_id: input.callId,
        result: resultJson,
        result_digest: sha256(resultJson),
        committed_at: this.now(),
      })
      .execute();
  }

  public async linkEffects(
    database: Transaction<StockControlDatabase>,
    callId: string,
    effects: readonly McpEffectLinkInput[],
  ): Promise<void> {
    for (const effect of effects) {
      await databaseFor(database)
        .insertInto("mcp_effect_links")
        .values({
          id: randomUUID(),
          call_id: callId,
          effect_type: effect.type,
          effect_id: effect.id,
        })
        .onConflict((conflict) =>
          conflict.columns(["call_id", "effect_type", "effect_id"]).doNothing(),
        )
        .execute();
    }
  }

  public async copyEffectLinks(
    database: Transaction<StockControlDatabase>,
    sourceCallId: string,
    targetCallId: string,
  ): Promise<void> {
    const links = await databaseFor(database)
      .selectFrom("mcp_effect_links")
      .select(["effect_type", "effect_id"])
      .where("call_id", "=", sourceCallId)
      .execute();
    await this.linkEffects(
      database,
      targetCallId,
      links.map((link) => ({
        type: link.effect_type as McpEffectLinkInput["type"],
        id: link.effect_id,
      })),
    );
  }
}

export class McpAuditUnavailableException extends ApplicationFailureException {
  public constructor() {
    super(internalFailure());
  }
}
