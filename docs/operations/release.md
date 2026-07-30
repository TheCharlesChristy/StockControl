# Production release

## Entry criteria

- The exact commit has green required quality, unit, integration, end-to-end,
  and security workflows.
- The release is versioned, documented, and explicitly vendor-approved.
- The immutable API, worker, and web digests map to the same commit and each has
  passed image vulnerability scanning. Reviewed Caddy and PostgreSQL digests
  are also recorded.
- Migrations have passed from an empty database and the previous supported
  release schema, with a reviewed recovery path.
- Customer scope, operator, change record, maintenance window, and expected
  impact are confirmed.

## Prepare

1. Review application, schema, permission, data-retention, infrastructure, and
   runbook changes since the installed version.
2. Confirm backup monitoring is healthy and the latest daily backup is within
   26 hours.
3. Run an on-demand pre-release backup. Record its S3 object versions, checksums,
   database schema version, document inventory, and restore compatibility.
4. Confirm capacity, free disk, certificate lifetime, error-monitoring access,
   and an operator with rollback authority.
5. Notify the customer with reasonable notice and avoid their working hours
   where practical.

## Deploy

1. Place the application in a maintenance-safe state if the migration plan
   requires it.
2. Update only the immutable image digests and reviewed non-secret
   configuration.
3. Run the implemented migration command exactly once through the Compose
   migrator service. It receives the migrator environment, never the runtime or
   admin credential. That environment contains `DATABASE_MIGRATOR_URL` and the
   non-secret `DATABASE_RUNTIME_ROLE` name only; it never contains
   `DATABASE_URL`. Save output in the change record without secrets.
4. Start API, worker, web, and proxy services. Do not route traffic until
   `/api/v1/health/ready` succeeds.
5. Record start/end UTC times, deployed commit, all image digests, and schema
   version.

## Verify

- HTTPS and readiness/liveness succeed from outside the host.
- Sign-in and Admin MFA work; a disabled test user cannot start a session.
- A read-only inventory search and permission-filtered dashboard succeed.
- A controlled idempotent test request does not duplicate its result.
- Worker heartbeat and outbox/job oldest-age metrics are healthy.
- Database connections, disk, CPU, memory, error rate, and response time remain
  within the installation baseline.
- Private document access requires authorisation and an unauthenticated object
  request is denied.
- The next backup timer is scheduled.

## Rollback

If schema is backward-compatible, restore the previous API, worker, and web
image digests together and repeat verification. If it is not compatible or data
integrity is in doubt, stop writes, preserve logs and current state, and use the
backup/restore runbook from the recorded pre-release recovery point. Never edit
or delete ledger transactions to make an older release start.

Close the change only after the observation window is healthy and customer
impact is documented. A failed release gets an incident or problem record and a
new reviewed commit; production is never patched by hand.
