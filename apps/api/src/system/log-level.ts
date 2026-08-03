import type { LogLevel } from "@nestjs/common";

export type ConfiguredLogLevel = "debug" | "error" | "fatal" | "info" | "trace" | "warn";

const ENABLED_LEVELS: Readonly<Record<ConfiguredLogLevel, readonly LogLevel[]>> = {
  trace: ["fatal", "error", "warn", "log", "debug", "verbose"],
  debug: ["fatal", "error", "warn", "log", "debug"],
  info: ["fatal", "error", "warn", "log"],
  warn: ["fatal", "error", "warn"],
  error: ["fatal", "error"],
  fatal: ["fatal"],
};

const isConfiguredLogLevel = (value: string): value is ConfiguredLogLevel =>
  Object.hasOwn(ENABLED_LEVELS, value);

export function resolveLogLevels(value: string | undefined): LogLevel[] {
  const level = value?.trim().toLowerCase() || "info";

  if (!isConfiguredLogLevel(level)) {
    throw new Error("LOG_LEVEL must be one of trace, debug, info, warn, error, or fatal.");
  }

  return [...ENABLED_LEVELS[level]];
}
