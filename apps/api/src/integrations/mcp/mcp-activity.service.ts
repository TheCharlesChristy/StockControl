import type {
  McpActivityListResponse,
  McpActivityQuery,
  McpConnectionListResponse,
  McpToolCallOutcome,
  UserRole,
} from "@stockcontrol/contracts";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely } from "kysely";

import type { OAuthService } from "./oauth.service";

const SCHEMA = "stockcontrol" as const;
const TERMINAL_EVENTS = ["Denied", "Succeeded", "Failed", "Interrupted"] as const;

export class McpActivityService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly oauth: OAuthService,
  ) {}

  public async list(
    viewer: { readonly id: string; readonly role: UserRole },
    query: McpActivityQuery,
  ): Promise<McpActivityListResponse> {
    const canSeeAll = viewer.role === "Office" || viewer.role === "Admin";
    const terminalEvent = sql<string>`(
      select event_type
      from stockcontrol.mcp_tool_call_events latest_event
      where latest_event.call_id = mcp_tool_calls.id
      order by latest_event.occurred_at desc, latest_event.id desc
      limit 1
    )`;
    const completedAt = sql<Date | null>`(
      (
        select occurred_at
        from stockcontrol.mcp_tool_call_events terminal_event
        where terminal_event.call_id = mcp_tool_calls.id
          and terminal_event.event_type in ('Denied', 'Succeeded', 'Failed', 'Interrupted')
        order by terminal_event.occurred_at desc, terminal_event.id desc
        limit 1
      )
    )`;
    const failureCode = sql<string | null>`(
      (
        select failure_code
        from stockcontrol.mcp_tool_call_events terminal_event
        where terminal_event.call_id = mcp_tool_calls.id
          and terminal_event.event_type in ('Denied', 'Succeeded', 'Failed', 'Interrupted')
        order by terminal_event.occurred_at desc, terminal_event.id desc
        limit 1
      )
    )`;
    const durationMs = sql<number | null>`(
      (
        select duration_ms
        from stockcontrol.mcp_tool_call_events terminal_event
        where terminal_event.call_id = mcp_tool_calls.id
          and terminal_event.event_type in ('Denied', 'Succeeded', 'Failed', 'Interrupted')
        order by terminal_event.occurred_at desc, terminal_event.id desc
        limit 1
      )
      )`;
    const actorUserId = sql<string | null>`coalesce(
      mcp_tool_calls.actor_user_id,
      (
        select actor_event.actor_user_id
        from stockcontrol.mcp_tool_call_events actor_event
        where actor_event.call_id = mcp_tool_calls.id
          and actor_event.actor_user_id is not null
        order by actor_event.occurred_at asc, actor_event.id asc
        limit 1
      )
    )`;
    const grantId = sql<string | null>`coalesce(
      mcp_tool_calls.oauth_grant_id,
      (
        select grant_event.oauth_grant_id
        from stockcontrol.mcp_tool_call_events grant_event
        where grant_event.call_id = mcp_tool_calls.id
          and grant_event.oauth_grant_id is not null
        order by grant_event.occurred_at asc, grant_event.id asc
        limit 1
      )
    )`;
    const actorName = sql<string | null>`(
      select activity_user.display_name
      from stockcontrol.users activity_user
      where activity_user.id = ${actorUserId}
      limit 1
    )`;
    const clientId = sql<string | null>`(
      select activity_grant.client_id
      from stockcontrol.oauth_grants activity_grant
      where activity_grant.id = ${grantId}
      limit 1
    )`;

    let selection = this.database
      .withSchema(SCHEMA)
      .selectFrom("mcp_tool_calls")
      .select([
        "mcp_tool_calls.id as id",
        "mcp_tool_calls.correlation_id as correlation_id",
        actorUserId.as("actor_user_id"),
        grantId.as("grant_id"),
        "mcp_tool_calls.tool_name as tool_name",
        "mcp_tool_calls.contract_version as contract_version",
        "mcp_tool_calls.operation as operation",
        "mcp_tool_calls.arguments as arguments",
        "mcp_tool_calls.action_summary as action_summary",
        "mcp_tool_calls.received_at as received_at",
        actorName.as("actor_name"),
        clientId.as("client_id"),
        terminalEvent.as("terminal_event"),
        completedAt.as("completed_at"),
        failureCode.as("failure_code"),
        durationMs.as("duration_ms"),
      ]);

    if (!canSeeAll) {
      selection = selection.where(actorUserId, "=", viewer.id);
    } else if (query.userId !== undefined) {
      selection = selection.where(actorUserId, "=", query.userId);
    }
    if (query.tool !== undefined && query.tool.trim().length > 0) {
      selection = selection.where("mcp_tool_calls.tool_name", "=", query.tool.trim().slice(0, 120));
    }
    if (query.operation !== undefined) {
      selection = selection.where("mcp_tool_calls.operation", "=", query.operation);
    }
    if (query.from !== undefined) {
      selection = selection.where("mcp_tool_calls.received_at", ">=", new Date(query.from));
    }
    if (query.to !== undefined) {
      selection = selection.where("mcp_tool_calls.received_at", "<=", new Date(query.to));
    }
    if (query.outcome === "Incomplete") {
      selection = selection.where(terminalEvent, "is", null);
    } else if (query.outcome !== undefined) {
      selection = selection.where(terminalEvent, "=", query.outcome);
    }

    const totalRow = await selection
      .clearSelect()
      .select((builder) => builder.fn.countAll<string>().as("total"))
      .executeTakeFirst();
    const rows = await selection
      .orderBy("mcp_tool_calls.received_at", "desc")
      .limit(query.limit ?? 50)
      .offset(query.offset ?? 0)
      .execute();

    const links = await this.linksFor(rows.map((row) => row.id));
    return {
      rows: rows.map((row) => ({
        id: row.id,
        correlationId: row.correlation_id,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        grantId: row.grant_id,
        clientId: row.client_id,
        toolName: row.tool_name,
        contractVersion: row.contract_version,
        operation: row.operation,
        outcome: terminalOutcome(row.terminal_event),
        arguments: row.arguments,
        actionSummary: row.action_summary,
        failureCode: row.failure_code,
        durationMs: row.duration_ms,
        effectLinks: links.get(row.id) ?? [],
        receivedAt: row.received_at.toISOString(),
        completedAt: row.completed_at?.toISOString() ?? null,
      })),
      total: Number(totalRow?.total ?? 0),
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    };
  }

  public async connections(viewer: {
    readonly id: string;
    readonly role: UserRole;
  }): Promise<McpConnectionListResponse> {
    if (viewer.role !== "Admin") {
      return { connections: await this.oauth.connectionsForUser(viewer.id) };
    }
    return { connections: await this.oauth.allConnections() };
  }

  private async linksFor(
    callIds: readonly string[],
  ): Promise<Map<string, readonly { type: string; id: string }[]>> {
    if (callIds.length === 0) {
      return new Map();
    }
    const rows = await this.database
      .withSchema(SCHEMA)
      .selectFrom("mcp_effect_links")
      .select(["call_id", "effect_type", "effect_id"])
      .where("call_id", "in", callIds)
      .orderBy("linked_at", "asc")
      .execute();
    const output = new Map<string, { type: string; id: string }[]>();
    for (const row of rows) {
      const current = output.get(row.call_id) ?? [];
      current.push({ type: row.effect_type, id: row.effect_id });
      output.set(row.call_id, current);
    }
    return output;
  }
}

const terminalOutcome = (event: string | null): McpToolCallOutcome | "Incomplete" => {
  return event !== null && (TERMINAL_EVENTS as readonly string[]).includes(event)
    ? (event as McpToolCallOutcome)
    : "Incomplete";
};
