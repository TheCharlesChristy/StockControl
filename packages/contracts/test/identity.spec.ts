import { describe, expect, it } from "vitest";

import {
  AUTH_CSRF_HEADER,
  isAuthenticatedSessionView,
  isAuthenticatedUserView,
  isSessionResponse,
  isSignInResponse,
} from "../src/identity";

const user = {
  id: "01K4USER",
  email: "admin@example.com",
  displayName: "Admin Owner",
  role: "Admin",
  status: "Active",
  effectiveCapabilities: ["inventory.view", "users.manage"],
  permissionCatalogueVersion: 1,
  mfaEnabled: true,
} as const;

const session = {
  user,
  assurance: "mfa",
  issuedAt: "2026-07-29T09:00:00.000Z",
  idleExpiresAt: "2026-07-29T09:30:00.000Z",
  absoluteExpiresAt: "2026-07-29T21:00:00.000Z",
  recentlyAuthenticatedAt: "2026-07-29T09:00:00.000Z",
} as const;

describe("identity HTTP contract guards", () => {
  it("publishes the CSRF header shared by browser and API", () => {
    expect(AUTH_CSRF_HEADER).toBe("x-csrf-token");
  });

  it("accepts a complete active user and session envelope", () => {
    expect(isAuthenticatedUserView(user)).toBe(true);
    expect(isAuthenticatedSessionView(session)).toBe(true);
    expect(isSessionResponse({ session })).toBe(true);
  });

  it.each([
    null,
    {},
    { ...user, id: "" },
    { ...user, email: "" },
    { ...user, displayName: "" },
    { ...user, role: "Owner" },
    { ...user, status: "Invited" },
    { ...user, effectiveCapabilities: ["inventory.view", "inventory.view"] },
    { ...user, effectiveCapabilities: [""] },
    { ...user, effectiveCapabilities: "inventory.view" },
    { ...user, permissionCatalogueVersion: 0 },
    { ...user, permissionCatalogueVersion: 1.5 },
    { ...user, mfaEnabled: "yes" },
    { ...user, mfaEnabled: false },
  ])("rejects an invalid authenticated user: %j", (candidate) => {
    expect(isAuthenticatedUserView(candidate)).toBe(false);
  });

  it.each([
    null,
    {},
    { ...session, user: {} },
    { ...session, assurance: "hardware_key" },
    { ...session, issuedAt: "2026-07-29" },
    { ...session, idleExpiresAt: "not-a-date" },
    { ...session, absoluteExpiresAt: 123 },
    { ...session, recentlyAuthenticatedAt: "2026-02-30T09:00:00Z" },
    { ...session, assurance: "password" },
    {
      ...session,
      user: { ...session.user, role: "Office", mfaEnabled: false },
      assurance: "mfa",
    },
    { ...session, recentlyAuthenticatedAt: "2026-07-29T08:59:59Z" },
    { ...session, idleExpiresAt: "2026-07-29T21:00:00.001Z" },
    { ...session, idleExpiresAt: session.issuedAt },
  ])("rejects an invalid authenticated session: %j", (candidate) => {
    expect(isAuthenticatedSessionView(candidate)).toBe(false);
  });

  it("accepts completed and MFA-required sign-in outcomes", () => {
    expect(
      isSignInResponse({
        outcome: "authenticated",
        session,
      }),
    ).toBe(true);
    expect(
      isSignInResponse({
        outcome: "mfa_required",
        challenge: {
          id: "challenge-1",
          expiresAt: "2026-07-29T09:05:00Z",
          methods: ["totp", "recovery_code"],
        },
      }),
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { outcome: "authenticated", session: {} },
    { outcome: "unknown" },
    { outcome: "mfa_required", challenge: null },
    {
      outcome: "mfa_required",
      challenge: {
        id: "",
        expiresAt: "2026-07-29T09:05:00Z",
        methods: ["totp"],
      },
    },
    {
      outcome: "mfa_required",
      challenge: {
        id: "challenge-1",
        expiresAt: "tomorrow",
        methods: ["totp"],
      },
    },
    {
      outcome: "mfa_required",
      challenge: {
        id: "challenge-1",
        expiresAt: "2026-07-29T09:05:00Z",
        methods: [],
      },
    },
    {
      outcome: "mfa_required",
      challenge: {
        id: "challenge-1",
        expiresAt: "2026-07-29T09:05:00Z",
        methods: ["sms"],
      },
    },
    {
      outcome: "mfa_required",
      challenge: {
        id: "challenge-1",
        expiresAt: "2026-07-29T09:05:00Z",
        methods: ["totp", "totp"],
      },
    },
  ])("rejects an invalid sign-in response: %j", (candidate) => {
    expect(isSignInResponse(candidate)).toBe(false);
  });
});
