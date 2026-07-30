# Backup and restore

## Backup policy

- Run an encrypted PostgreSQL logical backup daily and retain it for at least
  30 days.
- Keep private documents in a versioned, encrypted, non-public customer bucket.
- Take an on-demand recovery point before every production release.
- Monitor the backup timer, upload outcome, object age, size trend, checksum,
  and S3 lifecycle policy.
- A backup is not proven until it has restored into an isolated environment and
  passed integrity checks.

The current host timer writes `postgres.dump` and `manifest.txt` beneath a UTC
timestamp in the customer's `daily/` backup prefix. The manifest captures the
database checksum and deployed images. Secret values and raw environment files
must never enter the backup bucket or evidence record.

The dump authenticates as the dedicated read-only `stockcontrol_backup`
database role. Upload uses a backup-only AWS identity which is different from
the application's document-bucket identity. Neither identity may access the
other identity's bucket.

### Current activation blocker

The automation does not yet create an independent backup of document objects or
the object-version inventory required to bind documents to a database recovery
point. Versioning in the live document bucket is protection, not an independent
backup. A production deployment remains blocked until protected document
replication/copy, inventory capture, monitoring, and a full database-plus-object
restore have been implemented and rehearsed.

## Daily verification

1. Confirm the timer completed and no failed service unit remains.
2. Confirm both expected objects exist in the correct customer bucket, use
   server-side encryption, and are not public.
3. Compare the checksum, non-zero size, and size trend. Investigate unexpected
   shrinkage or growth.
4. Confirm the newest successful backup is less than 26 hours old and retention
   is at least 30 days.
5. Check document-bucket versioning and the independently captured
   inventory/reference metrics.
6. Record the automated result; page the operator for a missed or corrupt
   backup.

## Restore rehearsal schedule

Complete a rehearsal before the first customer launch, after material
infrastructure or backup changes, and at least quarterly thereafter. Restore
into an isolated non-production AWS account/network using new credentials. Do
not overwrite production and do not connect restored services to customer email
or other external effects.

### Restore ownership contract

The custom-format dump deliberately omits owners and grants. Consequently, the
database identity running `pg_restore` becomes the owner of restored schemas,
tables, sequences, and Kysely migration-history objects. The restore must
authenticate as `stockcontrol_migrator`; running it as `stockcontrol_admin` is a
failed rehearsal because the next release may be unable to inspect or alter the
restored schema.

Use the admin identity only to create a new, empty, explicitly named target
database whose owner is `stockcontrol_migrator`. Revoke public access and grant
the runtime identity only `CONNECT`. Keep passwords in root-owned mode `0600`
environment files or the approved secret runner, never in command history.

The essential sequence is:

```text
admin:     create empty target database owned by stockcontrol_migrator
migrator:  pg_restore --no-owner --no-privileges into that target
migrator:  run the matching compiled StockControl migration command
runtime:   perform a committed insert/read/delete probe
runtime:   start the API and require database-backed readiness
```

The integration workflow rehearses this identity and ownership sequence on
PostgreSQL 18. Production evidence must additionally cover the matching
document-object recovery point.

## Restore procedure

1. Open an approved rehearsal or incident record. Identify customer, recovery
   point, reason, operator, and authoriser.
2. Stop or isolate production writes if this is a live recovery. Preserve the
   affected system and logs for investigation.
3. Select a database object version and matching manifest from before the
   failure. Verify bucket, timestamp, encryption, size, and SHA-256 checksum.
4. Provision an isolated host and a new empty PostgreSQL 18 database at a
   compatible application/schema version. Create the database as the admin
   identity with `stockcontrol_migrator` as its owner; revoke database and
   `public` schema privileges from `PUBLIC`, then grant `CONNECT` to
   `stockcontrol_app`.
5. Download the dump over TLS to an encrypted, access-controlled temporary
   location. Do not place it in a shared workstation directory.
6. Authenticate directly as `stockcontrol_migrator` and restore using
   `pg_restore --exit-on-error --single-transaction --no-owner
--no-privileges`. The target must be the explicitly verified disposable
   database from step 4. If an approved recovery plan exceptionally reuses a
   non-empty disposable target, add `--clean --if-exists` only after separately
   verifying its exact database name. Capture errors and object counts.
7. Configure read-only access to the corresponding private document bucket or a
   separately restored copy. Never make the bucket public.
8. Start the matching immutable application image with jobs, notification
   delivery, and external side effects disabled.
9. Run `node packages/platform/database/dist/migrate.js` as
   `stockcontrol_migrator`, supplying the restored target and the
   `stockcontrol_app` runtime identity. Run it even when no schema change is
   expected: this proves migration-history ownership and reapplies the reviewed
   least-privilege runtime grants.
10. Connect as `stockcontrol_app` and complete a committed insert/read/delete
    probe against a mutable operational table. Start the API against the
    restored database and require `/api/v1/health/ready` to return `ready` with
    an `ok` PostgreSQL check.

## Integrity and acceptance checks

- schema migration/version matches expectation;
- the database, application schema, application objects, and Kysely migration
  objects are owned by `stockcontrol_migrator`, never the admin or runtime role;
- the runtime role has no schema-creation rights and cannot update or delete
  immutable audit/ledger rows;
- ledger and projection reconciliation reports agree;
- row counts and representative oldest/newest records are plausible;
- no orphan database-to-document references exist and sampled digests match;
- users, permissions, MFA enrolment, session revocation data, jobs,
  reservations, custody, purchasing, and audit records are present;
- seven locked reports and CSV output work against restored data;
- readiness succeeds and no worker job is unintentionally dispatched;
- measured recovery time and recoverable data point are recorded.

For live recovery, obtain authorisation before DNS or traffic changes, rotate
credentials that may have been exposed, re-enable workers carefully, and
perform the release verification checks. Keep evidence according to the
incident and customer contract, then securely dispose of temporary restored
data.

## Failed restore

Do not improvise destructive repairs. Preserve logs, mark the recovery point as
failed, identify whether the dump, manifest, object data, credentials, version,
or procedure caused the failure, and attempt an earlier verified recovery point
in a fresh isolated target. Escalate immediately if no point inside the
retention window restores successfully.
