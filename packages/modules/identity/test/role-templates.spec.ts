import { describe, expect, it } from "vitest";

import { capabilityKeys, type Capability } from "../src/identity/capabilities";
import {
  assertRoleTemplatesValid,
  getRoleTemplate,
  RoleTemplateConfigurationError,
  roleTemplates,
  standardRoles,
  validateRoleTemplates,
  type RoleTemplatesCandidate,
  type UserRole,
} from "../src/identity/role-templates";

const expectedEngineerGrants: readonly Capability[] = [
  "inventory.view",
  "inventory.take",
  "inventory.condition.report",
  "jobs.view",
  "jobs.reservations.request",
  "jobs.reservations.collect",
  "jobs.reconciliation.submit",
  "custody.view.own",
  "custody.collect",
  "custody.transfers.request",
  "purchasing.request",
  "locations.view",
  "audit.view.own",
];

const expectedOfficeGrants: readonly Capability[] = [
  "inventory.view",
  "inventory.take",
  "inventory.catalogue.manage",
  "inventory.receive",
  "inventory.transfer",
  "inventory.adjust",
  "inventory.condition.report",
  "inventory.condition.resolve",
  "inventory.writeoff.request",
  "inventory.writeoff.approve",
  "inventory.labels.print",
  "jobs.view",
  "jobs.create",
  "jobs.reservations.request",
  "jobs.reservations.manage",
  "jobs.reservations.collect",
  "jobs.reconciliation.submit",
  "jobs.reconciliation.approve",
  "custody.view.own",
  "custody.view.all",
  "custody.allocations.manage",
  "custody.collect",
  "custody.transfers.request",
  "custody.transfers.approve",
  "custody.accept.on-behalf",
  "purchasing.request",
  "purchasing.view",
  "purchasing.process",
  "purchasing.buyer.approve-request",
  "purchasing.buyer.approve-order",
  "purchasing.receive",
  "purchasing.invoices.manage",
  "purchasing.payments.record",
  "locations.view",
  "locations.use",
  "stocktakes.start",
  "stocktakes.enter",
  "stocktakes.recount",
  "stocktakes.variance.approve",
  "stocktakes.adjustment.post",
  "reports.inventory",
  "reports.operational",
  "reports.export",
  "audit.view.own",
  "audit.view.operational",
];

function grantedCapabilities(role: UserRole): readonly Capability[] {
  const template = getRoleTemplate(role);
  return capabilityKeys.filter((capability) => template.permissions[capability]);
}

describe("standard role templates", () => {
  it("defines the exact Engineer grants", () => {
    expect(grantedCapabilities("Engineer")).toEqual(expectedEngineerGrants);
  });

  it("defines the exact Office grants", () => {
    expect(grantedCapabilities("Office")).toEqual(expectedOfficeGrants);
  });

  it("grants every V1 capability to Admin by default", () => {
    expect(grantedCapabilities("Admin")).toEqual(capabilityKeys);
  });

  it("is exhaustive, versioned, immutable, and valid", () => {
    expect(Object.keys(roleTemplates)).toEqual(standardRoles);
    expect(validateRoleTemplates(roleTemplates)).toEqual({ valid: true, issues: [] });
    expect(() => assertRoleTemplatesValid(roleTemplates)).not.toThrow();

    for (const role of standardRoles) {
      const template = getRoleTemplate(role);
      expect(template.catalogueVersion).toBe(1);
      expect(Object.keys(template.permissions)).toEqual(capabilityKeys);
      expect(Object.values(template.permissions).every((value) => typeof value === "boolean")).toBe(
        true,
      );
      expect(Object.isFrozen(template)).toBe(true);
      expect(Object.isFrozen(template.permissions)).toBe(true);
    }
  });
});

describe("role-template validation", () => {
  it("reports every structural and default drift deterministically", () => {
    const engineerPermissions: Record<string, unknown> = {
      ...roleTemplates.Engineer.permissions,
      "future.capability": true,
      "inventory.view": "yes",
      "jobs.override": true,
    };
    delete engineerPermissions["inventory.take"];

    const candidate: RoleTemplatesCandidate = {
      Engineer: {
        role: "Office",
        catalogueVersion: 2,
        permissions: engineerPermissions,
      },
      Office: {
        role: "Office",
        catalogueVersion: 1,
      },
      FutureRole: {
        role: "FutureRole",
        catalogueVersion: 1,
        permissions: {},
      },
    };

    const result = validateRoleTemplates(candidate);

    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "UnexpectedRole",
        "RoleNameMismatch",
        "CatalogueVersionMismatch",
        "UnexpectedCapability",
        "PermissionNotBoolean",
        "MissingCapability",
        "PermissionDefaultMismatch",
        "PermissionsRequired",
        "MissingRole",
      ]),
    );
    expect(result.issues.find(({ code }) => code === "UnexpectedRole")?.path).toBe("FutureRole");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
  });

  it("throws a typed configuration error containing the validation evidence", () => {
    const invalid: RoleTemplatesCandidate = {};

    expect(() => assertRoleTemplatesValid(invalid)).toThrow(RoleTemplateConfigurationError);

    try {
      assertRoleTemplatesValid(invalid);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RoleTemplateConfigurationError);
      expect((error as RoleTemplateConfigurationError).name).toBe("RoleTemplateConfigurationError");
      expect((error as RoleTemplateConfigurationError).issues).toHaveLength(3);
      expect((error as Error).message).toBe("Role-template validation failed with 3 issue(s).");
    }
  });
});
