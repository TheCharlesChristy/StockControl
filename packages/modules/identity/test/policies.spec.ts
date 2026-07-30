import { describe, expect, it } from "vitest";

import { evaluateAccessMutationPolicy } from "../src/identity/policies/access-mutation-policy";
import {
  evaluateFinalCapableAdminProtection,
  finalCapableAdminRequiredCapabilities,
  isActiveCapableAdmin,
  type AdministrativeUserProjection,
} from "../src/identity/policies/final-capable-admin-policy";
import { userId } from "../src/identity/value-objects";

function projectedUser(
  suffix: string,
  overrides: Partial<AdministrativeUserProjection> = {},
): AdministrativeUserProjection {
  return {
    id: userId(`user-${suffix}`),
    role: "Admin",
    status: "Active",
    permissionSettings: {},
    ...overrides,
  };
}

describe("self access-mutation policy", () => {
  it("forbids self role, status, and permission mutation as non-overrideable", () => {
    const sameUserId = userId("user-one");

    expect(
      evaluateAccessMutationPolicy({
        actorUserId: sameUserId,
        targetUserId: sameUserId,
        mutationKinds: ["Permissions", "Role", "Permissions", "Status"],
      }),
    ).toEqual({
      allowed: false,
      code: "SelfAccessMutationForbidden",
      forbiddenKinds: ["Role", "Status", "Permissions"],
      nonOverrideable: true,
    });
  });

  it("allows access mutations targeting a different user", () => {
    expect(
      evaluateAccessMutationPolicy({
        actorUserId: userId("actor"),
        targetUserId: userId("target"),
        mutationKinds: ["Permissions"],
      }),
    ).toEqual({ allowed: true });
  });

  it("allows a self update when it does not mutate access", () => {
    const sameUserId = userId("user-one");

    expect(
      evaluateAccessMutationPolicy({
        actorUserId: sameUserId,
        targetUserId: sameUserId,
        mutationKinds: [],
      }),
    ).toEqual({ allowed: true });
  });
});

describe("final-capable-Admin protection", () => {
  it("retains an active Admin with both effective management capabilities", () => {
    const admin = projectedUser("admin");

    expect(isActiveCapableAdmin(admin)).toBe(true);
    expect(
      evaluateFinalCapableAdminProtection({
        projectedUsers: [admin],
      }),
    ).toEqual({
      allowed: true,
      remainingCapableAdminIds: [admin.id],
    });
  });

  it.each(["users.manage", "users.permissions.manage"] as const)(
    "treats an Admin explicit Deny of %s as effective",
    (capability) => {
      const admin = projectedUser("admin", {
        permissionSettings: {
          [capability]: "Deny",
        },
      });

      expect(isActiveCapableAdmin(admin)).toBe(false);
      expect(
        evaluateFinalCapableAdminProtection({
          projectedUsers: [admin],
        }),
      ).toEqual({
        allowed: false,
        code: "FinalCapableAdminRequired",
        remainingCapableAdminIds: [],
        requiredCapabilities: finalCapableAdminRequiredCapabilities,
        nonOverrideable: true,
      });
    },
  );

  it("does not count a disabled, invited, or non-Admin user", () => {
    const officeWithExplicitGrants = projectedUser("office", {
      role: "Office",
      permissionSettings: {
        "users.manage": "Allow",
        "users.permissions.manage": "Allow",
      },
    });

    const decision = evaluateFinalCapableAdminProtection({
      projectedUsers: [
        projectedUser("disabled", { status: "Disabled" }),
        projectedUser("invited", { status: "Invited" }),
        officeWithExplicitGrants,
      ],
    });

    expect(isActiveCapableAdmin(officeWithExplicitGrants)).toBe(false);
    expect(decision.allowed).toBe(false);
  });

  it("returns every remaining capable Admin as transaction evidence", () => {
    const first = projectedUser("first");
    const second = projectedUser("second", {
      permissionSettings: {
        "users.manage": "UseRoleDefault",
        "users.permissions.manage": "UseRoleDefault",
      },
    });

    expect(
      evaluateFinalCapableAdminProtection({
        projectedUsers: [first, projectedUser("disabled", { status: "Disabled" }), second],
      }),
    ).toEqual({
      allowed: true,
      remainingCapableAdminIds: [first.id, second.id],
    });
  });

  it("protects an empty projected roster", () => {
    const decision = evaluateFinalCapableAdminProtection({ projectedUsers: [] });

    expect(decision).toMatchObject({
      allowed: false,
      code: "FinalCapableAdminRequired",
      remainingCapableAdminIds: [],
      nonOverrideable: true,
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.remainingCapableAdminIds)).toBe(true);
  });
});
