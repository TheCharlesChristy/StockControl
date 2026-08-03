import { describe, expect, it } from "vitest";

import { resolveLogLevels } from "../../src/system/log-level";

describe("API log level", () => {
  it("defaults to informational output", () => {
    expect(resolveLogLevels(undefined)).toEqual(["fatal", "error", "warn", "log"]);
  });

  it("enables messages at and above the configured threshold", () => {
    expect(resolveLogLevels(" debug ")).toEqual(["fatal", "error", "warn", "log", "debug"]);
    expect(resolveLogLevels("error")).toEqual(["fatal", "error"]);
  });

  it("rejects an unknown value instead of silently hiding logs", () => {
    expect(() => resolveLogLevels("quiet")).toThrow("LOG_LEVEL must be one of");
  });
});
