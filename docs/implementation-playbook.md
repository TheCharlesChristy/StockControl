# StockControl demo MVP implementation playbook

**Status:** Delivery plan  
**Baseline:** [Demo MVP requirements v2.0](./product-requirements.md)  
**Supersedes:** [Full implementation playbook v1.0](./archive/implementation-playbook-full-v1.md)  
**Audience:** Whoever is building or extending the demo, human or agent

## 1. How to use this

Nine work packets, in order. Each is one sitting's work and ends with something you can show on
screen. There is no packet-record ceremony, no reviewer sign-off, no phase gate — build the packet,
prove it works, move on.

Source-of-truth order when something is ambiguous:

1. [Demo MVP requirements](./product-requirements.md)
2. The four live ADRs — [0001](./architecture/0001-modular-monolith.md),
   [0003](./architecture/0003-authentication-and-sessions.md),
   [0005](./architecture/0005-rest-and-openapi.md)
3. This playbook
4. Existing code

If a requirement in the archived v1.0 document conflicts with the demo baseline, the demo baseline
wins. Do not reintroduce deferred scope because the old document or existing code implies it —
see [the removal candidates list](./demo-mvp-removal-candidates.md) for what is already in the tree
but outside this scope.

## 2. Standing rules

- Business rules live in plain TypeScript with no framework imports. Controllers and React
  components translate and delegate.
- Every stock change goes through one application function that writes the stock level and its
  transaction row in a single database transaction. No exceptions, no second path.
- Reject impossible states loudly and specifically. `"Cannot issue 40 from STORE-A1: 12 on hand"`
  beats a generic 400.
- Server-side authorisation on every endpoint, read and write. Never trust the client's idea of the
  user's role.
- Quantities use a numeric database column and are validated at the boundary. Do not build a
  decimal arithmetic library.
- Timestamps are UTC instants.
- One migration per packet at most. Migrations run forward from an empty database; that is the only
  path the demo needs.
- Prefer deleting code over configuring it. This is a demo.

## 3. Work packets

### D1 — Trim the tree

**Outcome:** the repository contains only what the demo needs, and `pnpm install && pnpm quality`
passes.

Work through [the removal candidates list](./demo-mvp-removal-candidates.md) with the decisions the
product owner has made on it. Delete in this order: infrastructure and CI first (no code depends on
it), then unused domain modules, then the identity security surface, then the database platform
extras. Fix the workspace, TypeScript project references, and lint boundaries after each group so
you always know which deletion broke what.

Do not start D2 until the tree is quiet.

### D2 — Database and seed

**Outcome:** `docker compose up -d && pnpm db:migrate && pnpm db:seed` produces a populated demo
database.

- Compose file with one Postgres service and one role.
- One migration creating: `users`, `sessions`, `items`, `locations`, `stock_levels`, `jobs`,
  `reservations`, `transactions`.
- `stock_levels` has a unique constraint on (item, location) and a check that quantity >= 0. The
  check is the last line of defence behind the application rule, not a substitute for it.
- `transactions` has no update or delete path in application code.
- Seed script per requirements section 8.

### D3 — Stock engine

**Outcome:** unit-tested functions for every operation in requirements section 4, with no HTTP or
database framework in the tests.

Availability arithmetic, the seven operations, the negative-stock and over-reservation rejections,
partial and repeated collection. This packet is where the demo's credibility lives — the tests here
matter more than anywhere else in the build.

### D4 — Auth

**Outcome:** sign in, sign out, session cookie, role checks.

Password hashing from a maintained library, database-backed sessions, an auth guard that resolves
the session to a user and role, and a permission check helper driven by the static role map from
requirements section 5. No MFA, no invitations, no email.

### D5 — API

**Outcome:** every endpoint the screens need, under `/api/v1`, with role enforcement and integration
tests against a real database.

Items, locations, stock operations, jobs, reservations, transactions, users. JSON in and out, ISO
timestamps, consistent error shape — a plain `{ error: { code, message } }` is fine; RFC 9457
Problem Details is not required. Include the concurrent-double-collection test here.

### D6 — Inventory screens

**Outcome:** dashboard, inventory table with search and expandable rows, item detail.

### D7 — Jobs screens

**Outcome:** job list, job detail, and the reserve/collect/release/close flows.

### D8 — Transactions, users, and QR

**Outcome:** the transaction log with filters, the Admin user screen, the QR code on item detail,
and the print stylesheet.

### D9 — Demo polish

**Outcome:** the end-to-end journey from requirements section 9 passes, CI is green, and the README
tells a stranger how to run it in seven commands.

Walk the acceptance list in requirements section 11 yourself, on a phone as well as a laptop, before
calling this done.

## 4. Definition of done, per packet

- The outcome above is visible on screen or in a passing test.
- Rules from section 2 are respected.
- Unit tests for new domain rules; an integration test for anything touching stock atomically.
- `pnpm quality` and `pnpm test` pass.
- No secrets, no generated output, no dead code left behind.

## 5. Adding scope back later

When the demo earns the right to grow, take the feature's section out of
[the archived v1.0 requirements](./archive/product-requirements-full-v1.md), write it into the demo
requirements as a numbered revision, and add packets here. Recommended order if the question comes
up: serialized assets and tool custody first, then purchasing without costing, then stocktakes,
then notifications. Costing and VAT last — they are the largest and least demonstrable.
