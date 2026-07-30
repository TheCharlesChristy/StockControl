import { describe, expect, it } from "vitest";

import { isFailed, isSucceeded } from "../src/application-failures";
import {
  buildCommandAuthorizationContext,
  CommandContextError,
  evaluateContextualAuthorisation,
  evaluateOverride,
  isRecentlyAuthenticated,
  MAXIMUM_COMMAND_REASON_CHARACTERS,
  resolveCapabilityDecision,
  validateCommandReason,
  type CapabilityDecision,
  type CommandActor,
  type CommandAuthorizationRequest,
  type ContextualRule,
} from "../src/application-context";

const NOW = "2026-07-30T09:00:00.000Z";

const actor = (overrides: Partial<CommandActor> = {}): CommandActor => ({
  userId: "user-1",
  role: "Office",
  assurance: "password",
  authenticatedAt: "2026-07-30T08:55:00.000Z",
  ...overrides,
});

const baseRequest = (
  overrides: Partial<CommandAuthorizationRequest> = {},
): CommandAuthorizationRequest => ({
  actor: actor(),
  capability: { roleDefaultAllowed: true, setting: "UseRoleDefault" },
  nowIso: NOW,
  ...overrides,
});

describe("resolveCapabilityDecision", () => {
  it.each([
    [true, "UseRoleDefault", true, "RoleDefault"],
    [false, "UseRoleDefault", false, "RoleDefault"],
    [true, "Allow", true, "ExplicitAllow"],
    [false, "Allow", true, "ExplicitAllow"],
    [true, "Deny", false, "ExplicitDeny"],
    [false, "Deny", false, "ExplicitDeny"],
  ] as const)(
    "roleDefault=%s, setting=%s -> allowed=%s, provenance=%s",
    (roleDefaultAllowed, setting, allowed, provenance) => {
      const decision = resolveCapabilityDecision({ roleDefaultAllowed, setting });

      expect(decision).toEqual({ allowed, provenance });
      expect(Object.isFrozen(decision)).toBe(true);
    },
  );

  it("lets an explicit Deny win even when the role default and any Allow-like context would permit it", () => {
    const denied = resolveCapabilityDecision({ roleDefaultAllowed: true, setting: "Deny" });

    expect(denied.allowed).toBe(false);
    expect(denied.provenance).toBe("ExplicitDeny");
  });
});

describe("evaluateContextualAuthorisation", () => {
  const allowedCapability: CapabilityDecision = { allowed: true, provenance: "RoleDefault" };
  const deniedCapability: CapabilityDecision = { allowed: false, provenance: "ExplicitDeny" };

  it("denies by capability before any contextual rule is evaluated", () => {
    const rules: ContextualRule[] = [{ name: "van.entitlement", allowed: true }];

    expect(evaluateContextualAuthorisation(deniedCapability, rules)).toEqual({
      allowed: false,
      nonOverrideable: false,
      deniedBy: "capability",
    });
  });

  it("allows when the capability is granted and no contextual rule denies it", () => {
    expect(
      evaluateContextualAuthorisation(allowedCapability, [
        { name: "collector.entitlement", allowed: true },
      ]),
    ).toEqual({ allowed: true, nonOverrideable: false });
  });

  it("allows with no contextual rules supplied", () => {
    expect(evaluateContextualAuthorisation(allowedCapability)).toEqual({
      allowed: true,
      nonOverrideable: false,
    });
  });

  it("denies on the first failing contextual rule and names it", () => {
    const decision = evaluateContextualAuthorisation(allowedCapability, [
      { name: "collector.entitlement", allowed: true },
      { name: "item.sensitive-authorisation", allowed: false },
      { name: "van.entitlement", allowed: false },
    ]);

    expect(decision).toEqual({
      allowed: false,
      nonOverrideable: false,
      deniedBy: "item.sensitive-authorisation",
    });
  });

  it("surfaces a contextual rule's non-overrideable marker", () => {
    const decision = evaluateContextualAuthorisation(allowedCapability, [
      { name: "final-admin.protection", allowed: false, nonOverrideable: true },
    ]);

    expect(decision.nonOverrideable).toBe(true);
    expect(decision.deniedBy).toBe("final-admin.protection");
  });
});

describe("evaluateOverride", () => {
  const overrideable = { allowed: false, nonOverrideable: false, deniedBy: "capability" } as const;
  const nonOverrideable = {
    allowed: false,
    nonOverrideable: true,
    deniedBy: "final-admin",
  } as const;
  const alreadyAllowed = { allowed: true, nonOverrideable: false } as const;

  it("does nothing when the decision is already allowed", () => {
    expect(
      evaluateOverride(alreadyAllowed, true, { requested: true, reason: "Emergency issue" }),
    ).toEqual({ applied: false });
  });

  it("never applies to a non-overrideable denial even for a capable, requesting actor", () => {
    expect(
      evaluateOverride(nonOverrideable, true, { requested: true, reason: "Emergency issue" }),
    ).toEqual({ applied: false });
  });

  it("applies for a capable actor with a requested override and a usable reason", () => {
    expect(
      evaluateOverride(overrideable, true, { requested: true, reason: "  Approved by owner  " }),
    ).toEqual({ applied: true, reason: "Approved by owner" });
  });

  it("does not apply when the actor lacks override capability", () => {
    expect(
      evaluateOverride(overrideable, false, { requested: true, reason: "Emergency issue" }),
    ).toEqual({ applied: false });
  });

  it("does not apply when no override was requested", () => {
    expect(evaluateOverride(overrideable, true, { requested: false })).toEqual({ applied: false });
    expect(evaluateOverride(overrideable, true)).toEqual({ applied: false });
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["over-long", "a".repeat(MAXIMUM_COMMAND_REASON_CHARACTERS + 1)],
    ["control character bearing", "reason\nwith newline"],
  ])("does not apply with a %s reason", (_label, reason) => {
    expect(evaluateOverride(overrideable, true, { requested: true, reason })).toEqual({
      applied: false,
    });
  });
});

describe("validateCommandReason", () => {
  it("returns undefined when a reason is not required and none is supplied", () => {
    expect(validateCommandReason(undefined, false)).toBeUndefined();
  });

  it("throws when a reason is required and none is supplied", () => {
    expect(() => validateCommandReason(undefined, true)).toThrowError(
      expect.objectContaining({ code: "ReasonInvalid" }),
    );
  });

  it("trims a valid supplied reason", () => {
    expect(validateCommandReason("  Issued for job JOB-42  ", true)).toBe("Issued for job JOB-42");
  });

  it("accepts a reason at the maximum supported length", () => {
    const reason = "a".repeat(MAXIMUM_COMMAND_REASON_CHARACTERS);

    expect(validateCommandReason(reason, true)).toBe(reason);
  });

  it.each([
    ["blank", "   "],
    ["over-long", "a".repeat(MAXIMUM_COMMAND_REASON_CHARACTERS + 1)],
    ["control character bearing", "reason\nline two"],
    ["delete character bearing", "reason\u007fhidden"],
    ["C1 control bearing", "reason\u0085hidden"],
  ])("rejects a %s reason even when not required", (_label, reason) => {
    expect(() => validateCommandReason(reason, false)).toThrowError(CommandContextError);
  });
});

describe("isRecentlyAuthenticated", () => {
  it("is true at and before the boundary and false just after it", () => {
    expect(isRecentlyAuthenticated("2026-07-30T08:59:00.000Z", NOW, 60)).toBe(true);
    expect(isRecentlyAuthenticated("2026-07-30T08:58:59.999Z", NOW, 60)).toBe(false);
  });

  it("is true for an authentication at exactly now", () => {
    expect(isRecentlyAuthenticated(NOW, NOW, 0)).toBe(true);
  });

  it("is false for an authentication instant after now", () => {
    expect(isRecentlyAuthenticated("2026-07-30T09:00:00.001Z", NOW, 60)).toBe(false);
  });

  it.each([
    ["an invalid authenticatedAt", "not-a-date", NOW, 60],
    ["an invalid nowIso", NOW, "not-a-date", 60],
    ["a negative window", NOW, NOW, -1],
    ["a fractional window", NOW, NOW, 1.5],
  ])("throws for %s", (_label, authenticatedAt, nowIso, requiredSeconds) => {
    expect(() => isRecentlyAuthenticated(authenticatedAt, nowIso, requiredSeconds)).toThrowError(
      expect.objectContaining({ code: "InstantInvalid" }),
    );
  });
});

describe("buildCommandAuthorizationContext", () => {
  it("fails before any other check when there is no actor", () => {
    const result = buildCommandAuthorizationContext(baseRequest({ actor: undefined }));

    expect(isFailed(result)).toBe(true);
    if (isFailed(result)) {
      expect(result.failure.kind).toBe("AuthenticationRequired");
    }
  });

  it("succeeds and retains the acting identity as the represented identity by default", () => {
    const result = buildCommandAuthorizationContext(baseRequest());

    expect(isSucceeded(result)).toBe(true);
    if (isSucceeded(result)) {
      expect(result.value.actorUserId).toBe("user-1");
      expect(result.value.representedUserId).toBe("user-1");
    }
  });

  it("retains both the acting and represented identities when they differ and authorisation is granted", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({ representedUserId: "user-2", representedUserAuthorized: true }),
    );

    expect(isSucceeded(result)).toBe(true);
    if (isSucceeded(result)) {
      expect(result.value.actorUserId).toBe("user-1");
      expect(result.value.representedUserId).toBe("user-2");
    }
  });

  it("denies acting on behalf of another user without explicit authorisation", () => {
    const result = buildCommandAuthorizationContext(baseRequest({ representedUserId: "user-2" }));

    expect(isFailed(result)).toBe(true);
    if (isFailed(result)) {
      expect(result.failure.kind).toBe("PermissionDenied");
      expect(result.failure.code).toBe("command.represented_user_not_authorized");
    }
  });

  it("denies when the effective capability is an explicit Deny", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({ capability: { roleDefaultAllowed: true, setting: "Deny" } }),
    );

    expect(isFailed(result)).toBe(true);
    if (isFailed(result)) {
      expect(result.failure.kind).toBe("PermissionDenied");
    }
  });

  it("allows a denied decision through a valid, capable, requested override", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({
        capability: { roleDefaultAllowed: true, setting: "Deny" },
        actorCanOverride: true,
        override: { requested: true, reason: "Admin emergency override" },
      }),
    );

    expect(isSucceeded(result)).toBe(true);
    if (isSucceeded(result)) {
      expect(result.value.override).toEqual({
        applied: true,
        reason: "Admin emergency override",
      });
    }
  });

  it("fails when a non-overrideable contextual denial is present even with a capable override request", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({
        contextualRules: [
          { name: "final-admin.protection", allowed: false, nonOverrideable: true },
        ],
        actorCanOverride: true,
        override: { requested: true, reason: "Admin emergency override" },
      }),
    );

    expect(isFailed(result)).toBe(true);
    if (isFailed(result)) {
      expect(result.failure.kind).toBe("PermissionDenied");
    }
  });

  it("fails before reason and recent-authentication checks are relevant when unauthenticated", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({
        actor: undefined,
        reasonRequired: true,
        recentAuthenticationRequiredSeconds: 60,
      }),
    );

    expect(isFailed(result)).toBe(true);
    if (isFailed(result)) {
      expect(result.failure.kind).toBe("AuthenticationRequired");
    }
  });

  it("fails with RecentAuthenticationRequired when the safeguard is not met", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({
        actor: actor({ authenticatedAt: "2026-07-30T08:00:00.000Z" }),
        recentAuthenticationRequiredSeconds: 60,
      }),
    );

    expect(isFailed(result)).toBe(true);
    if (isFailed(result)) {
      expect(result.failure.kind).toBe("RecentAuthenticationRequired");
    }
  });

  it("succeeds when the recent-authentication safeguard is met", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({ recentAuthenticationRequiredSeconds: 300 }),
    );

    expect(isSucceeded(result)).toBe(true);
    if (isSucceeded(result)) {
      expect(result.value.recentlyAuthenticated).toBe(true);
    }
  });

  it("treats recent authentication as satisfied when the command has no such safeguard", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({ actor: actor({ authenticatedAt: "2020-01-01T00:00:00.000Z" }) }),
    );

    expect(isSucceeded(result)).toBe(true);
    if (isSucceeded(result)) {
      expect(result.value.recentlyAuthenticated).toBe(true);
    }
  });

  it("fails with a Validation failure and a reason field error when a mandatory reason is missing", () => {
    const result = buildCommandAuthorizationContext(baseRequest({ reasonRequired: true }));

    expect(isFailed(result)).toBe(true);
    if (isFailed(result)) {
      expect(result.failure.kind).toBe("Validation");
      expect(result.failure.errors).toHaveProperty("reason");
    }
  });

  it("succeeds and carries a valid reason when required and supplied", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({ reasonRequired: true, reason: "  Writing off damaged stock  " }),
    );

    expect(isSucceeded(result)).toBe(true);
    if (isSucceeded(result)) {
      expect(result.value.reason).toBe("Writing off damaged stock");
    }
  });

  it("checks recent authentication before the mandatory-reason safeguard", () => {
    const result = buildCommandAuthorizationContext(
      baseRequest({
        actor: actor({ authenticatedAt: "2026-07-30T08:00:00.000Z" }),
        recentAuthenticationRequiredSeconds: 60,
        reasonRequired: true,
      }),
    );

    expect(isFailed(result)).toBe(true);
    if (isFailed(result)) {
      expect(result.failure.kind).toBe("RecentAuthenticationRequired");
    }
  });

  it("returns a frozen, complete context on success", () => {
    const result = buildCommandAuthorizationContext(baseRequest());

    expect(isSucceeded(result)).toBe(true);
    if (isSucceeded(result)) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(result.value.role).toBe("Office");
      expect(result.value.capability).toEqual({ allowed: true, provenance: "RoleDefault" });
      expect(result.value.authorisation).toEqual({ allowed: true, nonOverrideable: false });
    }
  });
});
