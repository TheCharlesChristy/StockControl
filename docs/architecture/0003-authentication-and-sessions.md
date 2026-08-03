# ADR 0003: Use local authentication with server-side sessions

- Status: Accepted
- Date: 2026-07-29
- Production MVP exception (2026-08-03): password-only authentication is approved for the first small Railway installation. It enforces 15-to-128-character passwords, strengthened scrypt hashing, opaque session tokens stored only as hashes, exact-origin checks, and sign-in throttling. Application MFA, invitations, self-service/email password resets, recent-authentication, and durable security-event storage remain follow-up work. A narrowly scoped operator Admin recovery command is implemented for this MVP and atomically revokes that Admin's sessions; this ADR records the target design.
- Requirements: Archived [product requirements v1.0](../archive/product-requirements-full-v1.md) 9.2, 9.3, and 12.3

## Context

The MVP is invite-only, has no company single sign-on, requires named accounts,
and makes MFA mandatory for Admins. Disabling users and password resets must
invalidate active sessions. Sensitive actions require recent authentication.

## Decision

Implement email/password authentication inside the Identity and Permissions
module using a maintained password-hashing library configured for Argon2id.
Store only normalised email identifiers and password hashes. Parameters are
versioned so hashes can be upgraded after successful authentication.

Use TOTP as the MVP second factor. Encrypt TOTP seeds with an application
encryption key held outside source control. Store one-way hashes of single-use
recovery codes. Admin enrolment is incomplete until a TOTP challenge succeeds
and recovery codes are acknowledged.

Use opaque, high-entropy session identifiers in Secure, HttpOnly, SameSite
cookies. Store a hash of the identifier, user, issued time, last activity,
absolute expiry, recent-authentication time, and revocation time in PostgreSQL.
Apply CSRF protection to state-changing browser requests. Rotate the identifier
after authentication and privilege changes.

Enforce the specified two-hour standard idle timeout, 30-minute Admin idle
timeout, and 12-hour absolute timeout by default. Disabling a user or completing
a password reset revokes all sessions in the same transaction. Authentication,
MFA, recovery, rate-limit, and revocation events create security audit records.

Invitations and password resets use single-use, short-lived, hashed tokens.
Rate limits are keyed by account and network source without creating persistent
device fingerprints.

## Consequences

- Session revocation and recent-authentication checks are immediate.
- The application must protect password, session, TOTP, and recovery flows as
  security-critical code and keep encryption keys in the deployment secret
  store.
- Tests cover MFA enforcement, timing/expiry, rotation, revocation, recovery,
  final-Admin protection, rate limiting, and permission checks.
- Future SSO can be added behind an authentication-provider port without
  changing effective permissions or audit policy.

## Rejected alternatives

- Long-lived self-contained browser tokens: make immediate revocation and
  recent-authentication policy harder.
- SMS MFA: adds external delivery, cost, and weaker assurance not required by
  the MVP.
- Shared accounts: explicitly prohibited by the requirements.
