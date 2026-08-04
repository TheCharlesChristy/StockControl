import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cliMocks = vi.hoisted(() => {
  class MockDatabaseMigrationError extends Error {
    public override readonly name = "DatabaseMigrationError";

    public constructor(
      public readonly results: readonly unknown[],
      public readonly sqlState?: string,
    ) {
      super("safe migration failure");
    }
  }

  return {
    MockDatabaseMigrationError,
    migrateConfiguredDatabase: vi.fn(),
  };
});

vi.mock("../src/migrations/service", () => ({
  migrateConfiguredDatabase: cliMocks.migrateConfiguredDatabase,
}));

vi.mock("../src/migrations/runner", () => ({
  DatabaseMigrationError: cliMocks.MockDatabaseMigrationError,
}));

describe("database migration CLI", () => {
  let originalExitCode: typeof process.exitCode;
  let stderr: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;

  const executeCli = async (): Promise<void> => {
    vi.resetModules();
    await import("../src/migrate");
  };

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    cliMocks.migrateConfiguredDatabase.mockReset();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("uses an explicit runtime role and reports only sanitized migration fields", async () => {
    cliMocks.migrateConfiguredDatabase.mockResolvedValue({
      results: [
        {
          direction: "Up",
          migrationName: "0002_identity",
          status: "Success",
        },
      ],
    });

    await executeCli();
    await vi.waitFor(() => expect(stdout).toHaveBeenCalledOnce());

    expect(cliMocks.migrateConfiguredDatabase).toHaveBeenCalledWith(process.env);
    expect(stderr).not.toHaveBeenCalled();
    const line = String(stdout.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "database.migration.complete",
      results: [
        {
          direction: "Up",
          migrationName: "0002_identity",
          status: "Success",
        },
      ],
    });
    expect(line).not.toContain("secret");
  });

  it("reports safe failed migration coordinates and SQLSTATE", async () => {
    cliMocks.migrateConfiguredDatabase.mockRejectedValue(
      new cliMocks.MockDatabaseMigrationError(
        [
          {
            direction: "Up",
            migrationName: "0002_identity",
            status: "Error",
          },
        ],
        "23514",
      ),
    );

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    expect(stdout).not.toHaveBeenCalled();
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toEqual({
      error: "DatabaseMigrationError",
      event: "database.migration.failed",
      level: "error",
      results: [
        {
          direction: "Up",
          migrationName: "0002_identity",
          status: "Error",
        },
      ],
      sqlState: "23514",
    });
  });

  it("uses a stable error label and never serializes arbitrary failures", async () => {
    cliMocks.migrateConfiguredDatabase.mockRejectedValue(
      new TypeError("postgresql://runtime:secret@database/stockcontrol"),
    );

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    const line = String(stderr.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      error: "TypeError",
      event: "database.migration.failed",
      level: "error",
    });
    expect(line).not.toContain("secret");
  });

  it("uses UnknownError for non-Error failures", async () => {
    cliMocks.migrateConfiguredDatabase.mockRejectedValue("database secret");

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      error: "UnknownError",
    });
    expect(String(stderr.mock.calls[0]?.[0])).not.toContain("database secret");
  });

  it("reports migration setup failures without exposing their detail", async () => {
    cliMocks.migrateConfiguredDatabase.mockRejectedValue(
      new Error("DATABASE_RUNTIME_ROLE is invalid."),
    );

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      error: "Error",
      event: "database.migration.failed",
    });
    expect(String(stderr.mock.calls[0]?.[0])).not.toContain("DATABASE_RUNTIME_ROLE");
  });

  /*
   * pg puts the whole connection string in the message when it cannot reach the
   * server, so this is the case that decides whether a failed release publishes
   * the migrator password to the deploy log.
   */
  it("keeps the migrator password out of a connection failure log", async () => {
    cliMocks.migrateConfiguredDatabase.mockRejectedValue(
      new Error(
        "connect ECONNREFUSED postgresql://stockcontrol_migrator:hunter2@db.internal:5432/stockcontrol",
      ),
    );

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    const line = String(stderr.mock.calls[0]?.[0]);
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("stockcontrol_migrator");
    expect(Object.keys(JSON.parse(line) as Record<string, unknown>)).toEqual([
      "level",
      "event",
      "error",
    ]);
  });

  it("fails the release with a non-zero exit code", async () => {
    cliMocks.migrateConfiguredDatabase.mockRejectedValue(new Error("migration failed"));

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    expect(process.exitCode).toBe(1);
  });
});
