import { hasEffectivePermission, type UserPermissionSettings } from "../permission-resolution";
import type { UserRole } from "../role-templates";
import type { UserStatus } from "../user";
import type { UserId } from "../value-objects";

export const finalCapableAdminRequiredCapabilities = [
  "users.manage",
  "users.permissions.manage",
] as const;

export interface AdministrativeUserProjection {
  readonly id: UserId;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly permissionSettings: UserPermissionSettings;
}

export interface FinalCapableAdminProtectionInput {
  /**
   * The complete user roster after the proposed mutation has been applied in
   * memory. The application layer must read and lock this roster inside the
   * same transaction that will persist the mutation.
   */
  readonly projectedUsers: readonly AdministrativeUserProjection[];
}

export interface FinalCapableAdminProtected {
  readonly allowed: false;
  readonly code: "FinalCapableAdminRequired";
  readonly remainingCapableAdminIds: readonly UserId[];
  readonly requiredCapabilities: typeof finalCapableAdminRequiredCapabilities;
  readonly nonOverrideable: true;
}

export interface FinalCapableAdminRetained {
  readonly allowed: true;
  readonly remainingCapableAdminIds: readonly UserId[];
}

export type FinalCapableAdminProtectionDecision =
  FinalCapableAdminProtected | FinalCapableAdminRetained;

export function isActiveCapableAdmin(user: AdministrativeUserProjection): boolean {
  return (
    user.status === "Active" &&
    user.role === "Admin" &&
    finalCapableAdminRequiredCapabilities.every((capability) =>
      hasEffectivePermission(user.role, capability, user.permissionSettings),
    )
  );
}

export function evaluateFinalCapableAdminProtection(
  input: FinalCapableAdminProtectionInput,
): FinalCapableAdminProtectionDecision {
  const remainingCapableAdminIds = Object.freeze(
    input.projectedUsers.filter(isActiveCapableAdmin).map((user) => user.id),
  );

  if (remainingCapableAdminIds.length > 0) {
    return Object.freeze({
      allowed: true,
      remainingCapableAdminIds,
    });
  }

  return Object.freeze({
    allowed: false,
    code: "FinalCapableAdminRequired",
    remainingCapableAdminIds,
    requiredCapabilities: finalCapableAdminRequiredCapabilities,
    nonOverrideable: true,
  });
}
