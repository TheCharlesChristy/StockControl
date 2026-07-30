import AssessmentRounded from "@mui/icons-material/AssessmentRounded";
import DashboardRounded from "@mui/icons-material/DashboardRounded";
import FactCheckRounded from "@mui/icons-material/FactCheckRounded";
import Inventory2Rounded from "@mui/icons-material/Inventory2Rounded";
import ManageAccountsRounded from "@mui/icons-material/ManageAccountsRounded";
import MapRounded from "@mui/icons-material/MapRounded";
import PlaylistAddCheckRounded from "@mui/icons-material/PlaylistAddCheckRounded";
import QrCodeScannerRounded from "@mui/icons-material/QrCodeScannerRounded";
import ShoppingCartCheckoutRounded from "@mui/icons-material/ShoppingCartCheckoutRounded";
import WorkOutlineRounded from "@mui/icons-material/WorkOutlineRounded";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";

interface CapabilityHolder {
  readonly effectiveCapabilities: readonly string[];
}

export interface NavigationItem {
  readonly path: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly anyCapabilities: readonly string[];
  readonly icon: ComponentType<SvgIconProps>;
}

export const navigationItems: readonly NavigationItem[] = [
  {
    path: "/dashboard",
    label: "Overview",
    shortLabel: "Overview",
    description: "Role-aware priorities, exceptions and quick actions.",
    anyCapabilities: [],
    icon: DashboardRounded,
  },
  {
    path: "/inventory",
    label: "Inventory",
    shortLabel: "Inventory",
    description: "Search catalogue items, holdings, assets and availability.",
    anyCapabilities: ["inventory.view"],
    icon: Inventory2Rounded,
  },
  {
    path: "/scan",
    label: "Scan stock",
    shortLabel: "Scan",
    description: "Open fast, permission-aware QR stock actions.",
    anyCapabilities: ["inventory.view", "inventory.take"],
    icon: QrCodeScannerRounded,
  },
  {
    path: "/jobs",
    label: "Jobs",
    shortLabel: "Jobs",
    description: "Manage job demand, reservations and reconciliation.",
    anyCapabilities: ["jobs.view"],
    icon: WorkOutlineRounded,
  },
  {
    path: "/requests",
    label: "My requests",
    shortLabel: "Requests",
    description: "Track submitted reservation and purchase requests.",
    anyCapabilities: ["jobs.reservations.request", "purchasing.request"],
    icon: PlaylistAddCheckRounded,
  },
  {
    path: "/purchasing",
    label: "Purchasing",
    shortLabel: "Purchasing",
    description: "Control requests, purchase orders, receipts and invoices.",
    anyCapabilities: ["purchasing.view"],
    icon: ShoppingCartCheckoutRounded,
  },
  {
    path: "/stocktakes",
    label: "Stocktakes",
    shortLabel: "Counts",
    description: "Run blind counts, recounts and audited adjustments.",
    anyCapabilities: ["stocktakes.start", "stocktakes.enter"],
    icon: FactCheckRounded,
  },
  {
    path: "/locations",
    label: "Locations & maps",
    shortLabel: "Locations",
    description: "Manage the hierarchy and linked visual maps.",
    anyCapabilities: ["locations.view"],
    icon: MapRounded,
  },
  {
    path: "/reports",
    label: "Reports",
    shortLabel: "Reports",
    description: "Review locked operational, cost and audit reports.",
    anyCapabilities: [
      "reports.inventory",
      "reports.operational",
      "reports.financial",
      "reports.export",
    ],
    icon: AssessmentRounded,
  },
  {
    path: "/team",
    label: "Team & access",
    shortLabel: "Team",
    description: "Invite users and manage roles, permissions and safeguards.",
    anyCapabilities: ["users.view", "users.invite", "users.manage", "users.permissions.manage"],
    icon: ManageAccountsRounded,
  },
] as const;

export function canAccessNavigationItem(user: CapabilityHolder, item: NavigationItem): boolean {
  return (
    item.anyCapabilities.length === 0 ||
    item.anyCapabilities.some((capability) => user.effectiveCapabilities.includes(capability))
  );
}

export function navigationForUser(user: CapabilityHolder): readonly NavigationItem[] {
  return navigationItems.filter((item) => canAccessNavigationItem(user, item));
}
