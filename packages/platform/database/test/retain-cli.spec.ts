import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cliMocks = vi.hoisted(() => ({
  applyConfiguredRetention: vi.fn(),
}));

vi.mock("../src/retention/purge", () => ({
  applyConfiguredRetention: cliMocks.applyConfiguredRetention,
}));

const result = {
  dryRun: false,
  windows: { auditDays: 365, captureDays: 90 },
  ranAt: "2026-08-23T12:00:00.000Z",
  totalRows: 3,
  tables: [
    {
      table: "mcp_tool_calls",
      window: "auditDays",
      cutoff: "2025-08-23T12:00:00.000Z",
      rows: 3,
    },
  ],
};

describe("the retention CLI", () => {
  let originalArgv: readonly string[];
  let originalExitCode: typeof process.exitCode;
  let stderr: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;

  const executeCli = async (argv: readonly string[] = []): Promise<void> => {
    process.argv = ["node", "retain", ...argv];
    vi.resetModules();
    await import("../src/retain");
  };

  beforeEach(() => {
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    cliMocks.applyConfiguredRetention.mockReset();
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = originalExitCode;
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("reports what it removed, table by table", async () => {
    cliMocks.applyConfiguredRetention.mockResolvedValue(result);

    await executeCli();
    await vi.waitFor(() => expect(stdout).toHaveBeenCalledOnce());

    expect(cliMocks.applyConfiguredRetention).toHaveBeenCalledWith(process.env, {
      dryRun: false,
    });
    expect(stderr).not.toHaveBeenCalled();
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
      event: "database.retention.complete",
      dryRun: false,
      totalRows: 3,
    });
  });

  /*
   * The switch that lets somebody check a changed window before it destroys
   * anything. If it stopped being passed through, the preview would silently
   * become the deletion.
   */
  it("passes --dry-run through, and says that is what it did", async () => {
    cliMocks.applyConfiguredRetention.mockResolvedValue({ ...result, dryRun: true });

    await executeCli(["--dry-run"]);
    await vi.waitFor(() => expect(stdout).toHaveBeenCalledOnce());

    expect(cliMocks.applyConfiguredRetention).toHaveBeenCalledWith(process.env, {
      dryRun: true,
    });
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
      event: "database.retention.preview",
      dryRun: true,
    });
  });

  /*
   * pg puts the whole connection string in the message when it cannot reach
   * the server. This job runs on a schedule, so its output goes somewhere
   * nobody is watching — which is the worst place for a password to land.
   */
  it("keeps the migrator password out of a connection failure log", async () => {
    cliMocks.applyConfiguredRetention.mockRejectedValue(
      new Error(
        "connect ECONNREFUSED postgresql://stockcontrol_migrator:hunter2@db.internal:5432/stockcontrol",
      ),
    );

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    const line = String(stderr.mock.calls[0]?.[0]);

    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("stockcontrol_migrator");
    expect(JSON.parse(line)).toEqual({
      level: "error",
      event: "database.retention.failed",
      error: "Error",
    });
  });

  it("uses UnknownError for a failure that is not an Error", async () => {
    cliMocks.applyConfiguredRetention.mockRejectedValue("database secret");

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    const line = String(stderr.mock.calls[0]?.[0]);

    expect(JSON.parse(line)).toMatchObject({ error: "UnknownError" });
    expect(line).not.toContain("database secret");
  });

  it("fails the scheduled run with a non-zero exit code", async () => {
    cliMocks.applyConfiguredRetention.mockRejectedValue(new Error("retention failed"));

    await executeCli();
    await vi.waitFor(() => expect(stderr).toHaveBeenCalledOnce());

    expect(process.exitCode).toBe(1);
  });
});
