# `@stockcontrol/contracts`

Externally visible request, response, and error contracts shared by the API,
the web application, and the domain modules. This package has no runtime
dependencies and contains no business rules: a type or guard here describes
what crosses a boundary, not what the product decides.

## Application failure vocabulary

Every application command and protected query returns an
`ApplicationResult<Value>`: either `succeeded(value)` or `failed(failure)`. A
failure names one of ten kinds, and the kind fixes the HTTP status, the safe
default code, and the title.

| Kind                           | Status | Default code                          | Retryable |
| ------------------------------ | -----: | ------------------------------------- | --------- |
| `AuthenticationRequired`       |    401 | `auth.authentication_required`        | No        |
| `PermissionDenied`             |    403 | `auth.permission_denied`              | No        |
| `RecentAuthenticationRequired` |    403 | `auth.recent_authentication_required` | No        |
| `SafeguardApprovalRequired`    |    403 | `safeguard.approval_required`         | No        |
| `ResourceUnavailable`          |    404 | `resource.unavailable`                | No        |
| `IdempotencyConflict`          |    409 | `request.idempotency_conflict`        | No        |
| `OptimisticConflict`           |    409 | `resource.conflict`                   | Yes       |
| `ResourceExpired`              |    410 | `resource.expired`                    | No        |
| `Validation`                   |    422 | `request.validation_failed`           | No        |
| `InternalFailure`              |    500 | `internal.error`                      | Yes       |

The four authorisation outcomes deliberately share HTTP 403. The status tells
a browser what happened; the stable code tells the client which remedy to
offer — ask for a password, ask for a second approver, or explain that the
action is not permitted at all.

### Module-specific codes

A module supplies its own code so a client can distinguish outcomes that share
a kind, for example `identity.invitation_expired` from
`identity.password_reset_expired`. The kind still fixes the status, so the
transport layer never invents a second vocabulary. Codes are lowercase
dot-separated segments and are validated when the failure is constructed.

### Safety rules

- A failure detail is client-facing text written for the person using the
  product. It is never an exception message, SQL, a connection string, or a
  stack trace, and it is bounded and rejected if it contains control
  characters.
- Validation field errors are normalised, sorted, bounded, and frozen, so the
  same outcome always serialises identically.
- `InternalFailure` is the one kind whose content is replaced on the way out:
  `problemDetailsForFailure` always emits the generic detail and
  `internal.error`, and drops any field errors. Any detail passed to
  `internalFailure` is for the server-side log only.

### Transport

`ApplicationFailureException` in `@stockcontrol/platform` carries a failure
across the HTTP boundary, and `ProblemDetailsExceptionFilter` renders it as
`application/problem+json` with the correlation identifier. A route handler
never chooses a status or an error code itself.

Exceptions raised by the framework rather than by an application command —
an unknown route, a malformed request the router rejects — keep the existing
generic `http.<status>` code. Only application outcomes use this vocabulary.
