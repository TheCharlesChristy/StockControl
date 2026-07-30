import type { CatalogueItem } from "./catalogue-item";
import {
  isQuantityConditionUsable,
  isQuantityLifecycleAvailable,
  isSerializedConditionUsable,
  isSerializedLifecycleAvailable,
  quantityHoldingLifecycles,
  quantityStockConditions,
  serializedAssetLifecycles,
  serializedToolConditions,
  type QuantityHoldingLifecycle,
  type QuantityStockCondition,
  type SerializedAssetLifecycle,
  type SerializedToolCondition,
} from "./conditions";
import {
  defaultQuantityDecimalPolicy,
  type DecimalPolicy,
  ExactDecimal,
  requirePositiveQuantity,
} from "./decimal";
import { InventoryDomainError } from "./errors";
import { assertQuantityAllowedByUnit, type UnitId } from "./units";
import {
  canonicalInstant,
  catalogueItemId,
  commitmentId,
  demandIdentity,
  inboundLineId,
  locationId,
  serializedAssetId,
  stockHoldingId,
  type CanonicalInstant,
  type CatalogueItemId,
  type CommitmentId,
  type DemandIdentity,
  type InboundLineId,
  type LocationId,
  type SerializedAssetId,
  type StockHoldingId,
} from "./value-objects";

export const locationKinds = [
  "Fulfilment",
  "DisabledStorage",
  "Container",
  "Van",
  "JobSite",
  "UserCustody",
  "Quarantine",
  "Repair",
  "Transit",
  "Inactive",
] as const;

export type LocationKind = (typeof locationKinds)[number];

export interface HoldingLocation {
  readonly id: LocationId;
  readonly kind: LocationKind;
}

interface HoldingIdentity {
  readonly holdingId: StockHoldingId;
  readonly itemId: CatalogueItemId;
  readonly location: HoldingLocation;
}

export interface QuantityHolding extends HoldingIdentity {
  readonly kind: "Quantity";
  readonly unitId: UnitId;
  readonly quantity: ExactDecimal;
  readonly condition: QuantityStockCondition;
  readonly lifecycle: QuantityHoldingLifecycle;
}

export interface SerializedHolding extends HoldingIdentity {
  readonly kind: "Serialized";
  readonly assetId: SerializedAssetId;
  readonly condition: SerializedToolCondition;
  readonly lifecycle: SerializedAssetLifecycle;
}

export type StockHolding = QuantityHolding | SerializedHolding;

export type CommitmentKind = "JobReservation" | "UserAllocation";

interface CommitmentIdentity {
  readonly id: CommitmentId;
  readonly kind: CommitmentKind;
  readonly itemId: CatalogueItemId;
  readonly sourceHoldingId: StockHoldingId;
}

export interface QuantityCommitment extends CommitmentIdentity {
  readonly stockKind: "Quantity";
  readonly unitId: UnitId;
  readonly quantity: ExactDecimal;
}

export interface SerializedCommitment extends CommitmentIdentity {
  readonly stockKind: "Serialized";
  readonly assetId: SerializedAssetId;
}

export type StockCommitment = QuantityCommitment | SerializedCommitment;

export interface ConfirmedInboundLine {
  readonly id: InboundLineId;
  readonly itemId: CatalogueItemId;
  readonly unitId: UnitId;
  readonly quantity: ExactDecimal;
  readonly dueAt: CanonicalInstant;
}

export interface UncommittedDemandLine {
  /**
   * Shared by linked reservation and purchase-request representations of the
   * same demand. Equal duplicates are counted once; conflicting duplicates are
   * rejected rather than guessed.
   */
  readonly demandIdentity: DemandIdentity;
  readonly itemId: CatalogueItemId;
  readonly unitId: UnitId;
  readonly quantity: ExactDecimal;
  readonly dueAt: CanonicalInstant;
}

export interface AvailabilityProjectionInput {
  readonly item: CatalogueItem;
  readonly holdings: readonly StockHolding[];
  readonly commitments: readonly StockCommitment[];
  readonly confirmedInbound?: readonly ConfirmedInboundLine[];
  readonly uncommittedDemand?: readonly UncommittedDemandLine[];
  readonly projectedAt: CanonicalInstant;
  readonly decimalPolicy?: DecimalPolicy;
}

export interface CommittedShortfall {
  readonly commitmentId: CommitmentId;
  readonly commitmentKind: CommitmentKind;
  readonly sourceHoldingId: StockHoldingId;
  readonly quantity: ExactDecimal;
  readonly assetId?: SerializedAssetId;
  readonly reason: "ConditionUnavailable" | "LocationExcluded" | "LifecycleUnavailable";
}

export interface LocationAvailability {
  readonly location: HoldingLocation;
  readonly physicalStock: ExactDecimal;
  readonly eligibleUsableStock: ExactDecimal;
  readonly jobReserved: ExactDecimal;
  readonly userAllocated: ExactDecimal;
  readonly availableNow: ExactDecimal;
  readonly committedShortfall: ExactDecimal;
}

export interface AvailabilityProjection {
  readonly itemId: CatalogueItemId;
  readonly unitId: UnitId;
  readonly physicalStock: ExactDecimal;
  readonly eligibleUsableStock: ExactDecimal;
  readonly jobReserved: ExactDecimal;
  readonly userAllocated: ExactDecimal;
  readonly availableNow: ExactDecimal;
  readonly committedShortfall: ExactDecimal;
  readonly committedShortfalls: readonly CommittedShortfall[];
  readonly confirmedInboundDue: ExactDecimal;
  readonly uncommittedDemandDue: ExactDecimal;
  readonly projectedAt: CanonicalInstant;
  /**
   * Signed so a projected shortage remains visible instead of being clamped.
   */
  readonly projectedAvailable: ExactDecimal;
  readonly projectedShortfall: ExactDecimal;
  readonly byLocation: readonly LocationAvailability[];
}

interface HoldingProjectionState {
  readonly holding: StockHolding;
  readonly physical: ExactDecimal;
  committed: ExactDecimal;
  jobReserved: ExactDecimal;
  userAllocated: ExactDecimal;
  readonly commitments: StockCommitment[];
}

type HoldingProjection =
  | (HoldingProjectionState & {
      readonly eligible: true;
    })
  | (HoldingProjectionState & {
      readonly eligible: false;
      readonly unavailableReason: CommittedShortfall["reason"];
    });

interface MutableLocationProjection {
  readonly location: HoldingLocation;
  physicalStock: ExactDecimal;
  eligibleUsableStock: ExactDecimal;
  jobReserved: ExactDecimal;
  userAllocated: ExactDecimal;
  availableNow: ExactDecimal;
  committedShortfall: ExactDecimal;
}

const zero = (): ExactDecimal => ExactDecimal.zero();
const one = ExactDecimal.fromInteger(1n);

const contains = <Value extends string>(values: readonly Value[], value: string): value is Value =>
  values.some((candidate) => candidate === value);

const add = (left: ExactDecimal, right: ExactDecimal, policy: DecimalPolicy): ExactDecimal =>
  left.add(right, policy);

const assertCanonicalIdentity = (
  value: string,
  factory: (candidate: string) => string,
  label: string,
): void => {
  try {
    if (factory(value) !== value) {
      throw new Error("non-canonical");
    }
  } catch {
    throw new InventoryDomainError(
      "ProjectionInputInvalid",
      `${label} must be a canonical stock identity.`,
    );
  }
};

const unavailableReasonForHolding = (
  holding: StockHolding,
): CommittedShortfall["reason"] | undefined => {
  if (holding.location.kind !== "Fulfilment") {
    return "LocationExcluded";
  }

  if (
    (holding.kind === "Quantity" && !isQuantityLifecycleAvailable(holding.lifecycle)) ||
    (holding.kind === "Serialized" && !isSerializedLifecycleAvailable(holding.lifecycle))
  ) {
    return "LifecycleUnavailable";
  }

  if (
    (holding.kind === "Quantity" && !isQuantityConditionUsable(holding.condition)) ||
    (holding.kind === "Serialized" && !isSerializedConditionUsable(holding.condition))
  ) {
    return "ConditionUnavailable";
  }

  return undefined;
};

const assertItemAndUnit = (
  item: CatalogueItem,
  itemId: CatalogueItemId,
  unitIdValue?: UnitId,
): void => {
  assertCanonicalIdentity(item.id, catalogueItemId, "Catalogue item ID");
  assertCanonicalIdentity(itemId, catalogueItemId, "Projection item ID");

  if (itemId !== item.id) {
    throw new InventoryDomainError(
      "ProjectionItemMismatch",
      `Projection line item ${itemId} does not match ${item.id}.`,
    );
  }

  if (unitIdValue !== undefined && unitIdValue !== item.baseUnit.id) {
    throw new InventoryDomainError(
      "ProjectionUnitMismatch",
      `Projection line unit ${unitIdValue} does not match base unit ${item.baseUnit.id}.`,
    );
  }
};

const validateHolding = (item: CatalogueItem, holding: StockHolding): void => {
  const holdingKind: string = holding.kind;
  const locationKind: string = holding.location.kind;

  if (
    !contains(["Quantity", "Serialized"] as const, holdingKind) ||
    !contains(locationKinds, locationKind)
  ) {
    throw new InventoryDomainError(
      "ProjectionInputInvalid",
      "Holding and location kinds must use supported canonical values.",
    );
  }

  assertCanonicalIdentity(holding.holdingId, stockHoldingId, "Holding ID");
  assertCanonicalIdentity(holding.location.id, locationId, "Holding location ID");
  assertItemAndUnit(item, holding.itemId, holding.kind === "Quantity" ? holding.unitId : undefined);

  if (
    (item.trackingMode === "QuantityBased" && holding.kind !== "Quantity") ||
    (item.trackingMode === "Serialized" && holding.kind !== "Serialized")
  ) {
    throw new InventoryDomainError(
      "ProjectionInputInvalid",
      "Holding kind does not match the catalogue tracking mode.",
    );
  }

  if (holding.kind === "Quantity") {
    const condition: string = holding.condition;
    const lifecycle: string = holding.lifecycle;

    if (
      !contains(quantityStockConditions, condition) ||
      !contains(quantityHoldingLifecycles, lifecycle)
    ) {
      throw new InventoryDomainError(
        "ProjectionInputInvalid",
        "Quantity holding condition or lifecycle is not supported.",
      );
    }

    requirePositiveQuantity(holding.quantity);
    assertQuantityAllowedByUnit(holding.quantity, item.baseUnit);
  } else {
    const condition: string = holding.condition;
    const lifecycle: string = holding.lifecycle;

    if (
      !contains(serializedToolConditions, condition) ||
      !contains(serializedAssetLifecycles, lifecycle)
    ) {
      throw new InventoryDomainError(
        "ProjectionInputInvalid",
        "Serialized holding condition or lifecycle is not supported.",
      );
    }
    assertCanonicalIdentity(holding.assetId, serializedAssetId, "Serialized asset ID");
  }
};

const physicalQuantity = (holding: StockHolding): ExactDecimal =>
  holding.kind === "Quantity" ? holding.quantity : one;

const createHoldingProjection = (holding: StockHolding): HoldingProjection => {
  const unavailableReason = unavailableReasonForHolding(holding);
  const state = {
    holding,
    physical: physicalQuantity(holding),
    committed: zero(),
    jobReserved: zero(),
    userAllocated: zero(),
    commitments: [],
  };

  return unavailableReason === undefined
    ? { ...state, eligible: true }
    : { ...state, eligible: false, unavailableReason };
};

const assertCommitmentMatchesHolding = (
  item: CatalogueItem,
  commitment: StockCommitment,
  projection: HoldingProjection,
): void => {
  const commitmentKind: string = commitment.kind;
  const stockKind: string = commitment.stockKind;

  if (
    !contains(["JobReservation", "UserAllocation"] as const, commitmentKind) ||
    !contains(["Quantity", "Serialized"] as const, stockKind)
  ) {
    throw new InventoryDomainError(
      "ProjectionInputInvalid",
      "Commitment kinds must use supported canonical values.",
    );
  }

  assertCanonicalIdentity(commitment.id, commitmentId, "Commitment ID");
  assertCanonicalIdentity(
    commitment.sourceHoldingId,
    stockHoldingId,
    "Commitment source holding ID",
  );
  assertItemAndUnit(
    item,
    commitment.itemId,
    commitment.stockKind === "Quantity" ? commitment.unitId : undefined,
  );

  if (
    (commitment.stockKind === "Quantity" && projection.holding.kind !== "Quantity") ||
    (commitment.stockKind === "Serialized" && projection.holding.kind !== "Serialized")
  ) {
    throw new InventoryDomainError(
      "ProjectionInputInvalid",
      "Commitment kind does not match its source holding.",
    );
  }

  if (
    commitment.stockKind === "Serialized" &&
    projection.holding.kind === "Serialized" &&
    commitment.assetId !== projection.holding.assetId
  ) {
    throw new InventoryDomainError(
      "ProjectionInputInvalid",
      "Serialized commitment asset does not match its source holding.",
    );
  }

  if (commitment.stockKind === "Quantity") {
    requirePositiveQuantity(commitment.quantity);
    assertQuantityAllowedByUnit(commitment.quantity, item.baseUnit);
  } else {
    assertCanonicalIdentity(commitment.assetId, serializedAssetId, "Committed asset ID");
  }
};

const addCommitment = (
  projection: HoldingProjection,
  commitment: StockCommitment,
  policy: DecimalPolicy,
): void => {
  const quantity = commitment.stockKind === "Quantity" ? commitment.quantity : one;
  projection.committed = add(projection.committed, quantity, policy);

  if (commitment.kind === "JobReservation") {
    projection.jobReserved = add(projection.jobReserved, quantity, policy);
  } else {
    projection.userAllocated = add(projection.userAllocated, quantity, policy);
  }

  projection.commitments.push(commitment);

  if (projection.committed.compare(projection.physical) > 0) {
    throw new InventoryDomainError(
      "ProjectionOvercommitted",
      `Holding ${projection.holding.holdingId} is committed beyond its physical stock.`,
    );
  }
};

const addDatedQuantity = (
  item: CatalogueItem,
  line: ConfirmedInboundLine | UncommittedDemandLine,
): void => {
  if ("id" in line) {
    assertCanonicalIdentity(line.id, inboundLineId, "Inbound line ID");
  } else {
    assertCanonicalIdentity(line.demandIdentity, demandIdentity, "Demand identity");
  }
  assertItemAndUnit(item, line.itemId, line.unitId);
  requirePositiveQuantity(line.quantity);
  assertQuantityAllowedByUnit(line.quantity, item.baseUnit);
  canonicalInstant(line.dueAt);
};

const sameDemand = (left: UncommittedDemandLine, right: UncommittedDemandLine): boolean =>
  left.itemId === right.itemId &&
  left.unitId === right.unitId &&
  left.dueAt === right.dueAt &&
  left.quantity.equals(right.quantity);

const createMutableLocationProjection = (location: HoldingLocation): MutableLocationProjection => ({
  location: Object.freeze({ ...location }),
  physicalStock: zero(),
  eligibleUsableStock: zero(),
  jobReserved: zero(),
  userAllocated: zero(),
  availableNow: zero(),
  committedShortfall: zero(),
});

export function projectAvailability(input: AvailabilityProjectionInput): AvailabilityProjection {
  const policy = input.decimalPolicy ?? defaultQuantityDecimalPolicy;
  const projectedAt = canonicalInstant(input.projectedAt);
  const holdingsById = new Map<StockHoldingId, HoldingProjection>();
  const assets = new Set<SerializedAssetId>();
  const locations = new Map<LocationId, LocationKind>();

  for (const holding of input.holdings) {
    validateHolding(input.item, holding);

    if (holdingsById.has(holding.holdingId)) {
      throw new InventoryDomainError(
        "ProjectionDuplicateIdentity",
        `Holding ${holding.holdingId} is duplicated.`,
      );
    }

    const knownLocationKind = locations.get(holding.location.id);

    if (knownLocationKind !== undefined && knownLocationKind !== holding.location.kind) {
      throw new InventoryDomainError(
        "ProjectionInputInvalid",
        `Location ${holding.location.id} has conflicting kinds.`,
      );
    }

    locations.set(holding.location.id, holding.location.kind);

    if (holding.kind === "Serialized") {
      if (assets.has(holding.assetId)) {
        throw new InventoryDomainError(
          "ProjectionDuplicateIdentity",
          `Serialized asset ${holding.assetId} is duplicated.`,
        );
      }

      assets.add(holding.assetId);
    }

    holdingsById.set(holding.holdingId, createHoldingProjection(holding));
  }

  const commitmentIds = new Set<CommitmentId>();

  for (const commitment of input.commitments) {
    if (commitmentIds.has(commitment.id)) {
      throw new InventoryDomainError(
        "ProjectionDuplicateIdentity",
        `Commitment ${commitment.id} is duplicated.`,
      );
    }

    commitmentIds.add(commitment.id);
    const projection = holdingsById.get(commitment.sourceHoldingId);

    if (projection === undefined) {
      throw new InventoryDomainError(
        "ProjectionSourceMissing",
        `Commitment ${commitment.id} has no source holding.`,
      );
    }

    assertCommitmentMatchesHolding(input.item, commitment, projection);
    addCommitment(projection, commitment, policy);
  }

  let physicalStock = zero();
  let eligibleUsableStock = zero();
  let jobReserved = zero();
  let userAllocated = zero();
  let availableNow = zero();
  let committedShortfall = zero();
  const committedShortfalls: CommittedShortfall[] = [];
  const byLocation = new Map<LocationId, MutableLocationProjection>();

  for (const projection of holdingsById.values()) {
    const locationIdValue = projection.holding.location.id;
    const location =
      byLocation.get(locationIdValue) ??
      createMutableLocationProjection(projection.holding.location);
    byLocation.set(locationIdValue, location);
    physicalStock = add(physicalStock, projection.physical, policy);
    location.physicalStock = add(location.physicalStock, projection.physical, policy);
    jobReserved = add(jobReserved, projection.jobReserved, policy);
    userAllocated = add(userAllocated, projection.userAllocated, policy);
    location.jobReserved = add(location.jobReserved, projection.jobReserved, policy);
    location.userAllocated = add(location.userAllocated, projection.userAllocated, policy);

    if (projection.eligible) {
      eligibleUsableStock = add(eligibleUsableStock, projection.physical, policy);
      location.eligibleUsableStock = add(location.eligibleUsableStock, projection.physical, policy);
      const sourceAvailable = projection.physical.subtract(projection.committed, policy);
      availableNow = add(availableNow, sourceAvailable, policy);
      location.availableNow = add(location.availableNow, sourceAvailable, policy);
      continue;
    }

    committedShortfall = add(committedShortfall, projection.committed, policy);
    location.committedShortfall = add(location.committedShortfall, projection.committed, policy);

    for (const commitment of projection.commitments) {
      const quantity = commitment.stockKind === "Quantity" ? commitment.quantity : one;
      committedShortfalls.push(
        Object.freeze({
          commitmentId: commitment.id,
          commitmentKind: commitment.kind,
          sourceHoldingId: commitment.sourceHoldingId,
          quantity,
          ...(commitment.stockKind === "Serialized" ? { assetId: commitment.assetId } : {}),
          reason: projection.unavailableReason,
        }),
      );
    }
  }

  let confirmedInboundDue = zero();
  const inboundIds = new Set<InboundLineId>();

  for (const inbound of input.confirmedInbound ?? []) {
    addDatedQuantity(input.item, inbound);

    if (inboundIds.has(inbound.id)) {
      throw new InventoryDomainError(
        "ProjectionDuplicateIdentity",
        `Confirmed inbound line ${inbound.id} is duplicated.`,
      );
    }

    inboundIds.add(inbound.id);

    if (inbound.dueAt <= projectedAt) {
      confirmedInboundDue = add(confirmedInboundDue, inbound.quantity, policy);
    }
  }

  let uncommittedDemandDue = zero();
  const demands = new Map<DemandIdentity, UncommittedDemandLine>();

  for (const demand of input.uncommittedDemand ?? []) {
    addDatedQuantity(input.item, demand);
    const existing = demands.get(demand.demandIdentity);

    if (existing !== undefined) {
      if (!sameDemand(existing, demand)) {
        throw new InventoryDomainError(
          "ProjectionDuplicateIdentity",
          `Demand ${demand.demandIdentity} has conflicting duplicate representations.`,
        );
      }

      continue;
    }

    demands.set(demand.demandIdentity, demand);

    if (demand.dueAt <= projectedAt) {
      uncommittedDemandDue = add(uncommittedDemandDue, demand.quantity, policy);
    }
  }

  const projectedAvailable = availableNow
    .add(confirmedInboundDue, policy)
    .subtract(uncommittedDemandDue, policy);
  const projectedShortfall = projectedAvailable.isNegative()
    ? projectedAvailable.absolute(policy)
    : zero();

  const frozenLocations = [...byLocation.values()]
    .sort((left, right) => left.location.id.localeCompare(right.location.id))
    .map((location) =>
      Object.freeze({
        location: location.location,
        physicalStock: location.physicalStock,
        eligibleUsableStock: location.eligibleUsableStock,
        jobReserved: location.jobReserved,
        userAllocated: location.userAllocated,
        availableNow: location.availableNow,
        committedShortfall: location.committedShortfall,
      }),
    );

  return Object.freeze({
    itemId: input.item.id,
    unitId: input.item.baseUnit.id,
    physicalStock,
    eligibleUsableStock,
    jobReserved,
    userAllocated,
    availableNow,
    committedShortfall,
    committedShortfalls: Object.freeze(committedShortfalls),
    confirmedInboundDue,
    uncommittedDemandDue,
    projectedAt,
    projectedAvailable,
    projectedShortfall,
    byLocation: Object.freeze(frozenLocations),
  });
}
