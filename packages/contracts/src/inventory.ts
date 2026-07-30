export const locationKinds = ["Store", "JobSite"] as const;
export type LocationKind = (typeof locationKinds)[number];

export const transactionKinds = [
  "Receive",
  "Issue",
  "Transfer",
  "Adjust",
  "Reserve",
  "Collect",
  "Release",
] as const;
export type TransactionKind = (typeof transactionKinds)[number];

export interface LocationView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: LocationKind;
  readonly jobId: string | null;
  readonly isActive: boolean;
}

/** A quantity is always a decimal string, so exactness survives transport. */
export interface LocationBalanceView {
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly kind: LocationKind;
  readonly quantity: string;
}

export interface ItemSummaryView {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly unit: string;
  readonly barcode: string | null;
  readonly partNumber: string | null;
  readonly lowStockThreshold: string | null;
  readonly isActive: boolean;
  readonly onHand: string;
  readonly inStores: string;
  readonly atJobSites: string;
  readonly reserved: string;
  readonly available: string;
  readonly belowThreshold: boolean;
}

export interface ItemDetailView extends ItemSummaryView {
  readonly balances: readonly LocationBalanceView[];
  readonly recentTransactions: readonly TransactionView[];
}

export interface TransactionView {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly itemId: string;
  readonly itemReference: string;
  readonly itemName: string;
  readonly unit: string;
  readonly quantity: string;
  readonly fromLocationCode: string | null;
  readonly toLocationCode: string | null;
  readonly jobNumber: string | null;
  readonly reason: string | null;
  readonly actorName: string;
  readonly occurredAt: string;
}

export interface PagedResult<Row> {
  readonly rows: readonly Row[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export type ItemListResponse = PagedResult<ItemSummaryView>;
export type TransactionListResponse = PagedResult<TransactionView>;

export interface LocationListResponse {
  readonly locations: readonly LocationView[];
}

export interface CreateItemRequest {
  readonly reference?: string;
  readonly name: string;
  readonly unit: string;
  readonly barcode?: string | null;
  readonly partNumber?: string | null;
  readonly lowStockThreshold?: string | null;
}

export interface CreateLocationRequest {
  readonly code: string;
  readonly name: string;
}

export interface ReceiveStockRequest {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
}

export interface IssueStockRequest {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: string;
  readonly jobId?: string | null;
}

export interface TransferStockRequest {
  readonly itemId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly quantity: string;
}

export interface AdjustStockRequest {
  readonly itemId: string;
  readonly locationId: string;
  readonly countedQuantity: string;
  readonly reason: string;
}

export interface StockOperationResponse {
  readonly item: ItemDetailView;
  readonly transactionId: string;
}
