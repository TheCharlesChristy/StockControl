import type { LoggerService, LogLevel } from "@nestjs/common";

import type { CorrelationContext } from "./correlation-context";

type StructuredLogLevel = "debug" | "error" | "fatal" | "info" | "trace" | "warn";

export interface LogDestination {
  write(line: string, level: StructuredLogLevel): void;
}

const consoleDestination: LogDestination = {
  write: (line, level) => {
    const output = level === "error" || level === "fatal" ? process.stderr : process.stdout;
    output.write(`${line}\n`);
  },
};

const REDACTED_KEY_SUFFIXES = [
  "authorization",
  "cookie",
  "mfacode",
  "password",
  "provisioninguri",
  "recoverycode",
  "recoverycodes",
  "secret",
  "token",
  "totpcode",
] as const;

const isRedactedKey = (key: string): boolean => {
  const normalised = key.replaceAll(/[^A-Za-z0-9]/gu, "").toLowerCase();
  return REDACTED_KEY_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
};

const sanitize = (value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry, seen));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);
  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(source)) {
    sanitized[key] = isRedactedKey(key) ? "[REDACTED]" : sanitize(entry, seen);
  }

  return sanitized;
};

export class StructuredLogger implements LoggerService {
  private enabledLevels: ReadonlySet<LogLevel> | undefined;

  public constructor(
    private readonly context: CorrelationContext,
    private readonly service: string,
    private readonly destination: LogDestination = consoleDestination,
  ) {}

  public log(message: unknown, ...optionalParameters: unknown[]): void {
    this.write("info", message, optionalParameters);
  }

  public error(message: unknown, ...optionalParameters: unknown[]): void {
    this.write("error", message, optionalParameters);
  }

  public warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.write("warn", message, optionalParameters);
  }

  public debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.write("debug", message, optionalParameters);
  }

  public verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.write("trace", message, optionalParameters);
  }

  public fatal(message: unknown, ...optionalParameters: unknown[]): void {
    this.write("fatal", message, optionalParameters);
  }

  public setLogLevels(levels: LogLevel[]): void {
    this.enabledLevels = new Set(levels);
  }

  private write(
    level: StructuredLogLevel,
    message: unknown,
    optionalParameters: readonly unknown[],
  ): void {
    if (!this.isEnabled(level)) {
      return;
    }

    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      correlationId: this.context.currentId(),
    };

    if (typeof message === "string") {
      record.message = message;
    } else {
      record.event = sanitize(message);
    }

    if (optionalParameters.length > 0) {
      record.parameters = sanitize(optionalParameters);
    }

    this.destination.write(JSON.stringify(record), level);
  }

  private isEnabled(level: StructuredLogLevel): boolean {
    if (this.enabledLevels === undefined) {
      return true;
    }

    const nestLevel: LogLevel = level === "info" ? "log" : level === "trace" ? "verbose" : level;
    return this.enabledLevels.has(nestLevel);
  }
}
