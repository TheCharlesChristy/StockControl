# Customer installation deployment

## Purpose

Provision and accept one isolated StockControl installation. This runbook does
not authorise customer onboarding or production data import.

## Required inputs

- approved customer contract, hosting jurisdiction, domain, and data-retention
  terms;
- named operational owner and incident contacts;
- AWS account/region and restricted vendor administration CIDRs;
- reviewed Lightsail capacity based on the acceptance-test profile;
- SSH public key and verified operator access;
- immutable API, worker, and web image digests built from the same approved
  release commit;
- reviewed immutable Caddy and PostgreSQL image digests;
- customer-specific values in the encrypted vendor secret store;
- change record and maintenance window.

Do not continue if any input is shared with another customer installation.

## Provision

1. Select the correct AWS account and encrypted remote Terraform state.
2. Initialise Terraform, validate configuration, and create a saved plan using
   the customer-specific non-secret variables.
3. Review the plan for one Lightsail instance, one static IP, restricted ports,
   and two private S3 buckets. Verify `force_destroy` remains false and backup
   retention is at least 30 days.
4. Obtain the normal infrastructure approval and apply exactly the reviewed
   plan.
5. Record the Terraform outputs in the protected operational register.
6. Create the DNS A/AAAA records for the customer domain and wait for expected
   resolution.
7. Create separate least-privilege S3 credentials scoped to the returned
   document and backup buckets. Put them only in the encrypted secret store.
8. Verify the instance SSH host fingerprint out of band.

## Configure

1. Build the Ansible inventory and non-secret variables from the examples.
2. Create an encrypted vault from the approved secret-store values.
3. Set all five reviewed image digests. Tags and placeholder digests are not
   accepted.
4. Install the pinned Ansible collection and run syntax and check mode.
5. Review check-mode output, then run the playbook against only the intended
   customer host.
6. Confirm PostgreSQL is not exposed publicly and only ports 80, 443, and the
   approved SSH sources are reachable.
7. Verify HTTPS, certificate chain, redirect from HTTP, security headers, and
   the supported desktop and mobile browsers.

## Initialise and accept

The reviewed production migration command is
`node packages/platform/database/dist/migrate.js`. Ansible passes that command
as an argument list to the dedicated migrator service without shell parsing.
The migration environment contains `DATABASE_MIGRATOR_URL` and the non-secret
role name `DATABASE_RUNTIME_ROLE`; it never contains `DATABASE_URL` or the
runtime role's password. This lets the command create the schema and grant only
the required privileges to the named runtime identity. An empty migration
argument list remains a hard deployment failure.

For a new empty PostgreSQL volume, the reviewed bootstrap creates separate
admin, migrator, runtime, and read-only backup identities. The API and worker
receive only the runtime database URL. The generated Compose file must contain
no passwords; its referenced application, migration, PostgreSQL, and backup
environment files must remain root-owned mode `0600`.

The session secret and field-encryption key are separate, canonical unpadded
base64url values that each decode to exactly 32 random bytes. The playbook
decodes and validates both before changing the host.

For an existing PostgreSQL volume, the playbook refuses a changed bootstrap
environment because the container entrypoint cannot rotate live roles. Use the
[database credential rotation runbook](./database-credentials.md); never
acknowledge a mismatch before the live roles have been rotated and verified.

Before acceptance:

- migrate from an empty PostgreSQL 18 database and retain migration evidence;
- create the first named Admin through the controlled setup flow, enrol MFA,
  store recovery codes with that named person, and remove bootstrap access;
- verify readiness/liveness, structured logs, error monitoring, job-worker
  progress, disk space, certificate expiry, and backup alerts;
- upload and retrieve a harmless test document through the application,
  confirming the bucket remains private and the document identity cannot access
  the backup bucket;
- confirm the backup identity cannot access the document bucket and the
  read-only database identity cannot modify data;
- execute an on-demand backup and complete the full restore rehearsal;
- run the acceptance profile (50 users, 20 concurrent sessions, 25,000
  catalogue items, 100,000 assets, and one million retained transactions);
- run keyboard, focus, contrast, touch-target, responsive-layout, camera QR,
  and dedicated-scanner smoke tests;
- record the release commit, all image digests, schema version, configuration
  version, results, exceptions, and approvers.

## Failure and rollback

Stop on any failed security, migration, backup, restore, or health check. Keep
DNS on the previous service or maintenance response. If no customer data exists,
correct configuration through a reviewed plan/playbook. If state exists, use
the release or restore runbook; do not delete buckets, volumes, ledger data, or
Terraform state to retry.
