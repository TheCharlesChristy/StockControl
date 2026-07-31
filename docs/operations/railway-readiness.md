# Railway deployment readiness

## Purpose

This document describes the work required to deploy StockControl to Railway.
It distinguishes between deploying the current demonstrable MVP and operating a
production customer installation.

## Current assessment

StockControl is not yet ready for a production Railway deployment.

The current MVP can be deployed as a smaller Railway installation using:

- a public `web` service;
- a private `api` service; and
- Railway PostgreSQL.

The repository also contains Docker targets for a `worker`, but the worker is
currently only a heartbeat and health process. Object storage, email, durable
background jobs, logical backups, first-admin provisioning, and Railway release
automation are not implemented.

## Evidence from the repository

- The web TypeScript build currently fails in
  [`ItemBarcode.tsx`](../../apps/web/src/components/ItemBarcode.tsx) because the
  EAN-13 parity lookup is considered possibly undefined.
- Prettier reports six files requiring formatting.
- The backend TypeScript build and ESLint pass when invoked directly.
- The Vite production bundle builds when invoked without the TypeScript step.
- The Dockerfile contains `web`, `api`, and `worker` runtime targets, but the
  repository README states that the Dockerfile is not currently built or
  validated.
- CI runs quality, unit, integration, and browser checks, but does not build or
  smoke-test the production images.
- `db:seed` clears business data and creates users with the shared
  `demo-password`; it must not be used against production.
- The Railway runbook marks PostgreSQL role bootstrap, automated migrations,
  production S3 integration, backups, object backups, deployment workflow, and
  monitoring configuration as incomplete.

## Deployment scope decision

Before implementation starts, decide which of the following is being targeted.

### MVP/demo deployment

Deploy only the web application, API, and PostgreSQL. Keep the existing feature
scope and accept that there is no background processing, document storage,
email, or automated backup workflow beyond Railway's database facilities.

This is the shortest route to a usable hosted demonstration, but it should not
be described as a production customer installation.

### Production customer deployment

Complete all P0 and P1 work in this document, including database bootstrap,
first-admin provisioning, release migrations, backup/restore, monitoring, and
security acceptance. Implement the worker and object-storage features if they
are part of the customer contract.

## Required work

### P0 — must be complete before the first deployment

#### 1. Restore a green build gate

- Fix the TypeScript error in `apps/web/src/components/ItemBarcode.tsx`.
- Run Prettier and commit the six formatting corrections.
- Run the complete quality gate under Node.js 24 and pnpm 11:

  ```text
  pnpm install --frozen-lockfile
  pnpm quality
  pnpm test
  pnpm test:integration
  pnpm test:e2e
  ```

- Keep the existing unrelated `.dev-server/dev-server.log` working-tree change
  out of the deployment commit.

#### 2. Validate all production images

Build every Docker target from the same commit:

```text
docker build --target web --tag stockcontrol-web:<commit> .
docker build --target api --tag stockcontrol-api:<commit> .
docker build --target worker --tag stockcontrol-worker:<commit> .
```

Verify that:

- the API starts with only its production runtime dependencies;
- the API healthcheck reaches `/api/v1/health/ready`;
- the worker healthcheck reaches `/health/ready`;
- Nginx serves the React application and `/health`;
- the API image contains the compiled migration entrypoint; and
- all images run as their intended non-root users.

Add these checks to CI. Railway supports Dockerfiles at the repository root and
requires build-time variables used by a Dockerfile to be declared as `ARG`.
The existing `RUNTIME_TARGET` pattern should be retained and tested.

Reference: [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles).

#### 3. Implement production database bootstrap

Create a Railway-specific, reviewed and idempotent bootstrap procedure that:

1. reads the actual Railway database name and connection details;
2. creates `stockcontrol_migrator` with a generated password;
3. creates `stockcontrol_app` with a different generated password;
4. makes the migrator the owner of the StockControl schema and migration data;
5. grants the runtime role only the privileges defined by the migration runner;
6. revokes unnecessary `PUBLIC` privileges;
7. refuses to overwrite existing roles silently; and
8. records which role checks passed without recording passwords.

The existing local SQL assumes the database is named `stockcontrol` and uses
local credentials. It cannot be copied directly to a Railway installation.

The API and worker must receive only the runtime connection. The migration job
must receive only `DATABASE_MIGRATOR_URL` and
`DATABASE_RUNTIME_ROLE=stockcontrol_app`.

#### 4. Add a safe first-admin flow

Implement a one-time production setup command or controlled setup route that
creates the first named Admin with a unique password.

The production flow must not call `db:seed`, expose demo accounts, or log a
shared password. It should refuse to run after an Admin already exists unless
an explicit, audited recovery procedure is used.

#### 5. Run migrations as a release step

Add a clearly named production migration command and execute it exactly once
before application traffic is released. The command must:

- use `DATABASE_MIGRATOR_URL`;
- acquire the existing migration lock;
- fail non-zero on any error;
- validate migration integrity;
- grant runtime privileges after successful migration; and
- never receive the runtime or PostgreSQL administrator password.

Use a Railway one-off migration service/job or an equivalent reviewed release
step. Do not run migrations during the Docker image build; Railway private
networking is available between running services, not during image builds.

## Railway service configuration

### Web service

```text
RUNTIME_TARGET=web
PORT=8080
```

Expose only this service publicly. Configure the Railway domain target port as
`8080` and set the healthcheck path to `/health`.

### API service

```text
RUNTIME_TARGET=api
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=<stockcontrol_app connection URL>
DATABASE_POOL_MAX=<reviewed value>
```

Do not create a public API domain. Configure the healthcheck path as
`/api/v1/health/ready`.

### Worker service

For the MVP, omit this service because it has no business work to process.

If it is deployed, configure:

```text
RUNTIME_TARGET=worker
WORKER_HEALTH_PORT=<Railway service port>
WORKER_HEARTBEAT_MS=30000
```

Do not treat a healthy heartbeat as proof that background jobs are being
processed.

### PostgreSQL

Use Railway PostgreSQL in the same project and environment. Keep it private and
connect through Railway service variables/private networking. Railway exposes
PostgreSQL connection variables such as `DATABASE_URL` to connected services.

References:

- [Railway PostgreSQL](https://docs.railway.com/databases/postgresql)
- [Railway private networking](https://docs.railway.com/networking/private-networking)

## P0 deployment smoke tests

The first MVP deployment is not accepted until all of the following pass:

- the web service is reachable over HTTPS;
- `/health` returns HTTP 200;
- the web service can proxy `/api/v1/health/live` and
  `/api/v1/health/ready` to the private API;
- the API readiness response confirms database connectivity;
- the API has no unintended public domain;
- a first Admin can sign in through the web domain;
- session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and same-origin;
- an authenticated inventory read succeeds;
- a receive, reserve, collect, or transfer operation succeeds;
- an unauthenticated request is rejected; and
- deployed version and commit metadata are visible in the service logs or
  `/api/v1/version`.

The Nginx configuration currently uses `127.0.0.11` as its DNS resolver. This
is Docker-specific and must be proven to work on Railway or replaced with a
Railway-compatible resolver/upstream strategy before the proxy smoke test is
considered complete.

Railway healthchecks wait for an HTTP 200 response before activating a new
deployment, but they are not continuous monitoring after activation.

Reference: [Railway healthchecks](https://docs.railway.com/deployments/healthchecks).

## P1 — production readiness work

### Deployment automation

- Add Railway configuration or a documented, repeatable provisioning script.
- Create separate `web`, `api`, migration, and optional `worker` services from
  the same commit.
- Add watch paths or an equivalent strategy to avoid unnecessary rebuilds.
- Add a deployment workflow that runs only after required GitHub checks pass.
- Propagate the Railway/Git commit SHA into `GIT_SHA` and image labels.
- Build immutable images and record the image digests in the release record.
- Add post-deployment smoke tests and an observation window.

### Backups and restore

For the current MVP, PostgreSQL is the only customer data store. For a
production installation:

- enable and verify Railway PostgreSQL backups;
- add a scheduled logical PostgreSQL backup with at least 30 days of retention;
- store backup artifacts in a private backup location;
- include timestamp, customer identifier, schema version, commit, and checksum
  in a manifest;
- create a dedicated read-only backup role;
- rehearse restoration into an isolated environment; and
- record measured recovery time and the recoverable data point.

Railway Cron Jobs are suitable for short-lived backup commands that exit after
completion and use UTC schedules. Railway Buckets are private S3-compatible
object storage if the application later requires object storage.

References:

- [Railway Cron Jobs](https://docs.railway.com/cron-jobs)
- [Railway storage buckets](https://docs.railway.com/storage-buckets)
- [Railway backups](https://docs.railway.com/volumes/backups)

### Monitoring and operations

- Configure external HTTPS uptime monitoring.
- Alert on API/database unavailability, deployment failures, error rate,
  latency, certificate expiry, and backup age.
- Configure Railway spend limits and notifications.
- Emit a meaningful installation/customer identifier in safe logs.
- Ensure `LOG_LEVEL` is either implemented or removed from the deployment
  documentation; it is currently not wired into `StructuredLogger`.
- Document release, rollback, incident, credential rotation, and offboarding
  procedures for Railway rather than relying on the older Lightsail/Ansible
  instructions.

### Security acceptance

Before customer use, review and explicitly accept the MVP's security scope:

- no MFA;
- no password reset or invitation flow;
- no rate limiting documented for sign-in;
- no production first-admin flow until the work above is complete; and
- cookie-authenticated state-changing requests rely on same-origin deployment
  and `SameSite=Lax` rather than an explicit CSRF token mechanism.

These may be acceptable for a controlled demonstration, but they require a
separate approval for a real customer deployment.

## P2 — deferred product/platform work

Complete these only if they are required by the target product scope:

- implement durable background jobs and worker handlers;
- add the S3-compatible document adapter;
- add private document upload/download authorization;
- add email delivery and notification workflows;
- add independent document-object backups and object inventory capture; and
- reconcile the full product requirements with the intentionally reduced MVP.

Railway Buckets are private and S3-compatible, but provisioning a bucket alone
does not implement application storage or backup behavior.

## Recommended implementation order

1. Fix the web TypeScript and formatting failures.
2. Run all checks with Node 24 and pnpm 11.
3. Build and smoke-test all Docker targets in CI.
4. Implement Railway database bootstrap and first-admin provisioning.
5. Implement and test the one-shot production migration step.
6. Fix or validate the Nginx Railway DNS strategy.
7. Deploy a disposable Railway MVP environment with web, API, and PostgreSQL.
8. Run the complete smoke-test list.
9. Add deployment automation, backups, restore rehearsal, monitoring, and spend
   controls before customer production.
10. Decide whether the worker, object storage, and email features belong in the
    first production release.

## Definition of ready

StockControl is ready for an MVP Railway deployment when the P0 items, image
validation, and smoke tests pass.

It is ready for a production customer deployment only when P0 and P1 are
complete, the backup restore has been rehearsed, the security scope has been
approved, and the release has a repeatable rollback and incident procedure.
