import DashboardRounded from "@mui/icons-material/DashboardRounded";
import Inventory2Rounded from "@mui/icons-material/Inventory2Rounded";
import ManageAccountsRounded from "@mui/icons-material/ManageAccountsRounded";
import PlaylistAddCheckRounded from "@mui/icons-material/PlaylistAddCheckRounded";
import ReceiptLongRounded from "@mui/icons-material/ReceiptLongRounded";
import WorkOutlineRounded from "@mui/icons-material/WorkOutlineRounded";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";

import type { UserRole } from "./auth/auth-types";

interface RoleHolder {
  readonly role: UserRole;
}

export interface NavigationItem {
  readonly path: string;
  readonly label: string;
  /** Shown as the item's tooltip, so a new section explains itself. */
  readonly description: string;
  /** Roles that may open the section. An empty list means every signed-in user. */
  readonly roles: readonly UserRole[];
  readonly icon: ComponentType<SvgIconProps>;
}

/**
 * Each role gets the sections it works in and nothing else. An Engineer's
 * Overview *is* the stock list, so a separate Inventory section would only be
 * the same table one click further away; Office and Admin keep it because they
 * also create and edit the catalogue from there.
 */
export const navigationItems: readonly NavigationItem[] = [
  {
    path: "/dashboard",
    label: "Overview",
    description: "Your stock, your jobs and what you have committed.",
    roles: [],
    icon: DashboardRounded,
  },
  {
    path: "/inventory",
    label: "Inventory",
    description: "Search items and see on-hand, reserved and available stock by location.",
    roles: ["Office", "Admin"],
    icon: Inventory2Rounded,
  },
  {
    path: "/jobs",
    label: "Jobs",
    description: "Manage jobs and their stock reservations and collections.",
    roles: [],
    icon: WorkOutlineRounded,
  },
  {
    path: "/requests",
    label: "Stock requests",
    description: "Approve, amend or turn down what people have asked for.",
    roles: ["Office", "Admin"],
    icon: PlaylistAddCheckRounded,
  },
  {
    path: "/transactions",
    label: "Transactions",
    description: "Every stock change, with the actor, time and reason.",
    roles: [],
    icon: ReceiptLongRounded,
  },
  {
    path: "/team",
    label: "Team & access",
    description: "Create users, set their role and review what they have done.",
    roles: ["Admin"],
    icon: ManageAccountsRounded,
  },
] as const;

export function canAccessNavigationItem(user: RoleHolder, item: NavigationItem): boolean {
  return item.roles.length === 0 || item.roles.includes(user.role);
}

export function navigationForUser(user: RoleHolder): readonly NavigationItem[] {
  return navigationItems.filter((item) => canAccessNavigationItem(user, item));
}
