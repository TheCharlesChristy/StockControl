import { beforeEach, describe, expect, it, vi } from "vitest";

import { CorrelationContext, StructuredLogger } from "@stockcontrol/platform";

import { ExpiredSessionSweeper } from "../../src/auth/expired-session-sweeper";
import type { SessionService } from "../../src/auth/session-service";

interface CapturedLine {
  readonly event?: { readonly event?: string; readonly deleted?: number };
}

const loggerCapturing = (lines: string[]): StructuredLogger =>
  new StructuredLogger(new CorrelationContext(), "test", {
    write: (line) => lines.push(line),
  });

const sessionsDeleting = (deleteExpired: () => Promise<number>): SessionService =>
  ({ deleteExpired }) as unknown as SessionService;

const eventsIn = (lines: readonly string[]): readonly (string | undefined)[] =>
  lines.map((line) => (JSON.parse(line) as CapturedLine).event?.event);

describe("expired session sweeper", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("purges on bootstrap so a restart does not wait an hour to reclaim rows", async () => {
    const deleteExpired = vi.fn<() => Promise<number>>().mockResolvedValue(3);
    const lines: string[] = [];
    const sweeper = new ExpiredSessionSweeper(
      sessionsDeleting(deleteExpired),
      loggerCapturing(lines),
    );

    sweeper.onApplicationBootstrap();
    await vi.waitFor(() => expect(deleteExpired).toHaveBeenCalledOnce());
    sweeper.onApplicationShutdown();

    expect(eventsIn(lines)).toContain("auth.sessions.pruned");
    expect((JSON.parse(lines[0] ?? "{}") as CapturedLine).event?.deleted).toBe(3);
  });

  it("stays quiet when there was nothing to delete", async () => {
    const lines: string[] = [];
    const sweeper = new ExpiredSessionSweeper(
      sessionsDeleting(() => Promise.resolve(0)),
      loggerCapturing(lines),
    );

    await sweeper.sweep();

    expect(lines).toEqual([]);
  });

  /*
   * The sweep runs on a timer alongside live traffic. A database that is
   * briefly unreachable must not become an unhandled rejection that takes the
   * API process down with it.
   */
  it("reports a failed sweep rather than rejecting", async () => {
    const lines: string[] = [];
    const sweeper = new ExpiredSessionSweeper(
      sessionsDeleting(() => Promise.reject(new Error("connection terminated"))),
      loggerCapturing(lines),
    );

    await expect(sweeper.sweep()).resolves.toBeUndefined();
    expect(eventsIn(lines)).toEqual(["auth.sessions.prune_failed"]);
  });

  /*
   * This sweep runs against the database on a timer, so the failure it catches
   * most often is pg refusing a connection — and that message carries the
   * connection string, password included. StructuredLogger expands an Error
   * into its name, message and stack, so handing it the error object would
   * publish the runtime role's password on every failed sweep.
   */
  it("keeps the runtime password out of a failed sweep log", async () => {
    const lines: string[] = [];
    const sweeper = new ExpiredSessionSweeper(
      sessionsDeleting(() =>
        Promise.reject(
          new Error(
            "connect ECONNREFUSED postgresql://stockcontrol_app:hunter2@db.internal:5432/stockcontrol",
          ),
        ),
      ),
      loggerCapturing(lines),
    );

    await sweeper.sweep();

    const line = lines.join("");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("stockcontrol_app");
    expect(line).not.toContain("ECONNREFUSED");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: { event: "auth.sessions.prune_failed", error: "Error" },
    });
  });

  it("labels a non-Error failure without serialising it", async () => {
    const lines: string[] = [];
    const sweeper = new ExpiredSessionSweeper(
      /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors */
      sessionsDeleting(() => Promise.reject("postgresql://app:hunter2@db/stockcontrol")),
      loggerCapturing(lines),
    );

    await sweeper.sweep();

    expect(lines.join("")).not.toContain("hunter2");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: { error: "UnknownError" },
    });
  });

  it("stops sweeping once the application shuts down", async () => {
    vi.useFakeTimers();
    const deleteExpired = vi.fn<() => Promise<number>>().mockResolvedValue(0);
    const sweeper = new ExpiredSessionSweeper(
      sessionsDeleting(deleteExpired),
      loggerCapturing([]),
      1_000,
    );

    sweeper.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(2_500);
    const sweepsWhileRunning = deleteExpired.mock.calls.length;

    sweeper.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sweepsWhileRunning).toBeGreaterThan(1);
    expect(deleteExpired).toHaveBeenCalledTimes(sweepsWhileRunning);
    vi.useRealTimers();
  });
});
