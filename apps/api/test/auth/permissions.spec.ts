import {
  capabilities,
  capabilitiesForRole,
  everyRoleCan,
  roleHasCapability,
  userRoles,
  type Capability,
  type UserRole,
} from "@stockcontrol/contracts";
import { describe, expect, it } from "vitest";

/**
 * These assertions are the permission table from requirements section 5,
 * written out. If the table changes, this fails first.
 */
const EXPECTED: Readonly<Record<Capability, readonly UserRole[]>> = {
  view: ["Engineer", "Office", "Admin"],
  issue: ["Engineer", "Office", "Admin"],
  reserve: ["Engineer", "Office", "Admin"],
  collect: ["Engineer", "Office", "Admin"],
  requestStock: ["Engineer", "Office", "Admin"],
  manageStock: ["Office", "Admin"],
  manageCatalogue: ["Office", "Admin"],
  manageJobs: ["Office", "Admin"],
  releaseReservation: ["Office", "Admin"],
  reviewStockRequests: ["Office", "Admin"],
  viewAllActivity: ["Office", "Admin"],
  manageUsers: ["Admin"],
  manageLocations: ["Admin"],
};

describe("role capabilities", () => {
  it.each(capabilities)(
    "grants %s to exactly the roles in the requirements table",
    (capability) => {
      const granted = userRoles.filter((role) => roleHasCapability(role, capability));

      expect(granted).toEqual(EXPECTED[capability]);
    },
  );

  it("lets every role view, so nobody is locked out of the demo's read screens", () => {
    expect(everyRoleCan("view")).toBe(true);
  });

  it("gives an Engineer the field capabilities and nothing that changes the catalogue", () => {
    const engineer = capabilitiesForRole("Engineer");

    expect(engineer).toEqual(["view", "issue", "reserve", "collect", "requestStock"]);
    expect(engineer).not.toContain("manageStock");
    expect(engineer).not.toContain("manageUsers");
  });

  /**
   * This is what keeps an Engineer's transaction lists to their own record. The
   * server narrows every query on it, so losing it here would quietly widen
   * what a field user can see.
   */
  it("withholds other people's activity from an Engineer", () => {
    expect(roleHasCapability("Engineer", "viewAllActivity")).toBe(false);
    expect(roleHasCapability("Office", "viewAllActivity")).toBe(true);
    expect(roleHasCapability("Admin", "viewAllActivity")).toBe(true);
  });

  it("lets anyone raise a stock request but only Office and Admin decide it", () => {
    expect(everyRoleCan("requestStock")).toBe(true);
    expect(roleHasCapability("Engineer", "reviewStockRequests")).toBe(false);
    expect(roleHasCapability("Office", "reviewStockRequests")).toBe(true);
  });

  it("makes each role a superset of the one below it", () => {
    const engineer = new Set(capabilitiesForRole("Engineer"));
    const office = new Set(capabilitiesForRole("Office"));
    const admin = new Set(capabilitiesForRole("Admin"));

    expect([...engineer].every((capability) => office.has(capability))).toBe(true);
    expect([...office].every((capability) => admin.has(capability))).toBe(true);
  });

  it("reserves user management for Admins alone", () => {
    expect(roleHasCapability("Admin", "manageUsers")).toBe(true);
    expect(roleHasCapability("Office", "manageUsers")).toBe(false);
    expect(roleHasCapability("Engineer", "manageUsers")).toBe(false);
  });

  it("covers every capability the code declares", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...capabilities].sort());
  });
});
