# Identity persistence

This package is the PostgreSQL/Kysely adapter for the framework-independent
identity persistence ports. It stores only hashes for bearer, invitation,
recovery, reset, rate-limit and bootstrap tokens. CSRF tokens are signed,
session-bound, and intentionally not persisted. TOTP material is stored only as
a versioned authenticated-encryption envelope produced by the authentication
layer; encryption keys are never stored in PostgreSQL.

`KyselyIdentityUnitOfWork` runs every operation in a serializable transaction
and exposes one frozen set of repositories bound to that transaction. This is
required for access mutations: callers lock the complete administrative roster,
evaluate the final-capable-Admin policy, write the user and permission changes,
append the audit event, and commit as one operation. The deferred database
constraint is defence in depth and is deliberately inactive until bootstrap
completes. Callers should keep the whole security decision inside one
`execute(...)` callback; composing independently committed repository calls
would lose those guarantees.

The unit of work requires an `IdentityAuditIntegrity` implementation. Audit
append owns the chain-head lock, assigns the next sequence, validates and
canonicalises the event, asks that implementation to seal the exact persisted
content, and advances the head with the insert in one statement. Signers must
keep their HMAC keys outside PostgreSQL and support their own key-rotation
policy. Invalid signer output, signer failure, or a chain-head compare-and-swap
conflict fails closed; no unsigned or orphan audit event is accepted.

Rows use optimistic integer versions. An update returning `undefined` means the
record was missing, terminal already, or changed concurrently; application
services must treat that as a conflict instead of silently retrying a
security-sensitive decision.

Opaque IDs are application-generated UUIDs. SHA-256 digest inputs are exactly
32 bytes. Users are soft-disabled rather than deleted, which preserves session,
approval, invitation, and audit history.

Recovery codes are scoped to both a user and the exact TOTP credential that
issued them. Availability checks and revocation use that pair, while lookup and
consumption additionally require the owning user and credential to remain
active. Rotating or revoking a TOTP credential therefore cannot make codes from
an older credential usable against a newer one.
