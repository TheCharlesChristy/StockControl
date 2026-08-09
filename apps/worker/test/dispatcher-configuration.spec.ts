import { hostname } from "node:os";

import { describe, expect, it } from "vitest";

import {
  resolveDispatcherOptions,
  resolveLeaseOwner,
} from "../src/recognition/dispatcher-configuration";

describe("dispatcher configuration", () => {
  it("uses the built-in schedule when nothing is configured", () => {
    expect(resolveDispatcherOptions({})).toMatchObject({
      pollIntervalMilliseconds: 2_000,
      batchSize: 2,
      leaseMilliseconds: 180_000,
      leaseRenewalMilliseconds: 45_000,
    });
  });

  it("accepts an operator's schedule", () => {
    expect(
      resolveDispatcherOptions({
        RECOGNITION_POLL_MS: "5000",
        RECOGNITION_BATCH_SIZE: "4",
        RECOGNITION_LEASE_MS: "60000",
        RECOGNITION_LEASE_RENEWAL_MS: "20000",
      }),
    ).toMatchObject({
      pollIntervalMilliseconds: 5_000,
      batchSize: 4,
      leaseMilliseconds: 60_000,
      leaseRenewalMilliseconds: 20_000,
    });
  });

  /*
   * Renewal at or beyond half the lease means one slow tick hands live work to
   * a second worker. Refusing at start-up is better than finding out as two
   * workers running the same job.
   */
  it("refuses a renewal interval that cannot keep a lease alive", () => {
    expect(() =>
      resolveDispatcherOptions({
        RECOGNITION_LEASE_MS: "60000",
        RECOGNITION_LEASE_RENEWAL_MS: "30000",
      }),
    ).toThrow(/less than half/u);
  });

  it("refuses a value that is not a positive whole number", () => {
    expect(() => resolveDispatcherOptions({ RECOGNITION_POLL_MS: "0" })).toThrow(
      /positive integer/u,
    );
    expect(() => resolveDispatcherOptions({ RECOGNITION_BATCH_SIZE: "two" })).toThrow(
      /positive integer/u,
    );
    expect(() => resolveDispatcherOptions({ RECOGNITION_POLL_MS: "-5" })).toThrow(
      /positive integer/u,
    );
  });

  it("treats a blank value as unset", () => {
    expect(resolveDispatcherOptions({ RECOGNITION_POLL_MS: "  " }).pollIntervalMilliseconds).toBe(
      2_000,
    );
  });
});

describe("lease ownership", () => {
  /*
   * A lease is only safe because the worker holding it is the only process
   * that can extend or complete it. Two replicas sharing an owner string would
   * quietly let each other steal live work.
   */
  it("names the Railway replica when there is one", () => {
    expect(resolveLeaseOwner({ RAILWAY_REPLICA_ID: "replica-7" })).toBe(
      `replica-7:${String(process.pid)}`,
    );
  });

  it("falls back to the hostname off Railway", () => {
    expect(resolveLeaseOwner({})).toBe(`${hostname()}:${String(process.pid)}`);
  });

  it("stays inside the column the lease is stored in", () => {
    expect(resolveLeaseOwner({ RAILWAY_REPLICA_ID: "r".repeat(400) }).length).toBeLessThanOrEqual(
      120,
    );
  });
});
