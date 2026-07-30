# Catalogue and inventory domain

This package owns StockControl's framework-independent catalogue, exact stock
quantity, availability, and immutable stock-ledger rules.

## Quantity model

`ExactDecimal` stores a bigint coefficient and decimal scale. It never uses a
binary floating-point number, accepts only canonical plain decimal strings, and
does not round unless the caller supplies an explicit rounding scale and mode.
The default stock policy supports six decimal places and 38 significant digits;
deployments can select a stricter policy within the hard resource bounds of 18
decimal places and 38 significant digits.

Catalogue stock is stored in the item's base unit. Built-in definitions cover
indivisible counted items, grams and kilograms, millimetres and metres, and
millilitres and litres. Custom dimensions and exact conversion factors are
supported. Packs convert exactly to base quantities and may independently allow
or forbid fractional pack counts.

## Catalogue model

Tracking mode and handling policy are deliberately separate:

- `QuantityBased` or `Serialized` describes how stock is identified.
- `Consumable`, `PartiallyConsumable`, or `Returnable` describes what issue and
  return mean.

Returnable items must be serialized in the MVP. Serialized assets use the
indivisible counted base unit. `consumeOnIssue` is legal only for consumables.
Identifiers are namespace-and-value exact matches; this package never performs
fuzzy merging. Item identifiers and pack aliases must be unique within a
catalogue item.

## Availability model

`projectAvailability` is a pure projection over validated holdings,
source-specific commitments, confirmed inbound lines, and uncommitted demand.
Only usable, on-hand stock in an explicitly eligible fulfilment location
contributes to availability. Disabled storage, containers, vans, job sites,
custody, quarantine, repair, inactive, expired, unsafe, missing, retired,
written-off, and in-transit stock is excluded. The application derives the
inventory location category from the Locations module's fulfilment policy; it
must not infer eligibility from a location name or client-supplied flag.

Job reservations and user allocations are deducted only from their exact source
holding. Overcommitment, duplicate assets or identities, missing sources, and
item or unit mismatches are rejected. If committed stock later becomes
unavailable, the commitment is surfaced as a shortfall rather than silently
moving to another holding. Projected availability includes confirmed inbound
and deduplicates linked demand by its shared demand identity.

## Ledger and retry model

`createLedgerEntry` produces immutable quantity-or-asset entries with separate
recorded and effective times, actor and effective permission, reason, source or
destination, relations, prior/resulting state changes, and explicit correction
or reversal links. It validates this transport-independent ledger envelope;
command-specific services additionally prove action/state deltas inside the
same transaction. Historical mutation is intentionally not represented.

`resolveIdempotency` implements the ADR 0002 decision boundary: a new scoped key
executes, an identical actor-and-fingerprint retry replays its prior outcome,
and reuse with a different actor or fingerprint is rejected. Persistence must
store the scope, key, fingerprint, actor, outcome, ledger entries, and current
projection updates atomically.

`rebuildProjection` applies caller-provided pure hooks in strict ledger-sequence
order and supplies deterministic rebuild metadata. This package contains no
database or transport code. Repository adapters, row locking, optimistic
versions, and transactional ledger/projection persistence belong to later
application and persistence milestones.
