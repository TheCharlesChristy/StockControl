import {
  quantityHoldingLifecycles,
  quantityStockConditions,
  serializedAssetLifecycles,
  serializedToolConditions,
  type QuantityHoldingLifecycle,
  type QuantityStockCondition,
  type SerializedAssetLifecycle,
  type SerializedToolCondition,
} from "./conditions";
import { requireNonNegativeQuantity, requirePositiveQuantity, type ExactDecimal } from "./decimal";
import { InventoryDomainError } from "./errors";
import type { UnitId } from "./units";
import {
  actorId,
  canonicalInstant,
  catalogueItemId,
  compareLedgerSequences,
  effectivePermission,
  idempotencyKey,
  idempotencyScope,
  ledgerEntryId,
  ledgerSequence,
  ledgerTransactionId,
  locationId,
  outcomeReference,
  reason,
  requestFingerprint,
  serializedAssetId,
  stockHoldingId,
  type ActorId,
  type CanonicalInstant,
  type CatalogueItemId,
  type EffectivePermission,
  type IdempotencyKey,
  type IdempotencyScope,
  type LedgerEntryId,
  type LedgerSequence,
  type LedgerTransactionId,
  type LocationId,
  type OutcomeReference,
  type Reason,
  type RequestFingerprint,
  type SerializedAssetId,
  type StockHoldingId,
} from "./value-objects";

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

export const ledgerActions = [
  "Receipt",
  "Consumption",
  "Checkout",
  "Return",
  "Transfer",
  "Reservation",
  "ReservationRelease",
  "Allocation",
  "Collection",
  "ConditionChange",
  "Damage",
  "StocktakeAdjustment",
  "AdjustmentIncrease",
  "AdjustmentDecrease",
  "Loss",
  "WriteOff",
  "Reversal",
] as const;

export type LedgerAction = (typeof ledgerActions)[number];

export const ledgerRelationKinds = [
  "Job",
  "Reservation",
  "Allocation",
  "User",
  "Request",
  "PurchaseOrder",
] as const;

export type LedgerRelationKind = (typeof ledgerRelationKinds)[number];

type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type LedgerRelationReference = Brand<string, "LedgerRelationReference">;

export function ledgerRelationReference(value: string): LedgerRelationReference {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > 128 || hasControlCharacter(trimmed)) {
    throw new InventoryDomainError(
      "ValueInvalid",
      "Ledger relation reference must contain 1-128 non-control characters.",
    );
  }

  return trimmed as LedgerRelationReference;
}

export interface LedgerActor {
  readonly id: ActorId;
  readonly effectivePermission: EffectivePermission;
}

export interface LedgerActorInput {
  readonly id: ActorId;
  readonly effectivePermission: EffectivePermission;
}

export function createLedgerActor(input: LedgerActorInput): LedgerActor {
  return Object.freeze({
    id: actorId(input.id),
    effectivePermission: effectivePermission(input.effectivePermission),
  });
}

export interface LedgerRelation {
  readonly kind: LedgerRelationKind;
  readonly reference: LedgerRelationReference;
}

export interface LedgerRelationInput {
  readonly kind: LedgerRelationKind;
  readonly reference: LedgerRelationReference;
}

export interface QuantityLedgerStateSnapshot {
  readonly kind: "Quantity";
  readonly holdingId: StockHoldingId;
  readonly locationId: LocationId;
  readonly unitId: UnitId;
  readonly quantity: ExactDecimal;
  readonly condition: QuantityStockCondition;
  readonly lifecycle: QuantityHoldingLifecycle;
}

export interface SerializedLedgerStateSnapshot {
  readonly kind: "Serialized";
  readonly holdingId: StockHoldingId;
  readonly assetId: SerializedAssetId;
  readonly locationId?: LocationId;
  readonly condition: SerializedToolCondition;
  readonly lifecycle: SerializedAssetLifecycle;
}

export type LedgerStateSnapshot = QuantityLedgerStateSnapshot | SerializedLedgerStateSnapshot;

export interface LedgerStateChange {
  readonly prior?: LedgerStateSnapshot;
  readonly resulting?: LedgerStateSnapshot;
}

export interface LedgerStateChangeInput {
  readonly prior?: LedgerStateSnapshot;
  readonly resulting?: LedgerStateSnapshot;
}

interface CommonLedgerEntry {
  readonly entryId: LedgerEntryId;
  readonly transactionId: LedgerTransactionId;
  readonly sequence: LedgerSequence;
  readonly action: LedgerAction;
  readonly itemId: CatalogueItemId;
  readonly actor: LedgerActor;
  readonly reason: Reason;
  readonly recordedAt: CanonicalInstant;
  readonly effectiveAt: CanonicalInstant;
  readonly sourceLocationId?: LocationId;
  readonly destinationLocationId?: LocationId;
  readonly relations: readonly LedgerRelation[];
  readonly stateChanges: readonly LedgerStateChange[];
  readonly reversalOfEntryId?: LedgerEntryId;
  readonly correctionOfEntryId?: LedgerEntryId;
}

export interface QuantityLedgerEntry extends CommonLedgerEntry {
  readonly stockKind: "Quantity";
  readonly unitId: UnitId;
  readonly quantity: ExactDecimal;
}

export interface SerializedLedgerEntry extends CommonLedgerEntry {
  readonly stockKind: "Serialized";
  readonly assetId: SerializedAssetId;
}

export type LedgerEntry = QuantityLedgerEntry | SerializedLedgerEntry;

interface CommonLedgerEntryInput {
  readonly entryId: LedgerEntryId;
  readonly transactionId: LedgerTransactionId;
  readonly sequence: LedgerSequence;
  readonly action: LedgerAction;
  readonly itemId: CatalogueItemId;
  readonly actor: LedgerActorInput;
  readonly reason: Reason;
  readonly recordedAt: CanonicalInstant;
  readonly effectiveAt: CanonicalInstant;
  readonly sourceLocationId?: LocationId;
  readonly destinationLocationId?: LocationId;
  readonly relations?: readonly LedgerRelationInput[];
  readonly stateChanges: readonly LedgerStateChangeInput[];
  readonly reversalOfEntryId?: LedgerEntryId;
  readonly correctionOfEntryId?: LedgerEntryId;
}

export interface QuantityLedgerEntryInput extends CommonLedgerEntryInput {
  readonly stockKind: "Quantity";
  readonly unitId: UnitId;
  readonly quantity: ExactDecimal;
  readonly assetId?: never;
}

export interface SerializedLedgerEntryInput extends CommonLedgerEntryInput {
  readonly stockKind: "Serialized";
  readonly assetId: SerializedAssetId;
  readonly unitId?: never;
  readonly quantity?: never;
}

export type LedgerEntryInput = QuantityLedgerEntryInput | SerializedLedgerEntryInput;

const isMember = <Value extends string>(value: string, values: readonly Value[]): value is Value =>
  values.some((candidate) => candidate === value);

const cloneRelation = (input: LedgerRelationInput): LedgerRelation => {
  if (!isMember(input.kind, ledgerRelationKinds)) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "Ledger relation kind is not supported.",
    );
  }

  return Object.freeze({
    kind: input.kind,
    reference: ledgerRelationReference(input.reference),
  });
};

const cloneQuantityState = (
  snapshot: QuantityLedgerStateSnapshot,
  entry: QuantityLedgerEntryInput,
): QuantityLedgerStateSnapshot => {
  requireNonNegativeQuantity(snapshot.quantity);

  if (
    snapshot.unitId !== entry.unitId ||
    !isMember(snapshot.condition, quantityStockConditions) ||
    !isMember(snapshot.lifecycle, quantityHoldingLifecycles)
  ) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "Quantity state must use the entry unit and supported condition and lifecycle values.",
    );
  }

  return Object.freeze({
    kind: "Quantity",
    holdingId: stockHoldingId(snapshot.holdingId),
    locationId: locationId(snapshot.locationId),
    unitId: snapshot.unitId,
    quantity: snapshot.quantity,
    condition: snapshot.condition,
    lifecycle: snapshot.lifecycle,
  });
};

const cloneSerializedState = (
  snapshot: SerializedLedgerStateSnapshot,
  entry: SerializedLedgerEntryInput,
): SerializedLedgerStateSnapshot => {
  if (
    snapshot.assetId !== entry.assetId ||
    !isMember(snapshot.condition, serializedToolConditions) ||
    !isMember(snapshot.lifecycle, serializedAssetLifecycles)
  ) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "Serialized state must use the entry asset and supported condition and lifecycle values.",
    );
  }

  const snapshotLocation =
    snapshot.locationId === undefined ? undefined : locationId(snapshot.locationId);

  return Object.freeze({
    kind: "Serialized",
    holdingId: stockHoldingId(snapshot.holdingId),
    assetId: serializedAssetId(snapshot.assetId),
    ...(snapshotLocation === undefined ? {} : { locationId: snapshotLocation }),
    condition: snapshot.condition,
    lifecycle: snapshot.lifecycle,
  });
};

const cloneStateChange = (
  input: LedgerStateChangeInput,
  entry: LedgerEntryInput,
): LedgerStateChange => {
  if (input.prior === undefined && input.resulting === undefined) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "A state change must contain a prior or resulting state.",
    );
  }

  const cloneSnapshot = (
    snapshot: LedgerStateSnapshot | undefined,
  ): LedgerStateSnapshot | undefined => {
    if (snapshot === undefined) {
      return undefined;
    }

    if (
      (entry.stockKind === "Quantity" && snapshot.kind !== "Quantity") ||
      (entry.stockKind === "Serialized" && snapshot.kind !== "Serialized")
    ) {
      throw new InventoryDomainError(
        "LedgerInvariantViolation",
        "Ledger state kind must match the entry stock kind.",
      );
    }

    return entry.stockKind === "Quantity" && snapshot.kind === "Quantity"
      ? cloneQuantityState(snapshot, entry)
      : cloneSerializedState(
          snapshot as SerializedLedgerStateSnapshot,
          entry as SerializedLedgerEntryInput,
        );
  };

  const prior = cloneSnapshot(input.prior);
  const resulting = cloneSnapshot(input.resulting);

  return Object.freeze({
    ...(prior === undefined ? {} : { prior }),
    ...(resulting === undefined ? {} : { resulting }),
  });
};

const assertEntryLinks = (input: LedgerEntryInput): void => {
  const hasReversal = input.reversalOfEntryId !== undefined;
  const hasCorrection = input.correctionOfEntryId !== undefined;

  if (
    (input.action === "Reversal" && !hasReversal) ||
    (input.action !== "Reversal" && hasReversal) ||
    (input.action === "Reversal" && hasCorrection) ||
    (hasReversal && input.reversalOfEntryId === input.entryId) ||
    (hasCorrection && input.correctionOfEntryId === input.entryId)
  ) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "Reversal and correction links must be explicit, action-compatible, and cannot self-reference.",
    );
  }
};

export function createLedgerEntry(input: LedgerEntryInput): LedgerEntry {
  const stockKind: string = input.stockKind;

  if (
    !isMember(input.action, ledgerActions) ||
    !isMember(stockKind, ["Quantity", "Serialized"] as const)
  ) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "Ledger action or stock kind is not supported.",
    );
  }

  if (input.sourceLocationId === undefined && input.destinationLocationId === undefined) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "A stock ledger entry requires a source or destination location.",
    );
  }

  if (
    input.sourceLocationId !== undefined &&
    input.sourceLocationId === input.destinationLocationId
  ) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "Source and destination locations must differ.",
    );
  }

  const recordedAt = canonicalInstant(input.recordedAt);
  const effectiveAt = canonicalInstant(input.effectiveAt);

  if (effectiveAt > recordedAt) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "The effective time of an accepted stock change cannot be in the future relative to its recording time.",
    );
  }

  assertEntryLinks(input);

  if (input.stateChanges.length === 0) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "A stock ledger entry must record at least one prior or resulting state.",
    );
  }

  const relations = (input.relations ?? []).map(cloneRelation);
  const relationKeys = new Set<string>();

  for (const relation of relations) {
    const key = `${relation.kind}:${relation.reference}`;

    if (relationKeys.has(key)) {
      throw new InventoryDomainError(
        "LedgerInvariantViolation",
        "A ledger relation cannot be duplicated.",
      );
    }

    relationKeys.add(key);
  }

  const stateChanges = input.stateChanges.map((stateChange) =>
    cloneStateChange(stateChange, input),
  );
  const common = {
    entryId: ledgerEntryId(input.entryId),
    transactionId: ledgerTransactionId(input.transactionId),
    sequence: ledgerSequence(input.sequence),
    action: input.action,
    itemId: catalogueItemId(input.itemId),
    actor: createLedgerActor(input.actor),
    reason: reason(input.reason),
    recordedAt,
    effectiveAt,
    ...(input.sourceLocationId === undefined
      ? {}
      : { sourceLocationId: locationId(input.sourceLocationId) }),
    ...(input.destinationLocationId === undefined
      ? {}
      : { destinationLocationId: locationId(input.destinationLocationId) }),
    relations: Object.freeze(relations),
    stateChanges: Object.freeze(stateChanges),
    ...(input.reversalOfEntryId === undefined
      ? {}
      : { reversalOfEntryId: ledgerEntryId(input.reversalOfEntryId) }),
    ...(input.correctionOfEntryId === undefined
      ? {}
      : { correctionOfEntryId: ledgerEntryId(input.correctionOfEntryId) }),
  };

  if (input.stockKind === "Quantity") {
    if ("assetId" in input) {
      throw new InventoryDomainError(
        "LedgerInvariantViolation",
        "A quantity ledger entry cannot also identify a serialized asset.",
      );
    }

    requirePositiveQuantity(input.quantity);
    return Object.freeze({
      ...common,
      stockKind: "Quantity",
      unitId: input.unitId,
      quantity: input.quantity,
    });
  }

  if ("quantity" in input || "unitId" in input) {
    throw new InventoryDomainError(
      "LedgerInvariantViolation",
      "A serialized ledger entry cannot also contain a quantity payload.",
    );
  }

  return Object.freeze({
    ...common,
    stockKind: "Serialized",
    assetId: serializedAssetId(input.assetId),
  });
}

export interface IdempotencyAttempt {
  readonly scope: IdempotencyScope;
  readonly key: IdempotencyKey;
  readonly fingerprint: RequestFingerprint;
  readonly actorId: ActorId;
}

export interface IdempotencyRecord extends IdempotencyAttempt {
  readonly outcomeReference: OutcomeReference;
}

export interface IdempotencyAttemptInput {
  readonly scope: IdempotencyScope;
  readonly key: IdempotencyKey;
  readonly fingerprint: RequestFingerprint;
  readonly actorId: ActorId;
}

export interface IdempotencyRecordInput extends IdempotencyAttemptInput {
  readonly outcomeReference: OutcomeReference;
}

export type IdempotencyDecision =
  | {
      readonly kind: "Execute";
      readonly attempt: IdempotencyAttempt;
    }
  | {
      readonly kind: "Replay";
      readonly outcomeReference: OutcomeReference;
    };

const createIdempotencyAttempt = (input: IdempotencyAttemptInput): IdempotencyAttempt =>
  Object.freeze({
    scope: idempotencyScope(input.scope),
    key: idempotencyKey(input.key),
    fingerprint: requestFingerprint(input.fingerprint),
    actorId: actorId(input.actorId),
  });

export function createIdempotencyRecord(input: IdempotencyRecordInput): IdempotencyRecord {
  return Object.freeze({
    ...createIdempotencyAttempt(input),
    outcomeReference: outcomeReference(input.outcomeReference),
  });
}

export function resolveIdempotency(
  attemptInput: IdempotencyAttemptInput,
  existingInput?: IdempotencyRecordInput,
): IdempotencyDecision {
  const attempt = createIdempotencyAttempt(attemptInput);

  if (existingInput === undefined) {
    return Object.freeze({
      kind: "Execute",
      attempt,
    });
  }

  const existing = createIdempotencyRecord(existingInput);

  if (existing.scope !== attempt.scope || existing.key !== attempt.key) {
    throw new InventoryDomainError(
      "IdempotencyInputInvalid",
      "The existing idempotency record must belong to the attempted scope and key.",
    );
  }

  if (existing.fingerprint !== attempt.fingerprint || existing.actorId !== attempt.actorId) {
    throw new InventoryDomainError(
      "IdempotencyConflict",
      "The idempotency key is already bound to a different request fingerprint or actor.",
    );
  }

  return Object.freeze({
    kind: "Replay",
    outcomeReference: existing.outcomeReference,
  });
}

export interface ProjectionRebuildContext {
  readonly entriesApplied: number;
  readonly firstSequence?: LedgerSequence;
  readonly lastSequence?: LedgerSequence;
}

export interface ProjectionRebuildHooks<State, Result> {
  readonly createInitialState: () => State;
  readonly applyEntry: (state: State, entry: LedgerEntry) => State;
  readonly finalize: (state: State, context: ProjectionRebuildContext) => Result;
}

export function rebuildProjection<State, Result>(
  entries: readonly LedgerEntry[],
  hooks: ProjectionRebuildHooks<State, Result>,
): Result {
  let state = hooks.createInitialState();
  let previousSequence: LedgerSequence | undefined;
  let firstSequence: LedgerSequence | undefined;
  let entriesApplied = 0;

  for (const entry of entries) {
    const currentSequence = ledgerSequence(entry.sequence);

    if (
      previousSequence !== undefined &&
      compareLedgerSequences(previousSequence, currentSequence) >= 0
    ) {
      throw new InventoryDomainError(
        "LedgerSequenceOutOfOrder",
        "Projection rebuild entries must be strictly ordered by ledger sequence.",
      );
    }

    firstSequence ??= currentSequence;
    state = hooks.applyEntry(state, entry);
    previousSequence = currentSequence;
    entriesApplied += 1;
  }

  const context: ProjectionRebuildContext = Object.freeze({
    entriesApplied,
    ...(firstSequence === undefined ? {} : { firstSequence }),
    ...(previousSequence === undefined ? {} : { lastSequence: previousSequence }),
  });

  return hooks.finalize(state, context);
}
