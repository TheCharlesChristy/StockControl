import type { Clock } from "@stockcontrol/module-system";

export class FixedClock implements Clock {
  public constructor(
    private current: Date = new Date("2026-01-01T00:00:00.000Z"),
    private uptime = 0,
  ) {}

  public now(): Date {
    return new Date(this.current);
  }

  public uptimeSeconds(): number {
    return this.uptime;
  }

  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
    this.uptime += milliseconds / 1_000;
  }
}
