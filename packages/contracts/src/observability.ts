export const CORRELATION_ID_HEADER = "x-correlation-id";

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly code: string;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}
