# StockControl demo MVP requirements

**Status:** Demo MVP baseline v2.0  
**Supersedes:** [Full product requirements v1.0](./archive/product-requirements-full-v1.md)  
**Purpose:** Define the smallest coherent StockControl application that can be run on a local
machine and demonstrated end to end.

## 0. What changed and why

Version 1.0 described a complete commercial product: purchasing, VAT and weighted-average costing,
supplier invoices, serialized tool custody, stocktakes, floor-plan maps, a notification centre with
escalation, mandatory MFA, cloud provisioning, backups, and a seven-report suite. It is a good
description of the eventual product but it cannot be built or demonstrated quickly, and it forces
infrastructure (object storage, mail, background workers, cloud deployment) that a laptop demo does
not need.

This document replaces it as the implementation baseline. It keeps one thing: **the core inventory
loop, told convincingly**. Everything else is listed in section 10 as deferred, with the full v1.0
document preserved for when the demo becomes a product.

The rule for this document: if a requirement does not change what someone sees in a fifteen-minute
demonstration, it is not in scope.

## 1. Demo objective

A viewer should finish the demo able to say:

- I can see what stock exists, how much is available, and where it is.
- I can add stock, take stock, move stock, and correct stock.
- I can commit stock to a job and hand it over, and the numbers stay honest.
- I can see who did every one of those things, and when.
- I can scan an item's QR code with my phone and land on its page.

Everything in this specification exists to support one of those five statements.

## 2. Domain model

Six concepts. No others are required.

- **Item** — a catalogue definition, e.g. "M6 × 30 mm zinc bolt". Has a stable ID, name, unit
  label, optional barcode/part number, and an optional low-stock threshold.
- **Location** — a coded place stock can sit, e.g. `STORE-A1`. A location is either a **store**
  (counts towards availability) or a **job site** (does not).
- **Stock level** — the quantity of one item at one location.
- **Job** — a piece of work, with a number, name, customer, and status. Each job owns one job-site
  location, created automatically.
- **Reservation** — a quantity of one item committed to a job, not yet collected.
- **Transaction** — an append-only record of every stock change.

Quantities are whole or decimal numbers in the item's single unit. Pack conversions, batches,
expiry dates, and serialized assets are out of scope (section 10).

## 3. Stock rules

These are the only invariants the demo must never break.

- `on hand` = sum of that item's stock levels across all locations.
- `available` = sum of that item's stock levels at **store** locations − sum of that item's
  **open** reservations.
- Stock at a job-site location is visible in the item's location breakdown but never counts as
  available.
- A stock level may not go below zero. Any operation that would do so is rejected with a clear
  message and no partial effect.
- A reservation may not be created for more than the current available quantity.
- Every operation that changes a stock level writes exactly one transaction, in the same database
  transaction, recording the acting user, timestamp, item, quantity, source and destination
  location where applicable, related job where applicable, and reason where required.
- Transactions are never edited or deleted. A mistake is corrected with a new adjustment
  transaction.

## 4. Operations

| Operation    | Effect                                                             | Reason required |
| ------------ | ------------------------------------------------------------------ | --------------- |
| **Receive**  | Increases a stock level at a chosen store location                 | No              |
| **Issue**    | Decreases a stock level; optionally recorded against a job         | No              |
| **Transfer** | Decreases one location, increases another, same total              | No              |
| **Adjust**   | Sets a stock level to a counted value, up or down                  | Yes             |
| **Reserve**  | Creates an open reservation against a job; reduces availability    | No              |
| **Collect**  | Fulfils all or part of a reservation, moving stock to the job site | No              |
| **Release**  | Cancels the uncollected remainder of a reservation                 | Yes             |

Collection may be partial and may be repeated. The uncollected remainder stays reserved until it is
collected or released. Collected stock stays at the job-site location until it is issued or
transferred back.

Closing a job releases every uncollected reservation on it. Stock still sitting at the job site is
listed on the close screen as a plain warning; the demo does not require a reconciliation workflow.

## 5. Users, roles, and access

Three fixed roles. Permissions are a static map from role to allowed operations, resolved on the
server. There are no per-user permission overrides, no capability catalogue, and no override
workflow.

| Capability                             | Engineer | Office | Admin |
| -------------------------------------- | :------: | :----: | :---: |
| View inventory, jobs, and transactions |    ✓     |   ✓    |   ✓   |
| Issue stock, collect reservations      |    ✓     |   ✓    |   ✓   |
| Reserve stock against a job            |    ✓     |   ✓    |   ✓   |
| Receive stock, transfer, adjust        |          |   ✓    |   ✓   |
| Create and edit items and locations    |          |   ✓    |   ✓   |
| Create, edit, and close jobs           |          |   ✓    |   ✓   |
| Release a reservation                  |          |   ✓    |   ✓   |
| Manage users                           |          |        |   ✓   |

Authorisation is enforced on the server for every read and write. The web application uses the
role only to decide which controls to show.

### 5.1 Authentication

- Email address and password. Passwords are hashed with a well-reviewed algorithm from a
  maintained library.
- Sign-in creates a server-side session stored in the database, referenced by an `HttpOnly`,
  `SameSite=Lax` cookie. Sign-out deletes it. Sessions expire after 12 hours.
- An Admin creates users directly in the application and sets their initial password. There are no
  email invitations, no password-reset emails, and no email delivery of any kind.
- No multi-factor authentication, no recovery codes, no rate-limit buckets, no re-authentication
  prompts, no session-revocation console.

## 6. Screens

Eight screens. Every screen is responsive and usable on a phone.

1. **Sign in** — email, password, error state.
2. **Dashboard** — items below their low-stock threshold, the signed-in user's open reservations,
   and the ten most recent transactions.
3. **Inventory** — searchable, sortable table: item ID, name, on hand, reserved, available, unit,
   and a location summary. Search matches ID, name, barcode, and part number. A row expands to show
   its per-location breakdown.
4. **Item detail** — item fields, per-location stock, a QR code, the item's recent transactions,
   and buttons for the operations the signed-in role may perform.
5. **Jobs** — list with status filter; create and edit a job.
6. **Job detail** — job fields, its reservations with collected and outstanding quantities, the
   stock currently at its job site, and reserve/collect/release/close actions.
7. **Transactions** — the full log, filterable by item, job, user, and date range.
8. **Users** — Admin only: list, create, set role, enable/disable.

Every screen needs a loading state, an empty state, a validation-error state, and a
permission-denied state. Forms keep their input after a recoverable error.

## 7. QR codes

- Each item detail page renders a QR code encoding that item's own URL, generated in the browser
  from the item ID.
- Scanning it with any phone camera opens the item page. If the visitor is not signed in they land
  on sign-in and are returned to the item afterwards.
- Scanning grants no authority whatsoever; the server enforces the visitor's role as usual.
- A print-friendly stylesheet on the item page is sufficient for labels. Generated PDF label
  templates, thermal-printer sizes, and reservation/asset QR codes are out of scope.

## 8. Platform and running it locally

- One PostgreSQL database, started by `docker compose up -d` from a compose file containing exactly
  one service.
- One API process and one web dev server, both started by `pnpm dev`.
- A `pnpm db:migrate` step and a `pnpm db:seed` step. The seed creates three demo users (one per
  role), around twenty locations, a few hundred items with realistic names and stock levels, two
  open jobs, and enough transaction history for the log to look alive.
- No object storage, no mail server, no background worker, no message broker, no cache, no reverse
  proxy, no cloud provisioning, no backup automation.
- A single database role. Statement timeouts, lock timeouts, pool tuning, migration checksums, and
  append-only database triggers are not required.
- Runs on current Chrome, Edge, Firefox, and Safari, desktop and mobile.

A first-time setup must be: clone, copy `.env.example`, `docker compose up -d`, `pnpm install`,
`pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`. Seven commands, no cloud account, no secrets to
generate.

## 9. Quality bar

Proportionate to a demo, not to a regulated product.

- Domain rules from section 3 have unit tests: availability arithmetic, the negative-stock
  rejection, the over-reservation rejection, partial collection, and the transaction-per-change
  invariant.
- One integration test proves that a concurrent double collection of the same reservation cannot
  over-issue.
- A handful of component tests cover the inventory table and the stock-operation forms.
- One end-to-end journey: sign in → receive stock → reserve against a job → collect part of it →
  check the numbers → view the transaction log. This is also the demo script.
- One CI workflow: install, format check, lint, typecheck, build, unit tests. Coverage thresholds,
  container scanning, SBOM generation, secret scanning, dependency-review gates, and
  infrastructure validation are not required.
- Basic accessibility hygiene — semantic HTML, labelled controls, visible focus, status conveyed by
  text as well as colour. No automated accessibility gate.

## 10. Deferred

Not built, not designed, not a dependency of demo acceptance. Preserved in
[the full requirements](./archive/product-requirements-full-v1.md).

**Inventory depth** — serialized assets and tool custody; units of measure and pack conversions;
batches, expiry, and earliest-expiry-first picking; stock conditions (quarantined, damaged,
unsafe); handling policies and access classes; consume-on-issue configuration; equivalent-item
substitution; projected-availability forecasting.

**Purchasing and money** — suppliers, stock requests, purchase orders and their PDFs, approval
limits, separation of duties, goods receipt against orders, supplier invoices and credit notes,
three-way matching, payment status, VAT codes and rates, weighted-average costing, landed costs,
inventory valuation, purchase-price variance, replenishment suggestions.

**Field and custody workflows** — vans as mobile locations, engineer-to-engineer transfer
handshakes, user allocations, offboarding exceptions, job reconciliation and sign-off, the nine-state
job lifecycle (demo jobs are simply open or closed), collector lists, reservation expiry and
reminders.

**Control and insight** — stocktakes and cycle counts, blind counting, variance approval; the seven
locked reports; CSV import and export; the setup wizard; contextual help and documentation paths;
vendor-assisted data portability.

**Notifications** — the notification centre, severities, acknowledgement and resolution states,
deduplication, 24/48-hour escalation. The demo shows low stock on the dashboard and nothing more.

**Locations depth** — the six-level hierarchy, floor-plan maps and the geometry editor, map region
status colouring, location archival and retirement rules, bulk location label printing.

**Security depth** — multi-factor authentication and TOTP, recovery codes, email invitations and
password resets, AEAD-encrypted delivery secrets, hash-chained audit integrity, signed CSRF tokens,
fetch-metadata request policy, rate limiting, per-user permission overrides, last-admin protection,
recent-authentication requirements, idempotency keys.

**Platform and operations** — background workers, transactional outbox, scheduled jobs, object
storage and private documents, asynchronous PDF generation, email delivery, cloud provisioning
(Terraform/Ansible/Lightsail/Railway), automated encrypted backups and restore testing, monitoring
and incident response, release runbooks, container image publishing and scanning, SBOMs.

## 11. Demo acceptance

The demo MVP is done when, from an empty database, one person can:

1. run the seven setup commands on a laptop and reach a sign-in page;
2. sign in as each of the three roles and see the controls that role should have, and only those;
3. create an item, receive stock into a store location, and see availability change;
4. reserve stock against a job, watch availability drop while on hand stays the same, collect part
   of the reservation, and see the remainder stay reserved;
5. attempt to over-reserve and over-issue, and be refused cleanly both times;
6. transfer stock between locations and adjust a count with a reason;
7. scan an item's QR code with a phone and land on that item's page;
8. open the transaction log and account for every change made during the demo, with the actor and
   time on each;
9. see the CI workflow green on the demonstrated commit.

Nothing in section 10 is required to accept the demo. When something from section 10 is added back,
record it as a revision here rather than working from the archived v1.0 document, so the demo scope
and the product scope never silently merge.
