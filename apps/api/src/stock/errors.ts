import { formatQuantityCompact, type Quantity } from "./quantity";

export type StockErrorCode =
  | "InvalidQuantity"
  | "QuantityNotPositive"
  | "ReasonRequired"
  | "InsufficientStock"
  | "InsufficientAvailability"
  | "LocationNotStore"
  | "LocationInactive"
  | "SameSourceAndDestination"
  | "ItemInactive"
  | "JobNotOpen"
  | "ReservationNotOpen"
  | "NothingOutstanding"
  | "CollectionExceedsOutstanding"
  | "AdjustmentMatchesCount";

export interface StockError {
  readonly code: StockErrorCode;
  readonly message: string;
}

const error = (code: StockErrorCode, message: string): StockError => ({ code, message });

export const invalidQuantity = (): StockError =>
  error("InvalidQuantity", "Enter a quantity with at most three decimal places.");

export const quantityNotPositive = (): StockError =>
  error("QuantityNotPositive", "Enter a quantity greater than zero.");

export const reasonRequired = (operation: string): StockError =>
  error("ReasonRequired", `Give a reason for this ${operation}.`);

export const insufficientStock = (
  operation: string,
  quantity: Quantity,
  locationCode: string,
  onHand: Quantity,
): StockError =>
  error(
    "InsufficientStock",
    `Cannot ${operation} ${formatQuantityCompact(quantity)} from ${locationCode}: ` +
      `${formatQuantityCompact(onHand)} on hand.`,
  );

export const insufficientAvailability = (
  quantity: Quantity,
  itemReference: string,
  available: Quantity,
): StockError =>
  error(
    "InsufficientAvailability",
    `Cannot reserve ${formatQuantityCompact(quantity)} of ${itemReference}: ` +
      `${formatQuantityCompact(available)} available.`,
  );

export const locationNotStore = (locationCode: string): StockError =>
  error(
    "LocationNotStore",
    `${locationCode} is a job site. Stock is received into and reserved from store locations.`,
  );

export const locationInactive = (locationCode: string): StockError =>
  error("LocationInactive", `${locationCode} is no longer in use.`);

export const sameSourceAndDestination = (): StockError =>
  error("SameSourceAndDestination", "Choose a different destination location.");

export const itemInactive = (itemReference: string): StockError =>
  error("ItemInactive", `${itemReference} has been retired and cannot take new stock movements.`);

export const jobNotOpen = (jobNumber: string): StockError =>
  error("JobNotOpen", `Job ${jobNumber} is closed.`);

export const reservationNotOpen = (): StockError =>
  error("ReservationNotOpen", "This reservation is no longer open.");

export const nothingOutstanding = (): StockError =>
  error("NothingOutstanding", "This reservation has already been collected in full.");

export const collectionExceedsOutstanding = (
  quantity: Quantity,
  outstanding: Quantity,
): StockError =>
  error(
    "CollectionExceedsOutstanding",
    `Cannot collect ${formatQuantityCompact(quantity)}: ` +
      `${formatQuantityCompact(outstanding)} outstanding on this reservation.`,
  );

export const adjustmentMatchesCount = (counted: Quantity): StockError =>
  error(
    "AdjustmentMatchesCount",
    `The counted quantity already matches the recorded ${formatQuantityCompact(counted)}.`,
  );
