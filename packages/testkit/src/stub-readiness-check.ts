import type { ReadinessCheckResult, ReadinessCheckStatus } from "@stockcontrol/contracts";
import type { ReadinessCheck } from "@stockcontrol/module-system";

export class StubReadinessCheck implements ReadinessCheck {
  public constructor(
    public readonly name: string,
    private readonly status: ReadinessCheckStatus = "ok",
    private readonly detail?: string,
  ) {}

  public async check(): Promise<ReadinessCheckResult> {
    const result: ReadinessCheckResult = {
      name: this.name,
      status: this.status,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };

    return Promise.resolve(result);
  }
}
