import {
  actorId,
  builtinUnits,
  canonicalInstant,
  catalogueItemId,
  catalogueItemName,
  createCatalogueItem,
  effectivePermission,
  ExactDecimal,
  ledgerEntryId,
  ledgerSequence,
  ledgerTransactionId,
  locationId,
  reason,
  serializedAssetId,
  stockHoldingId,
  type CatalogueItem,
  type LedgerActorInput,
  type QuantityLedgerEntryInput,
  type QuantityLedgerStateSnapshot,
  type SerializedLedgerEntryInput,
  type SerializedLedgerStateSnapshot,
} from "../src";

export const decimal = (value: string): ExactDecimal => ExactDecimal.parse(value);

export const quantityItem = (): CatalogueItem =>
  createCatalogueItem({
    id: catalogueItemId("item-cable"),
    name: catalogueItemName("Cable"),
    trackingMode: "QuantityBased",
    handlingPolicy: "PartiallyConsumable",
    baseUnit: builtinUnits.millimetre,
    accessClass: "Standard",
  });

export const serializedItem = (): CatalogueItem =>
  createCatalogueItem({
    id: catalogueItemId("item-drill"),
    name: catalogueItemName("Drill"),
    trackingMode: "Serialized",
    handlingPolicy: "Returnable",
    baseUnit: builtinUnits.each,
    accessClass: "Privileged",
  });

export const ledgerActor = (): LedgerActorInput => ({
  id: actorId("actor-1"),
  effectivePermission: effectivePermission("stock.adjust"),
});

export const quantityState = (
  quantity: string,
  overrides: Partial<QuantityLedgerStateSnapshot> = {},
): QuantityLedgerStateSnapshot => ({
  kind: "Quantity",
  holdingId: stockHoldingId("holding-1"),
  locationId: locationId("location-1"),
  unitId: builtinUnits.millimetre.id,
  quantity: decimal(quantity),
  condition: "Usable",
  lifecycle: "OnHand",
  ...overrides,
});

export const serializedState = (
  overrides: Partial<SerializedLedgerStateSnapshot> = {},
): SerializedLedgerStateSnapshot => ({
  kind: "Serialized",
  holdingId: stockHoldingId("holding-asset-1"),
  assetId: serializedAssetId("asset-1"),
  locationId: locationId("location-1"),
  condition: "Good",
  lifecycle: "InStock",
  ...overrides,
});

export const quantityEntryInput = (
  overrides: Partial<QuantityLedgerEntryInput> = {},
): QuantityLedgerEntryInput => ({
  entryId: ledgerEntryId("entry-1"),
  transactionId: ledgerTransactionId("transaction-1"),
  sequence: ledgerSequence("1"),
  action: "Transfer",
  itemId: quantityItem().id,
  actor: ledgerActor(),
  reason: reason("Move stock"),
  recordedAt: canonicalInstant("2026-07-29T12:00:00.000Z"),
  effectiveAt: canonicalInstant("2026-07-29T11:00:00.000Z"),
  sourceLocationId: locationId("location-1"),
  destinationLocationId: locationId("location-2"),
  relations: [],
  stateChanges: [
    {
      prior: quantityState("10"),
      resulting: quantityState("5"),
    },
  ],
  stockKind: "Quantity",
  unitId: builtinUnits.millimetre.id,
  quantity: decimal("5"),
  ...overrides,
});

export const serializedEntryInput = (
  overrides: Partial<SerializedLedgerEntryInput> = {},
): SerializedLedgerEntryInput => ({
  entryId: ledgerEntryId("entry-asset-1"),
  transactionId: ledgerTransactionId("transaction-asset-1"),
  sequence: ledgerSequence("2"),
  action: "Checkout",
  itemId: serializedItem().id,
  actor: ledgerActor(),
  reason: reason("Issue tool"),
  recordedAt: canonicalInstant("2026-07-29T12:00:00.000Z"),
  effectiveAt: canonicalInstant("2026-07-29T12:00:00.000Z"),
  sourceLocationId: locationId("location-1"),
  destinationLocationId: locationId("custody-1"),
  relations: [],
  stateChanges: [
    {
      prior: serializedState(),
      resulting: serializedState({
        locationId: locationId("custody-1"),
        lifecycle: "InCustody",
      }),
    },
  ],
  stockKind: "Serialized",
  assetId: serializedAssetId("asset-1"),
  ...overrides,
});
