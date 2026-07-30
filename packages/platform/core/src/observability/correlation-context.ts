import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

interface RequestContext {
  readonly correlationId: string;
}

const VALID_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export class CorrelationContext {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  public run<TResult>(correlationId: string, callback: () => TResult): TResult {
    return this.storage.run({ correlationId }, callback);
  }

  public currentId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  public createId(): string {
    return randomUUID();
  }

  public normalize(candidate: unknown): string {
    if (typeof candidate === "string" && VALID_CORRELATION_ID.test(candidate)) {
      return candidate;
    }

    return this.createId();
  }
}
