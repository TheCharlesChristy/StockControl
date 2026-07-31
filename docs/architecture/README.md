# Architecture decisions

This directory records decisions that shape StockControl. Decisions are
numbered, immutable once accepted, and superseded by a later ADR rather than
silently rewritten.

The [demo MVP baseline](../product-requirements.md) defers five of these
capabilities. Their ADRs are kept rather than deleted so the reasoning survives
until the capability returns.

| ADR                                                | Decision                                    | Demo MVP status |
| -------------------------------------------------- | ------------------------------------------- | --------------- |
| [0001](./0001-modular-monolith.md)                 | Modular monolith                            | Live            |
| [0002](./0002-immutable-ledger-and-projections.md) | Immutable ledger and current projections    | Deferred        |
| [0003](./0003-authentication-and-sessions.md)      | Authentication and sessions                 | Live, reduced   |
| [0004](./0004-postgresql-jobs-and-outbox.md)       | PostgreSQL jobs and transactional outbox    | Deferred        |
| [0005](./0005-rest-and-openapi.md)                 | REST and OpenAPI                            | Live, reduced   |
| [0006](./0006-private-documents-and-pdf.md)        | Private document storage and PDF generation | In progress     |
| [0007](./0007-abstract-location-maps.md)           | Abstract location maps                      | Implemented     |
| [0008](./0008-lightsail-deployment-and-backups.md) | AWS Lightsail deployment and backups        | Deferred        |

## Decision process

1. Create a proposed ADR from the same headings used below.
2. Link the affected product requirement and identify security, data,
   permissions, testing, and deployment effects.
3. Obtain review from the domain owner and an operational reviewer.
4. Mark the ADR accepted before implementation depends on it.
5. If a decision changes, add a superseding ADR and update this index.
