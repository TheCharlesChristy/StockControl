import { afterEach, describe, expect, it, vi } from "vitest";

import { CorrelationContext, StructuredLogger } from "@stockcontrol/platform";

import { WorkerHealthEndpoint } from "../src/worker-health";
import { parseHeartbeatMilliseconds, WorkerRuntime } from "../src/worker-runtime";

describe("WorkerRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits lifecycle and correlated heartbeat events", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const context = new CorrelationContext();
    const logger = new StructuredLogger(context, "worker-test", {
      write: (line) => lines.push(line),
    });
    const runtime = new WorkerRuntime(
      context,
      logger,
      {
        get: () => ({
          service: "worker-test",
          version: "1.0.0",
          commit: "abc123",
          builtAt: null,
        }),
      },
      new WorkerHealthEndpoint({
        host: "127.0.0.1",
        port: 0,
      }),
      undefined,
      1_000,
    );

    await runtime.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await runtime.onApplicationShutdown("SIGTERM");

    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toHaveLength(3);
    expect(JSON.stringify(records[0])).toContain("worker.started");
    expect(JSON.stringify(records[1])).toContain("worker.heartbeat");
    expect(records[1]?.correlationId).toEqual(expect.any(String));
    expect(JSON.stringify(records[2])).toContain("worker.stopped");
  });

  it("rejects an accidental second start and can be restarted after shutdown", async () => {
    const endpoint = new WorkerHealthEndpoint({
      host: "127.0.0.1",
      port: 0,
    });
    const runtime = new WorkerRuntime(
      new CorrelationContext(),
      new StructuredLogger(new CorrelationContext(), "worker-test", {
        write: () => undefined,
      }),
      {
        get: () => ({
          service: "worker-test",
          version: "1.0.0",
          commit: "abc123",
          builtAt: null,
        }),
      },
      endpoint,
      undefined,
      60_000,
    );

    await runtime.start();
    await expect(runtime.start()).rejects.toThrow("already started");
    await runtime.onApplicationShutdown();

    await runtime.start();
    await runtime.onApplicationShutdown();
  });
});

describe("worker heartbeat configuration", () => {
  it.each([undefined, "", "   "])("uses the default for %p", (candidate) => {
    expect(parseHeartbeatMilliseconds(candidate)).toBe(60_000);
  });

  it("accepts a one-second or longer integer interval", () => {
    expect(parseHeartbeatMilliseconds("1000")).toBe(1_000);
    expect(parseHeartbeatMilliseconds(" 90000 ")).toBe(90_000);
  });

  it.each(["worker", "999", "1000.5"])("rejects invalid interval %s", (candidate) => {
    expect(() => parseHeartbeatMilliseconds(candidate)).toThrow(
      `Invalid WORKER_HEARTBEAT_MS value: ${candidate}. Minimum is 1000.`,
    );
  });
});
