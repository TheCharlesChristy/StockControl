import { describe, expect, it } from "vitest";

import {
  DEFAULT_IDENTITY_SECURITY_POLICY,
  IDENTITY_SECURITY_LIMITS,
  assertAuthenticationAssurance,
  authenticationArtifactExpiry,
  createIdentitySecurityPolicy,
  createSessionWindow,
  hasRecentAuthentication,
  isSessionExpired,
  refreshSessionWindow,
  type AuthenticationPolicyError,
} from "../src/identity/policies/authentication-policy";

const instant = (value: string): Date => new Date(value);

describe("identity security policy", () => {
  it("locks the approved defaults and returns an immutable validated policy", () => {
    expect(DEFAULT_IDENTITY_SECURITY_POLICY).toEqual({
      standardSessionIdleSeconds: 7_200,
      adminSessionIdleSeconds: 1_800,
      sessionAbsoluteSeconds: 43_200,
      recentAuthenticationSeconds: 900,
      authenticationChallengeSeconds: 600,
      invitationSeconds: 259_200,
      passwordResetSeconds: 3_600,
    });
    expect(Object.isFrozen(DEFAULT_IDENTITY_SECURITY_POLICY)).toBe(true);
    expect(createIdentitySecurityPolicy(DEFAULT_IDENTITY_SECURITY_POLICY)).toEqual(
      DEFAULT_IDENTITY_SECURITY_POLICY,
    );
  });

  it.each([
    ["standardSessionIdleSeconds", 59],
    ["standardSessionIdleSeconds", 7_201],
    ["adminSessionIdleSeconds", 1_801],
    ["sessionAbsoluteSeconds", 43_201],
    ["recentAuthenticationSeconds", 3_601],
    ["authenticationChallengeSeconds", 3_601],
    ["invitationSeconds", 259_201],
    ["passwordResetSeconds", 3_601],
    ["passwordResetSeconds", 60.5],
  ] as const)("rejects an unsafe %s value", (field, value) => {
    expect(() =>
      createIdentitySecurityPolicy({
        ...DEFAULT_IDENTITY_SECURITY_POLICY,
        [field]: value,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AuthenticationPolicyError>>({
        code: "PolicyValueInvalid",
      }),
    );
  });

  it("rejects invalid relationships between shorter configured limits", () => {
    expect(() =>
      createIdentitySecurityPolicy({
        ...DEFAULT_IDENTITY_SECURITY_POLICY,
        adminSessionIdleSeconds: 1_800,
        standardSessionIdleSeconds: 1_200,
      }),
    ).toThrowError(expect.objectContaining({ code: "PolicyRelationshipInvalid" }));
    expect(() =>
      createIdentitySecurityPolicy({
        ...DEFAULT_IDENTITY_SECURITY_POLICY,
        standardSessionIdleSeconds: 3_600,
        sessionAbsoluteSeconds: 1_800,
      }),
    ).toThrowError(expect.objectContaining({ code: "PolicyRelationshipInvalid" }));
  });

  it("publishes the hard product ceilings", () => {
    expect(IDENTITY_SECURITY_LIMITS).toMatchObject({
      maximumStandardSessionIdleSeconds: 7_200,
      maximumAdminSessionIdleSeconds: 1_800,
      maximumSessionAbsoluteSeconds: 43_200,
      maximumInvitationSeconds: 259_200,
    });
  });
});

describe("authentication assurance", () => {
  it("requires MFA for every Admin session", () => {
    expect(() => assertAuthenticationAssurance("Admin", true, "Password")).toThrowError(
      expect.objectContaining({ code: "AdminMfaRequired" }),
    );
    expect(() => assertAuthenticationAssurance("Admin", false, "MultiFactor")).toThrowError(
      expect.objectContaining({ code: "AdminMfaRequired" }),
    );
    expect(() => assertAuthenticationAssurance("Admin", true, "MultiFactor")).not.toThrow();
  });

  it("allows password sessions for other roles but never invents MFA assurance", () => {
    expect(() => assertAuthenticationAssurance("Engineer", false, "Password")).not.toThrow();
    expect(() => assertAuthenticationAssurance("Office", true, "MultiFactor")).not.toThrow();
    expect(() => assertAuthenticationAssurance("Office", false, "MultiFactor")).toThrowError(
      expect.objectContaining({ code: "MfaAssuranceUnavailable" }),
    );
  });
});

describe("session windows", () => {
  const issuedAt = instant("2026-07-29T10:00:00.000Z");

  it("creates role-aware idle windows with one absolute ceiling", () => {
    const standard = createSessionWindow("Engineer", issuedAt, DEFAULT_IDENTITY_SECURITY_POLICY);
    const admin = createSessionWindow("Admin", issuedAt, DEFAULT_IDENTITY_SECURITY_POLICY);

    expect(standard).toEqual({
      issuedAt,
      lastSeenAt: issuedAt,
      idleExpiresAt: instant("2026-07-29T12:00:00.000Z"),
      absoluteExpiresAt: instant("2026-07-29T22:00:00.000Z"),
    });
    expect(admin.idleExpiresAt).toEqual(instant("2026-07-29T10:30:00.000Z"));
    expect(admin.absoluteExpiresAt).toEqual(standard.absoluteExpiresAt);
    expect(Object.isFrozen(admin)).toBe(true);
  });

  it("refreshes activity monotonically without passing the absolute expiry", () => {
    const original = createSessionWindow("Office", issuedAt, DEFAULT_IDENTITY_SECURITY_POLICY);
    const nearExpiry = refreshSessionWindow({
      role: "Office",
      previous: original,
      activityAt: instant("2026-07-29T21:30:00.000Z"),
      policy: DEFAULT_IDENTITY_SECURITY_POLICY,
    });

    expect(nearExpiry.lastSeenAt).toEqual(instant("2026-07-29T21:30:00.000Z"));
    expect(nearExpiry.idleExpiresAt).toEqual(original.absoluteExpiresAt);
    expect(original.lastSeenAt).toEqual(issuedAt);
  });

  it("rejects backwards activity and refresh after absolute expiry", () => {
    const original = createSessionWindow("Office", issuedAt, DEFAULT_IDENTITY_SECURITY_POLICY);

    expect(() =>
      refreshSessionWindow({
        role: "Office",
        previous: original,
        activityAt: instant("2026-07-29T09:59:59.999Z"),
        policy: DEFAULT_IDENTITY_SECURITY_POLICY,
      }),
    ).toThrowError(expect.objectContaining({ code: "ActivityBeforePreviousActivity" }));
    expect(() =>
      refreshSessionWindow({
        role: "Office",
        previous: original,
        activityAt: original.absoluteExpiresAt,
        policy: DEFAULT_IDENTITY_SECURITY_POLICY,
      }),
    ).toThrowError(expect.objectContaining({ code: "SessionAlreadyExpired" }));
  });

  it("treats either idle or absolute boundary as expired", () => {
    const session = createSessionWindow("Engineer", issuedAt, DEFAULT_IDENTITY_SECURITY_POLICY);

    expect(isSessionExpired(session, instant("2026-07-29T11:59:59.999Z"))).toBe(false);
    expect(isSessionExpired(session, session.idleExpiresAt)).toBe(true);
    expect(
      isSessionExpired(
        {
          idleExpiresAt: instant("2026-07-30T00:00:00.000Z"),
          absoluteExpiresAt: session.absoluteExpiresAt,
        },
        session.absoluteExpiresAt,
      ),
    ).toBe(true);
  });
});

describe("recent authentication and expiring artifacts", () => {
  const createdAt = instant("2026-07-29T10:00:00.000Z");

  it("accepts only a non-future authentication inside the configured window", () => {
    expect(
      hasRecentAuthentication(
        createdAt,
        instant("2026-07-29T10:15:00.000Z"),
        DEFAULT_IDENTITY_SECURITY_POLICY,
      ),
    ).toBe(true);
    expect(
      hasRecentAuthentication(
        createdAt,
        instant("2026-07-29T10:15:00.001Z"),
        DEFAULT_IDENTITY_SECURITY_POLICY,
      ),
    ).toBe(false);
    expect(
      hasRecentAuthentication(
        instant("2026-07-29T10:00:01.000Z"),
        createdAt,
        DEFAULT_IDENTITY_SECURITY_POLICY,
      ),
    ).toBe(false);
  });

  it("derives challenge, invitation, and reset expiry from one policy", () => {
    expect(
      authenticationArtifactExpiry(
        "AuthenticationChallenge",
        createdAt,
        DEFAULT_IDENTITY_SECURITY_POLICY,
      ),
    ).toEqual(instant("2026-07-29T10:10:00.000Z"));
    expect(
      authenticationArtifactExpiry("Invitation", createdAt, DEFAULT_IDENTITY_SECURITY_POLICY),
    ).toEqual(instant("2026-08-01T10:00:00.000Z"));
    expect(
      authenticationArtifactExpiry("PasswordReset", createdAt, DEFAULT_IDENTITY_SECURITY_POLICY),
    ).toEqual(instant("2026-07-29T11:00:00.000Z"));
  });

  it("rejects invalid input instants instead of producing immortal sessions", () => {
    const invalid = new Date(Number.NaN);
    expect(() =>
      createSessionWindow("Engineer", invalid, DEFAULT_IDENTITY_SECURITY_POLICY),
    ).toThrowError(expect.objectContaining({ code: "InstantInvalid" }));
    expect(() =>
      hasRecentAuthentication(createdAt, invalid, DEFAULT_IDENTITY_SECURITY_POLICY),
    ).toThrowError(expect.objectContaining({ code: "InstantInvalid" }));
  });
});
