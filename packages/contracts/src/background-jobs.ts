export interface BackgroundJobEnvelope<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: TPayload;
  readonly attempt: number;
  readonly createdAt: string;
  readonly correlationId?: string;
}

export interface BackgroundJobResult {
  readonly jobId: string;
  readonly type: string;
  readonly outcome: "completed" | "failed";
  readonly durationMilliseconds: number;
}
