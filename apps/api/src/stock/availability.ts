import { add, subtract, sum, ZERO, type Quantity } from "./quantity";

export type LocationKind = "Store" | "JobSite";

export interface LocationBalance {
  readonly locationId: string;
  readonly locationCode: string;
  readonly kind: LocationKind;
  readonly quantity: Quantity;
  /** Present for hierarchy-backed rows; omitted by the legacy demo fixtures. */
  readonly operationalKind?:
    "Container" | "Storage" | "Quarantine" | "Repair" | "Transit" | "VirtualJobSite";
  readonly generalFulfilmentEnabled?: boolean;
  readonly isActive?: boolean;
}

export interface ItemStockSnapshot {
  readonly itemId: string;
  readonly balances: readonly LocationBalance[];
  /** Reserved but not yet collected, across every open reservation for the item. */
  readonly openReservedQuantity: Quantity;
}

export interface ItemAvailability {
  /** Everything physically held, wherever it is. */
  readonly onHand: Quantity;
  readonly inStores: Quantity;
  readonly atJobSites: Quantity;
  readonly reserved: Quantity;
  /**
   * Store stock not already committed to a job.
   *
   * This can go negative: issuing stock that was already reserved leaves a real
   * shortfall, and the demo shows it rather than hiding it behind a zero. New
   * reservations are refused while it is at or below zero.
   */
  readonly available: Quantity;
}

const quantitiesOfKind = function* (
  balances: readonly LocationBalance[],
  kind: LocationKind,
): Generator<Quantity> {
  for (const balance of balances) {
    const eligibleStore =
      balance.kind === "Store" &&
      (balance.operationalKind === undefined ||
        (balance.operationalKind === "Storage" &&
          balance.generalFulfilmentEnabled !== false &&
          balance.isActive !== false));
    if ((kind === "Store" && eligibleStore) || (kind === "JobSite" && balance.kind === kind)) {
      yield balance.quantity;
    }
  }
};

export function calculateAvailability(snapshot: ItemStockSnapshot): ItemAvailability {
  const inStores = sum(quantitiesOfKind(snapshot.balances, "Store"));
  const atJobSites = sum(quantitiesOfKind(snapshot.balances, "JobSite"));

  return {
    onHand: add(inStores, atJobSites),
    inStores,
    atJobSites,
    reserved: snapshot.openReservedQuantity,
    available: subtract(inStores, snapshot.openReservedQuantity),
  };
}

export function balanceAt(
  snapshot: ItemStockSnapshot,
  locationId: string,
): LocationBalance | undefined {
  return snapshot.balances.find((balance) => balance.locationId === locationId);
}

export function quantityAt(snapshot: ItemStockSnapshot, locationId: string): Quantity {
  return balanceAt(snapshot, locationId)?.quantity ?? ZERO;
}

export function isBelowThreshold(
  availability: ItemAvailability,
  lowStockThreshold: Quantity | null,
): boolean {
  return lowStockThreshold !== null && availability.available < lowStockThreshold;
}
