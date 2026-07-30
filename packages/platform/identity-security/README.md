# `@stockcontrol/platform-identity-security`

Dependency-free (apart from Node itself), injectable security primitives for StockControl's identity module. This package deliberately owns cryptographic mechanics, not authentication workflows, database access, HTTP framework integration, password composition rules, or authorization decisions.

## Runtime contract

- Node **24.7 or newer** is required because the implementation uses the built-in asynchronous `node:crypto` Argon2 API.
- Production composition uses `NodeRandomSource`, `SystemClock`, and `NodeCryptoArgon2idDeriver`.
- Tests may inject `RandomSource`, `Clock`, and `Argon2idDeriver`. Deterministic test adapters must never be composed into a production process.
- The Node Argon2 API is currently marked release-candidate by Node. Keep the adapter boundary: a runtime or implementation change must not leak into identity use cases or persisted encodings.

## Password hashes

`PasswordHashingService` uses Argon2id with the locked current policy:

| Parameter                     |               Value |
| ----------------------------- | ------------------: |
| StockControl encoding version |                   1 |
| Argon2 version                |                  19 |
| Memory                        | 65,536 KiB (64 MiB) |
| Passes                        |                   3 |
| Parallelism                   |                   1 |
| Salt                          |     16 random bytes |
| Tag                           |            32 bytes |

The persisted PHC-style value is:

```text
$sc-argon2id$v=1$a=19,m=65536,t=3,p=1,l=32$<base64url-salt>$<base64url-tag>
```

Parsing is bounded before Argon2 runs so a corrupted or malicious database value cannot request unbounded memory or CPU. A small, explicitly bounded legacy parameter range is verifiable and reports `needsRehash`; all new hashes use the locked current policy. The service erases its UTF-8 password buffer in `finally`, although JavaScript strings and copies retained by an injected adapter cannot be reliably erased. Enforce the product's password creation policy in the identity application layer; this primitive only enforces a 1–1,024 UTF-8 byte resource bound.

Do not log passwords, hashes, KDF inputs, timing details, or authentication failure distinctions.

For an unknown email address, the sign-in use case must still verify the submitted password against a real, deployment-generated dummy hash using this service. Otherwise account lookup plus KDF timing can disclose whether an account exists. Return one generic failure for unknown accounts, wrong passwords, disabled accounts, and malformed credential records.

## Opaque and session tokens

`OpaqueTokenService` issues 32–64 random bytes encoded as canonical base64url. Its one-time result contains the raw token and a domain-separated SHA-256 digest. Persist only the digest. Use a distinct stable lowercase domain per purpose so an invitation token cannot be replayed as a session or reset token.

`PersistedTokenHash` is deliberately not a textual encoding. It is a nominally branded value containing exactly 32 raw bytes for a PostgreSQL `BYTEA` column. Hydrate database bytes only through `createPersistedTokenHash`, which validates the exact length and returns a defensive copy. Pass only a fresh `persistedTokenHashBytes` copy to the database driver. Hex, base64, PHC-style, and version-prefixed strings are not accepted; supporting more than one representation would make equality and migration behavior ambiguous.

`SessionTokenService` fixes the domain to `identity.session`. Set its raw token only in the cookie described by `SESSION_COOKIE`:

- `__Host-stockcontrol_session`
- `Secure`
- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- no `Domain` attribute (required by the `__Host-` prefix)

The cookie definition intentionally excludes expiry; the identity session policy owns idle and absolute expiry. Rotate the raw session token after sign-in, MFA, privilege changes, and reauthentication. Never place it in a URL, log, event payload, or database column.

SHA-256 is appropriate here because issued tokens contain at least 256 random bits. It is not a substitute for Argon2 on user-chosen passwords.

## TOTP

`TotpService` implements RFC 6238 using RFC 4226 HMAC-SHA1, six digits, a 30-second period, and a 160-bit secret. SHA-1 is retained only because the standards require interoperable HMAC-SHA1; this is not collision-sensitive plain SHA-1.

The verification window is configurable as exactly zero or one counter either side. The default is one. A successful result returns the matched counter. The caller **must atomically compare and advance** the credential's `lastAcceptedCounter` in the same transaction as accepting the factor. Without a row lock or compare-and-swap update, concurrent requests could replay one code.

The enrollment result (secret and provisioning URI) is display-once material. TOTP cannot be verified from a hash, so encrypt it with `TotpSecretEncryptionService` before it crosses the persistence boundary. The locked version-1 envelope uses AES-256-GCM with an exact 32-byte key, a fresh 12-byte nonce, and a 16-byte authentication tag. Its fields map directly to `encryptionVersion`, `keyId`, `nonce`, `ciphertext`, and `authTag` database fields.

Encryption authenticates length-delimited purpose, version, key ID, user ID, and credential ID as additional data. A credential ciphertext therefore cannot be moved to another user, credential, purpose, version, or key identifier. Supply an active key and retained decryption keys during rotation. A successful decryption under a retained key returns `needsReencrypt: true`; re-encrypt that credential under the active key before retiring the old key. Keys must be generated and managed outside the database and source control. Every decrypt failure is the same `InvalidEncryptedTotpSecretError` so callers cannot distinguish a corrupt row, wrong context, missing key, unsupported version, or failed tag.

Never store the seed in plaintext or include it, encryption keys, plaintext/ciphertext buffers, provisioning material, or detailed decrypt failures in logs, analytics, error details, audit events, or unencrypted backups. The service clears temporary byte buffers where the JavaScript runtime permits, but immutable strings and copies inside Node cannot be reliably erased. Keep hosts time-synchronized.

## Recovery codes

The default issue contains ten independent 80-bit base32 codes. Show the formatted codes exactly once and persist only the domain-separated SHA-256 hashes. `consume` evaluates every persisted hash and removes every matching entry, protecting single-use semantics even if storage was accidentally duplicated.

The caller must replace the remaining hash set atomically under a lock or compare-and-swap operation. A successful comparison without an atomic delete is not consumption. Generate a new full set after recovery and invalidate the old set.

## Audit integrity

`HmacIdentityAuditIntegrity` seals the canonical persisted representation of each identity audit event with HMAC-SHA256. The seal includes version `1`, a safe key identifier, and an exact 32-byte event hash. The canonical input covers the chain sequence and previous hash as well as every event field, including sorted JSON details, so changing content or chain position invalidates verification.

Configure one active key and any retained verification keys during rotation. Key identifiers are part of the authenticated content and must be unique. Keys must contain 32 to 128 random bytes and remain outside PostgreSQL and source control. New events always use the active key; retained keys exist only to verify historical events until the applicable retention window has ended.

The PostgreSQL audit repository owns sequence assignment, chain-head locking, canonical input validation, sealing, and insertion inside the same serializable transaction. Application code supplies event content only; it must never supply a sequence or hash. Treat signing failures, unknown keys, malformed content, and chain-head conflicts as closed failures, and never fall back to unsigned audit records.

## Signed double-submit CSRF

`CsrfTokenService` creates a random nonce signed with HMAC-SHA256 and bound to a stable, server-side session identifier (prefer the persisted session ID or token hash, never the raw session token). Configure an active key plus prior verification keys during rotation. Keys must be generated outside this package, contain at least 32 random bytes, be supplied through the deployment secret mechanism, and never be stored beside application data.

Set the issued value as `CSRF_COOKIE` and return that same value once from the CSRF endpoint so the browser can send it in `x-csrf-token`. The cookie is intentionally `HttpOnly`: the client obtains the header value from the endpoint response rather than reading cookies. Verification requires:

1. exact constant-time equality of the bounded cookie and header values;
2. a valid signature from the active or retained rotation key; and
3. the same server-side session binding.

Sign-in, first-run bootstrap, invitation acceptance, and password-reset mutations happen before an authenticated session exists. For those routes only, use `issuePreAuthentication` and `verifyPreAuthentication`, which bind the signed double-submit token to the stable non-secret `PRE_AUTH_CSRF_BINDING`. Keep the token endpoint same-origin with no permissive CORS response, and apply the exact-origin and Fetch Metadata policy to each mutation. The random signed nonce, inaccessible cookie, matching header, and origin policy provide the browser-specific proof; the stable binding is not an authentication credential.

After authentication succeeds, discard the pre-authentication token and immediately issue a new token bound to the persisted session identifier. A pre-authentication token must never authorize an authenticated mutation. Issue another session-bound CSRF value whenever the session identifier rotates. CSRF defenses do not mitigate XSS.

All HTTP responses containing a raw token, recovery code, TOTP secret, provisioning URI, or CSRF header value must use `Cache-Control: no-store` and must not be captured by access-log bodies, tracing attributes, analytics, or error reporting.

## Origin and Fetch Metadata policy

`BrowserRequestPolicy` treats `GET`, `HEAD`, and `OPTIONS` as safe. Every other method requires an exact configured HTTP(S) `Origin`. When Fetch Metadata is present, only `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: cors|same-origin` are accepted. Deployments may require both headers after confirming every supported client emits them.

Apply this policy before executing authenticated mutations, then verify the signed CSRF token. It supplements—not replaces—TLS, restrictive CORS, CSP, secure cookies, authentication, authorization, and input validation. Configure exact origins such as `https://stock.example`; paths, trailing slashes, credentials, wildcards, and sibling subdomains are rejected.

## Operational rules

- Secret-bearing issuance objects are the only APIs that return newly generated raw secrets. Treat them as write-only/display-once values.
- Persist opaque-token and recovery-code hashes only. Persist password PHC values. Encrypt TOTP secrets. Do not persist CSRF values or raw session tokens.
- Do not serialize service instances or signing keyrings.
- Do not expose KDF parameters, token byte lengths, clocks, or verification windows to untrusted request input.
- Bound concurrent password derivations to the host's memory budget in addition to per-account and per-network rate limits; each current-policy derivation deliberately consumes about 64 MiB.
- Rate limiting, lockout policy, session lifetime, MFA recovery approval, audit events, and transactional replay protection belong in the identity application/persistence layers.
- Errors in persisted cryptographic material indicate corruption or an unsupported deployment version. Convert them to a generic authentication failure externally while alerting operators without secret values.
