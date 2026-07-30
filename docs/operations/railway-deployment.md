# Railway deployment plan

## Purpose and status

This runbook describes the intended production deployment of one isolated
StockControl customer installation on Railway. It is the deployment plan for
the product; it is not a claim that every provisioning and backup step is
automated yet.

The application source already supports the Railway runtime shape:

- the root Dockerfile can build the `web`, `api`, and `worker` targets;
- the API binds the `HOST` and `PORT` environment variables;
- the worker accepts Railway's injected `PORT` for its health endpoint;
- the web service proxies `/api/*` to the private API;
- PostgreSQL URLs are supplied through environment variables; and
- local MinIO and Railway Buckets use the same S3-compatible boundary.

The remaining implementation work is called out in [Implementation status](#implementation-status).

## Operating principles

- Each customer has a separate Railway project, database, bucket, domain and
  secret set.
- StockControl owns and operates the software. Customers remain responsible
  for their Railway resource costs under the product agreement.
- Only the web service is publicly reachable. API, worker and PostgreSQL use
  Railway private networking.
- Production changes are made from a reviewed Git commit, never by editing a
  running container.
- Database migrations run once, using a dedicated migrator identity, before
  application traffic is released.
- Customer documents and database backups are private, encrypted and retained
  according to the customer contract.
- All production evidence uses UTC and identifies the customer, project,
  commit, schema version and operator.

## Architecture

```text
Customer domain (HTTPS)
          |
          v
  web service (public, Nginx + React)
          |
          |  /api/* over Railway private networking
          v
  api service (private, NestJS)
       |             |
       |             +--> Railway Bucket (private documents and exports)
       v
  PostgreSQL <----- worker service (private, long-running jobs)
       ^                    |
       |                    +--> SMTP/email provider
       +----- migration and scheduled backup jobs
```

The API service must retain the Railway service name `api`, because the web
image forwards requests to `http://api.railway.internal:3000`.

## Railway resources

Create these resources in a new customer project:

| Resource         | Configuration                                                            | Publicly exposed   |
| ---------------- | ------------------------------------------------------------------------ | ------------------ |
| `web` service    | Docker target `web`, port `8080`, health `/health`                       | Yes, custom domain |
| `api` service    | Docker target `api`, `PORT=3000`, health `/api/v1/health/ready`          | No                 |
| `worker` service | Docker target `worker`, Railway `PORT` or `3001`, health `/health/ready` | No                 |
| PostgreSQL       | Railway PostgreSQL, persistent storage and backups enabled               | No                 |
| Documents bucket | Private Railway Bucket, customer-specific                                | No                 |
| Migration job    | Same repository/image, migrator credentials only                         | No                 |
| Backup job       | Same repository or reviewed backup image, backup credentials only        | No                 |

Railway supports GitHub deployments, private networking, custom domains,
scheduled jobs, volumes, backups and private S3-compatible buckets. The
operator should confirm current limits and pricing in the official
[Railway documentation](https://docs.railway.com/).

## Prerequisites

Before creating a project, record the following in the protected operational
register:

- customer name and internal installation identifier;
- approved data jurisdiction and retention period;
- customer domain and DNS administrator;
- Railway workspace and billing owner;
- operational owner and incident contacts;
- approved application release commit;
- customer-specific secret references;
- document and backup retention policy; and
- support and maintenance window.

The operator also needs:

- access to the StockControl GitHub repository;
- access to the Railway workspace;
- permission to create a project, database, bucket, services and domain;
- access to the customer DNS provider; and
- an approved email provider configuration.

## Repository and service configuration

Create the `web`, `api` and `worker` services from the same repository and
branch. Configure the build-time variable shown below on each service:

| Service  | `RUNTIME_TARGET` | Port                     | Health check           |
| -------- | ---------------- | ------------------------ | ---------------------- |
| `web`    | `web`            | `8080`                   | `/health`              |
| `api`    | `api`            | `3000`                   | `/api/v1/health/ready` |
| `worker` | `worker`         | Railway `PORT` or `3001` | `/health/ready`        |

Set `PORT=3000` explicitly on the API service. The Nginx proxy intentionally
targets the fixed private API port. Do not rename the API service without
updating the web image and its deployment tests.

Use watch paths where supported so a change confined to the web, API or worker
does not unnecessarily rebuild the other services. All three images must be
built from the same commit.

### Public networking

Generate a Railway domain for the web service during initial setup. Replace it
with the customer's final domain after the smoke test. Configure the DNS
records Railway supplies and wait for the managed TLS certificate to become
active.

Do not generate public domains for the API or worker. Their traffic is
service-to-service over Railway private networking.

### Environment variables

Values below are names and relationships, not secrets to commit to Git.

#### Web service

The browser continues to call relative paths such as `/api/v1/...`; no public
API origin is embedded in the React build.

```text
RUNTIME_TARGET=web
```

#### API service

```text
RUNTIME_TARGET=api
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
PUBLIC_APP_URL=https://<customer-domain>
ALLOWED_WEB_ORIGINS=https://<customer-domain>
DATABASE_URL=<stockcontrol_app private PostgreSQL URL>
DATABASE_POOL_MAX=5
S3_ENDPOINT=https://storage.railway.app
S3_REGION=<bucket region>
S3_BUCKET=<customer bucket>
S3_ACCESS_KEY_ID=<customer document credential>
S3_SECRET_ACCESS_KEY=<customer document secret>
MAIL_HOST=<approved SMTP host>
MAIL_PORT=587
MAIL_FROM=StockControl <approved sender>
LOG_LEVEL=info
```

Add the authentication, encryption, signing, QR and other feature secrets as
their application modules become active. Generate them with the approved
secret-management process; never place them in a Railway template, image,
commit, log or command line.

#### Worker service

```text
RUNTIME_TARGET=worker
NODE_ENV=production
DATABASE_URL=<stockcontrol_app private PostgreSQL URL>
DATABASE_POOL_MAX=3
S3_ENDPOINT=https://storage.railway.app
S3_REGION=<bucket region>
S3_BUCKET=<customer bucket>
S3_ACCESS_KEY_ID=<customer document credential>
S3_SECRET_ACCESS_KEY=<customer document secret>
WORKER_HEALTH_PORT=<Railway PORT, or 3001>
WORKER_HEARTBEAT_MS=30000
LOG_LEVEL=info
```

The worker receives only the runtime database and document credentials. It
must not receive the PostgreSQL administrator or migration password.

#### Migration service/job

```text
DATABASE_MIGRATOR_URL=<stockcontrol_migrator private PostgreSQL URL>
DATABASE_RUNTIME_ROLE=stockcontrol_app
```

The migration job must not receive `DATABASE_URL` or the runtime password.

#### Backup service/job

The backup job will receive a dedicated read-only database identity and a
backup-only bucket credential. It must not use the application document
credential.

## PostgreSQL bootstrap

Railway's initial PostgreSQL connection is an administrative connection. The
first installation must run a reviewed bootstrap operation that:

1. Reads the actual Railway database name and host from the provisioned
   connection.
2. Creates `stockcontrol_migrator` with a generated password.
3. Creates `stockcontrol_app` with a different generated password.
4. Makes the migrator the owner of the StockControl schema and migration
   metadata.
5. Grants the runtime identity only the reviewed application privileges.
6. Revokes unnecessary default `PUBLIC` privileges.
7. Stores the two resulting connection strings in Railway service variables.
8. Removes the administrator credential from API and worker variables.

The bootstrap must be idempotent for an empty installation and must refuse to
silently overwrite an existing customer's roles. Credential rotation follows
the dedicated database-credentials runbook.

## Release and migration flow

The intended release path is:

```text
Pull request
  -> quality checks
  -> review and merge
  -> Railway builds web/api/worker from one commit
  -> migration job runs once
  -> API and worker deploy
  -> web deploys
  -> smoke tests and observation window
```

The migration step must acquire the existing database migration lock and exit
non-zero on failure. The API and worker must not be routed to customer traffic
until migration and readiness checks succeed.

For a backward-compatible migration, rollback means redeploying the previous
application commit. For a data-changing or incompatible migration, stop writes
and use the recorded recovery procedure; never edit ledger or audit data to
make an older release start.

## Initial installation procedure

1. Open a change record and verify the customer prerequisites.
2. Create the Railway project in the approved workspace and region.
3. Provision PostgreSQL and the private documents bucket.
4. Create the `web`, `api` and `worker` services from the approved repository.
5. Set `RUNTIME_TARGET`, ports, health checks and watch paths.
6. Run the PostgreSQL role bootstrap.
7. Add the API, worker and migration variables through Railway's secret-aware
   variable interface.
8. Run the reviewed migration job.
9. Deploy API and worker, then verify private readiness and worker heartbeat.
10. Deploy the web service and verify `/health`.
11. Generate a temporary Railway domain and run smoke tests.
12. Configure the customer's DNS and wait for HTTPS certificate issuance.
13. Replace the temporary domain with the final public URL configuration.
14. Configure email delivery, monitoring, spending limits and notifications.
15. Run a private document upload/download probe.
16. Create the first named Admin through the controlled setup flow.
17. Record the commit, service versions, schema version, domain, checks and
    exceptions in the change record.

## Smoke and acceptance checks

The first installation is not accepted until all of the following pass:

- web HTTPS and `/health` work from an external browser;
- `/api/v1/health/live` and `/api/v1/health/ready` succeed through the web
  domain;
- API is not reachable through an unintended public domain;
- database readiness reports the expected PostgreSQL check;
- worker liveness and readiness are healthy;
- a private bucket upload, head and authorised download succeed;
- an unauthorised document request is denied;
- sign-in, session cookies and CSRF requests remain same-origin;
- logs contain no passwords, tokens, bucket secrets or full connection URLs;
- the deployed commit and database schema version are recorded; and
- backup creation and restoration have been rehearsed before customer launch.

## Backups and restore

Use two layers:

1. Railway's PostgreSQL/volume backup capability for operational recovery.
2. A scheduled logical PostgreSQL export stored in the customer's private
   backup location, with at least 30 days of retention.

The logical export must include a manifest containing the UTC timestamp,
customer identifier, schema version, release commit and checksum. It must not
contain secrets.

Document objects and the object-version inventory must be recoverable at a
point that can be matched to the database backup. A live bucket alone is not
an independent backup.

Before launch, then at least quarterly and after material backup changes:

- restore the database into an isolated Railway environment;
- restore or attach the corresponding private document objects;
- run migrations as `stockcontrol_migrator`;
- verify runtime access as `stockcontrol_app`;
- compare representative document digests and database counts; and
- record measured recovery time and the recoverable data point.

The existing [backup and restore runbook](./backup-and-restore.md) contains the
integrity expectations; its provider-specific AWS commands must be replaced by
Railway-compatible commands before the first production rehearsal.

## Monitoring and routine operations

Monitor at minimum:

- web, API and worker deployment status;
- API liveness and readiness;
- worker heartbeat age and oldest queued job;
- PostgreSQL availability, connections, storage and backup age;
- bucket upload failures, object growth and backup age;
- HTTP error rate and latency;
- email delivery failures;
- certificate expiry; and
- Railway project spend against the customer limit.

All alerts are acknowledged in the in-app operational process or the approved
operator channel. A failed backup, stale worker heartbeat or unavailable
database is an operational incident, not a silent warning.

## Rollback and incident handling

For an application-only failure with a compatible schema:

1. Stop or pause the release if it is still deploying.
2. Preserve logs and deployment identifiers.
3. Redeploy the previous web, API and worker commit together.
4. Verify readiness, sign-in, worker processing and a read-only inventory path.
5. Keep the change open through the observation window.

For suspected data corruption, credential exposure, failed migration or failed
restore:

1. Open an incident record.
2. Stop writes or isolate the affected project where safe.
3. Preserve the current database, bucket versions, logs and deployment data.
4. Rotate exposed credentials.
5. Restore only into a verified isolated target first.
6. Obtain approval before changing customer DNS or production traffic.

Never delete a customer project, database, bucket or volume as a retry
mechanism.

## Customer offboarding

Offboarding requires an approved customer-specific retention and deletion
record. Before deletion:

- export the agreed database and document data;
- verify the export checksum and readability;
- provide the customer handoff through the approved channel;
- revoke email, database, bucket and operator credentials;
- remove the customer domain and DNS records when authorised; and
- delete or retain Railway resources only according to the contract and
  documented retention decision.

No automated cleanup may bypass the retention decision or destroy a backup
needed for legal, financial or audit purposes.

## Local development and CI

Local development continues to use Docker Compose with PostgreSQL, MinIO and
Mailpit. The local S3 endpoint remains separate from Railway production.

GitHub Actions must run formatting, linting, type checking, unit tests,
integration tests, build and browser checks before a production deployment is
allowed. Railway should deploy the same reviewed commit only after required
checks pass. Deployment smoke tests must use a disposable Railway environment
or an explicitly approved customer maintenance window.

## Implementation status

| Area                                      | Status                               |
| ----------------------------------------- | ------------------------------------ |
| Docker runtime targets                    | Implemented                          |
| Web-to-private-API proxy                  | Implemented                          |
| Worker Railway port handling              | Implemented                          |
| Railway service setup                     | Manual setup documented here         |
| PostgreSQL role bootstrap                 | To be implemented and rehearsed      |
| Automated release migration job           | To be implemented                    |
| Production S3-compatible document adapter | Product work remains                 |
| Scheduled logical backup and retention    | To be implemented                    |
| Independent document-object backup        | To be implemented                    |
| Railway deployment workflow               | To be implemented                    |
| Monitoring/spend alert configuration      | To be configured per project         |
| Full StockControl feature set             | Separate product implementation work |

## Related runbooks

- [Release](./release.md)
- [Database credentials](./database-credentials.md)
- [Backup and restore](./backup-and-restore.md)
- [Monitoring](./monitoring.md)
- [Incident response](./incident-response.md)
- [Railway infrastructure notes](../../infra/railway/README.md)
