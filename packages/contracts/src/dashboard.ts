import type { UserRole } from "./auth";
import type { ItemSummaryView, LocationBalanceView, TransactionView } from "./inventory";
import type { JobSummaryView, ReservationView } from "./jobs";
import type { StockRequestView } from "./stock-requests";

/**
 * The dashboard is the one screen that differs by role, so its payload does
 * too. An Engineer is shown their own work; Office and Admin are shown what
 * the business needs decided. Discriminating on `role` keeps the two shapes
 * honest at the type level rather than leaving optional fields everywhere.
 */

export interface DashboardReservationView extends ReservationView {
  readonly jobId: string;
  readonly jobNumber: string;
  readonly jobName: string;
}

/** A job the engineer is assigned to, with the stock sitting on its site. */
export interface EngineerJobView extends JobSummaryView {
  readonly jobSiteStock: readonly LocationBalanceView[];
}

export interface EngineerDashboardResponse {
  readonly role: "Engineer";
  readonly myJobs: readonly EngineerJobView[];
  readonly myReservations: readonly DashboardReservationView[];
  readonly myRequests: readonly StockRequestView[];
}

export interface OfficeDashboardResponse {
  readonly role: "Office" | "Admin";
  /** Items whose available quantity has fallen below their threshold. */
  readonly lowStock: readonly ItemSummaryView[];
  readonly upcomingJobs: readonly JobSummaryView[];
  readonly openReservations: readonly DashboardReservationView[];
  readonly myReservations: readonly DashboardReservationView[];
  readonly pendingRequests: readonly StockRequestView[];
  readonly recentTransactions: readonly TransactionView[];
  readonly counts: {
    readonly items: number;
    readonly openJobs: number;
    readonly openReservations: number;
    readonly pendingRequests: number;
  };
}

export type DashboardResponse = EngineerDashboardResponse | OfficeDashboardResponse;

export function isEngineerDashboard(
  dashboard: DashboardResponse,
): dashboard is EngineerDashboardResponse {
  return dashboard.role === "Engineer";
}

/** Narrowing helper for code that only has the role to hand. */
export function dashboardRoleIsEngineer(role: UserRole): boolean {
  return role === "Engineer";
}
