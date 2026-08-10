# Railway production-MVP readiness

## Status

The repository contains the application and deployment controls needed for a
small, single-customer Railway installation. Deployment is accepted only after
the per-customer resources, secrets, first Admin and restore rehearsal in the
[Railway runbook](../../infra/railway/README.md) are complete.

This is a focused production MVP for one or two concurrent users. It is not the
larger multi-customer platform described in the full product requirements.

## Implemented controls

| Area           | Production-MVP control                                                                     |
| -------------- | ------------------------------------------------------------------------------------------ |
| Runtime        | Deterministic non-root `web` and `api` images selected from one Dockerfile                 |
| Placement      | One replica per persistent service in Railway EU West                                      |
| Network        | Public web only; private API, PostgreSQL, Bucket and migration task                        |
| Proxy          | Runtime private-DNS resolution, same-origin `/api`, 16 MiB body limit and security headers |
| Database       | Temporary administrator bootstrap, distinct migrator/runtime roles and explicit migrations |
| Startup        | API no longer performs schema migration while starting                                     |
| Initial access | Empty-database-only Admin setup with a hidden password prompt                              |
| Passwords      | Shared 15-to-128-character policy plus sign-in throttling                                  |
| Request safety | Exact production origin validation for unsafe methods                                      |
| Media          | Railway virtual-hosted S3 support with complete configuration validation                   |
| Seed safety    | Demo seed refuses to run in `NODE_ENV=production`                                          |
| Release        | Per-service Config as Code, ordered manual release and Docker contract checks in CI        |
| Shutdown       | Railway deployment overlap/draining plus application shutdown hooks                        |

## Accepted MVP limitations

- Application MFA, passkeys and self-service password reset are deferred.
- The `worker`, `recognition-core` and `recognition-fusion` services are
  optional and undeployed by default. They exist to serve assisted stock
  capture, itself gated off by `STOCK_CAPTURE_ENABLED` until a customer opts
  in — see [`docs/operations/railway-stock-capture.md`](railway-stock-capture.md).
  `recognition-core` and `recognition-fusion` additionally require real model
  weights promoted into `models/manifest.lock.json`, which has not happened in
  this environment (specification section 20's S0 gate needs real hardware and
  a consented evaluation set); until then, capture still works end to end
  through the barcode fast path and manual entry, with the model stages
  correctly reporting themselves unavailable.
- Recovery uses Railway's PostgreSQL facilities only. Railway Bucket objects
  have no independent backup/version history in this baseline.
- Release ordering is operator-driven rather than a fully automated promotion
  pipeline.
- One replica per service means a regional/platform interruption can make the
  application temporarily unavailable.

These limitations are appropriate only for the agreed small early-access
installation. Reassess them before materially increasing users, data value,
availability commitments or regulatory requirements.

## Deployment acceptance

- GitHub Actions passes quality, unit/integration/browser suites and API/web
  image contract builds.
- PostgreSQL bootstrap creates and verifies distinct roles without printing or
  logging passwords.
- The migration task succeeds before API/web deployment.
- API readiness proves runtime-role database connectivity.
- Web readiness proves the private API proxy as well as static serving.
- The named Admin signs in with secure cookie attributes; invalid credentials,
  cross-origin writes and rapid repeated failures are rejected.
- Representative stock mutation and private media upload/read/delete flows
  pass.
- API and PostgreSQL have no unintended public endpoints.
- Version output matches the released Git SHA.
- PostgreSQL restore into an isolated environment completes and is recorded.

The exact setup, variable contract, smoke commands, release sequence and
recovery caveats are maintained in
[`infra/railway/README.md`](../../infra/railway/README.md).
