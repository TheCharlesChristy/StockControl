# Demo MVP removal candidates

**Status:** Partly actioned — see "What was actually removed" below  
**Baseline:** [Demo MVP requirements v2.0](./product-requirements.md)

This started as a decision list covering everything outside the demo MVP scope. A first pass has
since removed the code that **conflicts with or obstructs** the MVP. Everything left standing is
inert: it does not contradict the demo baseline and does not get in the way of building it, so it
was kept.

Recommendation column (as originally assessed):

- **Remove** — outside demo scope, nothing in scope depends on it.
- **Replace** — the capability is in scope but the current implementation is far heavier than the
  demo needs.
- **Optional** — genuinely a judgement call; costs little to keep, costs little to lose.

Line counts are TypeScript source plus its tests, measured before the first pass. The repository
held about **40,800 lines** of TypeScript then and holds about **9,400** now.

---

## What was actually removed

The test for removal was: _does this contradict the demo spec, or would a packet have to fight it?_
Inert code was kept regardless of how far outside the eventual scope it sits.

**Deleted — competing domain models.** Nothing imported these five packages, so they came out
cleanly. Each defined a model the demo baseline contradicts: availability with ten location kinds
against the demo's single subtraction, a six-level location hierarchy against a flat store/job-site
list, a 62-key capability catalogue with per-user overrides against a static role map.

- `packages/modules/inventory`, `packages/modules/locations`, `packages/modules/identity`
- `packages/platform/identity-security`, `packages/platform/identity-persistence`

**Deleted — obstructed the next packets.**

- `packages/platform/database/src/migrations/0002-identity.ts` (1,523 lines) and its 14 identity
  tables in `schema.ts`, the provider registration, and the runtime-privilege entries. `pnpm
db:migrate` created all of it, and packet D2 would have added a competing `users` table.
- `packages/contracts/src/identity.ts` (271 lines) — MFA challenges, TOTP enrolment, bootstrap,
  invitations, password resets, and CSRF token responses. Requirements section 5.1 excludes every
  one of them.
- `packages/contracts/src/application-context.ts` — actor/override/represented-user/recent-auth
  command context. Unused, and a competing model for what a command carries.
- The MFA and preview-capability surface in `apps/web/src/auth/` and `SignInPage.tsx`, plus the MFA
  steps in the end-to-end journey. The sign-in flow implemented the deferred model end to end.

**Rewritten, not deleted.**

- `packages/contracts/src/auth.ts` — new, 58 lines, replacing the 271-line identity contract with
  the demo's user/session/role shape.
- `apps/web/src/auth/*` — email and password only, no CSRF pre-fetch, no MFA states. The
  development preview client survives in simplified form so the shell runs before packet D4.
- `apps/web/src/navigation.tsx` — was capability-driven off the deleted catalogue and advertised
  Purchasing, Stocktakes, Locations & maps, and Reports. Now role-driven with the five sections in
  requirements section 6.
- `packages/contracts/src/jobs.ts` → `background-jobs.ts` — the file name would have collided with
  the MVP's `Job` domain concept. Its contents were fine and are unchanged.
- Database tests that asserted against identity tables were trimmed to the foundation migration.

**Kept deliberately, though outside eventual scope.** All of it is inert:

- `apps/worker` — a heartbeat with nothing to dispatch, but it builds, tests, and blocks nothing.
- `infra/` (Terraform, Ansible, Railway), the `containers` and `security` CI workflows, and
  `docs/operations/` — none of it touches the application.
- Migration checksums, the dual migrator/runtime database roles, and the append-only column types.
  The runner grants runtime privileges automatically, so these cost a packet nothing.
- RFC 9457 Problem Details, structured logging with correlation IDs, and the readiness registry —
  all working, all harmless.

Everything in this last group remains a legitimate later cleanup. It is listed group by group
below.

---

## Group A — Local dev services

| #   | Item                                                                                          | What it is                                                                                                                                             | Recommendation                                                                           |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| A1  | `compose.yaml` — `minio`, `minio-init`, `mailpit` services and the `minio-data` volume        | S3-compatible object storage for private documents, a `mc` init container to create the bucket, and a fake SMTP server for invitation and reset emails | **Remove** — leaves one Postgres service — **Done**                                      |
| A2  | `.env.example` — `S3_*`, `MAIL_*`                                                             | Configuration for A1                                                                                                                                   | **Remove** — **Done**                                                                    |
| A3  | `.env.example` — `DATABASE_MIGRATOR_URL`, `DATABASE_RUNTIME_ROLE`, `VITE_ENABLE_AUTH_PREVIEW` | Two-role database setup and the placeholder auth preview flag                                                                                          | **Remove** with F2 and D5                                                                |
| A4  | `scripts/postgres/init/001_roles.sql`                                                         | Creates separate `stockcontrol_migrator` and `stockcontrol_app` roles, revokes `PUBLIC`, transfers database ownership                                  | **Remove** — one role for a demo                                                         |
| A5  | `README.md` local-setup section                                                               | Documents starting MinIO and Mailpit and lists their endpoints                                                                                         | **Replace** — rewrite for the seven-command setup — **Done**                             |
| A6  | `Dockerfile`, `.dockerignore`                                                                 | Multi-stage production image build                                                                                                                     | **Optional** — not needed for `pnpm dev`, useful if you want to hand someone a container |

---

## Group B — Cloud infrastructure (~all of `infra/`)

| #   | Item                                                                                                                                                                     | What it is                                                            | Recommendation |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------- |
| B1  | `infra/terraform/` — `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, `terraform.tfvars.example`, `README.md`                                                     | AWS Lightsail instance, static IP, firewall, and DNS provisioning     | **Remove**     |
| B2  | `infra/ansible/` — `site.yml`, `ansible.cfg`, `requirements.yml`, `inventory/`, `group_vars/` (including a vault example)                                                | Server configuration for a provisioned host                           | **Remove**     |
| B3  | `infra/ansible/templates/` — `Caddyfile.j2`, `compose.yml.j2`, `application.env.j2`, `migration.env.j2`, `postgres.env.j2`, `backup.env.j2`, `stockcontrol-backup.sh.j2` | TLS reverse proxy, production compose, and encrypted backup scripting | **Remove**     |
| B4  | `infra/ansible/files/` — `stockcontrol-backup.service`, `stockcontrol-backup.timer`, `web-nginx.conf`, `010-stockcontrol-roles.sql`                                      | systemd backup timer units and production role SQL                    | **Remove**     |
| B5  | `infra/railway/README.md`, `infra/README.md`                                                                                                                             | Alternative PaaS deployment notes                                     | **Remove**     |

Removing B1–B5 deletes the `infra/` tree entirely and unblocks C1.

---

## Group C — CI workflows

| #   | Item                                         | What it is                                                                                                                 | Recommendation                                                             |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C1  | `.github/workflows/containers.yml`           | Container contract checks, four Anchore SBOM generations, four Trivy image scans, Terraform `validate`/`fmt`, Ansible lint | **Remove** — every target of it is in group B or A6                        |
| C2  | `.github/workflows/security.yml`             | `pnpm audit` gate, GitHub dependency-review, full-history Gitleaks secret scan, scheduled re-runs                          | **Remove** for a demo; keep Gitleaks alone if the repo will be public      |
| C3  | `.github/workflows/integration.yml`          | Postgres-backed integration gate                                                                                           | **Optional** — the concurrency test in D5 is worth a gate; the rest is not |
| C4  | `.github/workflows/e2e.yml`                  | Playwright browser gate with artifact upload                                                                               | **Optional** — keep only if D9's single journey is automated               |
| C5  | `.github/workflows/quality.yml` + `unit.yml` | Two workflows doing install/format/lint/typecheck/build and install/test/coverage                                          | **Replace** — merge into one workflow, drop the coverage artifact          |

---

## Group D — Documentation

| #   | Item                                                                                                                                                                                              | What it is                                        | Recommendation                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| D1  | `docs/operations/railway-deployment.md` (411 lines)                                                                                                                                               | Full PaaS deployment runbook                      | **Remove**                                                                                                        |
| D2  | `docs/operations/` — `deployment.md`, `backup-and-restore.md`, `database-credentials.md`, `release.md`, `monitoring.md`, `incident-response.md`, `README.md`                                      | Production operations handbook                    | **Remove** — a laptop demo has no operations                                                                      |
| D3  | `docs/security/dependency-risk-register.md`                                                                                                                                                       | Register for temporary `pnpm audit` exceptions    | **Remove** with C2                                                                                                |
| D4  | ADRs `0002` (immutable ledger and projections), `0004` (Postgres jobs and outbox), `0006` (private documents and PDF), `0007` (abstract location maps), `0008` (Lightsail deployment and backups) | Decisions for deferred capabilities               | **Optional** — already marked deferred in place; delete only if you want the ADR folder to describe just the demo |
| D5  | `apps/web` auth-preview path behind `VITE_ENABLE_AUTH_PREVIEW`                                                                                                                                    | Placeholder sign-in used before real auth existed | **Replace** — superseded by packet D4                                                                             |
| D6  | `docs/next-work-packet-prompt.md`                                                                                                                                                                 | Agent prompt referencing the v1.0 packet workflow | **Replace** — rewrite for the nine demo packets, or delete                                                        |

Already done: the v1.0 requirements, v1.0 playbook, and the requirements traceability matrix moved
to `docs/archive/`.

---

## Group E — Identity and security surface

This is the largest single reduction available: **~10,800 lines** across two platform packages, one
domain module, and the 1,523-line identity migration. The demo needs a password hash, a session
row, and a role check.

### E1 — Multi-factor authentication — **Remove** (~1,900 lines)

- `packages/platform/identity-security/src/totp.ts` and `totp-secret-encryption.ts` — TOTP
  generation and AES-GCM encryption of TOTP secrets with a rotating keyring
- `packages/platform/identity-security/src/recovery-codes.ts` — one-time recovery code issue and
  verification
- `packages/platform/identity-persistence/src/totp-repository.ts`,
  `recovery-code-repository.ts`, `mfa-recovery-repository.ts`, `auth-challenge-repository.ts`
- Schema: `identity_totp_credentials`, `identity_recovery_codes`, `identity_mfa_recovery_requests`,
  `identity_auth_challenges`
- Their tests: `totp.spec.ts`, `totp-secret-encryption.spec.ts`, `tokens-and-recovery.spec.ts`

### E2 — Invitation and password-reset delivery — **Remove** (~1,100 lines)

- `packages/platform/identity-security/src/delivery-secret-envelope.ts` (411 lines) — an AEAD
  envelope binding a delivery secret to its purpose, recipient, and expiry, with keyring rotation
- `packages/platform/identity-persistence/src/invitation-repository.ts`,
  `password-reset-repository.ts`
- Schema: `identity_invitations`, `identity_password_resets`
- `packages/modules/identity/src/identity/ports/delivery.ts`
- Depends on A1's Mailpit; there is no mail transport in demo scope

### E3 — Audit hash chain — **Remove** (~600 lines)

- `packages/platform/identity-security/src/audit-integrity.ts` — HMAC-sealed, hash-chained security
  audit events with keyring support
- `packages/platform/identity-persistence/src/audit-repository.ts`
- Schema: `identity_audit_events`, `identity_audit_chain_head`

The demo's accountability story is the `transactions` table, which is plain and readable. A tamper-
evident chain over a second audit log is product-grade assurance, not demo material.

### E4 — Request hardening — **Replace** (~700 lines)

- `packages/platform/identity-security/src/csrf.ts` — signed double-submit CSRF tokens with a
  signing keyring and a pre-auth binding
- `packages/platform/identity-security/src/request-policy.ts` — `Sec-Fetch-*` fetch-metadata policy

Replace both with a `SameSite=Lax` session cookie and an origin check on mutations. That is
appropriate for a locally-run demo.

### E5 — Security configuration and composition — **Remove** (~840 lines)

- `packages/platform/identity-security/src/composition.ts` (394 lines) — validates five separate
  keyrings from environment variables, enforces key lengths, rejects deterministic test adapters in
  production
- `packages/platform/identity-security/src/node-adapters.ts`, `ports.ts`, `identity-ports.ts` —
  injected clock, random source, and Argon2id deriver behind ports
- `ConfiguredDummyPasswordHash` — constant-time dummy hash to equalise timing on unknown accounts

Keep password hashing itself, called directly from a maintained library. The ports-and-adapters
indirection around it exists to make cryptography swappable, which the demo will never do.

### E6 — Rate limiting — **Remove** (~400 lines)

- `packages/modules/identity/src/identity/policies/rate-limit-policy.ts`
- `packages/platform/identity-persistence/src/rate-limit-repository.ts`
- Schema: `identity_rate_limit_buckets`

### E7 — Permission engine — **Replace** (~1,200 lines)

- `packages/modules/identity/src/identity/capabilities.ts` — 62 capability keys across 10 groups.
  Roughly 40 of them address purchasing, stocktakes, custody, and audit features that do not exist
  and are deferred
- `permission-resolution.ts` — per-user Allow/Deny overrides layered over role defaults, with a
  versioned catalogue
- `policies/final-capable-admin-policy.ts` — guarantees a last capable Admin always remains
- `policies/access-mutation-policy.ts` — who may change whose permissions
- `packages/platform/identity-persistence/src/permission-repository.ts`,
  `security-policy-repository.ts`, `bootstrap-repository.ts`
- Schema: `identity_permission_overrides`, `identity_security_policy`, `identity_bootstrap_state`

Replace with the static role→capability map in requirements section 5 — roughly 20 lines.

### E8 — Identity migration and persistence plumbing — **Replace** (~2,900 lines)

- `packages/platform/database/src/migrations/0002-identity.ts` (1,523 lines) creating 14 identity
  tables. The demo needs `users` and `sessions`
- `packages/platform/identity-persistence/src/validation.ts` (318 lines) — re-validates every row
  read back from the database at runtime
- `mappers.ts` (400 lines), `kysely-identity-unit-of-work.ts`
- `packages/modules/identity/src/identity/ports/persistence.ts` (651 lines) — port definitions for
  the repositories above

### E9 — Keep

`password-policy.ts`, `authentication-policy.ts` (trim to session expiry), `user.ts`,
`value-objects.ts`, `role-templates.ts` (reduce to the section 5 table), and the Argon2id password
hashing itself.

---

## Group F — Database platform

| #   | Item                                                                                                                              | What it is                                                                                                                | Lines | Recommendation                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------- |
| F1  | `packages/platform/database/src/migrations/integrity.ts` + `foundation-migration.spec.ts` checks                                  | SHA-256 checksums per migration, a `migration_integrity` table, and drift detection against previously applied migrations |  ~350 | **Remove** — forward-only from empty is the demo's only path                                                          |
| F2  | `MigrationDatabaseRoles` and the runtime/migrator split in `configuration.ts`, plus per-table grant statements in both migrations | Least-privilege separation between the migrating role and the runtime role                                                |  ~250 | **Remove** with A4                                                                                                    |
| F3  | `ImmutableColumn` / `GeneratedImmutableColumn` types in `schema.ts` and the database triggers enforcing append-only writes        | Type-level and database-level protection against updating history rows                                                    |  ~200 | **Optional** — cheap to keep the types, the triggers are the fiddly part                                              |
| F4  | `version` optimistic-concurrency columns on every table plus their bump triggers                                                  | Lost-update protection across all identity tables                                                                         |  ~150 | **Optional** — the demo's one concurrency risk is reservation collection, better handled with `SELECT ... FOR UPDATE` |
| F5  | Statement timeout, lock timeout, pool size, and connection timeout configuration knobs in `configuration.ts`                      | Production tuning surface                                                                                                 |  ~120 | **Remove** — use driver defaults                                                                                      |
| F6  | `packages/platform/database/src/migrations/runner.ts` (282 lines) and `provider.ts`                                               | Custom migration runner with advisory locking and checksum registration                                                   |  ~400 | **Replace** — a plain Kysely migrator is enough once F1 is gone                                                       |

---

## Group G — Domain modules beyond demo scope

These are well-built and heavily tested. They are also modelling a product the demo does not show.

| #   | Item                                                                      | What it is                                                                                                                                               |             Lines | Recommendation                                                                         |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------: | -------------------------------------------------------------------------------------- |
| G1  | `packages/modules/locations/src/locations/map.ts` (695) and `geometry.ts` | Floor-plan and blank-canvas maps, normalised rectangle and polygon regions, nesting, region stock-status colouring, hierarchy/map consistency validation | ~1,900 with tests | **Remove** — maps are deferred — **Done**                                              |
| G2  | `packages/modules/locations/src/locations/directory.ts` (877)             | Branch→Building→Area→Aisle→Shelf→Bin hierarchy, vans with engineer assignment, virtual job sites, retirement and archival rules                          | ~1,900 with tests | **Replace** — demo needs a flat location list with a store/job-site flag — **Done**    |
| G3  | `packages/modules/locations/src/locations/policies.ts`                    | Van movement initiation and completion handshakes, reservation source eligibility, receipt eligibility                                                   |   ~600 with tests | **Remove** — vans are deferred — **Done**                                              |
| G4  | `packages/modules/inventory/src/inventory/availability.ts` (672)          | Ten location kinds, commitments, split sourcing, inbound lines, demand identities, projected-availability-at-date                                        | ~1,300 with tests | **Replace** — demo availability is one subtraction (requirements section 3) — **Done** |
| G5  | `packages/modules/inventory/src/inventory/decimal.ts` (390)               | Hand-written exact decimal arithmetic with configurable policies, for money and fractional quantities                                                    |   ~870 with tests | **Replace** — a numeric column and boundary validation — **Done**                      |
| G6  | `packages/modules/inventory/src/inventory/units.ts`                       | Counted and measured units, pack conversions, unit-compatible quantity assertions                                                                        |   ~700 with tests | **Remove** — one unit label per item — **Done**                                        |
| G7  | `packages/modules/inventory/src/inventory/conditions.ts`                  | Usable/Quarantined/Damaged/Expired quantity conditions, Good/Damaged-usable/Unsafe tool conditions, and lifecycle states                                 |              ~250 | **Remove** — conditions are deferred — **Done**                                        |
| G8  | `packages/modules/inventory/src/inventory/catalogue-item.ts` (404)        | Tracking mode, handling policy, access classes, identifier aliases, equivalence groups, batch and expiry settings, reorder settings                      |   ~800 with tests | **Replace** — demo item is six fields — **Done**                                       |
| G9  | `packages/modules/inventory/src/inventory/ledger.ts` (619)                | Immutable ledger envelopes, idempotency keys, reversal linkage, prior/resulting state capture                                                            | ~1,150 with tests | **Replace** — a `transactions` table row per change — **Done**                         |

Total for group G: roughly **9,500 lines**. Some of this is genuinely good work you may want back
later — G4, G8, and G9 in particular encode rules the product will need. Archiving the packages on a
branch before deleting costs nothing and keeps the option open.

---

## Group H — Runtime scaffolding

| #   | Item                                                                                                                                                                            | What it is                                                                                                                                                                       |           Lines | Recommendation                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | `apps/worker/` — entire application                                                                                                                                             | Background worker with heartbeat, health endpoint, and shutdown handling. Has no work to do: the outbox, scheduled jobs, reservation expiry, and PDF generation are all deferred |             748 | **Remove**                                                                                                                                                    |
| H2  | `packages/platform/core/src/background/job-dispatcher.ts`                                                                                                                       | Port for dispatching durable background jobs                                                                                                                                     |             ~80 | **Remove** with H1                                                                                                                                            |
| H3  | `packages/contracts/src/application-context.ts` (346) and `jobs.ts`                                                                                                             | Actor, effective capability, contextual authorisation, recent authentication, reason, represented user, and override command context                                             | ~760 with tests | **Replace** — the demo's command context is a user ID and a role — **Done**                                                                                   |
| H4  | `packages/contracts/src/application-failures.ts` (370) and `packages/platform/core/src/http/problem-details-exception-filter.ts` + `application-failure-exception.ts`           | RFC 9457 Problem Details vocabulary with stable application codes mapped to HTTP statuses                                                                                        | ~900 with tests | **Replace** — `{ error: { code, message } }` — **Partly** (H4 kept: Problem Details still in use)                                                             |
| H5  | `packages/platform/core/src/observability/correlation-context.ts`, `structured-logger.ts`, `http/correlation-hook.ts`                                                           | AsyncLocalStorage correlation IDs threaded through structured JSON logs                                                                                                          | ~450 with tests | **Optional** — pleasant, not demo-visible                                                                                                                     |
| H6  | `packages/platform/core/src/health/readiness-registry.ts`, `packages/modules/system/` readiness and version use cases, `PostgresReadinessCheck`                                 | Liveness, readiness, and version endpoints with a pluggable check registry                                                                                                       |            ~500 | **Replace** — one `/health` returning 200                                                                                                                     |
| H7  | `apps/e2e/` and its Playwright config                                                                                                                                           | Browser test harness, currently one shell test against preview auth                                                                                                              |             103 | **Optional** — keep if D9's journey is automated                                                                                                              |
| H8  | `apps/web/src/app/ErrorBoundaries.tsx`, `RouteTransitionManager.tsx`, `Accessibility.test.tsx`                                                                                  | Route-level error boundaries, transition announcements, automated accessibility assertions                                                                                       | ~600 with tests | **Optional**                                                                                                                                                  |
| H9  | Workspace shape: 10 packages under `packages/`, `eslint-plugin-boundaries` dependency rules, per-package `tsconfig.build.json` and project references, `tsconfig.backend*.json` | Modular-monolith enforcement designed for a nine-module product                                                                                                                  |               — | **Optional** — collapsing to `api/`, `web/`, and `shared/` removes real friction, but it is the most disruptive change on this list. Do it last or not at all |

---

## Summary

| Group | Scope                 | Approximate lines | State after the first pass                          |
| ----- | --------------------- | ----------------: | --------------------------------------------------- |
| A     | Local dev services    |                 — | Done — one-service compose file                     |
| B     | Cloud infrastructure  |                 — | Kept — inert, `infra/` untouched                    |
| C     | CI workflows          |                 — | Kept — 6 workflows, all still green                 |
| D     | Documentation         |                 — | Kept — `docs/operations/`, `docs/security/` remain  |
| E     | Identity and security |           ~10,800 | Done — ~450 lines of auth contract and web client   |
| F     | Database platform     |            ~1,500 | Kept — grants are automatic, checksums cost nothing |
| G     | Domain modules        |            ~9,500 | Done — all five packages deleted                    |
| H     | Runtime scaffolding   |            ~4,100 | Partly — command context gone, the rest kept        |

The tree went from **40,800 to about 9,400 lines** of TypeScript. `pnpm quality` and `pnpm test`
pass; 259 unit tests are green.

If you later want the rest, the order that breaks nothing confusingly is: **B and C** (nothing
depends on them) → **D** → **H1/H2** (deletes the worker app) → **F** → the remaining optional
items.
