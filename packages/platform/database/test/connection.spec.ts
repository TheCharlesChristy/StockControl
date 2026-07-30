import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMocks = vi.hoisted(() => ({
  constructedDatabases: [] as unknown[],
  constructedDialects: [] as unknown[],
  constructedPools: [] as Array<{
    emitUnexpectedError: (error: Error) => void;
    options: unknown;
  }>,
}));

vi.mock("pg", () => ({
  Pool: class MockPool {
    private unexpectedErrorHandler: ((error: Error) => void) | undefined;

    public constructor(public readonly options: unknown) {
      connectionMocks.constructedPools.push(this);
    }

    public on(event: string, handler: (error: Error) => void): this {
      if (event === "error") {
        this.unexpectedErrorHandler = handler;
      }

      return this;
    }

    public emitUnexpectedError(error: Error): void {
      this.unexpectedErrorHandler?.(error);
    }
  },
}));

vi.mock("kysely", () => ({
  Kysely: class MockKysely {
    public constructor(public readonly options: unknown) {
      connectionMocks.constructedDatabases.push(this);
    }
  },
  PostgresDialect: class MockPostgresDialect {
    public constructor(public readonly options: unknown) {
      connectionMocks.constructedDialects.push(this);
    }
  },
}));

import { createMigratorDatabase, createRuntimeDatabase } from "../src/connection";

describe("database connection factory", () => {
  const configuration = {
    applicationName: "stockcontrol-test",
    connectionString: "postgresql://runtime:secret@database:5432/stockcontrol",
    connectionTimeoutMilliseconds: 2_500,
    lockTimeoutMilliseconds: 3_000,
    maximumPoolSize: 7,
    statementTimeoutMilliseconds: 15_000,
  };

  beforeEach(() => {
    connectionMocks.constructedDatabases.length = 0;
    connectionMocks.constructedDialects.length = 0;
    connectionMocks.constructedPools.length = 0;
  });

  it.each([
    ["runtime", createRuntimeDatabase],
    ["migrator", createMigratorDatabase],
  ])("constructs the %s database with the configured PostgreSQL pool", (_name, factory) => {
    const database = factory(configuration);

    expect(connectionMocks.constructedPools).toHaveLength(1);
    expect(connectionMocks.constructedPools[0]?.options).toEqual({
      application_name: "stockcontrol-test",
      connectionString: configuration.connectionString,
      connectionTimeoutMillis: 2_500,
      lock_timeout: 3_000,
      max: 7,
      query_timeout: 15_000,
      statement_timeout: 15_000,
    });
    expect(connectionMocks.constructedDialects).toHaveLength(1);
    expect(connectionMocks.constructedDialects[0]).toMatchObject({
      options: { pool: connectionMocks.constructedPools[0] },
    });
    expect(connectionMocks.constructedDatabases).toEqual([database]);
    expect(database).toMatchObject({
      options: { dialect: connectionMocks.constructedDialects[0] },
    });
  });

  it("forwards unexpected pool errors to a caller-supplied handler", () => {
    const handler = vi.fn();
    createRuntimeDatabase(configuration, { onUnexpectedPoolError: handler });
    const error = new Error("connection reset");

    connectionMocks.constructedPools[0]?.emitUnexpectedError(error);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(error);
  });

  it("reports unexpected pool errors without logging their potentially sensitive message", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    createRuntimeDatabase(configuration);

    connectionMocks.constructedPools[0]?.emitUnexpectedError(
      new Error("postgresql://role:super-secret@database/stockcontrol"),
    );

    expect(stderr).toHaveBeenCalledOnce();
    const line = String(stderr.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "database.pool.unexpected_error",
      level: "error",
    });
    expect(line).not.toContain("super-secret");
    stderr.mockRestore();
  });
});
