# Monitoring and routine operations

## Service signals

Monitor each customer installation independently:

- external HTTPS availability, certificate expiry, readiness, and response
  latency;
- process/container restarts, application error rate, and structured error
  events;
- host CPU, memory, load, disk/inode use, and clock synchronisation;
- PostgreSQL availability, connections, locks, slow queries, storage growth,
  migration version, and transaction failures;
- outbox and job queue depth, oldest ready item, lease age, retry rate, and
  permanently failed work;
- document upload/download errors and inaccessible/orphan object counts;
- backup last success, age, size, checksum, encryption, and restore-rehearsal
  status.

Logs include UTC time, severity, service, installation identifier, release,
correlation ID, and safe event fields. They exclude passwords, session or reset
tokens, MFA seeds/recovery codes, AWS keys, full document contents, and
unnecessary personal data.

## Alert classes

- Page immediately: service unavailable, suspected data corruption or breach,
  public document exposure, failed authentication safeguards, database
  unavailable, disk exhaustion imminent, or no valid backup inside the recovery
  window.
- Action during UK support hours: newest backup older than 26 hours, repeated
  job failure, queue age outside its workflow deadline, elevated error/latency,
  certificate within 21 days, or capacity trend requiring intervention.
- Review routinely: dependency/security updates, cost/capacity trend, restore
  rehearsal due, dormant access, and retention-policy drift.

Alert thresholds start from these safety conditions and are tuned from measured
customer baselines. They do not create a contractual SLA.

## Routine cadence

Daily:

- review backup, health, error, queue, disk, and certificate alerts;
- triage permanently failed jobs and never mark them complete without resolving
  the business effect.

Weekly:

- review security/dependency workflow results, host updates, capacity and cost
  trends, administrative access, and open operational actions.

Monthly:

- apply reviewed security updates in a maintenance window;
- review least privilege, stale secrets, firewall CIDRs, S3 public-access blocks,
  lifecycle policy, log retention, and unsupported software.

Quarterly and after material infrastructure change:

- perform the restore rehearsal;
- test incident contacts and vendor access;
- compare measured performance with the accepted customer profile.

Host updates, credential rotation, capacity changes, and manual job retries use
an approved change record. Never retry a non-idempotent handler without first
understanding its committed domain and outbox state.
