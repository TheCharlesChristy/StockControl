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
    createMigratorDatabase: vi.fn(),
    destroy: vi.fn(),
    loadMigrationDatabaseRoles: vi.fn(),
    loadMigratorDatabaseConfiguration: vi.fn(),
    runMigrations: vi.fn(),
  };
});

vi.mock("../src/configuration", () => ({
  loadMigrationDatabaseRoles: cliMocks.loadMigrationDatabaseRoles,
  loadMigratorDatabaseConfiguration: cliMocks.loadMigratorDatabaseConfiguration,
}));

vi.mock("../src/connection", () => ({
  createMigratorDatabase: cliMocks.createMigratorDatabase,
}));

vi.mock("../src/migrations/runner", () => ({
  DatabaseMigrationError: cliMocks.MockDatabaseMigrationError,
  runMigrations: cliMocks.runMigrations,
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

    cliMocks.createMigratorDatabase.mockReset();
    cliMocks.destroy.mockReset().mockResolvedValue(undefined);
    cliMocks.loadMigrationDatabaseRoles.mockReset().mockReturnValue({
      migratorRole: "migrator",
      runtimeRole: "runtime",
    });
    cliMocks.loadMigratorDatabaseConfiguration.mockReset().mockReturnValue({
      connectionString: "postgresql://migrator:secret@database/stockcontrol",
    });
    cliMocks.runMigrations.mockReset();
    cliMocks.createMigratorDatabase.mockReturnValue({ destroy: cliMocks.destroy });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("uses an explicit runtime role and reports only sanitized migration fields", async () => {
    cliMocks.runMigrations.mockResolvedValue({
      results: [
        {
          direction: "Up",
          migrationName: "0002_identity",
          status: "Success",
        },
      ],
    });

    await executeCli();
    await vi.waitFor(() => expect(cliMocks.destroy).toHaveBeenCalledOnce());

    expect(cliMocks.loadMigrationDatabaseRoles).toHaveBeenCalledWith(
      process.env,
      "postgresql://migrator:secret@database/stockcontrol",
    );
    expect(cliMocks.runMigrations).toHaveBeenCalledWith(
      cliMocks.createMigratorDatabase.mock.results[0]?.value,
      { runtimeRole: "runtime" },
    );
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

  it("reports safe failed migration coordinates and SQLSTATE and closes the pool", async () => {
    cliMocks.runMigrations.mockRejectedValue(
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

    expect(cliMocks.destroy).toHaveBeenCalledOnce();
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
    cliMocks.runMigrations.mockRejectedValue(
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
    cliMocks.runMigrations.mockRejectedValue("database secret");

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      error: "UnknownError",
    });
    expect(String(stderr.mock.calls[0]?.[0])).not.toContain("database secret");
  });

  it("fails role validation before opening a pool", async () => {
    cliMocks.loadMigrationDatabaseRoles.mockImplementation(() => {
      throw new Error("DATABASE_RUNTIME_ROLE is invalid.");
    });

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    expect(cliMocks.createMigratorDatabase).not.toHaveBeenCalled();
    expect(cliMocks.runMigrations).not.toHaveBeenCalled();
    expect(cliMocks.destroy).not.toHaveBeenCalled();
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      error: "Error",
      event: "database.migration.failed",
    });
    expect(String(stderr.mock.calls[0]?.[0])).not.toContain("DATABASE_RUNTIME_ROLE");
  });
});
