# Architecture decisions

This directory records decisions that shape the StockControl MVP. Decisions are
numbered, immutable once accepted, and superseded by a later ADR rather than
silently rewritten.

| ADR                                                | Decision                                    | Status   |
| -------------------------------------------------- | ------------------------------------------- | -------- |
| [0001](./0001-modular-monolith.md)                 | Modular monolith                            | Accepted |
| [0002](./0002-immutable-ledger-and-projections.md) | Immutable ledger and current projections    | Accepted |
| [0003](./0003-authentication-and-sessions.md)      | Authentication and sessions                 | Accepted |
| [0004](./0004-postgresql-jobs-and-outbox.md)       | PostgreSQL jobs and transactional outbox    | Accepted |
| [0005](./0005-rest-and-openapi.md)                 | REST and OpenAPI                            | Accepted |
| [0006](./0006-private-documents-and-pdf.md)        | Private document storage and PDF generation | Accepted |
| [0007](./0007-abstract-location-maps.md)           | Abstract location maps                      | Accepted |
| [0008](./0008-lightsail-deployment-and-backups.md) | AWS Lightsail deployment and backups        | Accepted |

## Decision process

1. Create a proposed ADR from the same headings used below.
2. Link the affected product requirement and identify security, data,
   permissions, testing, and deployment effects.
3. Obtain review from the domain owner and an operational reviewer.
4. Mark the ADR accepted before implementation depends on it.
5. If a decision changes, add a superseding ADR and update this index and the
   requirements traceability matrix.
