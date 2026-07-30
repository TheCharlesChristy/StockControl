import { afterEach, describe, expect, it } from "vitest";

import type { INestApplicationContext } from "@nestjs/common";

import { startWorker } from "../src/bootstrap";
import type { WorkerHealthEndpoint } from "../src/worker-health";
import { WORKER_TOKENS } from "../src/worker.tokens";

const originalEnvironment = {
  APP_VERSION: process.env.APP_VERSION,
  GIT_SHA: process.env.GIT_SHA,
  WORKER_HEALTH_HOST: process.env.WORKER_HEALTH_HOST,
  WORKER_HEALTH_PORT: process.env.WORKER_HEALTH_PORT,
  WORKER_HEARTBEAT_MS: process.env.WORKER_HEARTBEAT_MS,
};

let application: INestApplicationContext | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;

  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("worker application contract", () => {
  it("starts the composed Nest context and publishes readiness", async () => {
    process.env.APP_VERSION = "worker-test";
    process.env.GIT_SHA = "worker-test-commit";
    process.env.WORKER_HEALTH_HOST = "127.0.0.1";
    process.env.WORKER_HEALTH_PORT = "0";
    process.env.WORKER_HEARTBEAT_MS = "60000";

    application = await startWorker();
    const endpoint = application.get<WorkerHealthEndpoint>(WORKER_TOKENS.healthEndpoint);
    const address = endpoint.getAddress();

    expect(address).toBeDefined();

    const response = await fetch(`http://127.0.0.1:${String(address?.port)}/health/ready`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "stockcontrol-worker",
      status: "ready",
    });

    await application.close();
    application = undefined;

    await expect(fetch(`http://127.0.0.1:${String(address?.port)}/health/ready`)).rejects.toThrow();
  });
});
