import type { LocationBalanceView, TransactionView } from "./inventory";

export const jobStatuses = ["Open", "Closed"] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const reservationStatuses = ["Open", "Fulfilled", "Released"] as const;
export type ReservationStatus = (typeof reservationStatuses)[number];

export interface JobSummaryView {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly customer: string;
  readonly status: JobStatus;
  readonly jobSiteLocationId: string;
  readonly openReservationCount: number;
  readonly createdAt: string;
  readonly closedAt: string | null;
}

export interface ReservationView {
  readonly id: string;
  readonly itemId: string;
  readonly itemReference: string;
  readonly itemName: string;
  readonly unit: string;
  readonly quantityReserved: string;
  readonly quantityCollected: string;
  readonly quantityOutstanding: string;
  readonly status: ReservationStatus;
  readonly createdByName: string;
  readonly createdAt: string;
}

export interface JobDetailView extends JobSummaryView {
  readonly reservations: readonly ReservationView[];
  /** Stock currently sitting at the job site, which closing does not move. */
  readonly jobSiteStock: readonly LocationBalanceView[];
  readonly recentTransactions: readonly TransactionView[];
}

export interface JobListResponse {
  readonly jobs: readonly JobSummaryView[];
}

export interface CreateJobRequest {
  readonly number?: string;
  readonly name: string;
  readonly customer: string;
}

export interface ReserveStockRequest {
  readonly itemId: string;
  readonly quantity: string;
}

export interface CollectReservationRequest {
  readonly sourceLocationId: string;
  readonly quantity: string;
}

export interface ReleaseReservationRequest {
  readonly reason: string;
}

export interface JobResponse {
  readonly job: JobDetailView;
}
