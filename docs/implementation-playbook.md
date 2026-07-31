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

Packets **D1 through D8 are done**. D9 is next.

### D1 — Trim the tree ✅

**Outcome:** the repository contains only what the demo needs, and `pnpm install && pnpm quality`
passes.

Work through [the removal candidates list](./demo-mvp-removal-candidates.md) with the decisions the
product owner has made on it. Delete in this order: infrastructure and CI first (no code depends on
it), then unused domain modules, then the identity security surface, then the database platform
extras. Fix the workspace, TypeScript project references, and lint boundaries after each group so
you always know which deletion broke what.

Do not start D2 until the tree is quiet.

### D2 — Database and seed ✅

**Outcome:** `docker compose up -d && pnpm db:migrate && pnpm db:seed` produces a populated demo
database. Verified end to end against PostgreSQL; both commands are safe to re-run.

- `0002_stock` creates `users`, `sessions`, `items`, `locations`, `stock_levels`, `jobs`,
  `reservations`, `transactions`.
- `stock_levels` is unique on (item, location) and checks quantity >= 0. The check is the last line
  of defence behind the application rule, not a substitute for it.
- `transactions` is append-only: the runtime role is granted select and insert only, so an attempted
  update or delete fails loudly rather than silently doing nothing. No rule or trigger is used.
- `RUNTIME_TABLE_PRIVILEGES` in `runner.ts` is exhaustive over the schema type, so a new table
  without a reviewed privilege entry is a compile error.
- The seed builds its dataset by running the D3 engine, so every seeded balance is explained by the
  transactions beside it. `test/seed/simulate.spec.ts` proves that by replaying the log.

### D3 — Stock engine ✅

**Outcome:** unit-tested functions for every operation in requirements section 4, with no HTTP or
database framework in the tests.

Lives in `apps/api/src/stock/`, framework-free, decide-don't-perform: each operation returns the
exact effects to apply in one transaction, or a typed refusal. `quantity.ts` holds quantities as
integer thousandths so fractional arithmetic is exact.

Two behaviours worth knowing before building on it:

- **Available may go negative.** Issuing is checked against what is physically at a location, not
  against availability, so stock already committed to a job can still be issued. The result is a
  visible shortfall rather than a silent refusal. New reservations are refused while available is at
  or below zero.
- **Reserve and release write transactions despite moving nothing.** The invariant is that every
  stock-level change writes exactly one transaction; these two additionally appear in the log so it
  accounts for the whole demo.

### D4 — Auth ✅

**Outcome:** sign in, sign out, session cookie, role checks.

scrypt from Node's standard library, database-backed sessions, and a guard registered globally so a
new route is authenticated by default — opting out needs an explicit `@Public()`, which is visible
in review. Health endpoints are the only public routes besides the three auth ones.

The role→capability map lives in `packages/contracts/src/permissions.ts` and is nine capabilities
wide. `requireCapability` is the single authorisation gate; every state-changing handler calls it
first.

### D5 — API ✅

**Outcome:** every endpoint the screens need, under `/api/v1`, with role enforcement and integration
tests against a real database.

Items, locations, the seven stock operations, jobs, reservations, transactions, users, dashboard.
Errors reuse the existing Problem Details vocabulary rather than inventing a second one; stock
refusals are 422 with a `stock.<rule>` code carrying the engine's message.

Two things worth knowing before extending it:

- **Request bodies are read as `unknown` and narrowed**, not trusted as their contract type.
  Controllers validate and hand services already-checked values.
- **Locks are taken reservation-first, then stock levels in id order.** Keep that order in any new
  command or two of them will deadlock.

### D6 — Inventory screens ✅

**Outcome:** dashboard, inventory table with search and expandable rows, item detail.

### D7 — Jobs screens ✅

**Outcome:** job list, job detail, and the reserve/collect/release/close flows.

### D8 — Transactions, users, and QR ✅

**Outcome:** the transaction log with filters, the Admin user screen, the QR code on item detail,
and the print stylesheet.

Three conventions the screens share, worth keeping if you add more:

- **`useResource` is the whole data layer** — load on mount, cancel on unmount, reload on demand,
  no cache. Pass it a `useCallback`-wrapped loader; that callback is the effect's dependency.
- **Dialogs are mounted only while open** (`{operation !== null && <Dialog …/>}`) rather than kept
  mounted and reset in an effect. React 19's lint rules reject the reset-in-effect pattern, and
  fresh mounting is simpler anyway.
- **Role decides which controls render, never whether a rule holds.** `useCapability` hides buttons
  as a courtesy; the server checks the same rule on every request and the tests assert both.

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
