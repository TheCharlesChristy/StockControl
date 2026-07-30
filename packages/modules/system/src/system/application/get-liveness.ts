import type { LivenessResponse } from "@stockcontrol/contracts";

import type { Clock } from "../ports/clock";

export class GetLiveness {
  public constructor(private readonly clock: Clock) {}

  public execute(): LivenessResponse {
    return {
      status: "ok",
      timestamp: this.clock.now().toISOString(),
      uptimeSeconds: Math.max(0, this.clock.uptimeSeconds()),
    };
  }
}
