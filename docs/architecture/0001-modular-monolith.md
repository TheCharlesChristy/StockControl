# ADR 0001: Use a modular monolith

- Status: Accepted
- Date: 2026-07-29
- Demo MVP: live, though the demo needs far fewer modules — see [removal candidates](../demo-mvp-removal-candidates.md) group H9
- Requirements: Archived [product requirements v1.0](../archive/product-requirements-full-v1.md) 15.1 and 15.2

## Context

The MVP has rich, cross-cutting inventory rules but serves a small number of
single-customer installations. Distributed services would add failure modes,
deployment cost, and cross-service consistency problems before they provide
useful scale.

## Decision

Build one deployable application with explicit modules for Catalogue and
Inventory, Locations and Maps, Jobs and Reservations, Allocation and Custody,
Purchasing, Identity and Permissions, Notifications, Audit, and Reporting.

Each module owns its domain model and persistence access. Calls across module
boundaries use exported application interfaces or typed domain events. Modules
must not import another module's internal domain or persistence code. Browser,
HTTP, database, document, and messaging adapters depend inward on application
ports.

Automated dependency rules will enforce the boundaries. Cross-module workflows
will be coordinated in application services and use database transactions where
one atomic business invariant spans modules.

## Consequences

- One process and one PostgreSQL database keep deployment and transactions
  simple.
- Clear boundaries permit later extraction, but extraction is not an MVP goal.
- Shared tables and direct imports across module internals are prohibited even
  though technically possible.
- Unit tests cover domain policies; integration tests cover persistence and
  collaboration between modules; end-to-end tests cover critical journeys.
- A module needs an explicit public contract before another module can use it.

## Rejected alternatives

- Microservices: operational and consistency cost is disproportionate to the
  MVP scale.
- Unstructured layered monolith: easy initially, but it does not protect domain
  boundaries or support safe extension.
