import AddAPhotoRounded from "@mui/icons-material/AddAPhotoRounded";
import DashboardRounded from "@mui/icons-material/DashboardRounded";
import Inventory2Rounded from "@mui/icons-material/Inventory2Rounded";
import ManageAccountsRounded from "@mui/icons-material/ManageAccountsRounded";
import PlaylistAddCheckRounded from "@mui/icons-material/PlaylistAddCheckRounded";
import ReceiptLongRounded from "@mui/icons-material/ReceiptLongRounded";
import WorkOutlineRounded from "@mui/icons-material/WorkOutlineRounded";
import MapRounded from "@mui/icons-material/MapRounded";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";

import type { SessionFeatures, UserRole } from "./auth/auth-types";

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
  /** A section behind a server flag: absent entirely until the flag is on,
   * regardless of role. */
  readonly requiresFeature?: keyof SessionFeatures;
}

/*
 * Deny by default: a caller that forgets to pass the real, server-decided
 * features sees a flagged section as absent, never as present. The opposite
 * default would mean one missed call site quietly shows "Add stock" in a
 * deployment that has not turned the flag on.
 */
const noFeatures: SessionFeatures = { stockCapture: false };

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
    description: "Find stock and see what is ready to use in each store.",
    roles: ["Office", "Admin"],
    icon: Inventory2Rounded,
  },
  {
    path: "/stock-capture",
    label: "Add stock",
    description: "Book in a delivery and check what StockControl made of each photograph.",
    roles: ["Office", "Admin"],
    icon: AddAPhotoRounded,
    requiresFeature: "stockCapture",
  },
  {
    path: "/jobs",
    label: "Jobs",
    description: "Reserve stock for jobs and collect it to site.",
    roles: [],
    icon: WorkOutlineRounded,
  },
  {
    path: "/requests",
    label: "Stock requests",
    description: "Review requests from the team.",
    roles: ["Office", "Admin"],
    icon: PlaylistAddCheckRounded,
  },
  {
    path: "/transactions",
    label: "Transactions",
    description: "See the full history of stock changes.",
    roles: [],
    icon: ReceiptLongRounded,
  },
  {
    path: "/locations",
    label: "Locations",
    description: "Find stores, shelves and job sites on the map.",
    roles: [],
    icon: MapRounded,
  },
  {
    path: "/team",
    label: "Team & access",
    description: "Create users, set their role and review what they have done.",
    roles: ["Admin"],
    icon: ManageAccountsRounded,
  },
] as const;

export function canAccessNavigationItem(
  user: RoleHolder,
  item: NavigationItem,
  features: SessionFeatures = noFeatures,
): boolean {
  if (item.requiresFeature !== undefined && !features[item.requiresFeature]) {
    return false;
  }

  return item.roles.length === 0 || item.roles.includes(user.role);
}

export function navigationForUser(
  user: RoleHolder,
  features: SessionFeatures = noFeatures,
): readonly NavigationItem[] {
  return navigationItems.filter((item) => canAccessNavigationItem(user, item, features));
}
