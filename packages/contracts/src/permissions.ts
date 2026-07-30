import { userRoles, type UserRole } from "./auth";

/**
 * The whole permission model, from requirements section 5. A static map from
 * role to capability, resolved on the server for every read and write. There
 * are no per-user overrides and no capability catalogue to administer.
 */

export const capabilities = [
  "view",
  "issue",
  "reserve",
  "collect",
  "manageStock",
  "manageCatalogue",
  "manageJobs",
  "releaseReservation",
  "manageUsers",
] as const;

export type Capability = (typeof capabilities)[number];

const engineer: readonly Capability[] = ["view", "issue", "reserve", "collect"];

const office: readonly Capability[] = [
  ...engineer,
  "manageStock",
  "manageCatalogue",
  "manageJobs",
  "releaseReservation",
];

const admin: readonly Capability[] = [...office, "manageUsers"];

export const ROLE_CAPABILITIES: Readonly<Record<UserRole, readonly Capability[]>> = Object.freeze({
  Engineer: Object.freeze(engineer),
  Office: Object.freeze(office),
  Admin: Object.freeze(admin),
});

export function roleHasCapability(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function capabilitiesForRole(role: UserRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

/** Every role can see everything; they differ in what they may change. */
export function everyRoleCan(capability: Capability): boolean {
  return userRoles.every((role) => roleHasCapability(role, capability));
}
