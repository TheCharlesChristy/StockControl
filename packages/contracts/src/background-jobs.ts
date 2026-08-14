export interface BackgroundJobEnvelope<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: TPayload;
  readonly attempt: number;
  /**
   * How many attempts this job is allowed in total. It travels with `attempt`
   * because on its own `attempt` cannot answer the question a handler actually
   * has to ask before it throws: is another go coming, or is this the last one
   * and does something need to be told so before the queue gives up?
   */
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly correlationId?: string;
}

export interface BackgroundJobResult {
  readonly jobId: string;
  readonly type: string;
  readonly outcome: "completed" | "failed";
  readonly durationMilliseconds: number;
}
