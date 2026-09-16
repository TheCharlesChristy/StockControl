import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import type { StockControlDatabase } from "@stockcontrol/platform-database";
import type { StructuredLogger } from "@stockcontrol/platform";
import type { Kysely } from "kysely";

import type { McpAuditService } from "./mcp-audit.service";

const SCHEMA = "stockcontrol" as const;

/**
 * Makes abandoned calls visible. This is intentionally idempotent: the
 * append-only event index may contain more than one reconciliation attempt,
 * but the query only claims calls with no terminal event.
 */
const RECONCILIATION_INTERVAL_MILLISECONDS = 60 * 1_000;

export class McpReconciliationJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly audit: McpAuditService,
    private readonly now: () => Date = () => new Date(),
    private readonly abandonedCallSeconds = 300,
    private readonly logger?: StructuredLogger,
    private readonly enabled = true,
    private readonly isInFlight: (callId: string) => boolean = () => false,
  ) {}

  public onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), RECONCILIATION_INTERVAL_MILLISECONDS);
    this.timer.unref();
  }

  public onApplicationShutdown(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async run(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const interrupted = await this.reconcile(this.abandonedCallSeconds);
      if (interrupted > 0) {
        this.logger?.log({ event: "mcp.calls.reconciled", interrupted });
      }
    } catch (error: unknown) {
      this.logger?.warn({
        event: "mcp.calls.reconcile_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  public async reconcile(abandonedCallSeconds: number): Promise<number> {
    const cutoff = new Date(this.now().getTime() - abandonedCallSeconds * 1_000);
    const calls = await this.database
      .withSchema(SCHEMA)
      .selectFrom("mcp_tool_calls")
      .select(["id", "received_at"])
      .where("received_at", "<=", cutoff)
      .where((builder) =>
        builder.not(
          builder.exists(
            builder
              .selectFrom("mcp_tool_call_events")
              .select("id")
              .whereRef("mcp_tool_call_events.call_id", "=", "mcp_tool_calls.id")
              .where("event_type", "in", ["Denied", "Succeeded", "Failed", "Interrupted"]),
          ),
        ),
      )
      .execute();

    let interrupted = 0;
    for (const call of calls) {
      if (this.isInFlight(call.id)) continue;
      if (
        await this.audit.eventIfIncomplete(call.id, {
          failureCode: "mcp.timeout",
          durationMs: this.now().getTime() - call.received_at.getTime(),
          resultSummary: { outcome: "interrupted" },
        })
      )
        interrupted += 1;
    }

    return interrupted;
  }
}
