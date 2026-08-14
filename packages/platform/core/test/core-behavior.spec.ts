import { describe, expect, it, vi } from "vitest";

import type { BackgroundJobEnvelope } from "@stockcontrol/contracts";

import {
  BackgroundJobDispatcher,
  CorrelationContext,
  EnvironmentVersionProvider,
  ReadinessRegistry,
  StructuredLogger,
  SystemClock,
} from "../src";

describe("core platform behavior", () => {
  it("preserves readiness check registration order and rejects duplicates", () => {
    const registry = new ReadinessRegistry();
    const database = {
      name: "database",
      check: vi.fn(() => Promise.resolve({ name: "database", status: "ok" as const })),
    };
    const queue = {
      name: "queue",
      check: vi.fn(() => Promise.resolve({ name: "queue", status: "ok" as const })),
    };

    registry.register(database);
    registry.register(queue);

    expect(registry.all()).toEqual([database, queue]);
    expect(() => registry.register(database)).toThrow(
      'Readiness check "database" is already registered',
    );
  });

  it("reads trimmed build information and applies development fallbacks", () => {
    expect(
      new EnvironmentVersionProvider("api", {
        APP_VERSION: " 1.2.3 ",
        GIT_SHA: " abc123 ",
        BUILD_TIMESTAMP: " 2026-07-29T12:00:00.000Z ",
      }).get(),
    ).toEqual({
      service: "api",
      version: "1.2.3",
      commit: "abc123",
      builtAt: "2026-07-29T12:00:00.000Z",
    });

    expect(
      new EnvironmentVersionProvider("worker", {
        APP_VERSION: " ",
        BUILD_TIMESTAMP: " ",
      }).get(),
    ).toEqual({
      service: "worker",
      version: "0.0.0-dev",
      commit: "unknown",
      builtAt: null,
    });
  });

  it("provides current wall-clock and process-uptime values", () => {
    const clock = new SystemClock();
    const before = Date.now();
    const now = clock.now();
    const after = Date.now();

    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
    expect(clock.uptimeSeconds()).toBeGreaterThanOrEqual(0);
  });

  it("normalizes correlation identifiers and exposes only the active context", () => {
    const context = new CorrelationContext();

    expect(context.currentId()).toBeUndefined();
    expect(context.normalize("request._:-123")).toBe("request._:-123");
    expect(context.run("active-request", () => context.currentId())).toBe("active-request");
    expect(context.currentId()).toBeUndefined();

    for (const invalid of [undefined, "", "contains spaces", "x".repeat(129), {}]) {
      expect(context.normalize(invalid)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    }

    expect(context.createId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("rejects duplicate job handlers and records handler failures", async () => {
    const context = new CorrelationContext();
    const records: Array<{ readonly level: string; readonly line: string }> = [];
    const logger = new StructuredLogger(context, "worker-test", {
      write: (line, level) => records.push({ line, level }),
    });
    const dispatcher = new BackgroundJobDispatcher(context, logger);
    const failure = new Error("handler failed");
    const handler = vi.fn(() => Promise.reject(failure));
    const job: BackgroundJobEnvelope = {
      id: "job-failure",
      type: "reservation.expire",
      payload: {},
      attempt: 2,
      maxAttempts: 5,
      createdAt: "2026-07-29T10:00:00.000Z",
    };

    dispatcher.register(job.type, handler);

    expect(() => dispatcher.register(job.type, handler)).toThrow(
      'Background job handler "reservation.expire" is already registered',
    );
    await expect(dispatcher.dispatch(job)).rejects.toBe(failure);
    expect(records).toHaveLength(2);
    expect(records.map(({ level }) => level)).toEqual(["info", "error"]);
    expect(records[1]?.line).toContain("background_job.failed");
    expect(records[1]?.line).toContain("handler failed");
  });
});
