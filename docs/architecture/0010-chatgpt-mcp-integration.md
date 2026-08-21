# ADR 0010: Private ChatGPT MCP integration

- Status: Accepted
- Date: 2026-08-21
- Requirements: private operational assistant, durable auditability, immediate permission revocation

## Context

StockControl needs a deliberately narrow ChatGPT connection for one customer
installation. The connection must answer operational questions as the current
StockControl user and, later, issue a small set of confirmed stock commands.
It must not create a second implementation of inventory rules or create an
audit gap around model-mediated activity.

## Decision

Version one supports one customer installation and one fixed MCP URL. MCP runs
inside the existing NestJS API process; the API and PostgreSQL database remain
private behind the controlled Nginx edge.

Existing application services and the transactional stock engine remain the
only business-operation path. OAuth grants are linked to a current
StockControl user. Effective permission is the intersection of the granted
OAuth scope and the user's live role capability, reloaded for every tool call.
Disabling a user, changing their role, or revoking a grant takes effect on the
next call.

OAuth grant state is mutable only through its dedicated service. MCP tool-call
records, lifecycle events, effect links and command receipts are append-only.
Every call fails closed if its initial `Received` record cannot be written.
Successful writes append their success event, receipt and effect links in the
same PostgreSQL transaction as the business effect. Retryable commands use a
scoped idempotency key and canonical validated-argument fingerprint.

The tool contract is versioned and backward-compatible. The server records the
tool selected, validated argument projection, result summary and business
effect references; it does not store prompts, credentials, cookies, raw
authorization headers, exception stacks or unrestricted response bodies.

## Consequences

- The public edge exposes only `/mcp`, required OAuth metadata and OAuth
  endpoints; normal browser routes continue to use the existing origin guard.
- Read tools can be enabled independently of write tools and are bounded by
  existing activity scoping and explicit page/date limits.
- The activity screen can reconstruct successful, denied, invalid, failed and
  incomplete calls without replaying the model conversation.
- A small reconciliation job must append `Interrupted` for calls left without
  a terminal event after the maximum tool timeout.
- Initial audit data is retained for twelve months; linked business ledger
  records follow their existing retention policy.

## Rejected alternatives

- A separate MCP business service would duplicate authorization and stock rules.
- Storing the original prompt would exceed what the integration needs and
  increase privacy exposure.
- Treating a ChatGPT connection as a permanent role would make role changes
  and immediate revocation unreliable.
