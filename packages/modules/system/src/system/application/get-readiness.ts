import type { ReadinessCheckResult, ReadinessResponse } from "@stockcontrol/contracts";

import type { Clock } from "../ports/clock";
import type { ReadinessCheck, ReadinessChecks } from "../ports/readiness-check";

const failedCheck = (check: ReadinessCheck, error: unknown): ReadinessCheckResult => ({
  name: check.name,
  status: "error",
  detail: error instanceof Error ? error.message : "Readiness check failed",
});

export class GetReadiness {
  public constructor(
    private readonly clock: Clock,
    private readonly checks: ReadinessChecks,
  ) {}

  public async execute(): Promise<ReadinessResponse> {
    const results = await Promise.all(
      this.checks
        .all()
        .map(async (check) => check.check().catch((error: unknown) => failedCheck(check, error))),
    );

    const sortedResults = [...results].sort((left, right) => left.name.localeCompare(right.name));
    const ready = sortedResults.every((result) => result.status === "ok");

    return {
      status: ready ? "ready" : "not_ready",
      timestamp: this.clock.now().toISOString(),
      checks: sortedResults,
    };
  }
}
