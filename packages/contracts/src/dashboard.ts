import type { ItemSummaryView, TransactionView } from "./inventory";
import type { ReservationView } from "./jobs";

export interface DashboardReservationView extends ReservationView {
  readonly jobId: string;
  readonly jobNumber: string;
  readonly jobName: string;
}

export interface DashboardResponse {
  /** Items whose available quantity has fallen below their threshold. */
  readonly lowStock: readonly ItemSummaryView[];
  /** Open reservations the signed-in user raised. */
  readonly myReservations: readonly DashboardReservationView[];
  readonly recentTransactions: readonly TransactionView[];
  readonly counts: {
    readonly items: number;
    readonly openJobs: number;
    readonly openReservations: number;
  };
}
