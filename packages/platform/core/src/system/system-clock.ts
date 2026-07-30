import type { Clock } from "@stockcontrol/module-system";

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }

  public uptimeSeconds(): number {
    return process.uptime();
  }
}
