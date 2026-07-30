import { describe, expect, it } from "vitest";

import {
  applicationFailure,
  applicationFailureKinds,
  applicationFailureStatus,
  APPLICATION_FAILURE_POLICY,
  ApplicationFailureError,
  authenticationRequired,
  createFieldErrors,
  failed,
  GENERIC_INTERNAL_FAILURE_DETAIL,
  idempotencyConflict,
  internalFailure,
  isApplicationFailure,
  isFailed,
  isSucceeded,
  MAXIMUM_FAILURE_DETAIL_CHARACTERS,
  MAXIMUM_FAILURE_FIELDS,
  MAXIMUM_FIELD_MESSAGES,
  optimisticConflict,
  permissionDenied,
  problemDetailsForFailure,
  recentAuthenticationRequired,
  resourceExpired,
  resourceUnavailable,
  safeguardApprovalRequired,
  succeeded,
  validationFailed,
  type ApplicationFailureKind,
  type ProblemDetailsContext,
} from "../src/application-failures";

const context: ProblemDetailsContext = {
  instance: "/api/v1/invitations/accept",
  correlationId: "correlation-1",
  timestamp: "2026-07-30T09:00:00.000Z",
};

describe("application failure vocabulary", () => {
  it.each([
    ["AuthenticationRequired", 401, "auth.authentication_required", false],
    ["PermissionDenied", 403, "auth.permission_denied", false],
    ["RecentAuthenticationRequired", 403, "auth.recent_authentication_required", false],
    ["SafeguardApprovalRequired", 403, "safeguard.approval_required", false],
    ["Validation", 422, "request.validation_failed", false],
    ["ResourceUnavailable", 404, "resource.unavailable", false],
    ["ResourceExpired", 410, "resource.expired", false],
    ["IdempotencyConflict", 409, "request.idempotency_conflict", false],
    ["OptimisticConflict", 409, "resource.conflict", true],
    ["InternalFailure", 500, "internal.error", true],
  ] as const)(
    "maps %s to status %i, code %s",
    (kind: ApplicationFailureKind, status, code, retryable) => {
      const policy = APPLICATION_FAILURE_POLICY[kind];

      expect(policy.status).toBe(status);
      expect(policy.code).toBe(code);
      expect(policy.retryable).toBe(retryable);
      expect(applicationFailureStatus(applicationFailure(kind))).toBe(status);
    },
  );

  it("covers every published kind exactly once with a unique code", () => {
    const codes = applicationFailureKinds.map((kind) => APPLICATION_FAILURE_POLICY[kind].code);

    expect(Object.keys(APPLICATION_FAILURE_POLICY).sort()).toEqual(
      [...applicationFailureKinds].sort(),
    );
    expect(new Set(codes).size).toBe(applicationFailureKinds.length);
    expect(Object.isFrozen(APPLICATION_FAILURE_POLICY)).toBe(true);
  });

  it("defaults the detail to the kind's title and freezes the failure", () => {
    const failure = permissionDenied();

    expect(failure).toEqual({
      kind: "PermissionDenied",
      code: "auth.permission_denied",
      detail: "Permission denied",
    });
    expect(Object.isFrozen(failure)).toBe(true);
  });

  it("exposes a named constructor for every kind", () => {
    const constructed = [
      authenticationRequired(),
      permissionDenied(),
      recentAuthenticationRequired(),
      safeguardApprovalRequired(),
      validationFailed({ password: ["Too short"] }),
      resourceUnavailable(),
      resourceExpired(),
      idempotencyConflict(),
      optimisticConflict(),
      internalFailure(),
    ].map(({ kind }) => kind);

    expect(constructed.sort()).toEqual([...applicationFailureKinds].sort());
  });

  it("rejects an unsupported kind supplied at runtime", () => {
    expect(() => applicationFailure("Teapot" as ApplicationFailureKind)).toThrowError(
      expect.objectContaining({ code: "KindUnsupported" }),
    );
  });
});

describe("module-specific codes", () => {
  it("keeps a module code while the kind still fixes the status", () => {
    const failure = resourceExpired({
      code: "identity.invitation_expired",
      detail: "That invitation link has expired. Ask an administrator to reissue it.",
    });

    expect(failure.code).toBe("identity.invitation_expired");
    expect(applicationFailureStatus(failure)).toBe(410);
    expect(problemDetailsForFailure(failure, context)).toMatchObject({
      status: 410,
      code: "identity.invitation_expired",
      title: "Resource expired",
    });
  });

  it("distinguishes two module codes that share one kind and status", () => {
    const invitation = resourceExpired({ code: "identity.invitation_expired" });
    const reset = resourceExpired({ code: "identity.password_reset_expired" });

    expect(invitation.code).not.toBe(reset.code);
    expect(applicationFailureStatus(invitation)).toBe(applicationFailureStatus(reset));
  });

  it.each([
    ["uppercase", "Identity.Invitation"],
    ["single segment", "identity"],
    ["trailing dot", "identity."],
    ["spaces", "identity invitation"],
    ["leading digit", "1identity.invitation"],
    ["empty", ""],
  ])("rejects a %s code", (_label, code) => {
    expect(() => resourceExpired({ code })).toThrowError(
      expect.objectContaining({ code: "CodeInvalid" }),
    );
  });

  it("rejects an over-long code", () => {
    expect(() => resourceExpired({ code: `identity.${"a".repeat(100)}` })).toThrowError(
      ApplicationFailureError,
    );
  });
});

describe("failure detail safety", () => {
  it("trims a supplied detail", () => {
    expect(permissionDenied({ detail: "  You cannot change your own permissions.  " }).detail).toBe(
      "You cannot change your own permissions.",
    );
  });

  it("accepts a detail at the maximum supported length", () => {
    const detail = "a".repeat(MAXIMUM_FAILURE_DETAIL_CHARACTERS);

    expect(permissionDenied({ detail }).detail).toBe(detail);
  });

  it("accepts printable non-ASCII text", () => {
    expect(
      permissionDenied({ detail: "Vous n\u2019avez pas l\u2019autorisation requise." }).detail,
    ).toBe("Vous n\u2019avez pas l\u2019autorisation requise.");
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["over-long", "a".repeat(MAXIMUM_FAILURE_DETAIL_CHARACTERS + 1)],
    ["control character bearing", "Denied\nselect * from users"],
    ["delete character bearing", "Denied\u007fhidden"],
    ["C1 control bearing", "Denied\u0085hidden"],
  ])("rejects a %s detail", (_label, detail) => {
    expect(() => permissionDenied({ detail })).toThrowError(
      expect.objectContaining({ code: "DetailInvalid" }),
    );
  });
});

describe("validation field errors", () => {
  it("sorts fields and freezes the normalised map", () => {
    const failure = validationFailed({
      password: ["  Must contain at least 12 characters  "],
      email: ["Enter a valid email address"],
    });

    expect(Object.keys(failure.errors as Readonly<Record<string, readonly string[]>>)).toEqual([
      "email",
      "password",
    ]);
    expect(failure.errors?.["password"]).toEqual(["Must contain at least 12 characters"]);
    expect(Object.isFrozen(failure.errors)).toBe(true);
    expect(Object.isFrozen(failure.errors?.["email"])).toBe(true);
  });

  it("keeps a module code alongside field errors", () => {
    const failure = validationFailed(
      { password: ["Must contain at least 12 characters"] },
      { code: "identity.password_policy_unmet", detail: "That password cannot be used." },
    );

    expect(failure.code).toBe("identity.password_policy_unmet");
    expect(problemDetailsForFailure(failure, context).errors?.["password"]).toEqual([
      "Must contain at least 12 characters",
    ]);
  });

  it("accepts a dotted and indexed field path", () => {
    const failure = validationFailed({ "lines[0].quantity": ["Enter a quantity"] });

    expect(Object.keys(failure.errors as Readonly<Record<string, readonly string[]>>)).toEqual([
      "lines[0].quantity",
    ]);
  });

  it.each([
    ["no fields", {}],
    [
      "too many fields",
      Object.fromEntries(
        Array.from({ length: MAXIMUM_FAILURE_FIELDS + 1 }, (_, index) => [
          `field${String(index)}`,
          ["Invalid"],
        ]),
      ),
    ],
  ])("rejects %s", (_label, errors) => {
    expect(() => createFieldErrors(errors)).toThrowError(
      expect.objectContaining({ code: "FieldMessagesInvalid" }),
    );
  });

  it.each([
    ["no messages", { email: [] }],
    [
      "too many messages",
      { email: Array.from({ length: MAXIMUM_FIELD_MESSAGES + 1 }, () => "Invalid") },
    ],
  ])("rejects a field with %s", (_label, errors) => {
    expect(() => createFieldErrors(errors)).toThrowError(
      expect.objectContaining({ code: "FieldMessagesInvalid" }),
    );
  });

  it.each([
    ["a space", "email address"],
    ["a slash", "email/address"],
    ["a trailing dot", "email."],
    ["an over-long name", "a".repeat(101)],
  ])("rejects a field name containing %s", (_label, name) => {
    expect(() => createFieldErrors({ [name]: ["Invalid"] })).toThrowError(
      expect.objectContaining({ code: "FieldNameInvalid" }),
    );
  });

  it("rejects an unsafe field message", () => {
    expect(() => createFieldErrors({ email: ["line one\nline two"] })).toThrowError(
      expect.objectContaining({ code: "DetailInvalid" }),
    );
  });
});

describe("problem details mapping", () => {
  it.each([...applicationFailureKinds])("produces a complete problem document for %s", (kind) => {
    const problem = problemDetailsForFailure(applicationFailure(kind), context);

    expect(problem).toEqual({
      type: "about:blank",
      title: APPLICATION_FAILURE_POLICY[kind].title,
      status: APPLICATION_FAILURE_POLICY[kind].status,
      detail:
        kind === "InternalFailure"
          ? GENERIC_INTERNAL_FAILURE_DETAIL
          : APPLICATION_FAILURE_POLICY[kind].title,
      instance: "/api/v1/invitations/accept",
      code: APPLICATION_FAILURE_POLICY[kind].code,
      correlationId: "correlation-1",
      timestamp: "2026-07-30T09:00:00.000Z",
    });
    expect(Object.isFrozen(problem)).toBe(true);
  });

  it("omits the errors member when a failure carries none", () => {
    expect(problemDetailsForFailure(permissionDenied(), context)).not.toHaveProperty("errors");
  });

  it("never discloses internal detail, code, or fields for an unexpected failure", () => {
    const problem = problemDetailsForFailure(
      internalFailure('relation "identity_users" does not exist'),
      context,
    );

    expect(problem.detail).toBe(GENERIC_INTERNAL_FAILURE_DETAIL);
    expect(problem.code).toBe("internal.error");
    expect(problem).not.toHaveProperty("errors");
    expect(JSON.stringify(problem)).not.toContain("identity_users");
  });

  it("carries the correlation identifier and request path from the transport", () => {
    const problem = problemDetailsForFailure(authenticationRequired(), {
      instance: "/api/v1/sessions/current",
      correlationId: "correlation-2",
      timestamp: "2026-07-30T10:00:00.000Z",
    });

    expect(problem.instance).toBe("/api/v1/sessions/current");
    expect(problem.correlationId).toBe("correlation-2");
    expect(problem.timestamp).toBe("2026-07-30T10:00:00.000Z");
  });
});

describe("application results", () => {
  it("carries a succeeded value", () => {
    const result = succeeded({ id: "user-1" });

    expect(isSucceeded(result)).toBe(true);
    expect(isFailed(result)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);

    if (isSucceeded(result)) {
      expect(result.value).toEqual({ id: "user-1" });
    }
  });

  it("carries a failure", () => {
    const result = failed(permissionDenied());

    expect(isFailed(result)).toBe(true);
    expect(isSucceeded(result)).toBe(false);

    if (isFailed(result)) {
      expect(result.failure.kind).toBe("PermissionDenied");
    }
  });

  it("recognises a failure at a trust boundary", () => {
    expect(isApplicationFailure(permissionDenied())).toBe(true);
    expect(isApplicationFailure(internalFailure())).toBe(true);
    expect(isApplicationFailure(null)).toBe(false);
    expect(isApplicationFailure("PermissionDenied")).toBe(false);
    expect(isApplicationFailure({ kind: "Teapot", code: "a.b", detail: "x" })).toBe(false);
    expect(isApplicationFailure({ kind: "PermissionDenied", detail: "x" })).toBe(false);
    expect(isApplicationFailure({ kind: "PermissionDenied", code: "a.b" })).toBe(false);
  });
});
