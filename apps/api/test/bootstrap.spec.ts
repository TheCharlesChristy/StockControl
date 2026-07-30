import { createServer } from "node:net";

import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const { destroyDatabase } = vi.hoisted(() => ({
  destroyDatabase: vi.fn(() => Promise.resolve()),
}));

vi.mock("@stockcontrol/platform-database", () => ({
  createRuntimeDatabase: vi.fn(() => ({
    destroy: destroyDatabase,
  })),
  loadRuntimeDatabaseConfiguration: vi.fn(() => ({
    applicationName: "stockcontrol-api-bootstrap-test",
    connectionString: "postgresql://test:test@localhost:5432/test",
    connectionTimeoutMilliseconds: 100,
    maximumPoolSize: 1,
  })),
  PostgresReadinessCheck: class {
    public readonly name = "database.postgresql";

    public check(): Promise<{
      readonly name: string;
      readonly status: "ok";
    }> {
      return Promise.resolve({
        name: this.name,
        status: "ok",
      });
    }
  },
}));

import { resolveApiListenerConfiguration, startApi } from "../src/bootstrap";

const acquireEphemeralPort = async (): Promise<number> => {
  const reservation = createServer();

  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });

  const address = reservation.address() as AddressInfo;

  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return address.port;
};

const occupyEphemeralPort = async (): Promise<{
  readonly port: number;
  readonly release: () => Promise<void>;
}> => {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  return {
    port: address.port,
    release: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
};

describe("API listener configuration", () => {
  it("uses externally reachable production defaults", () => {
    expect(resolveApiListenerConfiguration({})).toEqual({
      host: "0.0.0.0",
      port: 3000,
    });
  });

  it("normalises an explicit host and port", () => {
    expect(
      resolveApiListenerConfiguration({
        HOST: " 127.0.0.1 ",
        PORT: "4100",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 4100,
    });
  });

  it("falls back from a blank host", () => {
    expect(resolveApiListenerConfiguration({ HOST: "   " }).host).toBe("0.0.0.0");
  });

  it.each([
    ["not numeric", "stock-control"],
    ["fractional", "3000.5"],
    ["below range", "0"],
    ["above range", "65536"],
  ])("rejects a %s port", (_description, port) => {
    expect(() => resolveApiListenerConfiguration({ PORT: port })).toThrow(
      `Invalid PORT value: ${port}`,
    );
  });
});

describe("API process lifecycle", () => {
  afterEach(() => {
    destroyDatabase.mockClear();
  });

  it("starts on a requested loopback port and releases resources on close", async () => {
    const port = await acquireEphemeralPort();
    const app = await startApi({
      HOST: "127.0.0.1",
      PORT: String(port),
    });

    try {
      expect(await app.getUrl()).toBe(`http://127.0.0.1:${port}`);

      const response = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/api/v1/health/live",
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }

    expect(destroyDatabase).toHaveBeenCalledOnce();
  });

  it("closes application and database resources when the listener cannot bind", async () => {
    const occupied = await occupyEphemeralPort();

    try {
      await expect(
        startApi({
          HOST: "127.0.0.1",
          PORT: String(occupied.port),
        }),
      ).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
    } finally {
      await occupied.release();
    }

    expect(destroyDatabase).toHaveBeenCalledOnce();
  });
});
