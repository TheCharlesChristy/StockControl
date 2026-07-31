import { calculateAvailability, quantityAt, type ItemStockSnapshot } from "./availability";
import {
  adjustmentMatchesCount,
  collectionExceedsOutstanding,
  insufficientAvailability,
  insufficientStock,
  itemInactive,
  jobNotOpen,
  locationInactive,
  locationNotStore,
  nothingOutstanding,
  quantityNotPositive,
  reasonRequired,
  reservationNotOpen,
  sameSourceAndDestination,
  type StockError,
} from "./errors";
import {
  atLeast,
  add,
  isPositive,
  isZero,
  negate,
  subtract,
  ZERO,
  type Quantity,
} from "./quantity";

/**
 * These functions decide; they do not perform. Each returns the exact set of
 * effects the caller must apply inside one database transaction, or a typed
 * refusal. Nothing here touches a database, a clock, or a framework, which is
 * what makes the rules in requirements section 3 cheap to test.
 */

export type TransactionKind =
  "Receive" | "Issue" | "Transfer" | "Adjust" | "Reserve" | "Collect" | "Release";

export interface ItemFacts {
  readonly id: string;
  readonly reference: string;
  readonly isActive: boolean;
}

export interface LocationFacts {
  readonly id: string;
  readonly code: string;
  readonly kind: "Store" | "JobSite";
  readonly isActive: boolean;
  readonly operationalKind?:
    "Container" | "Storage" | "Quarantine" | "Repair" | "Transit" | "VirtualJobSite";
  readonly generalFulfilmentEnabled?: boolean;
}

export interface JobFacts {
  readonly id: string;
  readonly number: string;
  readonly status: "Open" | "Closed";
  readonly jobSiteLocationId: string;
}

export interface ReservationFacts {
  readonly id: string;
  readonly itemId: string;
  readonly jobId: string;
  readonly quantityReserved: Quantity;
  readonly quantityCollected: Quantity;
  readonly status: "Open" | "Fulfilled" | "Released";
}

/** A signed change to one item's balance at one location. */
export interface LevelChange {
  readonly locationId: string;
  readonly delta: Quantity;
}

export interface TransactionDraft {
  readonly kind: TransactionKind;
  readonly itemId: string;
  readonly quantity: Quantity;
  readonly fromLocationId: string | null;
  readonly toLocationId: string | null;
  readonly jobId: string | null;
  readonly reservationId: string | null;
  readonly reason: string | null;
  readonly actorUserId: string;
}

export interface ReservationDraft {
  readonly itemId: string;
  readonly jobId: string;
  readonly quantityReserved: Quantity;
  readonly createdByUserId: string;
}

export interface ReservationUpdate {
  readonly reservationId: string;
  readonly quantityCollected: Quantity;
  readonly status: "Open" | "Fulfilled" | "Released";
}

export interface StockEffect {
  readonly levelChanges: readonly LevelChange[];
  readonly transaction: TransactionDraft;
  readonly newReservation?: ReservationDraft;
  readonly reservationUpdate?: ReservationUpdate;
}

export type StockDecision =
  | { readonly ok: true; readonly effect: StockEffect }
  | { readonly ok: false; readonly error: StockError };

const refuse = (error: StockError): StockDecision => ({ ok: false, error });
const allow = (effect: StockEffect): StockDecision => ({ ok: true, effect });

export function outstandingQuantity(reservation: ReservationFacts): Quantity {
  return subtract(reservation.quantityReserved, reservation.quantityCollected);
}

const checkPositive = (quantity: Quantity): StockError | null =>
  isPositive(quantity) ? null : quantityNotPositive();

const checkUsableLocation = (location: LocationFacts): StockError | null =>
  location.isActive ? null : locationInactive(location.code);

const checkStoreLocation = (location: LocationFacts): StockError | null =>
  location.kind === "Store" &&
  (location.operationalKind === undefined || location.operationalKind === "Storage")
    ? null
    : locationNotStore(location.code);

const checkActiveItem = (item: ItemFacts): StockError | null =>
  item.isActive ? null : itemInactive(item.reference);

const checkReason = (reason: string, operation: string): StockError | null =>
  reason.trim().length > 0 ? null : reasonRequired(operation);

const firstError = (...checks: readonly (StockError | null)[]): StockError | null =>
  checks.find((check) => check !== null) ?? null;

export interface ReceiveCommand {
  readonly item: ItemFacts;
  readonly location: LocationFacts;
  readonly quantity: Quantity;
  readonly actorUserId: string;
}

/** Increases a store balance. Requirements section 4, Receive. */
export function receive(command: ReceiveCommand): StockDecision {
  const problem = firstError(
    checkPositive(command.quantity),
    checkActiveItem(command.item),
    checkUsableLocation(command.location),
    checkStoreLocation(command.location),
  );

  if (problem !== null) {
    return refuse(problem);
  }

  return allow({
    levelChanges: [{ locationId: command.location.id, delta: command.quantity }],
    transaction: {
      kind: "Receive",
      itemId: command.item.id,
      quantity: command.quantity,
      fromLocationId: null,
      toLocationId: command.location.id,
      jobId: null,
      reservationId: null,
      reason: null,
      actorUserId: command.actorUserId,
    },
  });
}

export interface IssueCommand {
  readonly item: ItemFacts;
  readonly location: LocationFacts;
  readonly quantity: Quantity;
  readonly snapshot: ItemStockSnapshot;
  readonly job: JobFacts | null;
  readonly actorUserId: string;
}

/**
 * Consumes stock out of the system. Issuing is checked against what is
 * physically at the location, not against availability, so stock already
 * committed to a job can still be issued — that shows up afterwards as a
 * negative available quantity rather than being silently prevented.
 */
export function issue(command: IssueCommand): StockDecision {
  const problem = firstError(
    checkPositive(command.quantity),
    checkActiveItem(command.item),
    checkUsableLocation(command.location),
  );

  if (problem !== null) {
    return refuse(problem);
  }

  const onHand = quantityAt(command.snapshot, command.location.id);

  if (!atLeast(onHand, command.quantity)) {
    return refuse(insufficientStock("issue", command.quantity, command.location.code, onHand));
  }

  return allow({
    levelChanges: [{ locationId: command.location.id, delta: negate(command.quantity) }],
    transaction: {
      kind: "Issue",
      itemId: command.item.id,
      quantity: command.quantity,
      fromLocationId: command.location.id,
      toLocationId: null,
      jobId: command.job?.id ?? null,
      reservationId: null,
      reason: null,
      actorUserId: command.actorUserId,
    },
  });
}

export interface TransferCommand {
  readonly item: ItemFacts;
  readonly from: LocationFacts;
  readonly to: LocationFacts;
  readonly quantity: Quantity;
  readonly snapshot: ItemStockSnapshot;
  readonly actorUserId: string;
}

/** Moves stock between locations. The total on hand does not change. */
export function transfer(command: TransferCommand): StockDecision {
  const problem = firstError(
    checkPositive(command.quantity),
    checkActiveItem(command.item),
    command.from.id === command.to.id ? sameSourceAndDestination() : null,
    checkUsableLocation(command.from),
    checkUsableLocation(command.to),
  );

  if (problem !== null) {
    return refuse(problem);
  }

  const onHand = quantityAt(command.snapshot, command.from.id);

  if (!atLeast(onHand, command.quantity)) {
    return refuse(insufficientStock("transfer", command.quantity, command.from.code, onHand));
  }

  return allow({
    levelChanges: [
      { locationId: command.from.id, delta: negate(command.quantity) },
      { locationId: command.to.id, delta: command.quantity },
    ],
    transaction: {
      kind: "Transfer",
      itemId: command.item.id,
      quantity: command.quantity,
      fromLocationId: command.from.id,
      toLocationId: command.to.id,
      jobId: null,
      reservationId: null,
      reason: null,
      actorUserId: command.actorUserId,
    },
  });
}

export interface AdjustCommand {
  readonly item: ItemFacts;
  readonly location: LocationFacts;
  readonly countedQuantity: Quantity;
  readonly snapshot: ItemStockSnapshot;
  readonly reason: string;
  readonly actorUserId: string;
}

/** Corrects a balance to a counted figure, up or down. Always needs a reason. */
export function adjust(command: AdjustCommand): StockDecision {
  const problem = firstError(
    command.countedQuantity < ZERO ? quantityNotPositive() : null,
    checkActiveItem(command.item),
    checkUsableLocation(command.location),
    checkReason(command.reason, "adjustment"),
  );

  if (problem !== null) {
    return refuse(problem);
  }

  const recorded = quantityAt(command.snapshot, command.location.id);
  const delta = subtract(command.countedQuantity, recorded);

  if (isZero(delta)) {
    return refuse(adjustmentMatchesCount(recorded));
  }

  const increase = isPositive(delta);

  return allow({
    levelChanges: [{ locationId: command.location.id, delta }],
    transaction: {
      kind: "Adjust",
      itemId: command.item.id,
      quantity: increase ? delta : negate(delta),
      fromLocationId: increase ? null : command.location.id,
      toLocationId: increase ? command.location.id : null,
      jobId: null,
      reservationId: null,
      reason: command.reason.trim(),
      actorUserId: command.actorUserId,
    },
  });
}

export interface ReserveCommand {
  readonly item: ItemFacts;
  readonly job: JobFacts;
  readonly quantity: Quantity;
  readonly snapshot: ItemStockSnapshot;
  readonly actorUserId: string;
}

/**
 * Commits store stock to a job. Nothing moves: the physical balances are
 * untouched and only availability falls.
 */
export function reserve(command: ReserveCommand): StockDecision {
  const problem = firstError(
    checkPositive(command.quantity),
    checkActiveItem(command.item),
    command.job.status === "Open" ? null : jobNotOpen(command.job.number),
  );

  if (problem !== null) {
    return refuse(problem);
  }

  const { available } = calculateAvailability(command.snapshot);

  if (!atLeast(available, command.quantity)) {
    return refuse(insufficientAvailability(command.quantity, command.item.reference, available));
  }

  return allow({
    levelChanges: [],
    newReservation: {
      itemId: command.item.id,
      jobId: command.job.id,
      quantityReserved: command.quantity,
      createdByUserId: command.actorUserId,
    },
    transaction: {
      kind: "Reserve",
      itemId: command.item.id,
      quantity: command.quantity,
      fromLocationId: null,
      toLocationId: null,
      jobId: command.job.id,
      reservationId: null,
      reason: null,
      actorUserId: command.actorUserId,
    },
  });
}

export interface CollectCommand {
  readonly item: ItemFacts;
  readonly job: JobFacts;
  readonly reservation: ReservationFacts;
  readonly source: LocationFacts;
  readonly quantity: Quantity;
  readonly snapshot: ItemStockSnapshot;
  readonly actorUserId: string;
}

/**
 * Hands reserved stock over, moving it from a store to the job site. May be
 * partial and may be repeated; the uncollected remainder stays reserved.
 */
export function collect(command: CollectCommand): StockDecision {
  const problem = firstError(
    checkPositive(command.quantity),
    command.reservation.status === "Open" ? null : reservationNotOpen(),
    command.job.status === "Open" ? null : jobNotOpen(command.job.number),
    checkUsableLocation(command.source),
    checkStoreLocation(command.source),
  );

  if (problem !== null) {
    return refuse(problem);
  }

  const outstanding = outstandingQuantity(command.reservation);

  if (isZero(outstanding)) {
    return refuse(nothingOutstanding());
  }

  if (!atLeast(outstanding, command.quantity)) {
    return refuse(collectionExceedsOutstanding(command.quantity, outstanding));
  }

  const onHand = quantityAt(command.snapshot, command.source.id);

  if (!atLeast(onHand, command.quantity)) {
    return refuse(insufficientStock("collect", command.quantity, command.source.code, onHand));
  }

  const quantityCollected = add(command.reservation.quantityCollected, command.quantity);
  const fullyCollected = quantityCollected === command.reservation.quantityReserved;

  return allow({
    levelChanges: [
      { locationId: command.source.id, delta: negate(command.quantity) },
      { locationId: command.job.jobSiteLocationId, delta: command.quantity },
    ],
    reservationUpdate: {
      reservationId: command.reservation.id,
      quantityCollected,
      status: fullyCollected ? "Fulfilled" : "Open",
    },
    transaction: {
      kind: "Collect",
      itemId: command.item.id,
      quantity: command.quantity,
      fromLocationId: command.source.id,
      toLocationId: command.job.jobSiteLocationId,
      jobId: command.job.id,
      reservationId: command.reservation.id,
      reason: null,
      actorUserId: command.actorUserId,
    },
  });
}

export interface ReleaseCommand {
  readonly item: ItemFacts;
  readonly reservation: ReservationFacts;
  readonly reason: string;
  readonly actorUserId: string;
}

/** Gives back the uncollected remainder. Collected stock stays at the job site. */
export function release(command: ReleaseCommand): StockDecision {
  const problem = firstError(
    command.reservation.status === "Open" ? null : reservationNotOpen(),
    checkReason(command.reason, "release"),
  );

  if (problem !== null) {
    return refuse(problem);
  }

  const outstanding = outstandingQuantity(command.reservation);

  if (isZero(outstanding)) {
    return refuse(nothingOutstanding());
  }

  return allow({
    levelChanges: [],
    reservationUpdate: {
      reservationId: command.reservation.id,
      quantityCollected: command.reservation.quantityCollected,
      status: "Released",
    },
    transaction: {
      kind: "Release",
      itemId: command.item.id,
      quantity: outstanding,
      fromLocationId: null,
      toLocationId: null,
      jobId: command.reservation.jobId,
      reservationId: command.reservation.id,
      reason: command.reason.trim(),
      actorUserId: command.actorUserId,
    },
  });
}

export interface CloseJobCommand {
  readonly job: JobFacts;
  readonly openReservations: readonly {
    readonly reservation: ReservationFacts;
    readonly item: ItemFacts;
  }[];
  readonly actorUserId: string;
}

export type CloseJobDecision =
  | { readonly ok: true; readonly releases: readonly StockEffect[] }
  | { readonly ok: false; readonly error: StockError };

/**
 * Closing a job releases every uncollected reservation on it. Stock already at
 * the job site is left where it is; the close screen warns about it rather than
 * forcing a reconciliation the demo does not model.
 */
export function closeJob(command: CloseJobCommand): CloseJobDecision {
  if (command.job.status !== "Open") {
    return { ok: false, error: jobNotOpen(command.job.number) };
  }

  const releases: StockEffect[] = [];

  for (const { reservation, item } of command.openReservations) {
    const decision = release({
      item,
      reservation,
      reason: `Job ${command.job.number} closed`,
      actorUserId: command.actorUserId,
    });

    if (decision.ok) {
      releases.push(decision.effect);
    }
  }

  return { ok: true, releases };
}
