import type { ReadinessCheck, ReadinessChecks } from "@stockcontrol/module-system";

export class ReadinessRegistry implements ReadinessChecks {
  private readonly checks = new Map<string, ReadinessCheck>();

  public register(check: ReadinessCheck): void {
    if (this.checks.has(check.name)) {
      throw new Error(`Readiness check "${check.name}" is already registered`);
    }

    this.checks.set(check.name, check);
  }

  public all(): readonly ReadinessCheck[] {
    return [...this.checks.values()];
  }
}
