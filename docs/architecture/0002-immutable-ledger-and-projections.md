# ADR 0002: Use an immutable stock ledger and current projections

- Status: Accepted
- Date: 2026-07-29
- Requirements: Product requirements 3, 5, 6, 8, and 10

## Context

StockControl must preserve actor, reason, prior and resulting state, costing,
custody, and correction history. Availability and current location must still
be fast to query. Editing historical transactions would destroy accountability;
replaying a million events for every page would miss the response target.

## Decision

Record every accepted stock-changing command as one or more append-only ledger
entries in the same PostgreSQL transaction that updates current projection
tables. Corrections are new linked reversals or adjustments; posted ledger rows
are never updated or deleted through the application.

Current projections include quantity balances, serialized-asset state,
commitments, custody, location, weighted-average cost, and reporting summaries.
Projection updates use row locking, constraints, and optimistic version checks
to reject over-commitment and stale concurrent changes.

Each externally retryable command carries a scoped idempotency key. The key,
request fingerprint, outcome reference, and actor are persisted atomically.
Reusing a key with a different fingerprint is rejected.

Ledger entries retain recording time and the separately authorised effective
date. A deterministic rebuild utility will reconstruct projections from the
ledger and verify totals without changing the ledger.

## Consequences

- Current reads are fast while audit evidence remains durable.
- Write paths are more deliberate because ledger and projections must commit
  together.
- Schema migrations must preserve replay semantics and include a projection
  recovery path.
- Integration tests must exercise concurrent reservation/collection,
  fractional quantities, reversal linkage, idempotent retries, and projection
  rebuild equivalence.
- Database roles used by the application will not receive destructive ledger
  privileges in production.

## Rejected alternatives

- Mutable balance-only records: cannot satisfy audit and correction
  requirements.
- Full event sourcing for all application state: introduces unnecessary
  complexity; this decision applies event-like immutability to stock and audit
  facts while retaining purpose-built relational projections.
