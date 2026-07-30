# ADR 0005: Use versioned REST APIs described by OpenAPI

- Status: Accepted
- Date: 2026-07-29
- Requirements: Product requirements 4, 12.2, and 15.2

## Context

The responsive web application, QR links, CSV interfaces, and future supported
integrations need stable typed contracts. The MVP does not require multiple API
styles or public integration breadth.

## Decision

Expose application capabilities through JSON-over-HTTPS REST endpoints under
`/api/v1`. Describe request, response, authentication, error, pagination, and
idempotency contracts in an OpenAPI 3.1 document generated from or checked
against the server's typed route schemas.

Use nouns for resources and explicit action subresources when a domain command
is not honest CRUD, for example reservation approval or asset acceptance.
Represent money and fractional quantities as decimal strings. Represent times
as ISO 8601 UTC instants and dates as calendar dates. Return a consistent
problem-details error shape with a correlation identifier.

All authorisation is enforced server-side on every command and query. QR codes
contain stable application URLs or opaque record identifiers, never authority.
Retryable stock-changing endpoints require an idempotency key and follow ADR 0002.

Treat the checked OpenAPI document as a versioned external interface. CI will
validate it and use generated types or contract tests once routes exist.
Breaking changes require a new API version or an explicitly managed migration.

## Consequences

- Browser and server share testable, typed contracts.
- The API remains understandable with standard tooling.
- Route handlers must translate HTTP concerns into application commands and
  must not contain business rules.
- Contract, authorisation, malformed-input, and duplicate-retry tests are
  required.

## Rejected alternatives

- GraphQL: adds schema and authorisation complexity without an MVP need.
- Screen-specific unversioned endpoints: couple domain behaviour to the current
  interface and make QR and integration contracts unstable.
