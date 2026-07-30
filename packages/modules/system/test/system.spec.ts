import { describe, expect, it, vi } from "vitest";

import { GetLiveness } from "../src/system/application/get-liveness";
import { GetReadiness } from "../src/system/application/get-readiness";
import { GetVersion } from "../src/system/application/get-version";
import type { Clock } from "../src/system/ports/clock";
import type { ReadinessCheck, ReadinessChecks } from "../src/system/ports/readiness-check";
import type { VersionInformationProvider } from "../src/system/ports/version-information";

const fixedClock: Clock = {
  now: () => new Date("2026-07-29T09:30:00.000Z"),
  uptimeSeconds: () => 12.5,
};

describe("system application services", () => {
  it("returns deterministic liveness information", () => {
    expect(new GetLiveness(fixedClock).execute()).toEqual({
      status: "ok",
      timestamp: "2026-07-29T09:30:00.000Z",
      uptimeSeconds: 12.5,
    });
  });

  it("reports not ready and converts a thrown check into a safe result", async () => {
    const checks: readonly ReadinessCheck[] = [
      {
        name: "database",
        check: () => Promise.reject(new Error("connection refused")),
      },
      {
        name: "application",
        check: () => Promise.resolve({ name: "application", status: "ok" }),
      },
    ];
    const registry: ReadinessChecks = { all: () => checks };

    await expect(new GetReadiness(fixedClock, registry).execute()).resolves.toEqual({
      status: "not_ready",
      timestamp: "2026-07-29T09:30:00.000Z",
      checks: [
        { name: "application", status: "ok" },
        {
          name: "database",
          status: "error",
          detail: "connection refused",
        },
      ],
    });
  });

  it("reports ready when every check succeeds", async () => {
    const registry: ReadinessChecks = {
      all: () => [
        {
          name: "database",
          check: () => Promise.resolve({ name: "database", status: "ok" }),
        },
      ],
    };

    await expect(new GetReadiness(fixedClock, registry).execute()).resolves.toMatchObject({
      status: "ready",
      checks: [{ name: "database", status: "ok" }],
    });
  });

  it("does not expose non-Error readiness failures", async () => {
    const registry: ReadinessChecks = {
      all: () => [
        {
          name: "queue",
          check: vi.fn().mockRejectedValue("connection details"),
        },
      ],
    };

    await expect(new GetReadiness(fixedClock, registry).execute()).resolves.toMatchObject({
      status: "not_ready",
      checks: [
        {
          name: "queue",
          status: "error",
          detail: "Readiness check failed",
        },
      ],
    });
  });

  it("returns build metadata without framework concerns", () => {
    const provider: VersionInformationProvider = {
      get: () => ({
        service: "stockcontrol-api",
        version: "1.2.3",
        commit: "abc123",
        builtAt: null,
      }),
    };

    expect(new GetVersion(provider).execute()).toEqual(provider.get());
  });
});
