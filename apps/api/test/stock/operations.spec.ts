import { describe, expect, it } from "vitest";

import type { ItemStockSnapshot, LocationBalance } from "../../src/stock/availability";
import {
  adjust,
  closeJob,
  collect,
  issue,
  outstandingQuantity,
  receive,
  release,
  reserve,
  transfer,
  type ItemFacts,
  type JobFacts,
  type LocationFacts,
  type ReservationFacts,
  type StockDecision,
} from "../../src/stock/operations";
import { formatQuantity, parseQuantity, type Quantity } from "../../src/stock/quantity";

const q = (value: string): Quantity => parseQuantity(value) as Quantity;

const ACTOR = "user-office";

const item: ItemFacts = { id: "item-1", reference: "ITM-0001", isActive: true };
const retiredItem: ItemFacts = { ...item, isActive: false };

const storeA: LocationFacts = { id: "loc-a", code: "STORE-A1", kind: "Store", isActive: true };
const storeB: LocationFacts = { id: "loc-b", code: "STORE-B2", kind: "Store", isActive: true };
const closedStore: LocationFacts = { ...storeB, id: "loc-c", code: "STORE-C3", isActive: false };
const jobSite: LocationFacts = { id: "loc-job", code: "JOB-1001", kind: "JobSite", isActive: true };

const openJob: JobFacts = {
  id: "job-1",
  number: "J-1001",
  status: "Open",
  jobSiteLocationId: jobSite.id,
};
const closedJob: JobFacts = { ...openJob, status: "Closed" };

const balance = (location: LocationFacts, quantity: string): LocationBalance => ({
  locationId: location.id,
  locationCode: location.code,
  kind: location.kind,
  quantity: q(quantity),
});

const snapshot = (balances: readonly LocationBalance[], openReserved = "0"): ItemStockSnapshot => ({
  itemId: item.id,
  balances,
  openReservedQuantity: q(openReserved),
});

const openReservation = (reserved: string, collected = "0"): ReservationFacts => ({
  id: "res-1",
  itemId: item.id,
  jobId: openJob.id,
  quantityReserved: q(reserved),
  quantityCollected: q(collected),
  status: "Open",
});

function expectRefusal(decision: StockDecision, code: string): void {
  if (decision.ok) {
    throw new Error(`Expected a ${code} refusal but the operation was allowed.`);
  }

  expect(decision.error.code).toBe(code);
}

function expectAllowed(decision: StockDecision): Extract<StockDecision, { ok: true }> {
  if (!decision.ok) {
    throw new Error(`Expected the operation to be allowed but got ${decision.error.message}`);
  }

  return decision;
}

describe("receive", () => {
  it("increases the chosen store balance and records a receipt", () => {
    const decision = expectAllowed(
      receive({ item, location: storeA, quantity: q("250"), actorUserId: ACTOR }),
    );

    expect(decision.effect.levelChanges).toEqual([{ locationId: storeA.id, delta: q("250") }]);
    expect(decision.effect.transaction).toMatchObject({
      kind: "Receive",
      itemId: item.id,
      fromLocationId: null,
      toLocationId: storeA.id,
      actorUserId: ACTOR,
    });
  });

  it.each([
    ["0", "QuantityNotPositive"],
    ["-5", "QuantityNotPositive"],
  ])("refuses a quantity of %s", (quantity, code) => {
    expectRefusal(
      receive({ item, location: storeA, quantity: q(quantity), actorUserId: ACTOR }),
      code,
    );
  });

  it("refuses to receive into a job site", () => {
    expectRefusal(
      receive({ item, location: jobSite, quantity: q("5"), actorUserId: ACTOR }),
      "LocationNotStore",
    );
  });

  it("refuses a location that is no longer in use", () => {
    expectRefusal(
      receive({ item, location: closedStore, quantity: q("5"), actorUserId: ACTOR }),
      "LocationInactive",
    );
  });

  it("refuses a retired item", () => {
    expectRefusal(
      receive({ item: retiredItem, location: storeA, quantity: q("5"), actorUserId: ACTOR }),
      "ItemInactive",
    );
  });
});

describe("issue", () => {
  const base = {
    item,
    location: storeA,
    job: null,
    actorUserId: ACTOR,
  };

  it("decreases the balance and records who took it", () => {
    const decision = expectAllowed(
      issue({ ...base, quantity: q("12"), snapshot: snapshot([balance(storeA, "40")]) }),
    );

    expect(decision.effect.levelChanges).toEqual([{ locationId: storeA.id, delta: q("-12") }]);
    expect(decision.effect.transaction).toMatchObject({
      kind: "Issue",
      fromLocationId: storeA.id,
      toLocationId: null,
      jobId: null,
    });
  });

  it("records the job when one is given", () => {
    const decision = expectAllowed(
      issue({
        ...base,
        job: openJob,
        quantity: q("2"),
        snapshot: snapshot([balance(storeA, "40")]),
      }),
    );

    expect(decision.effect.transaction.jobId).toBe(openJob.id);
  });

  it("allows issuing the whole balance", () => {
    expectAllowed(
      issue({ ...base, quantity: q("40"), snapshot: snapshot([balance(storeA, "40")]) }),
    );
  });

  it("refuses to take more than is on hand, and says what is there", () => {
    const decision = issue({
      ...base,
      quantity: q("40"),
      snapshot: snapshot([balance(storeA, "12")]),
    });

    expectRefusal(decision, "InsufficientStock");
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.error.message).toBe("Cannot issue 40 from STORE-A1: 12 on hand.");
    }
  });

  it("refuses when the location holds nothing at all", () => {
    expectRefusal(
      issue({ ...base, quantity: q("1"), snapshot: snapshot([]) }),
      "InsufficientStock",
    );
  });

  it("may issue stock that is already reserved, leaving a visible shortfall", () => {
    expectAllowed(
      issue({
        ...base,
        quantity: q("10"),
        snapshot: snapshot([balance(storeA, "10")], "10"),
      }),
    );
  });
});

describe("transfer", () => {
  const base = { item, from: storeA, to: storeB, actorUserId: ACTOR };

  it("moves stock without changing the total on hand", () => {
    const decision = expectAllowed(
      transfer({ ...base, quantity: q("15"), snapshot: snapshot([balance(storeA, "40")]) }),
    );

    expect(decision.effect.levelChanges).toEqual([
      { locationId: storeA.id, delta: q("-15") },
      { locationId: storeB.id, delta: q("15") },
    ]);
    const total = decision.effect.levelChanges.reduce(
      (running, change) => running + change.delta,
      0,
    );
    expect(total).toBe(0);
  });

  it("can move stock back from a job site", () => {
    expectAllowed(
      transfer({
        ...base,
        from: jobSite,
        to: storeA,
        quantity: q("3"),
        snapshot: snapshot([balance(jobSite, "5")]),
      }),
    );
  });

  it("refuses a transfer to the same location", () => {
    expectRefusal(
      transfer({
        ...base,
        to: storeA,
        quantity: q("1"),
        snapshot: snapshot([balance(storeA, "40")]),
      }),
      "SameSourceAndDestination",
    );
  });

  it("refuses to move more than the source holds", () => {
    expectRefusal(
      transfer({ ...base, quantity: q("41"), snapshot: snapshot([balance(storeA, "40")]) }),
      "InsufficientStock",
    );
  });

  it("refuses a destination that is no longer in use", () => {
    expectRefusal(
      transfer({
        ...base,
        to: closedStore,
        quantity: q("1"),
        snapshot: snapshot([balance(storeA, "40")]),
      }),
      "LocationInactive",
    );
  });
});

describe("adjust", () => {
  const base = { item, location: storeA, reason: "Annual count", actorUserId: ACTOR };

  it("increases to the counted figure and records the difference", () => {
    const decision = expectAllowed(
      adjust({ ...base, countedQuantity: q("45"), snapshot: snapshot([balance(storeA, "40")]) }),
    );

    expect(decision.effect.levelChanges).toEqual([{ locationId: storeA.id, delta: q("5") }]);
    expect(decision.effect.transaction).toMatchObject({
      kind: "Adjust",
      quantity: q("5"),
      fromLocationId: null,
      toLocationId: storeA.id,
      reason: "Annual count",
    });
  });

  it("decreases to the counted figure with the shortfall as a positive quantity", () => {
    const decision = expectAllowed(
      adjust({ ...base, countedQuantity: q("36"), snapshot: snapshot([balance(storeA, "40")]) }),
    );

    expect(decision.effect.levelChanges).toEqual([{ locationId: storeA.id, delta: q("-4") }]);
    expect(decision.effect.transaction).toMatchObject({
      quantity: q("4"),
      fromLocationId: storeA.id,
      toLocationId: null,
    });
  });

  it("can count a balance down to zero", () => {
    const decision = expectAllowed(
      adjust({ ...base, countedQuantity: q("0"), snapshot: snapshot([balance(storeA, "7")]) }),
    );

    expect(decision.effect.levelChanges).toEqual([{ locationId: storeA.id, delta: q("-7") }]);
  });

  it.each(["", "   "])("refuses without a reason (%s)", (reason) => {
    expectRefusal(
      adjust({
        ...base,
        reason,
        countedQuantity: q("45"),
        snapshot: snapshot([balance(storeA, "40")]),
      }),
      "ReasonRequired",
    );
  });

  it("refuses a negative count", () => {
    expectRefusal(
      adjust({ ...base, countedQuantity: q("-1"), snapshot: snapshot([balance(storeA, "40")]) }),
      "QuantityNotPositive",
    );
  });

  it("refuses a no-op rather than writing an empty transaction", () => {
    expectRefusal(
      adjust({ ...base, countedQuantity: q("40"), snapshot: snapshot([balance(storeA, "40")]) }),
      "AdjustmentMatchesCount",
    );
  });

  it("trims the recorded reason", () => {
    const decision = expectAllowed(
      adjust({
        ...base,
        reason: "  Damaged in transit  ",
        countedQuantity: q("39"),
        snapshot: snapshot([balance(storeA, "40")]),
      }),
    );

    expect(decision.effect.transaction.reason).toBe("Damaged in transit");
  });
});

describe("reserve", () => {
  const base = { item, job: openJob, actorUserId: ACTOR };

  it("commits stock without moving it", () => {
    const decision = expectAllowed(
      reserve({ ...base, quantity: q("30"), snapshot: snapshot([balance(storeA, "100")]) }),
    );

    expect(decision.effect.levelChanges).toEqual([]);
    expect(decision.effect.newReservation).toMatchObject({
      itemId: item.id,
      jobId: openJob.id,
      quantityReserved: q("30"),
      createdByUserId: ACTOR,
    });
    expect(decision.effect.transaction.kind).toBe("Reserve");
  });

  it("allows reserving exactly what is available", () => {
    expectAllowed(
      reserve({ ...base, quantity: q("70"), snapshot: snapshot([balance(storeA, "100")], "30") }),
    );
  });

  it("refuses to over-reserve, and says what is available", () => {
    const decision = reserve({
      ...base,
      quantity: q("71"),
      snapshot: snapshot([balance(storeA, "100")], "30"),
    });

    expectRefusal(decision, "InsufficientAvailability");
    if (!decision.ok) {
      expect(decision.error.message).toBe("Cannot reserve 71 of ITM-0001: 70 available.");
    }
  });

  it("does not count job-site stock as reservable", () => {
    expectRefusal(
      reserve({
        ...base,
        quantity: q("5"),
        snapshot: snapshot([balance(jobSite, "50")]),
      }),
      "InsufficientAvailability",
    );
  });

  it("refuses a closed job", () => {
    expectRefusal(
      reserve({
        ...base,
        job: closedJob,
        quantity: q("1"),
        snapshot: snapshot([balance(storeA, "100")]),
      }),
      "JobNotOpen",
    );
  });

  it("refuses when a shortfall has driven availability negative", () => {
    expectRefusal(
      reserve({ ...base, quantity: q("1"), snapshot: snapshot([balance(storeA, "4")], "10") }),
      "InsufficientAvailability",
    );
  });
});

describe("collect", () => {
  const base = {
    item,
    job: openJob,
    source: storeA,
    actorUserId: ACTOR,
  };

  it("moves stock from the store to the job site and closes a fully collected reservation", () => {
    const decision = expectAllowed(
      collect({
        ...base,
        reservation: openReservation("20"),
        quantity: q("20"),
        snapshot: snapshot([balance(storeA, "100")], "20"),
      }),
    );

    expect(decision.effect.levelChanges).toEqual([
      { locationId: storeA.id, delta: q("-20") },
      { locationId: jobSite.id, delta: q("20") },
    ]);
    expect(decision.effect.reservationUpdate).toEqual({
      reservationId: "res-1",
      quantityCollected: q("20"),
      status: "Fulfilled",
    });
  });

  it("leaves the remainder reserved after a partial collection", () => {
    const decision = expectAllowed(
      collect({
        ...base,
        reservation: openReservation("20"),
        quantity: q("12"),
        snapshot: snapshot([balance(storeA, "100")], "20"),
      }),
    );

    expect(decision.effect.reservationUpdate).toEqual({
      reservationId: "res-1",
      quantityCollected: q("12"),
      status: "Open",
    });
  });

  it("supports repeated collection up to the reserved quantity", () => {
    const first = expectAllowed(
      collect({
        ...base,
        reservation: openReservation("20"),
        quantity: q("12"),
        snapshot: snapshot([balance(storeA, "100")], "20"),
      }),
    );
    const second = expectAllowed(
      collect({
        ...base,
        reservation: openReservation("20", "12"),
        quantity: q("8"),
        snapshot: snapshot([balance(storeA, "88")], "8"),
      }),
    );

    expect(first.effect.reservationUpdate?.status).toBe("Open");
    expect(second.effect.reservationUpdate).toEqual({
      reservationId: "res-1",
      quantityCollected: q("20"),
      status: "Fulfilled",
    });
  });

  it("refuses to collect more than is outstanding", () => {
    const decision = collect({
      ...base,
      reservation: openReservation("20", "12"),
      quantity: q("9"),
      snapshot: snapshot([balance(storeA, "100")], "8"),
    });

    expectRefusal(decision, "CollectionExceedsOutstanding");
    if (!decision.ok) {
      expect(decision.error.message).toBe("Cannot collect 9: 8 outstanding on this reservation.");
    }
  });

  it("refuses when the source store cannot cover the collection", () => {
    expectRefusal(
      collect({
        ...base,
        reservation: openReservation("20"),
        quantity: q("20"),
        snapshot: snapshot([balance(storeA, "5")], "20"),
      }),
      "InsufficientStock",
    );
  });

  it("refuses a reservation that is no longer open", () => {
    expectRefusal(
      collect({
        ...base,
        reservation: { ...openReservation("20"), status: "Released" },
        quantity: q("1"),
        snapshot: snapshot([balance(storeA, "100")], "0"),
      }),
      "ReservationNotOpen",
    );
  });

  it("refuses once the reservation has nothing outstanding", () => {
    expectRefusal(
      collect({
        ...base,
        reservation: openReservation("20", "20"),
        quantity: q("1"),
        snapshot: snapshot([balance(storeA, "100")]),
      }),
      "NothingOutstanding",
    );
  });

  it("refuses to collect from a job site", () => {
    expectRefusal(
      collect({
        ...base,
        source: jobSite,
        reservation: openReservation("20"),
        quantity: q("1"),
        snapshot: snapshot([balance(jobSite, "100")], "20"),
      }),
      "LocationNotStore",
    );
  });

  it("refuses when the job has been closed", () => {
    expectRefusal(
      collect({
        ...base,
        job: closedJob,
        reservation: openReservation("20"),
        quantity: q("1"),
        snapshot: snapshot([balance(storeA, "100")], "20"),
      }),
      "JobNotOpen",
    );
  });
});

describe("release", () => {
  const base = { item, reason: "No longer needed", actorUserId: ACTOR };

  it("gives back only the uncollected remainder", () => {
    const decision = expectAllowed(release({ ...base, reservation: openReservation("20", "12") }));

    expect(decision.effect.levelChanges).toEqual([]);
    expect(decision.effect.transaction).toMatchObject({
      kind: "Release",
      quantity: q("8"),
      reason: "No longer needed",
    });
    expect(decision.effect.reservationUpdate).toEqual({
      reservationId: "res-1",
      quantityCollected: q("12"),
      status: "Released",
    });
  });

  it("refuses without a reason", () => {
    expectRefusal(
      release({ ...base, reason: "", reservation: openReservation("20") }),
      "ReasonRequired",
    );
  });

  it("refuses a reservation that is already fully collected", () => {
    expectRefusal(
      release({ ...base, reservation: openReservation("20", "20") }),
      "NothingOutstanding",
    );
  });

  it("refuses a reservation that is not open", () => {
    expectRefusal(
      release({ ...base, reservation: { ...openReservation("20"), status: "Fulfilled" } }),
      "ReservationNotOpen",
    );
  });
});

describe("outstandingQuantity", () => {
  it("is the reserved quantity less what has been collected", () => {
    expect(formatQuantity(outstandingQuantity(openReservation("20", "12.5")))).toBe("7.500");
  });
});

describe("closeJob", () => {
  it("releases every open reservation and leaves job-site stock alone", () => {
    const decision = closeJob({
      job: openJob,
      openReservations: [
        { reservation: openReservation("20", "12"), item },
        { reservation: { ...openReservation("6"), id: "res-2" }, item },
      ],
      actorUserId: ACTOR,
    });

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.releases).toHaveLength(2);
      expect(decision.releases.map(({ transaction }) => transaction.quantity)).toEqual([
        q("8"),
        q("6"),
      ]);
      expect(decision.releases.every(({ levelChanges }) => levelChanges.length === 0)).toBe(true);
      expect(decision.releases[0]?.transaction.reason).toBe("Job J-1001 closed");
    }
  });

  it("closes cleanly when there is nothing reserved", () => {
    const decision = closeJob({ job: openJob, openReservations: [], actorUserId: ACTOR });

    expect(decision).toEqual({ ok: true, releases: [] });
  });

  it("refuses to close a job that is already closed", () => {
    const decision = closeJob({ job: closedJob, openReservations: [], actorUserId: ACTOR });

    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.error.code).toBe("JobNotOpen");
    }
  });
});

describe("the transaction-per-change invariant", () => {
  it("writes exactly one transaction for every operation that changes a balance", () => {
    const decisions = [
      receive({ item, location: storeA, quantity: q("10"), actorUserId: ACTOR }),
      issue({
        item,
        location: storeA,
        job: null,
        quantity: q("1"),
        snapshot: snapshot([balance(storeA, "10")]),
        actorUserId: ACTOR,
      }),
      transfer({
        item,
        from: storeA,
        to: storeB,
        quantity: q("1"),
        snapshot: snapshot([balance(storeA, "10")]),
        actorUserId: ACTOR,
      }),
      adjust({
        item,
        location: storeA,
        countedQuantity: q("9"),
        snapshot: snapshot([balance(storeA, "10")]),
        reason: "Count",
        actorUserId: ACTOR,
      }),
      collect({
        item,
        job: openJob,
        source: storeA,
        reservation: openReservation("5"),
        quantity: q("5"),
        snapshot: snapshot([balance(storeA, "10")], "5"),
        actorUserId: ACTOR,
      }),
    ];

    for (const decision of decisions) {
      const allowed = expectAllowed(decision);
      expect(allowed.effect.levelChanges.length).toBeGreaterThan(0);
      expect(allowed.effect.transaction).toBeDefined();
      expect(allowed.effect.transaction.actorUserId).toBe(ACTOR);
    }
  });

  it("still records a transaction for reserve and release, which move nothing", () => {
    const reserved = expectAllowed(
      reserve({
        item,
        job: openJob,
        quantity: q("5"),
        snapshot: snapshot([balance(storeA, "10")]),
        actorUserId: ACTOR,
      }),
    );
    const released = expectAllowed(
      release({ item, reservation: openReservation("5"), reason: "Cancelled", actorUserId: ACTOR }),
    );

    expect(reserved.effect.levelChanges).toEqual([]);
    expect(reserved.effect.transaction.kind).toBe("Reserve");
    expect(released.effect.levelChanges).toEqual([]);
    expect(released.effect.transaction.kind).toBe("Release");
  });

  it("never produces a level change that is not covered by its transaction quantity", () => {
    const decision = expectAllowed(
      transfer({
        item,
        from: storeA,
        to: storeB,
        quantity: q("7.5"),
        snapshot: snapshot([balance(storeA, "10")]),
        actorUserId: ACTOR,
      }),
    );

    for (const change of decision.effect.levelChanges) {
      expect(Math.abs(change.delta)).toBe(decision.effect.transaction.quantity);
    }
  });
});
