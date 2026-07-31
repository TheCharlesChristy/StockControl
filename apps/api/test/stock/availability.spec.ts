import { describe, expect, it } from "vitest";

import {
  balanceAt,
  calculateAvailability,
  isBelowThreshold,
  quantityAt,
  type ItemStockSnapshot,
  type LocationBalance,
} from "../../src/stock/availability";
import { formatQuantity, parseQuantity, ZERO, type Quantity } from "../../src/stock/quantity";

const q = (value: string): Quantity => parseQuantity(value) as Quantity;

const store = (locationId: string, code: string, quantity: string): LocationBalance => ({
  locationId,
  locationCode: code,
  kind: "Store",
  quantity: q(quantity),
});

const jobSite = (locationId: string, code: string, quantity: string): LocationBalance => ({
  locationId,
  locationCode: code,
  kind: "JobSite",
  quantity: q(quantity),
});

const snapshot = (balances: readonly LocationBalance[], openReserved = "0"): ItemStockSnapshot => ({
  itemId: "item-1",
  balances,
  openReservedQuantity: q(openReserved),
});

describe("calculateAvailability", () => {
  it("reports zero for an item with no stock anywhere", () => {
    const availability = calculateAvailability(snapshot([]));

    expect(formatQuantity(availability.onHand)).toBe("0.000");
    expect(formatQuantity(availability.available)).toBe("0.000");
  });

  it("sums store balances across locations", () => {
    const availability = calculateAvailability(
      snapshot([store("l1", "STORE-A1", "100"), store("l2", "STORE-B2", "40.5")]),
    );

    expect(formatQuantity(availability.inStores)).toBe("140.500");
    expect(formatQuantity(availability.onHand)).toBe("140.500");
    expect(formatQuantity(availability.available)).toBe("140.500");
  });

  it("counts job-site stock as on hand but never as available", () => {
    const availability = calculateAvailability(
      snapshot([store("l1", "STORE-A1", "60"), jobSite("l9", "JOB-1001", "25")]),
    );

    expect(formatQuantity(availability.onHand)).toBe("85.000");
    expect(formatQuantity(availability.inStores)).toBe("60.000");
    expect(formatQuantity(availability.atJobSites)).toBe("25.000");
    expect(formatQuantity(availability.available)).toBe("60.000");
  });

  it("subtracts open reservations from store stock without moving anything", () => {
    const availability = calculateAvailability(snapshot([store("l1", "STORE-A1", "100")], "30"));

    expect(formatQuantity(availability.onHand)).toBe("100.000");
    expect(formatQuantity(availability.reserved)).toBe("30.000");
    expect(formatQuantity(availability.available)).toBe("70.000");
  });

  it("reports a negative available quantity as a visible shortfall", () => {
    const availability = calculateAvailability(snapshot([store("l1", "STORE-A1", "4")], "10"));

    expect(formatQuantity(availability.onHand)).toBe("4.000");
    expect(formatQuantity(availability.available)).toBe("-6.000");
  });

  it("keeps fractional arithmetic exact", () => {
    const availability = calculateAvailability(
      snapshot([store("l1", "STORE-A1", "0.1"), store("l2", "STORE-B2", "0.2")], "0.05"),
    );

    expect(formatQuantity(availability.inStores)).toBe("0.300");
    expect(formatQuantity(availability.available)).toBe("0.250");
  });
});

describe("locating a balance", () => {
  it("finds the balance at a location", () => {
    const found = balanceAt(snapshot([store("l1", "STORE-A1", "12")]), "l1");

    expect(found?.locationCode).toBe("STORE-A1");
  });

  it("treats a location with no row as holding nothing", () => {
    expect(quantityAt(snapshot([store("l1", "STORE-A1", "12")]), "l2")).toBe(ZERO);
    expect(balanceAt(snapshot([]), "l1")).toBeUndefined();
  });
});

describe("isBelowThreshold", () => {
  it("is false when no threshold is set", () => {
    const availability = calculateAvailability(snapshot([store("l1", "STORE-A1", "0")]));

    expect(isBelowThreshold(availability, null)).toBe(false);
  });

  it("triggers strictly below the threshold, not at it", () => {
    const atThreshold = calculateAvailability(snapshot([store("l1", "STORE-A1", "10")]));
    const belowThreshold = calculateAvailability(snapshot([store("l1", "STORE-A1", "9.999")]));

    expect(isBelowThreshold(atThreshold, q("10"))).toBe(false);
    expect(isBelowThreshold(belowThreshold, q("10"))).toBe(true);
  });

  it("uses available rather than on hand, so reservations can trigger it", () => {
    const availability = calculateAvailability(snapshot([store("l1", "STORE-A1", "100")], "95"));

    expect(formatQuantity(availability.onHand)).toBe("100.000");
    expect(isBelowThreshold(availability, q("10"))).toBe(true);
  });
});
