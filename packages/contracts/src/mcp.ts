import type { PagedResult } from "./inventory";

export const mcpToolCallOutcomes = ["Succeeded", "Denied", "Failed", "Interrupted"] as const;
export type McpToolCallOutcome = (typeof mcpToolCallOutcomes)[number];

export type McpOperation = "read" | "write";

export interface McpEffectLinkView {
  readonly type: string;
  readonly id: string;
}

export interface McpToolCallView {
  readonly id: string;
  readonly correlationId: string;
  readonly actorUserId: string | null;
  readonly actorName: string | null;
  readonly grantId: string | null;
  readonly clientId: string | null;
  readonly toolName: string;
  readonly contractVersion: string;
  readonly operation: McpOperation;
  readonly outcome: McpToolCallOutcome | "Incomplete";
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly actionSummary: string | null;
  readonly failureCode: string | null;
  readonly durationMs: number | null;
  readonly effectLinks: readonly McpEffectLinkView[];
  readonly receivedAt: string;
  readonly completedAt: string | null;
}

export type McpActivityListResponse = PagedResult<McpToolCallView>;

export interface McpActivityQuery {
  readonly from?: string;
  readonly to?: string;
  readonly userId?: string;
  readonly tool?: string;
  readonly outcome?: McpToolCallOutcome | "Incomplete";
  readonly operation?: McpOperation;
  readonly limit?: number;
  readonly offset?: number;
}

export interface McpConnectionView {
  readonly id: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface McpConnectionListResponse {
  readonly connections: readonly McpConnectionView[];
}
