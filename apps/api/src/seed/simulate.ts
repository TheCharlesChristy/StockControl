import type { ItemStockSnapshot, LocationBalance } from "../stock/availability";
import {
  adjust,
  collect,
  issue,
  receive,
  reserve,
  transfer,
  type ItemFacts,
  type JobFacts,
  type LocationFacts,
  type ReservationFacts,
  type StockDecision,
  type StockEffect,
  type TransactionDraft,
} from "../stock/operations";
import { add, parseQuantity, ZERO, type Quantity } from "../stock/quantity";
import { buildSeedItems, createRandom, seedJobs, seedLocations, type SeedItem } from "./catalogue";

/**
 * Builds the demo dataset in memory by running the real stock engine, so the
 * seeded transaction log genuinely explains every seeded balance. Writing it to
 * PostgreSQL is a separate concern, in seed.ts.
 */

export const HISTORY_DAYS = 45;

const q = (value: string): Quantity => {
  const parsed = parseQuantity(value);

  if (parsed === null) {
    throw new Error(`Seed quantity "${value}" is invalid.`);
  }

  return parsed;
};

export interface SeededUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: "Engineer" | "Office" | "Admin";
}

export interface SeededLocation {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: "Store" | "JobSite";
  readonly jobId: string | null;
}

export interface SeededItem extends SeedItem {
  readonly id: string;
}

export interface SeededJob {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly customer: string;
  readonly jobSiteLocationId: string;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

export interface SeededJobAssignment {
  readonly jobId: string;
  readonly userId: string;
  readonly assignedByUserId: string;
}

export interface SeededStockRequest {
  readonly id: string;
  readonly reference: string;
  readonly itemId: string;
  readonly jobId: string | null;
  readonly quantity: string;
  readonly note: string | null;
  readonly status: "Pending" | "Approved" | "Rejected" | "Cancelled";
  readonly requestedByUserId: string;
  readonly decidedByUserId: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly createdAt: Date;
}

export interface SeededReservation extends ReservationFacts {
  readonly createdByUserId: string;
  readonly createdAt: Date;
}

export interface SeededTransaction extends TransactionDraft {
  readonly id: string;
  readonly occurredAt: Date;
}

export interface SeededStockLevel {
  readonly itemId: string;
  readonly locationId: string;
  readonly quantity: Quantity;
}

export interface DemoWorld {
  readonly users: readonly SeededUser[];
  readonly locations: readonly SeededLocation[];
  readonly items: readonly SeededItem[];
  readonly jobs: readonly SeededJob[];
  readonly jobAssignments: readonly SeededJobAssignment[];
  readonly reservations: readonly SeededReservation[];
  readonly stockRequests: readonly SeededStockRequest[];
  readonly stockLevels: readonly SeededStockLevel[];
  readonly transactions: readonly SeededTransaction[];
}

class Ledger {
  public readonly transactions: SeededTransaction[] = [];
  public readonly reservations = new Map<string, SeededReservation>();
  private readonly balances = new Map<string, Map<string, Quantity>>();

  public constructor(private readonly createId: () => string) {}

  public snapshotFor(
    itemId: string,
    locations: ReadonlyMap<string, LocationFacts>,
  ): ItemStockSnapshot {
    const perLocation = this.balances.get(itemId) ?? new Map<string, Quantity>();
    const balances: LocationBalance[] = [];

    for (const [locationId, quantity] of perLocation) {
      const location = locations.get(locationId);

      if (location !== undefined) {
        balances.push({
          locationId,
          locationCode: location.code,
          kind: location.kind,
          quantity,
        });
      }
    }

    let openReserved = ZERO;

    for (const reservation of this.reservations.values()) {
      if (reservation.itemId === itemId && reservation.status === "Open") {
        openReserved = add(
          openReserved,
          (reservation.quantityReserved - reservation.quantityCollected) as Quantity,
        );
      }
    }

    return { itemId, balances, openReservedQuantity: openReserved };
  }

  public apply(decision: StockDecision, occurredAt: Date): string | null {
    return decision.ok ? this.applyEffect(decision.effect, occurredAt) : null;
  }

  public applyEffect(effect: StockEffect, occurredAt: Date): string {
    const itemBalances =
      this.balances.get(effect.transaction.itemId) ?? new Map<string, Quantity>();

    for (const change of effect.levelChanges) {
      itemBalances.set(
        change.locationId,
        add(itemBalances.get(change.locationId) ?? ZERO, change.delta),
      );
    }
    this.balances.set(effect.transaction.itemId, itemBalances);

    let reservationId = effect.transaction.reservationId;

    if (effect.newReservation !== undefined) {
      reservationId = this.createId();
      this.reservations.set(reservationId, {
        id: reservationId,
        itemId: effect.newReservation.itemId,
        jobId: effect.newReservation.jobId,
        quantityReserved: effect.newReservation.quantityReserved,
        quantityCollected: ZERO,
        status: "Open",
        createdByUserId: effect.newReservation.createdByUserId,
        createdAt: occurredAt,
      });
    }

    if (effect.reservationUpdate !== undefined) {
      const existing = this.reservations.get(effect.reservationUpdate.reservationId);

      if (existing !== undefined) {
        this.reservations.set(existing.id, {
          ...existing,
          quantityCollected: effect.reservationUpdate.quantityCollected,
          status: effect.reservationUpdate.status,
        });
      }
    }

    this.transactions.push({
      ...effect.transaction,
      id: this.createId(),
      reservationId: reservationId === "" ? null : reservationId,
      occurredAt,
    });

    return reservationId ?? "";
  }

  public stockLevels(): readonly SeededStockLevel[] {
    const rows: SeededStockLevel[] = [];

    for (const [itemId, perLocation] of this.balances) {
      for (const [locationId, quantity] of perLocation) {
        if (quantity !== 0) {
          rows.push({ itemId, locationId, quantity });
        }
      }
    }

    return rows;
  }
}

export interface BuildDemoWorldOptions {
  readonly createId: () => string;
  readonly now: Date;
  readonly seed?: number;
}

export function buildDemoWorld(options: BuildDemoWorldOptions): DemoWorld {
  const random = createRandom(options.seed ?? 20_260_730);
  const dayMs = 86_400_000;
  const dayAgo = (days: number): Date => new Date(options.now.getTime() - days * dayMs);
  const pick = <Value>(values: readonly Value[]): Value =>
    values[Math.floor(random() * values.length)] as Value;

  const users: readonly SeededUser[] = [
    {
      id: options.createId(),
      email: "admin.owner@example.com",
      displayName: "Alex Owner",
      role: "Admin",
    },
    {
      id: options.createId(),
      email: "office.desk@example.com",
      displayName: "Olivia Desk",
      role: "Office",
    },
    {
      id: options.createId(),
      email: "engineer.one@example.com",
      displayName: "Sam Field",
      role: "Engineer",
    },
    /*
     * A second engineer is what makes "only your own activity" visible: sign in
     * as one and the other's movements are absent, which is the point.
     */
    {
      id: options.createId(),
      email: "engineer.two@example.com",
      displayName: "Priya Kaur",
      role: "Engineer",
    },
  ];
  const [admin, office, engineer, secondEngineer] = users as [
    SeededUser,
    SeededUser,
    SeededUser,
    SeededUser,
  ];
  const engineers = [engineer, secondEngineer] as const;

  const jobs: readonly SeededJob[] = seedJobs.map((job, index) => ({
    number: job.number,
    name: job.name,
    customer: job.customer,
    id: options.createId(),
    jobSiteLocationId: options.createId(),
    createdAt: dayAgo(HISTORY_DAYS - index * 3),
    closedAt: job.closed === true ? dayAgo(2) : null,
  }));
  const openJobs = jobs.filter((job) => job.closedAt === null);

  /* Both engineers work the first job; the rest have one each. */
  const jobAssignments: readonly SeededJobAssignment[] = openJobs.flatMap((job, index) =>
    index === 0
      ? engineers.map((person) => ({
          jobId: job.id,
          userId: person.id,
          assignedByUserId: office.id,
        }))
      : [
          {
            jobId: job.id,
            userId: (engineers[index % engineers.length] as SeededUser).id,
            assignedByUserId: office.id,
          },
        ],
  );

  const storeLocations: readonly SeededLocation[] = seedLocations.map((location) => ({
    ...location,
    id: options.createId(),
    kind: "Store" as const,
    jobId: null,
  }));
  const jobSiteLocations: readonly SeededLocation[] = jobs.map((job) => ({
    id: job.jobSiteLocationId,
    code: job.number,
    name: `${job.name} site`,
    kind: "JobSite" as const,
    jobId: job.id,
  }));
  const locations = [...storeLocations, ...jobSiteLocations];

  const locationFacts = new Map<string, LocationFacts>(
    locations.map((location) => [
      location.id,
      { id: location.id, code: location.code, kind: location.kind, isActive: true },
    ]),
  );

  const items: readonly SeededItem[] = buildSeedItems().map((item) => ({
    ...item,
    id: options.createId(),
  }));
  const itemFacts = new Map<string, ItemFacts>(
    items.map((item) => [item.id, { id: item.id, reference: item.reference, isActive: true }]),
  );
  const jobFacts = new Map<string, JobFacts>(
    jobs.map((job) => [
      job.id,
      {
        id: job.id,
        number: job.number,
        status: "Open" as const,
        jobSiteLocationId: job.jobSiteLocationId,
      },
    ]),
  );

  const ledger = new Ledger(options.createId);

  for (const item of items) {
    const facts = itemFacts.get(item.id) as ItemFacts;
    const receiptCount = random() < 0.35 ? 2 : 1;

    for (let index = 0; index < receiptCount; index += 1) {
      const location = pick(storeLocations);
      const magnitude = item.unit === "m" ? 40 + random() * 260 : 25 + random() * 900;
      const quantity = q(
        item.unit === "L" ? (5 + random() * 25).toFixed(1) : String(Math.round(magnitude)),
      );

      ledger.apply(
        receive({
          item: facts,
          location: locationFacts.get(location.id) as LocationFacts,
          quantity,
          actorUserId: office.id,
        }),
        dayAgo(HISTORY_DAYS - Math.floor(random() * 10)),
      );
    }
  }

  for (let index = 0; index < 260; index += 1) {
    const item = pick(items);
    const facts = itemFacts.get(item.id) as ItemFacts;
    const snapshot = ledger.snapshotFor(item.id, locationFacts);
    const held = snapshot.balances.filter((balance) => balance.quantity > 0);

    if (held.length === 0) {
      continue;
    }

    const source = pick(held);
    const sourceFacts = locationFacts.get(source.locationId) as LocationFacts;
    const portion = q(
      String(Math.max(1, Math.round((source.quantity / 1000) * (0.05 + random() * 0.2)))),
    );
    const occurredAt = dayAgo(Math.floor(random() * (HISTORY_DAYS - 12)));
    const roll = random();

    if (roll < 0.5) {
      ledger.apply(
        issue({
          item: facts,
          location: sourceFacts,
          quantity: portion,
          snapshot,
          job: random() < 0.4 ? (jobFacts.get(pick(jobs).id) as JobFacts) : null,
          actorUserId: random() < 0.6 ? pick(engineers).id : office.id,
        }),
        occurredAt,
      );
    } else if (roll < 0.85) {
      const destination = pick(storeLocations);

      ledger.apply(
        transfer({
          item: facts,
          from: sourceFacts,
          to: locationFacts.get(destination.id) as LocationFacts,
          quantity: portion,
          snapshot,
          actorUserId: office.id,
        }),
        occurredAt,
      );
    } else {
      const counted = add(source.quantity, q(String(random() < 0.5 ? -1 : 1)));

      ledger.apply(
        adjust({
          item: facts,
          location: sourceFacts,
          countedQuantity: counted < ZERO ? ZERO : counted,
          snapshot,
          reason: pick(["Cycle count correction", "Damaged in store", "Miscount on receipt"]),
          actorUserId: admin.id,
        }),
        occurredAt,
      );
    }
  }

  for (const job of openJobs) {
    const facts = jobFacts.get(job.id) as JobFacts;
    /* Whoever is on the job is who reserves and collects for it. */
    const jobEngineers = engineers.filter((person) =>
      jobAssignments.some(
        (assignment) => assignment.jobId === job.id && assignment.userId === person.id,
      ),
    );
    const actorFor = (index: number): SeededUser =>
      jobEngineers[index % Math.max(1, jobEngineers.length)] ?? engineer;

    for (let index = 0; index < 6; index += 1) {
      const item = pick(items);
      const itemFact = itemFacts.get(item.id) as ItemFacts;
      const snapshot = ledger.snapshotFor(item.id, locationFacts);
      const inStores = snapshot.balances
        .filter((balance) => balance.kind === "Store")
        .reduce((running, balance) => running + balance.quantity, 0);

      if (inStores <= 5000) {
        continue;
      }

      const quantity = q(String(Math.max(1, Math.round((inStores / 1000) * 0.1))));
      const decision = reserve({
        item: itemFact,
        job: facts,
        quantity,
        snapshot,
        actorUserId: actorFor(index).id,
      });

      if (!decision.ok) {
        continue;
      }

      const reservationId = ledger.applyEffect(decision.effect, dayAgo(10 - index));
      const reservation = ledger.reservations.get(reservationId);
      const collectRoll = random();

      if (reservation === undefined || collectRoll < 0.3) {
        continue;
      }

      const collectSnapshot = ledger.snapshotFor(item.id, locationFacts);
      const source = collectSnapshot.balances
        .filter((balance) => balance.kind === "Store" && balance.quantity > 0)
        .sort((left, right) => right.quantity - left.quantity)[0];

      if (source === undefined) {
        continue;
      }

      const collectQuantity =
        collectRoll < 0.65 ? quantity : (Math.max(1, Math.round(quantity * 0.4)) as Quantity);

      ledger.apply(
        collect({
          item: itemFact,
          job: facts,
          reservation,
          source: locationFacts.get(source.locationId) as LocationFacts,
          quantity: collectQuantity,
          snapshot: collectSnapshot,
          actorUserId: actorFor(index).id,
        }),
        dayAgo(Math.max(1, 9 - index)),
      );
    }
  }

  /*
   * A few requests in each state, so the queue, the engineer's own list and the
   * decided history all have something in them on a fresh database.
   */
  const requestItems = [pick(items), pick(items), pick(items), pick(items)] as const;
  const stockRequests: readonly SeededStockRequest[] = [
    {
      id: options.createId(),
      reference: "REQ-0001",
      itemId: requestItems[0].id,
      jobId: openJobs[0]?.id ?? null,
      quantity: "24",
      note: "Running short on site, need these for Thursday.",
      status: "Pending",
      requestedByUserId: engineer.id,
      decidedByUserId: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: dayAgo(2),
    },
    {
      id: options.createId(),
      reference: "REQ-0002",
      itemId: requestItems[1].id,
      jobId: null,
      quantity: "100",
      note: "We are down to the last box in the van stock.",
      status: "Pending",
      requestedByUserId: secondEngineer.id,
      decidedByUserId: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: dayAgo(1),
    },
    {
      id: options.createId(),
      reference: "REQ-0003",
      itemId: requestItems[2].id,
      jobId: null,
      quantity: "12",
      note: "Spare set for the second fix.",
      status: "Approved",
      requestedByUserId: engineer.id,
      decidedByUserId: office.id,
      decidedAt: dayAgo(4),
      decisionNote: "Ordered with the weekly delivery.",
      createdAt: dayAgo(5),
    },
    {
      id: options.createId(),
      reference: "REQ-0004",
      itemId: requestItems[3].id,
      jobId: null,
      quantity: "500",
      note: "Might as well take a full pallet.",
      status: "Rejected",
      requestedByUserId: secondEngineer.id,
      decidedByUserId: admin.id,
      decidedAt: dayAgo(6),
      decisionNote: "Too much for one job — take what you need from the main store.",
      createdAt: dayAgo(7),
    },
  ];

  return {
    users,
    locations,
    items,
    jobs,
    jobAssignments,
    reservations: [...ledger.reservations.values()],
    stockRequests,
    stockLevels: ledger.stockLevels(),
    transactions: ledger.transactions
      .slice()
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime()),
  };
}
