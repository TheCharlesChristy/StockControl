import type { LogDestination } from "@stockcontrol/platform";

export class CapturedLogDestination implements LogDestination {
  public readonly lines: string[] = [];

  public write(line: string): void {
    this.lines.push(line);
  }

  public parsed(): readonly Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}
