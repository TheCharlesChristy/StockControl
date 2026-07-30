import { describe, expect, it, vi } from "vitest";

import { CorrelationContext } from "../src/observability/correlation-context";
import { type LogDestination, StructuredLogger } from "../src/observability/structured-logger";

interface CapturedRecord {
  readonly correlationId?: string;
  readonly event?: unknown;
  readonly level: string;
  readonly message?: string;
  readonly parameters?: readonly unknown[];
  readonly service: string;
  readonly timestamp: string;
}

const capturingLogger = (): {
  readonly logger: StructuredLogger;
  readonly records: CapturedRecord[];
  readonly levels: string[];
} => {
  const records: CapturedRecord[] = [];
  const levels: string[] = [];
  const destination: LogDestination = {
    write: (line, level) => {
      records.push(JSON.parse(line) as CapturedRecord);
      levels.push(level);
    },
  };

  return {
    logger: new StructuredLogger(new CorrelationContext(), "api-test", destination),
    records,
    levels,
  };
};

describe("StructuredLogger", () => {
  it("emits every Nest log level with the expected structured level", () => {
    const { logger, levels, records } = capturingLogger();

    logger.log("info", { request: 1 });
    logger.error("error");
    logger.warn("warning");
    logger.debug("debug");
    logger.verbose("verbose");
    logger.fatal("fatal");

    expect(levels).toEqual(["info", "error", "warn", "debug", "trace", "fatal"]);
    expect(records[0]).toMatchObject({
      message: "info",
      parameters: [{ request: 1 }],
      service: "api-test",
    });
    expect(records.every(({ timestamp }) => !Number.isNaN(Date.parse(timestamp)))).toBe(true);
  });

  it("honors configured Nest log levels, including mapped info and verbose levels", () => {
    const { logger, levels } = capturingLogger();

    logger.setLogLevels(["log", "verbose", "error"]);
    logger.log("enabled");
    logger.verbose("enabled");
    logger.error("enabled");
    logger.warn("disabled");
    logger.debug("disabled");
    logger.fatal("disabled");

    expect(levels).toEqual(["info", "trace", "error"]);
  });

  it("sanitizes nested arrays, errors, circular values, and normalized secret keys", () => {
    const { logger, records } = capturingLogger();
    const circular: Record<string, unknown> = { visible: "safe" };
    circular.self = circular;
    const failure = new TypeError("safe failure");

    logger.log(
      {
        publicValue: "visible",
        nested: [
          null,
          42,
          failure,
          circular,
          {
            HTTP_AUTHORIZATION: "secret",
            customerPassword: "secret",
            device_cookie: "secret",
            oneTimeTotpCode: "secret",
            errorCode: "safe.code",
          },
        ],
      },
      { refresh_token: "secret", publicValue: true },
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.event).toEqual({
      publicValue: "visible",
      nested: [
        null,
        42,
        expect.objectContaining({
          name: "TypeError",
          message: "safe failure",
        }),
        { visible: "safe", self: "[Circular]" },
        {
          HTTP_AUTHORIZATION: "[REDACTED]",
          customerPassword: "[REDACTED]",
          device_cookie: "[REDACTED]",
          oneTimeTotpCode: "[REDACTED]",
          errorCode: "safe.code",
        },
      ],
    });
    expect(records[0]?.parameters).toEqual([{ refresh_token: "[REDACTED]", publicValue: true }]);
  });

  it("routes default output to stdout except for error and fatal records", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logger = new StructuredLogger(new CorrelationContext(), "default-output");

    logger.log("standard");
    logger.error("failure");
    logger.fatal("fatal");

    expect(stdout).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledTimes(2);
    expect(String(stdout.mock.calls[0]?.[0])).toContain('"level":"info"');
    expect(String(stderr.mock.calls[0]?.[0])).toContain('"level":"error"');

    stdout.mockRestore();
    stderr.mockRestore();
  });
});
