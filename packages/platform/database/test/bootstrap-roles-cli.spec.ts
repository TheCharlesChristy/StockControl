import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cliMocks = vi.hoisted(() => {
  class MockDatabaseRoleBootstrapConfigurationError extends Error {
    public constructor(public readonly code: string) {
      super(code);
      this.name = "DatabaseRoleBootstrapConfigurationError";
    }
  }

  class MockDatabaseRoleBootstrapError extends Error {
    public constructor(public readonly code: string) {
      super(code);
      this.name = "DatabaseRoleBootstrapError";
    }
  }

  return {
    MockDatabaseRoleBootstrapConfigurationError,
    MockDatabaseRoleBootstrapError,
    bootstrapConfiguredDatabaseRoles: vi.fn(),
  };
});

vi.mock("../src/role-bootstrap", () => ({
  bootstrapConfiguredDatabaseRoles: cliMocks.bootstrapConfiguredDatabaseRoles,
  DatabaseRoleBootstrapConfigurationError: cliMocks.MockDatabaseRoleBootstrapConfigurationError,
  DatabaseRoleBootstrapError: cliMocks.MockDatabaseRoleBootstrapError,
}));

describe("database role bootstrap CLI", () => {
  let originalExitCode: typeof process.exitCode;
  let stderr: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;

  const executeCli = async (): Promise<void> => {
    vi.resetModules();
    await import("../src/bootstrap-roles");
  };

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    cliMocks.bootstrapConfiguredDatabaseRoles.mockReset();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("reports a successful role bootstrap without exposing configuration", async () => {
    cliMocks.bootstrapConfiguredDatabaseRoles.mockResolvedValue({
      databaseName: "stockcontrol",
      migratorRole: "stockcontrol_migrator",
      runtimeRole: "stockcontrol_app",
    });

    await executeCli();
    await vi.waitFor(() => expect(stdout).toHaveBeenCalledOnce());

    expect(cliMocks.bootstrapConfiguredDatabaseRoles).toHaveBeenCalledWith(process.env);
    expect(stderr).not.toHaveBeenCalled();
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({
      event: "database.roles.bootstrap.complete",
    });
  });

  it("fails the deployment after flushing a sanitized configuration error", async () => {
    cliMocks.bootstrapConfiguredDatabaseRoles.mockRejectedValue(
      new cliMocks.MockDatabaseRoleBootstrapConfigurationError("InvalidPassword"),
    );

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    expect(stdout).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toEqual({
      code: "InvalidPassword",
      event: "database.roles.bootstrap.failed",
      level: "error",
    });
    expect(stderr.mock.calls[0]?.[1]).toEqual(expect.any(Function));
  });

  it("reports SQLSTATE without serializing a database connection failure", async () => {
    const failure = Object.assign(
      new Error(
        "password authentication failed: postgresql://stockcontrol_app:secret@postgres/stockcontrol",
      ),
      { code: "28P01", severity: "FATAL" },
    );
    cliMocks.bootstrapConfiguredDatabaseRoles.mockRejectedValue(failure);

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    const line = String(stderr.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      code: "UnexpectedError",
      event: "database.roles.bootstrap.failed",
      level: "error",
      sqlState: "28P01",
    });
    expect(line).not.toContain("secret");
    expect(line).not.toContain("stockcontrol_app");
  });

  it("keeps stable bootstrap error codes while failing the deployment", async () => {
    cliMocks.bootstrapConfiguredDatabaseRoles.mockRejectedValue(
      new cliMocks.MockDatabaseRoleBootstrapError("ConnectedRuntimeRoleMismatch"),
    );

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      code: "ConnectedRuntimeRoleMismatch",
      event: "database.roles.bootstrap.failed",
    });
  });
});
