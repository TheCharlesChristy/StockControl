import { describe, expect, it } from "vitest";

import { buildSeedItems } from "../../src/seed/catalogue";
import { buildDemoWorld, type DemoWorld } from "../../src/seed/simulate";
import { formatQuantity, type Quantity } from "../../src/stock/quantity";

function createWorld(seed?: number): DemoWorld {
  let counter = 0;

  return buildDemoWorld({
    createId: () => `id-${String((counter += 1)).padStart(6, "0")}`,
    now: new Date("2026-07-30T09:00:00.000Z"),
    ...(seed === undefined ? {} : { seed }),
  });
}

const world = createWorld();

describe("the demo catalogue", () => {
  const items = buildSeedItems();

  it("holds a few hundred items, as the requirements ask", () => {
    expect(items.length).toBeGreaterThanOrEqual(200);
    expect(items.length).toBeLessThanOrEqual(400);
  });

  it("gives every item a unique reference in sequence", () => {
    const references = items.map((item) => item.reference);

    expect(new Set(references).size).toBe(items.length);
    expect(references[0]).toBe("ITM-0001");
  });

  it("never repeats a barcode", () => {
    const barcodes = items.map((item) => item.barcode).filter((code) => code !== null);

    expect(new Set(barcodes).size).toBe(barcodes.length);
  });

  it("uses realistic names and units rather than placeholders", () => {
    expect(items.every((item) => item.name.length > 5)).toBe(true);
    expect(new Set(items.map((item) => item.unit))).toEqual(new Set(["ea", "m", "L"]));
    expect(items.some((item) => item.name.includes("cable"))).toBe(true);
  });

  it("is deterministic, so a demo script stays true between runs", () => {
    expect(buildSeedItems()).toEqual(items);
  });
});

describe("the demo world", () => {
  it("seeds one user per role", () => {
    expect(world.users.map((user) => user.role).sort()).toEqual(["Admin", "Engineer", "Office"]);
  });

  it("seeds around twenty locations, one job site per job", () => {
    const stores = world.locations.filter((location) => location.kind === "Store");
    const jobSites = world.locations.filter((location) => location.kind === "JobSite");

    expect(stores.length).toBeGreaterThanOrEqual(15);
    expect(jobSites).toHaveLength(world.jobs.length);
    expect(jobSites.every((site) => site.jobId !== null)).toBe(true);
    expect(new Set(world.locations.map((location) => location.code)).size).toBe(
      world.locations.length,
    );
  });

  it("gives every job exactly one job-site location", () => {
    for (const job of world.jobs) {
      const sites = world.locations.filter((location) => location.jobId === job.id);

      expect(sites).toHaveLength(1);
      expect(sites[0]?.id).toBe(job.jobSiteLocationId);
    }
  });

  it("produces enough history for the transaction log to look alive", () => {
    expect(world.transactions.length).toBeGreaterThan(300);
    expect(world.stockLevels.length).toBeGreaterThan(100);
  });

  it("orders the transaction log by time", () => {
    const times = world.transactions.map(({ occurredAt }) => occurredAt.getTime());

    expect(times).toEqual([...times].sort((left, right) => left - right));
  });

  it("attributes every transaction to a seeded user", () => {
    const userIds = new Set(world.users.map((user) => user.id));

    expect(world.transactions.every(({ actorUserId }) => userIds.has(actorUserId))).toBe(true);
  });

  it("records a reason on exactly the operations that require one", () => {
    for (const transaction of world.transactions) {
      const needsReason = transaction.kind === "Adjust" || transaction.kind === "Release";

      expect(transaction.reason === null).toBe(!needsReason);
    }
  });

  it("exercises the operations the demo script walks through", () => {
    const kinds = new Set(world.transactions.map(({ kind }) => kind));

    expect(kinds).toContain("Receive");
    expect(kinds).toContain("Issue");
    expect(kinds).toContain("Transfer");
    expect(kinds).toContain("Adjust");
    expect(kinds).toContain("Reserve");
    expect(kinds).toContain("Collect");
  });

  it("is deterministic for a given seed and differs for another", () => {
    expect(createWorld().transactions.length).toBe(world.transactions.length);
    expect(createWorld(99).transactions.length).not.toBe(world.transactions.length);
  });
});

describe("seeded balances reconcile with the seeded transaction log", () => {
  it("never seeds a negative balance", () => {
    for (const level of world.stockLevels) {
      expect(level.quantity, `${level.itemId} at ${level.locationId}`).toBeGreaterThan(0);
    }
  });

  it("explains every balance by replaying the log", () => {
    const replayed = new Map<string, number>();
    const key = (itemId: string, locationId: string): string => `${itemId}@${locationId}`;
    const move = (itemId: string, locationId: string, delta: number): void => {
      replayed.set(key(itemId, locationId), (replayed.get(key(itemId, locationId)) ?? 0) + delta);
    };

    for (const transaction of world.transactions) {
      if (transaction.fromLocationId !== null) {
        move(transaction.itemId, transaction.fromLocationId, 0 - transaction.quantity);
      }

      if (transaction.toLocationId !== null) {
        move(transaction.itemId, transaction.toLocationId, transaction.quantity);
      }
    }

    for (const level of world.stockLevels) {
      expect(
        replayed.get(key(level.itemId, level.locationId)) ?? 0,
        `${level.itemId} at ${level.locationId}`,
      ).toBe(level.quantity);
    }

    for (const [composite, quantity] of replayed) {
      if (quantity !== 0) {
        const [itemId, locationId] = composite.split("@") as [string, string];
        const seeded = world.stockLevels.find(
          (level) => level.itemId === itemId && level.locationId === locationId,
        );

        expect(seeded, `${composite} is in the log but not in the balances`).toBeDefined();
      }
    }
  });

  it("keeps every reservation's collected quantity within what was reserved", () => {
    for (const reservation of world.reservations) {
      expect(reservation.quantityCollected).toBeGreaterThanOrEqual(0);
      expect(reservation.quantityCollected).toBeLessThanOrEqual(reservation.quantityReserved);
      expect(reservation.status).toBe(
        reservation.quantityCollected === reservation.quantityReserved ? "Fulfilled" : "Open",
      );
    }
  });

  it("matches each collection in the log to its reservation", () => {
    const collectedByReservation = new Map<string, number>();

    for (const transaction of world.transactions) {
      if (transaction.kind === "Collect" && transaction.reservationId !== null) {
        collectedByReservation.set(
          transaction.reservationId,
          (collectedByReservation.get(transaction.reservationId) ?? 0) + transaction.quantity,
        );
      }
    }

    for (const [reservationId, collected] of collectedByReservation) {
      const reservation = world.reservations.find((candidate) => candidate.id === reservationId);

      expect(reservation, `collection for unknown reservation ${reservationId}`).toBeDefined();
      expect(formatQuantity(reservation?.quantityCollected as Quantity)).toBe(
        formatQuantity(collected as Quantity),
      );
    }
  });

  it("moves collected stock onto the job site it was reserved for", () => {
    for (const transaction of world.transactions) {
      if (transaction.kind !== "Collect") {
        continue;
      }

      const job = world.jobs.find((candidate) => candidate.id === transaction.jobId);

      expect(job).toBeDefined();
      expect(transaction.toLocationId).toBe(job?.jobSiteLocationId);
    }
  });

  it("never reserves more than was available in stores at the time", () => {
    const storeIds = new Set(
      world.locations.filter((location) => location.kind === "Store").map(({ id }) => id),
    );
    const inStores = new Map<string, number>();
    const reservedOpen = new Map<string, number>();

    for (const transaction of world.transactions) {
      if (transaction.kind === "Reserve") {
        const stores = inStores.get(transaction.itemId) ?? 0;
        const reserved = reservedOpen.get(transaction.itemId) ?? 0;

        expect(
          transaction.quantity,
          `reserve of ${transaction.itemId} exceeded availability`,
        ).toBeLessThanOrEqual(stores - reserved);
        reservedOpen.set(transaction.itemId, reserved + transaction.quantity);
        continue;
      }

      if (transaction.kind === "Collect") {
        reservedOpen.set(
          transaction.itemId,
          (reservedOpen.get(transaction.itemId) ?? 0) - transaction.quantity,
        );
      }

      if (transaction.fromLocationId !== null && storeIds.has(transaction.fromLocationId)) {
        inStores.set(
          transaction.itemId,
          (inStores.get(transaction.itemId) ?? 0) - transaction.quantity,
        );
      }

      if (transaction.toLocationId !== null && storeIds.has(transaction.toLocationId)) {
        inStores.set(
          transaction.itemId,
          (inStores.get(transaction.itemId) ?? 0) + transaction.quantity,
        );
      }
    }
  });
});
