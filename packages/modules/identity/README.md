# Identity and Permissions domain

This package owns StockControl's framework-independent user, role-template, and
effective-permission rules.

The V1 permission catalogue and the three standard role templates are immutable
domain definitions. Per-user settings use `UseRoleDefault`, `Allow`, or `Deny`;
resolution always applies explicit Deny, then explicit Allow, then the role
default. Contextual item, job, van, approval-limit, separation-of-duties, and
reasoned-override checks belong to their owning modules and run after this
capability decision.

The access-mutation and final-capable-Admin policies accept transaction
projections rather than performing persistence. An application service should
lock the affected users, build the projected post-change roster, evaluate both
policies, write the change and audit record, and commit as one transaction.

## Application ports

`src/identity/ports` declares everything an Identity use case may depend on.
Node, PostgreSQL, HTTP, and deployment code implement these ports; the module
never imports an implementation, so every use case can run against
deterministic fakes.

- `security.ts`: clock, UUID generator, Argon2id password hashing, the
  deployment-generated dummy password hash, purpose-separated opaque tokens,
  TOTP, encrypted TOTP secrets, and recovery codes.
- `delivery.ts`: the versioned AEAD delivery-secret envelope, the
  transaction-bound delivery scheduler, expired-envelope cleanup, and key
  retirement.
- `policy.ts`: installation identity plus the security-policy and rate-limit
  defaults.
- `request-context.ts`: the trusted actor and bounded network facts.
- `application.ts`: `IdentityApplicationPorts`, the single bundle a use case
  receives.

Each token purpose has a distinct stable hash domain, so an invitation token
can never validate against a session, reset, bootstrap, or challenge record.

### Trusted facts

The actor, session, correlation ID, remote address, user agent, and
installation are resolved by the host from the authenticated session and the
transport connection. `assertNoUntrustedActorFacts` rejects a command body that
carries any of them rather than ignoring it, so a command must name its target
explicitly (`subjectUserId`) instead of reusing `userId`. A remote address is
accepted only as a 32-byte digest, so no raw address or persistent device
fingerprint can be stored.

### Delivery secrets

A raw invitation or password-reset link is a bearer credential and must never
reach a log, an audit record, or a plaintext durable job payload. The
scheduling transaction seals it in a versioned AEAD envelope bound to the
envelope version, purpose, job ID, recipient identity, token record, and
installation; the delivery handler opens it immediately before composing the
message. `keyId` and `expiresAt` stay external and authenticated so a
maintenance job can re-encrypt or delete rows without opening them.

### Test adapters

Every deterministic fake carries the `deterministicTestAdapter` marker.
Production composition calls `assertNoDeterministicTestAdapters` and refuses to
start when a marked adapter is present.

Authentication use cases, invitations, sessions, and persistence
implementations are intentionally outside this first domain slice.
