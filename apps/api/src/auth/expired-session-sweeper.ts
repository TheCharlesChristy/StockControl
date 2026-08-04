import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";

import type { StructuredLogger } from "@stockcontrol/platform";

import type { SessionService } from "./session-service";

const DEFAULT_INTERVAL_MILLISECONDS = 60 * 60 * 1_000;

/**
 * Deletes sessions that have already expired. Nothing else does: the API is the
 * only process a production installation runs, the heartbeat worker is
 * deliberately not deployed, and an expired row is only ignored at sign-in
 * rather than removed. Without this the table grows for the life of the
 * installation and keeps a record of every session ever issued.
 */
export class ExpiredSessionSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly sessions: SessionService,
    private readonly logger: StructuredLogger,
    private readonly intervalMilliseconds: number = DEFAULT_INTERVAL_MILLISECONDS,
  ) {}

  public onApplicationBootstrap(): void {
    void this.sweep();

    this.timer = setInterval(() => {
      void this.sweep();
    }, this.intervalMilliseconds);

    /* A pending sweep must never be the reason a deployment fails to drain. */
    this.timer.unref();
  }

  public onApplicationShutdown(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * A failed sweep is reported and forgotten. The database being briefly
   * unreachable is not a reason to fail a request the user is waiting on, and
   * the next interval will retry.
   */
  public async sweep(): Promise<void> {
    try {
      const deleted = await this.sessions.deleteExpired();

      if (deleted > 0) {
        this.logger.log({ event: "auth.sessions.pruned", deleted });
      }
    } catch (error: unknown) {
      /*
       * The label only. StructuredLogger expands an Error into its name,
       * message and stack, and the failure this most often catches is pg
       * refusing a connection — whose message carries the connection string,
       * and so the runtime role's password.
       */
      this.logger.warn({
        event: "auth.sessions.prune_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
