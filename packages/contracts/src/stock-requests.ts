import type { PagedResult } from "./inventory";

/**
 * Demand somebody has asked for, before anything is committed. A pending
 * request is visible as demand but changes no availability; approving one
 * against a job creates an ordinary reservation, which does.
 */

export const stockRequestStatuses = ["Pending", "Approved", "Rejected", "Cancelled"] as const;
export type StockRequestStatus = (typeof stockRequestStatuses)[number];

export interface StockRequestView {
  readonly id: string;
  readonly reference: string;
  readonly itemId: string;
  readonly itemReference: string;
  readonly itemName: string;
  readonly unit: string;
  readonly jobId: string | null;
  readonly jobNumber: string | null;
  readonly jobName: string | null;
  readonly quantity: string;
  readonly note: string | null;
  readonly status: StockRequestStatus;
  readonly requestedById: string;
  readonly requestedByName: string;
  readonly decidedByName: string | null;
  readonly decisionNote: string | null;
  /** Set when approval committed the stock, so the reservation can be opened. */
  readonly reservationId: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

export type StockRequestListResponse = PagedResult<StockRequestView>;

export interface StockRequestResponse {
  readonly request: StockRequestView;
}

export interface CreateStockRequestRequest {
  readonly itemId: string;
  readonly quantity: string;
  readonly jobId?: string | null;
  readonly note?: string | null;
}

export interface ApproveStockRequestRequest {
  /** Amend the quantity while approving. Defaults to what was asked for. */
  readonly quantity?: string;
  readonly decisionNote?: string | null;
}

export interface RejectStockRequestRequest {
  readonly decisionNote: string;
}
