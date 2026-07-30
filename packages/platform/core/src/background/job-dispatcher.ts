import { performance } from "node:perf_hooks";

import type { BackgroundJobEnvelope, BackgroundJobResult } from "@stockcontrol/contracts";

import type { CorrelationContext } from "../observability/correlation-context";
import type { StructuredLogger } from "../observability/structured-logger";

export type BackgroundJobHandler<TPayload = unknown> = (
  job: BackgroundJobEnvelope<TPayload>,
) => Promise<void>;

export class UnknownBackgroundJobError extends Error {
  public constructor(jobType: string) {
    super(`No background job handler is registered for "${jobType}"`);
    this.name = "UnknownBackgroundJobError";
  }
}

export class BackgroundJobDispatcher {
  private readonly handlers = new Map<string, BackgroundJobHandler>();

  public constructor(
    private readonly context: CorrelationContext,
    private readonly logger: StructuredLogger,
  ) {}

  public register<TPayload>(type: string, handler: BackgroundJobHandler<TPayload>): void {
    if (this.handlers.has(type)) {
      throw new Error(`Background job handler "${type}" is already registered`);
    }

    this.handlers.set(type, handler as BackgroundJobHandler);
  }

  public async dispatch(job: BackgroundJobEnvelope): Promise<BackgroundJobResult> {
    const handler = this.handlers.get(job.type);

    if (handler === undefined) {
      throw new UnknownBackgroundJobError(job.type);
    }

    const correlationId = this.context.normalize(job.correlationId);

    return this.context.run(correlationId, async () => {
      const startedAt = performance.now();
      this.logger.log({
        event: "background_job.started",
        jobId: job.id,
        jobType: job.type,
        attempt: job.attempt,
      });

      try {
        await handler(job);
        const result: BackgroundJobResult = {
          jobId: job.id,
          type: job.type,
          outcome: "completed",
          durationMilliseconds: performance.now() - startedAt,
        };
        this.logger.log({ event: "background_job.completed", ...result });
        return result;
      } catch (error: unknown) {
        this.logger.error({
          event: "background_job.failed",
          jobId: job.id,
          jobType: job.type,
          attempt: job.attempt,
          durationMilliseconds: performance.now() - startedAt,
          error,
        });
        throw error;
      }
    });
  }
}
