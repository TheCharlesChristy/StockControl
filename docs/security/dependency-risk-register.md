# Dependency risk register

This register records dependency advisories that cannot yet be removed without
creating a more severe or incompatible dependency state. Every exception must
have an owner, an explicit mitigation, and a review trigger.

`pnpm audit --audit-level high` runs in the CI quality job, so a new
high-severity advisory fails the build rather than waiting to be noticed. An
advisory that cannot be fixed must be recorded here **and** downgraded out of
the gate deliberately — never by loosening the CI step.

Advisories are resolved by pinning through `overrides` in `pnpm-workspace.yaml`
when the direct dependency has not yet released a fixed range.

## Resolved by override

| Advisory                | Package           | Pinned to | Reached through                         |
| ----------------------- | ----------------- | --------- | --------------------------------------- |
| `GHSA-7p8r-x3mc-p8w7`   | `fast-uri`        | `^3.1.5`  | fastify → `@fastify/ajv-compiler`       |
| `GHSA-7p8r-x3mc-p8w7`   | `fast-uri`        | `^4.1.2`  | fastify → `fast-json-stringify`         |
| unbounded expansion DoS | `brace-expansion` | `^5.0.9`  | eslint → `minimatch` (development only) |

Remove each override once the intermediate dependency ships a range that already
excludes the vulnerable versions; the audit step will prove whether it is still
needed.

## React Router 6.30.1

- **Status:** Temporarily accepted for the M0 browser shell.
- **Advisories:** `GHSA-9jcx-v3wj-wh4m`, `GHSA-2j2x-hqr9-3h42`,
  `GHSA-wrjc-x8rr-h8h6`, and `GHSA-337j-9hxr-rhxg`.
- **Why not upgrade now:** The currently available Router 7 releases that fix
  these moderate issues are affected by a high-severity RSC action advisory.
  Router 8.3.0 is named as the complete fix but is not published in the package
  registry.
- **Exposure:** StockControl is a client-rendered SPA. It does not enable React
  Server Components, server-side rendering, hydration deserialization,
  `ScrollRestoration`, framework actions, or the single-fetch protocol.
- **Mitigation:** Redirect destinations are created internally by the protected
  route guard. The sign-in redirect validator rejects protocol-relative paths,
  backslashes, external origins, malformed values, and the sign-in loop.
  Server authorization never relies on client routes.
- **Verification:** `pnpm audit --audit-level high` must remain clean — these
  four are moderate, so they sit below the CI gate by design rather than by
  exception. Browser and route tests cover protected redirects and authenticated
  navigation.
- **Review trigger:** Reassess on every React Router release and replace this
  entry as soon as a registry release resolves both the Router 6 redirect/SSR
  advisories and the Router 7 RSC advisory.
