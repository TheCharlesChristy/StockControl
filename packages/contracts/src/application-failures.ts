import type { ProblemDetails } from "./observability";

/**
 * The shared application result and failure vocabulary.
 *
 * Every application command and protected query returns one of these outcomes.
 * The kind fixes the HTTP status and the safe default code; a module may
 * supply its own stable code so a client can distinguish, for example, an
 * expired invitation from an expired password-reset token without the
 * transport layer inventing a second vocabulary.
 *
 * A failure never carries an exception message, SQL, a connection string, a
 * stack trace, or any secret. Detail text is written for the person using the
 * product.
 */

export const applicationFailureKinds = [
  "AuthenticationRequired",
  "PermissionDenied",
  "RecentAuthenticationRequired",
  "SafeguardApprovalRequired",
  "Validation",
  "ResourceUnavailable",
  "ResourceExpired",
  "IdempotencyConflict",
  "OptimisticConflict",
  "InternalFailure",
] as const;

export type ApplicationFailureKind = (typeof applicationFailureKinds)[number];

export interface ApplicationFailurePolicy {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  /** True when an unchanged, immediate retry can reasonably succeed. */
  readonly retryable: boolean;
}

/**
 * Authorisation outcomes deliberately share HTTP 403 and are distinguished by
 * their stable code: the status tells a browser what happened, the code tells
 * the client which remedy to offer.
 */
export const APPLICATION_FAILURE_POLICY: Readonly<
  Record<ApplicationFailureKind, ApplicationFailurePolicy>
> = Object.freeze({
  AuthenticationRequired: Object.freeze({
    status: 401,
    code: "auth.authentication_required",
    title: "Authentication required",
    retryable: false,
  }),
  PermissionDenied: Object.freeze({
    status: 403,
    code: "auth.permission_denied",
    title: "Permission denied",
    retryable: false,
  }),
  RecentAuthenticationRequired: Object.freeze({
    status: 403,
    code: "auth.recent_authentication_required",
    title: "Recent authentication required",
    retryable: false,
  }),
  SafeguardApprovalRequired: Object.freeze({
    status: 403,
    code: "safeguard.approval_required",
    title: "Safeguard approval required",
    retryable: false,
  }),
  Validation: Object.freeze({
    status: 422,
    code: "request.validation_failed",
    title: "Validation failed",
    retryable: false,
  }),
  ResourceUnavailable: Object.freeze({
    status: 404,
    code: "resource.unavailable",
    title: "Resource unavailable",
    retryable: false,
  }),
  ResourceExpired: Object.freeze({
    status: 410,
    code: "resource.expired",
    title: "Resource expired",
    retryable: false,
  }),
  IdempotencyConflict: Object.freeze({
    status: 409,
    code: "request.idempotency_conflict",
    title: "Idempotency conflict",
    retryable: false,
  }),
  OptimisticConflict: Object.freeze({
    status: 409,
    code: "resource.conflict",
    title: "Resource conflict",
    retryable: true,
  }),
  InternalFailure: Object.freeze({
    status: 500,
    code: "internal.error",
    title: "Internal server error",
    retryable: true,
  }),
});

export const GENERIC_INTERNAL_FAILURE_DETAIL = "An unexpected error occurred.";

export const MAXIMUM_FAILURE_DETAIL_CHARACTERS = 300;
export const MAXIMUM_FAILURE_FIELDS = 50;
export const MAXIMUM_FIELD_MESSAGES = 10;
export const MAXIMUM_FIELD_NAME_CHARACTERS = 100;

const APPLICATION_CODE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]+)+$/u;
const FIELD_NAME_PATTERN = /^[A-Za-z0-9_](?:[A-Za-z0-9_.[\]-]{0,98}[A-Za-z0-9_\]])?$/u;

export type ApplicationFailureErrorCode =
  "CodeInvalid" | "DetailInvalid" | "FieldNameInvalid" | "FieldMessagesInvalid" | "KindUnsupported";

export class ApplicationFailureError extends Error {
  public constructor(
    public readonly code: ApplicationFailureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationFailureError";
  }
}

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export interface ApplicationFailure {
  readonly kind: ApplicationFailureKind;
  /** The default code for the kind, or the owning module's stable code. */
  readonly code: string;
  /** Safe, client-facing text. Never an exception message. */
  readonly detail: string;
  readonly errors?: FieldErrors;
}

export interface ApplicationFailureOptions {
  readonly code?: string;
  readonly detail?: string;
  readonly errors?: FieldErrors;
}

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });

const requireDetail = (value: string): string => {
  const detail = value.trim();

  if (
    detail.length < 1 ||
    detail.length > MAXIMUM_FAILURE_DETAIL_CHARACTERS ||
    containsControlCharacter(detail)
  ) {
    throw new ApplicationFailureError(
      "DetailInvalid",
      `A failure detail must contain 1-${String(MAXIMUM_FAILURE_DETAIL_CHARACTERS)} printable characters.`,
    );
  }

  return detail;
};

const requireCode = (value: string): string => {
  if (!APPLICATION_CODE_PATTERN.test(value) || value.length > MAXIMUM_FIELD_NAME_CHARACTERS) {
    throw new ApplicationFailureError(
      "CodeInvalid",
      "An application failure code must be lowercase dot-separated segments, such as identity.invitation_expired.",
    );
  }

  return value;
};

/**
 * Normalises and sorts field errors so the same validation outcome always
 * serialises identically, and so an unbounded or malformed error map cannot
 * reach a response.
 */
export const createFieldErrors = (errors: FieldErrors): FieldErrors => {
  const names = Object.keys(errors).sort();

  if (names.length < 1 || names.length > MAXIMUM_FAILURE_FIELDS) {
    throw new ApplicationFailureError(
      "FieldMessagesInvalid",
      `Field errors must describe 1-${String(MAXIMUM_FAILURE_FIELDS)} fields.`,
    );
  }

  const normalised: Record<string, readonly string[]> = {};

  for (const name of names) {
    if (!FIELD_NAME_PATTERN.test(name)) {
      throw new ApplicationFailureError(
        "FieldNameInvalid",
        `A field name must contain 1-${String(MAXIMUM_FIELD_NAME_CHARACTERS)} safe path characters.`,
      );
    }

    const messages = errors[name] as readonly string[];

    if (messages.length < 1 || messages.length > MAXIMUM_FIELD_MESSAGES) {
      throw new ApplicationFailureError(
        "FieldMessagesInvalid",
        `Each field must carry 1-${String(MAXIMUM_FIELD_MESSAGES)} messages.`,
      );
    }

    normalised[name] = Object.freeze(messages.map((message) => requireDetail(message)));
  }

  return Object.freeze(normalised);
};

/*
 * A widened view of the policy table. An unsupported kind can still arrive at
 * runtime from persisted or transport data, so the lookup must be able to miss.
 */
const failurePolicies: Readonly<Record<string, ApplicationFailurePolicy | undefined>> =
  APPLICATION_FAILURE_POLICY;

export const applicationFailure = (
  kind: ApplicationFailureKind,
  options: ApplicationFailureOptions = {},
): ApplicationFailure => {
  const policy = failurePolicies[kind];

  if (policy === undefined) {
    throw new ApplicationFailureError(
      "KindUnsupported",
      "An application failure must use a supported kind.",
    );
  }

  const errors = options.errors === undefined ? undefined : createFieldErrors(options.errors);

  return Object.freeze({
    kind,
    code: options.code === undefined ? policy.code : requireCode(options.code),
    detail: options.detail === undefined ? policy.title : requireDetail(options.detail),
    ...(errors === undefined ? {} : { errors }),
  });
};

export const authenticationRequired = (options?: ApplicationFailureOptions): ApplicationFailure =>
  applicationFailure("AuthenticationRequired", options);

export const permissionDenied = (options?: ApplicationFailureOptions): ApplicationFailure =>
  applicationFailure("PermissionDenied", options);

export const recentAuthenticationRequired = (
  options?: ApplicationFailureOptions,
): ApplicationFailure => applicationFailure("RecentAuthenticationRequired", options);

export const safeguardApprovalRequired = (
  options?: ApplicationFailureOptions,
): ApplicationFailure => applicationFailure("SafeguardApprovalRequired", options);

export const validationFailed = (
  errors: FieldErrors,
  options?: Omit<ApplicationFailureOptions, "errors">,
): ApplicationFailure => applicationFailure("Validation", { ...options, errors });

export const resourceUnavailable = (options?: ApplicationFailureOptions): ApplicationFailure =>
  applicationFailure("ResourceUnavailable", options);

export const resourceExpired = (options?: ApplicationFailureOptions): ApplicationFailure =>
  applicationFailure("ResourceExpired", options);

export const idempotencyConflict = (options?: ApplicationFailureOptions): ApplicationFailure =>
  applicationFailure("IdempotencyConflict", options);

export const optimisticConflict = (options?: ApplicationFailureOptions): ApplicationFailure =>
  applicationFailure("OptimisticConflict", options);

/**
 * An unexpected failure. Any supplied detail is for the server-side log only;
 * the response always carries the generic detail and the generic code.
 */
export const internalFailure = (logOnlyDetail?: string): ApplicationFailure =>
  Object.freeze({
    kind: "InternalFailure",
    code: APPLICATION_FAILURE_POLICY.InternalFailure.code,
    detail: logOnlyDetail === undefined ? GENERIC_INTERNAL_FAILURE_DETAIL : logOnlyDetail,
  });

export interface SucceededResult<Value> {
  readonly ok: true;
  readonly value: Value;
}

export interface FailedResult {
  readonly ok: false;
  readonly failure: ApplicationFailure;
}

export type ApplicationResult<Value> = SucceededResult<Value> | FailedResult;

export const succeeded = <Value>(value: Value): SucceededResult<Value> =>
  Object.freeze({ ok: true, value });

export const failed = (failure: ApplicationFailure): FailedResult =>
  Object.freeze({ ok: false, failure });

export const isSucceeded = <Value>(
  result: ApplicationResult<Value>,
): result is SucceededResult<Value> => result.ok;

export const isFailed = <Value>(result: ApplicationResult<Value>): result is FailedResult =>
  !result.ok;

export const applicationFailureStatus = (failure: ApplicationFailure): number =>
  APPLICATION_FAILURE_POLICY[failure.kind].status;

export interface ProblemDetailsContext {
  /** The request path the failure applies to. */
  readonly instance: string;
  readonly correlationId: string;
  readonly timestamp: string;
}

/**
 * Maps a failure onto the wire contract. The module's code and field errors
 * are preserved for every kind except `InternalFailure`, whose detail, code,
 * and errors are always replaced so an unexpected condition cannot disclose
 * internal state.
 */
export const problemDetailsForFailure = (
  failure: ApplicationFailure,
  context: ProblemDetailsContext,
): ProblemDetails => {
  const policy = APPLICATION_FAILURE_POLICY[failure.kind];
  const internal = failure.kind === "InternalFailure";

  return Object.freeze({
    type: "about:blank",
    title: policy.title,
    status: policy.status,
    detail: internal ? GENERIC_INTERNAL_FAILURE_DETAIL : failure.detail,
    instance: context.instance,
    code: internal ? policy.code : failure.code,
    correlationId: context.correlationId,
    timestamp: context.timestamp,
    ...(failure.errors === undefined || internal ? {} : { errors: failure.errors }),
  });
};

export const isApplicationFailure = (value: unknown): value is ApplicationFailure => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ApplicationFailure>;

  return (
    typeof candidate.kind === "string" &&
    (applicationFailureKinds as readonly string[]).includes(candidate.kind) &&
    typeof candidate.code === "string" &&
    typeof candidate.detail === "string"
  );
};
