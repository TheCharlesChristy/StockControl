import { hostname } from "node:os";

import {
  DEFAULT_DISPATCHER_OPTIONS,
  type RecognitionDispatcherOptions,
} from "./recognition-dispatcher";

export type DispatcherEnvironment = Readonly<Record<string, string | undefined>>;

const readPositiveInteger = (
  environment: DispatcherEnvironment,
  name: string,
  defaultValue: number,
): number => {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) return defaultValue;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
};

/**
 * Names this process in the leases it takes. Railway gives each replica a
 * distinct id; the hostname and process id are the fallback. It matters that
 * two replicas never share a value — a lease is only safe because the worker
 * holding it is the only one that can extend or complete it.
 */
export const resolveLeaseOwner = (environment: DispatcherEnvironment): string => {
  const replica = environment.RAILWAY_REPLICA_ID?.trim();
  const base = replica !== undefined && replica.length > 0 ? replica : hostname();
  return `${base}:${String(process.pid)}`.slice(0, 120);
};

export const resolveDispatcherOptions = (
  environment: DispatcherEnvironment,
): RecognitionDispatcherOptions => {
  const leaseMilliseconds = readPositiveInteger(
    environment,
    "RECOGNITION_LEASE_MS",
    DEFAULT_DISPATCHER_OPTIONS.leaseMilliseconds,
  );
  const leaseRenewalMilliseconds = readPositiveInteger(
    environment,
    "RECOGNITION_LEASE_RENEWAL_MS",
    DEFAULT_DISPATCHER_OPTIONS.leaseRenewalMilliseconds,
  );

  /*
   * Renewal must land comfortably inside the lease or one slow tick loses live
   * work to another worker. Refusing the configuration is better than
   * discovering it as two workers running the same job.
   */
  if (leaseRenewalMilliseconds * 2 >= leaseMilliseconds) {
    throw new Error("RECOGNITION_LEASE_RENEWAL_MS must be less than half of RECOGNITION_LEASE_MS.");
  }

  return {
    leaseOwner: resolveLeaseOwner(environment),
    pollIntervalMilliseconds: readPositiveInteger(
      environment,
      "RECOGNITION_POLL_MS",
      DEFAULT_DISPATCHER_OPTIONS.pollIntervalMilliseconds,
    ),
    batchSize: readPositiveInteger(
      environment,
      "RECOGNITION_BATCH_SIZE",
      DEFAULT_DISPATCHER_OPTIONS.batchSize,
    ),
    leaseMilliseconds,
    leaseRenewalMilliseconds,
  };
};
