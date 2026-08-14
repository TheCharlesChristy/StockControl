import { describe, expect, it, vi } from "vitest";

import type { BackgroundJobEnvelope } from "@stockcontrol/contracts";

import {
  BackgroundJobDispatcher,
  UnknownBackgroundJobError,
} from "../src/background/job-dispatcher";
import { CorrelationContext } from "../src/observability/correlation-context";
import { type LogDestination, StructuredLogger } from "../src/observability/structured-logger";

describe("platform observability foundations", () => {
  it("keeps correlation across asynchronous job execution", async () => {
    const context = new CorrelationContext();
    const lines: string[] = [];
    const destination: LogDestination = {
      write: (line) => lines.push(line),
    };
    const logger = new StructuredLogger(context, "worker-test", destination);
    const dispatcher = new BackgroundJobDispatcher(context, logger);
    const handler = vi.fn(async () => {
      await Promise.resolve();
      expect(context.currentId()).toBe("job-correlation");
    });
    dispatcher.register("reservation.expire", handler);
    const job: BackgroundJobEnvelope = {
      id: "job-1",
      type: "reservation.expire",
      payload: { reservationId: "reservation-1" },
      attempt: 1,
      maxAttempts: 3,
      createdAt: "2026-07-29T10:00:00.000Z",
      correlationId: "job-correlation",
    };

    const result = await dispatcher.dispatch(job);

    expect(result.outcome).toBe("completed");
    expect(handler).toHaveBeenCalledOnce();
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.includes("job-correlation"))).toBe(true);
  });

  it("rejects unknown jobs without silently dropping them", async () => {
    const context = new CorrelationContext();
    const logger = new StructuredLogger(context, "worker-test", {
      write: () => undefined,
    });
    const dispatcher = new BackgroundJobDispatcher(context, logger);

    await expect(
      dispatcher.dispatch({
        id: "job-2",
        type: "unknown",
        payload: {},
        attempt: 1,
        maxAttempts: 3,
        createdAt: "2026-07-29T10:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(UnknownBackgroundJobError);
  });

  it("redacts common secret fields from structured logs", () => {
    const context = new CorrelationContext();
    const lines: string[] = [];
    const logger = new StructuredLogger(context, "api-test", {
      write: (line) => lines.push(line),
    });

    context.run("request-1", () => {
      logger.log({
        event: "test",
        password: "do-not-log",
        nested: {
          token: "also-secret",
          BootstrapToken: "bootstrap-secret",
          acknowledgement_token: "ack-secret",
          sessionToken: "session-secret",
          recoveryCodes: ["recovery-secret"],
          provisioningUri: "provisioning-secret",
          mfaCode: "mfa-secret",
          errorCode: "identity.safe-code",
        },
      });
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("do-not-log");
    expect(lines[0]).not.toContain("also-secret");
    expect(lines[0]).not.toContain("bootstrap-secret");
    expect(lines[0]).not.toContain("ack-secret");
    expect(lines[0]).not.toContain("session-secret");
    expect(lines[0]).not.toContain("recovery-secret");
    expect(lines[0]).not.toContain("provisioning-secret");
    expect(lines[0]).not.toContain("mfa-secret");
    expect(lines[0]).toContain("identity.safe-code");
    expect(lines[0]).toContain("[REDACTED]");
    expect(lines[0]).toContain("request-1");
  });
});
