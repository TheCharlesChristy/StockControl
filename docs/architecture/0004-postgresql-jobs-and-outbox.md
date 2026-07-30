# ADR 0004: Use PostgreSQL for durable jobs and a transactional outbox

- Status: Accepted, deferred beyond the demo MVP
- Date: 2026-07-29
- Demo MVP: deferred by [demo requirements v2.0](../product-requirements.md) section 10; retained for when the capability returns
- Requirements: Archived [product requirements v1.0](../archive/product-requirements-full-v1.md) 5, 12.3, 13, and 15.2

## Context

Reservation expiry, reminders, notification escalation, document generation,
and maintenance need durable asynchronous work. The MVP already depends on
PostgreSQL and does not justify a separate broker. Business events must not be
lost between committing domain state and scheduling follow-up work.

## Decision

Persist domain events to an outbox table in the same transaction as their
domain changes. A worker claims ready rows in short transactions using
`FOR UPDATE SKIP LOCKED`, records attempts, and dispatches idempotent handlers.

Persist scheduled work in a jobs table with type, versioned payload, run-at
time, attempt count, lease owner/expiry, and deduplication key. Workers claim
bounded batches, extend leases for long work, and use exponential backoff with
jitter. After a configured attempt limit, jobs move to a failed state and
create an actionable operational notification; they are not silently dropped.

Use PostgreSQL advisory locks only to prevent duplicate scheduler ticks or
singleton maintenance, never as the durable record of work. Store timestamps in
UTC and derive recurring reminders from business deadlines and stable
deduplication keys.

Outbox consumers and job handlers must be idempotent. Completed outbox and job
records are retained long enough for incident investigation, then removed by a
documented housekeeping job without touching immutable business audit records.

## Consequences

- Domain commit and event publication are atomic.
- The deployment needs a worker process, queue-depth/oldest-age metrics, and
  alerts for stuck leases and repeated failures.
- Integration tests use real PostgreSQL 18 and cover crashes after claim,
  duplicate delivery, concurrent workers, retries, and dead-letter handling.
- A dedicated broker may be introduced later behind the dispatcher interface if
  measured load requires it.

## Rejected alternatives

- In-memory timers: work is lost on restart and cannot be safely scaled.
- A message broker at MVP launch: adds operational complexity without a current
  throughput need.
- Calling external effects before commit: can publish work for a transaction
  that later rolls back.
