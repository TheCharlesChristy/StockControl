import { afterEach, describe, expect, it } from "vitest";

import type { ReadinessCheckResult } from "@stockcontrol/contracts";
import type { ReadinessCheck, ReadinessChecks } from "@stockcontrol/module-system";

import { resolveWorkerHealthConfiguration, WorkerHealthEndpoint } from "../src/worker-health";

const endpoints: WorkerHealthEndpoint[] = [];

const checksReporting = (...results: readonly ReadinessCheckResult[]): ReadinessChecks => ({
  all: (): readonly ReadinessCheck[] =>
    results.map((result) => ({ name: result.name, check: () => Promise.resolve(result) })),
});

const startEndpoint = async (
  readiness?: ReadinessChecks,
): Promise<{
  readonly endpoint: WorkerHealthEndpoint;
  readonly origin: string;
}> => {
  const endpoint = new WorkerHealthEndpoint(
    {
      host: "127.0.0.1",
      port: 0,
    },
    readiness,
  );
  endpoints.push(endpoint);
  await endpoint.start();
  const address = endpoint.getAddress();

  if (address === undefined) {
    throw new Error("Expected the worker health endpoint to be listening.");
  }

  return {
    endpoint,
    origin: `http://127.0.0.1:${address.port}`,
  };
};

afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
});

describe("worker health configuration", () => {
  it("uses externally reachable defaults", () => {
    expect(resolveWorkerHealthConfiguration({})).toEqual({
      host: "0.0.0.0",
      port: 3_001,
    });
  });

  it("normalises an explicit host and allows an ephemeral test port", () => {
    expect(
      resolveWorkerHealthConfiguration({
        WORKER_HEALTH_HOST: " 127.0.0.1 ",
        WORKER_HEALTH_PORT: "0",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 0,
    });
  });

  it("uses Railway's injected PORT when no worker-specific port is set", () => {
    expect(
      resolveWorkerHealthConfiguration({
        PORT: "3001",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 3001,
    });
  });

  it("falls back from a blank host", () => {
    expect(
      resolveWorkerHealthConfiguration({
        WORKER_HEALTH_HOST: "  ",
      }).host,
    ).toBe("0.0.0.0");
  });

  it.each(["worker", "-1", "1.5", "65536"])("rejects invalid port %s", (port) => {
    expect(() =>
      resolveWorkerHealthConfiguration({
        WORKER_HEALTH_PORT: port,
      }),
    ).toThrow(`Invalid WORKER_HEALTH_PORT value: ${port}`);
  });
});

describe("WorkerHealthEndpoint", () => {
  it("publishes liveness while keeping readiness closed until startup completes", async () => {
    const { endpoint, origin } = await startEndpoint();

    const live = await fetch(`${origin}/health/live`);
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("no-store");
    await expect(live.json()).resolves.toEqual({
      service: "stockcontrol-worker",
      status: "live",
    });

    const pending = await fetch(`${origin}/health/ready`);
    expect(pending.status).toBe(503);
    await expect(pending.json()).resolves.toMatchObject({
      service: "stockcontrol-worker",
      status: "not_ready",
      checks: [],
    });

    endpoint.markReady();
    const ready = await fetch(`${origin}/health/ready`);
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({
      service: "stockcontrol-worker",
      status: "ready",
      checks: [],
    });

    endpoint.markNotReady();
    expect((await fetch(`${origin}/health/ready`)).status).toBe(503);
  });

  /*
   * The boolean this replaced could not tell these two apart: a worker that
   * cannot reach PostgreSQL claims nothing while reporting itself healthy, and
   * that is exactly the outage nobody would be paged for.
   */
  it("reports not ready while a dependency is failing", async () => {
    const { endpoint, origin } = await startEndpoint(
      checksReporting({
        name: "database.postgresql",
        status: "error",
        detail: "PostgreSQL is unavailable or migrations are incomplete.",
      }),
    );
    endpoint.markReady();

    const response = await fetch(`${origin}/health/ready`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      checks: [{ name: "database.postgresql", status: "error" }],
    });
  });

  it("reports ready and names the checks it consulted", async () => {
    const { endpoint, origin } = await startEndpoint(
      checksReporting({ name: "database.postgresql", status: "ok" }),
    );
    endpoint.markReady();

    const response = await fetch(`${origin}/health/ready`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      checks: [{ name: "database.postgresql", status: "ok" }],
    });
  });

  /* Shutting down beats a healthy dependency: the process is going away. */
  it("stays not ready while shutting down even if every check passes", async () => {
    const { endpoint, origin } = await startEndpoint(
      checksReporting({ name: "database.postgresql", status: "ok" }),
    );
    endpoint.markReady();
    endpoint.markNotReady();

    expect((await fetch(`${origin}/health/ready`)).status).toBe(503);
  });

  it("rejects unsupported methods and unknown paths without caching", async () => {
    const { origin } = await startEndpoint();

    const unsupported = await fetch(`${origin}/health/live`, {
      method: "POST",
    });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET");
    expect(unsupported.headers.get("cache-control")).toBe("no-store");

    const missing = await fetch(`${origin}/unknown`);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      status: "not-found",
    });
  });

  it("closes idempotently before or after listening", async () => {
    const endpoint = new WorkerHealthEndpoint({
      host: "127.0.0.1",
      port: 0,
    });

    await endpoint.close();
    await endpoint.start();
    expect(endpoint.getAddress()).toBeDefined();
    await endpoint.close();
    expect(endpoint.getAddress()).toBeUndefined();
    await endpoint.close();
  });

  it("rejects start() when the port is already bound", async () => {
    const first = await startEndpoint();
    const address = first.endpoint.getAddress();
    if (address === undefined) throw new Error("Expected the first endpoint to be listening.");

    const second = new WorkerHealthEndpoint({ host: "127.0.0.1", port: address.port });
    endpoints.push(second);

    await expect(second.start()).rejects.toThrow();
  });

  it("rejects close() when the underlying server reports a close error", async () => {
    const { endpoint } = await startEndpoint();
    const server = (
      endpoint as unknown as { server: { close: (cb: (error?: Error) => void) => void } }
    ).server;
    const originalClose = server.close.bind(server);
    server.close = (callback: (error?: Error) => void): void => {
      callback(new Error("simulated close failure"));
    };

    await expect(endpoint.close()).rejects.toThrow("simulated close failure");

    server.close = originalClose;
  });
});
