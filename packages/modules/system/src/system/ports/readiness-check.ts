import type { ReadinessCheckResult } from "@stockcontrol/contracts";

export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<ReadinessCheckResult>;
}

export interface ReadinessChecks {
  all(): readonly ReadinessCheck[];
}
