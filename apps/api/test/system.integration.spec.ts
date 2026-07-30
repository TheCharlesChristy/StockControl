import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CORRELATION_ID_HEADER,
  type LivenessResponse,
  type ProblemDetails,
  type ReadinessResponse,
  type VersionResponse,
} from "@stockcontrol/contracts";

const { destroyDatabase, readiness } = vi.hoisted(() => {
  let readinessStatus: "error" | "ok" = "ok";

  return {
    destroyDatabase: vi.fn(() => Promise.resolve()),
    readiness: {
      getStatus: () => readinessStatus,
      setStatus: (status: "error" | "ok") => {
        readinessStatus = status;
      },
    },
  };
});

vi.mock("@stockcontrol/platform-database", () => ({
  createRuntimeDatabase: vi.fn(() => ({
    destroy: destroyDatabase,
  })),
  loadRuntimeDatabaseConfiguration: vi.fn(() => ({
    applicationName: "stockcontrol-api-test",
    connectionString: "postgresql://test:test@localhost:5432/test",
    connectionTimeoutMilliseconds: 100,
    maximumPoolSize: 1,
  })),
  PostgresReadinessCheck: class {
    public readonly name = "database.postgresql";

    public check(): Promise<{
      readonly detail?: string;
      readonly name: string;
      readonly status: "error" | "ok";
    }> {
      const status = readiness.getStatus();

      return Promise.resolve({
        ...(status === "error" ? { detail: "Database connection refused" } : {}),
        name: this.name,
        status,
      });
    }
  },
}));

import { createApiApplication } from "../src/bootstrap";

describe("system HTTP integration endpoints", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;

  beforeAll(async () => {
    app = await createApiApplication();
    server = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app.close();
    expect(destroyDatabase).toHaveBeenCalledOnce();
  });

  it("reports liveness and propagates a caller correlation ID", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/health/live",
      headers: {
        [CORRELATION_ID_HEADER]: "test-request-1",
      },
    });
    const body = response.json<LivenessResponse>();

    expect(response.statusCode).toBe(200);
    expect(response.headers[CORRELATION_ID_HEADER]).toBe("test-request-1");
    expect(body.status).toBe("ok");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("reports database-backed readiness", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/health/ready",
    });
    const body = response.json<ReadinessResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      checks: [
        {
          name: "database.postgresql",
          status: "ok",
        },
      ],
    });
  });

  it("reports service unavailable when the database is not ready", async () => {
    readiness.setStatus("error");

    try {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/health/ready",
      });
      const body = response.json<ReadinessResponse>();

      expect(response.statusCode).toBe(503);
      expect(body).toMatchObject({
        status: "not_ready",
        checks: [
          {
            detail: "Database connection refused",
            name: "database.postgresql",
            status: "error",
          },
        ],
      });
    } finally {
      readiness.setStatus("ok");
    }
  });

  it("exposes reproducible build metadata", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/version",
    });
    const body = response.json<VersionResponse>();

    expect(response.statusCode).toBe(200);
    expect(body.service).toBe("stockcontrol-api");
    expect(body.version.length).toBeGreaterThan(0);
    expect(body.commit.length).toBeGreaterThan(0);
  });

  it("returns structured problem details for an unknown endpoint", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/does-not-exist",
      headers: {
        [CORRELATION_ID_HEADER]: "test-request-404",
      },
    });
    const body = response.json<ProblemDetails>();

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(body).toMatchObject({
      status: 404,
      code: "http.404",
      correlationId: "test-request-404",
      instance: "/api/v1/does-not-exist",
    });
  });
});
