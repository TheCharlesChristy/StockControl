import { describe, expect, it } from "vitest";

import { capabilityKeys } from "../src/identity/capabilities";
import {
  hasEffectivePermission,
  permissionSettings,
  resolveEffectivePermission,
  resolveEffectivePermissions,
} from "../src/identity/permission-resolution";

describe("effective permission resolution", () => {
  it("uses an allowed role default with provenance", () => {
    expect(resolveEffectivePermission("Engineer", "inventory.view")).toEqual({
      catalogueVersion: 1,
      capability: "inventory.view",
      role: "Engineer",
      allowed: true,
      roleDefault: true,
      setting: "UseRoleDefault",
      provenance: "RoleDefault",
    });
  });

  it("uses a denied role default with provenance", () => {
    expect(resolveEffectivePermission("Engineer", "users.manage")).toEqual({
      catalogueVersion: 1,
      capability: "users.manage",
      role: "Engineer",
      allowed: false,
      roleDefault: false,
      setting: "UseRoleDefault",
      provenance: "RoleDefault",
    });
  });

  it("applies explicit Allow over a denied role default", () => {
    expect(
      resolveEffectivePermission("Engineer", "jobs.create", {
        "jobs.create": "Allow",
      }),
    ).toEqual({
      catalogueVersion: 1,
      capability: "jobs.create",
      role: "Engineer",
      allowed: true,
      roleDefault: false,
      setting: "Allow",
      provenance: "ExplicitAllow",
    });
  });

  it("applies explicit Deny even for an Admin role default", () => {
    expect(
      resolveEffectivePermission("Admin", "users.permissions.manage", {
        "users.permissions.manage": "Deny",
      }),
    ).toEqual({
      catalogueVersion: 1,
      capability: "users.permissions.manage",
      role: "Admin",
      allowed: false,
      roleDefault: true,
      setting: "Deny",
      provenance: "ExplicitDeny",
    });
  });

  it("treats an explicit UseRoleDefault setting as the role default", () => {
    expect(
      resolveEffectivePermission("Office", "locations.manage", {
        "locations.manage": "UseRoleDefault",
      }),
    ).toMatchObject({
      allowed: false,
      roleDefault: false,
      setting: "UseRoleDefault",
      provenance: "RoleDefault",
    });
  });

  it("resolves and freezes an exhaustive effective-permission view", () => {
    const resolved = resolveEffectivePermissions("Engineer", {
      "jobs.create": "Allow",
      "inventory.take": "Deny",
    });

    expect(Object.keys(resolved)).toEqual(capabilityKeys);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.values(resolved).every(Object.isFrozen)).toBe(true);
    expect(resolved["jobs.create"].allowed).toBe(true);
    expect(resolved["inventory.take"].allowed).toBe(false);
    expect(hasEffectivePermission("Engineer", "locations.view")).toBe(true);
    expect(hasEffectivePermission("Engineer", "locations.use")).toBe(false);
  });

  it("exposes only the confirmed tri-state settings", () => {
    expect(permissionSettings).toEqual(["UseRoleDefault", "Allow", "Deny"]);
  });
});
