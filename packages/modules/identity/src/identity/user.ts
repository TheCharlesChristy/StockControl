import type { UserPermissionSettings } from "./permission-resolution";
import type { UserRole } from "./role-templates";
import type { NormalisedEmailAddress, UserDisplayName, UserId } from "./value-objects";

export const userStatuses = ["Invited", "Active", "Disabled"] as const;

export type UserStatus = (typeof userStatuses)[number];

export interface User {
  readonly id: UserId;
  readonly email: NormalisedEmailAddress;
  readonly displayName: UserDisplayName;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly permissionSettings: UserPermissionSettings;
}

export function isActiveUser(user: Pick<User, "status">): boolean {
  return user.status === "Active";
}
