import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import type { StructuredLogger } from "@stockcontrol/platform";

import type { OAuthService } from "./oauth.service";

const DEFAULT_INTERVAL_MILLISECONDS = 15 * 60 * 1_000;

/** Keeps short-lived OAuth consent state from accumulating indefinitely. */
export class OAuthAuthorizationRequestSweeper
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly oauth: OAuthService,
    private readonly logger: StructuredLogger,
    private readonly intervalMilliseconds: number = DEFAULT_INTERVAL_MILLISECONDS,
  ) {}

  public onApplicationBootstrap(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.intervalMilliseconds);
    this.timer.unref();
  }

  public onApplicationShutdown(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public async sweep(): Promise<void> {
    try {
      const deleted = await this.oauth.deleteExpiredAuthorizationRequests();
      if (deleted > 0) {
        this.logger.log({ event: "mcp.oauth_authorization_requests.pruned", deleted });
      }
    } catch (error: unknown) {
      this.logger.warn({
        event: "mcp.oauth_authorization_requests.prune_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
