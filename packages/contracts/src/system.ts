export const API_V1_PREFIX = "api/v1";

export interface LivenessResponse {
  readonly status: "ok";
  readonly timestamp: string;
  readonly uptimeSeconds: number;
}

export type ReadinessCheckStatus = "ok" | "error";

export interface ReadinessCheckResult {
  readonly name: string;
  readonly status: ReadinessCheckStatus;
  readonly detail?: string;
}

export interface ReadinessResponse {
  readonly status: "ready" | "not_ready";
  readonly timestamp: string;
  readonly checks: readonly ReadinessCheckResult[];
}

export interface VersionResponse {
  readonly service: string;
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string | null;
}
