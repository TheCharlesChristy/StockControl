import { capabilityKeys, PERMISSION_CATALOGUE_VERSION, type Capability } from "./capabilities";
import { getRoleTemplate, type UserRole } from "./role-templates";

export const permissionSettings = ["UseRoleDefault", "Allow", "Deny"] as const;

export type PermissionSetting = (typeof permissionSettings)[number];

export type UserPermissionSettings = Readonly<Partial<Record<Capability, PermissionSetting>>>;

export type PermissionProvenance = "ExplicitDeny" | "ExplicitAllow" | "RoleDefault";

export interface EffectivePermission {
  readonly catalogueVersion: typeof PERMISSION_CATALOGUE_VERSION;
  readonly capability: Capability;
  readonly role: UserRole;
  readonly allowed: boolean;
  readonly roleDefault: boolean;
  readonly setting: PermissionSetting;
  readonly provenance: PermissionProvenance;
}

function effectivePermission(
  capability: Capability,
  role: UserRole,
  roleDefault: boolean,
  setting: PermissionSetting,
  allowed: boolean,
  provenance: PermissionProvenance,
): EffectivePermission {
  return Object.freeze({
    catalogueVersion: PERMISSION_CATALOGUE_VERSION,
    capability,
    role,
    allowed,
    roleDefault,
    setting,
    provenance,
  });
}

export function resolveEffectivePermission(
  role: UserRole,
  capability: Capability,
  settings: UserPermissionSettings = {},
): EffectivePermission {
  const roleDefault = getRoleTemplate(role).permissions[capability];
  const setting = settings[capability] ?? "UseRoleDefault";

  if (setting === "Deny") {
    return effectivePermission(capability, role, roleDefault, setting, false, "ExplicitDeny");
  }

  if (setting === "Allow") {
    return effectivePermission(capability, role, roleDefault, setting, true, "ExplicitAllow");
  }

  return effectivePermission(
    capability,
    role,
    roleDefault,
    "UseRoleDefault",
    roleDefault,
    "RoleDefault",
  );
}

export function resolveEffectivePermissions(
  role: UserRole,
  settings: UserPermissionSettings = {},
): Readonly<Record<Capability, EffectivePermission>> {
  return Object.freeze(
    Object.fromEntries(
      capabilityKeys.map((capability) => [
        capability,
        resolveEffectivePermission(role, capability, settings),
      ]),
    ) as Record<Capability, EffectivePermission>,
  );
}

export function hasEffectivePermission(
  role: UserRole,
  capability: Capability,
  settings: UserPermissionSettings = {},
): boolean {
  return resolveEffectivePermission(role, capability, settings).allowed;
}
