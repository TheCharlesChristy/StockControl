# What changed and why

<!-- The problem, then the change. A reviewer should not have to read the diff
     to find out what you were trying to do. -->

## How it was verified

<!-- What you actually ran, and what you saw. `pnpm run quality` and
     `pnpm run test:coverage` are the baseline; say so if a change needed the
     integration suite, the browser journey, or a real deployment. -->

## Checks that this repository cares about

Delete any line that does not apply, rather than ticking it blindly.

- [ ] Any new route calls `requireCapability`, or the reason it does not is
      stated here.
- [ ] No new `@Public()` decorator — or, if there is one, what it exposes and
      why that is safe.
- [ ] A new migration adds its grants for the runtime role, and its `down`
      reverses its `up`.
- [ ] Nothing that could carry a secret is written to a log or an error
      response. Connection strings arrive inside driver error messages.
- [ ] `pnpm audit --audit-level high` is clean, or the exception is recorded in
      `docs/security/dependency-risk-register.md`.
- [ ] Coverage thresholds moved up, not down. They are ratchet floors.
- [ ] Configuration a deployment needs is in `.env.example` and the Railway
      runbook, and production has no silently inferred fallback.

## Anything a reviewer should look at hardest

<!-- The part you are least sure about. -->
