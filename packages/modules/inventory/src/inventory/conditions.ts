export const quantityStockConditions = ["Usable", "Quarantined", "Damaged", "Expired"] as const;

export type QuantityStockCondition = (typeof quantityStockConditions)[number];

export const serializedToolConditions = ["Good", "DamagedUsable", "Unsafe"] as const;

export type SerializedToolCondition = (typeof serializedToolConditions)[number];

export const quantityHoldingLifecycles = [
  "OnHand",
  "InTransit",
  "AtJobSite",
  "InCustody",
  "WrittenOff",
] as const;

export type QuantityHoldingLifecycle = (typeof quantityHoldingLifecycles)[number];

export const serializedAssetLifecycles = [
  "InStock",
  "InTransit",
  "InCustody",
  "AtJobSite",
  "Missing",
  "Retired",
  "WrittenOff",
] as const;

export type SerializedAssetLifecycle = (typeof serializedAssetLifecycles)[number];

export const isQuantityConditionUsable = (condition: QuantityStockCondition): boolean =>
  condition === "Usable";

export const isSerializedConditionUsable = (condition: SerializedToolCondition): boolean =>
  condition === "Good" || condition === "DamagedUsable";

export const isQuantityLifecycleAvailable = (lifecycle: QuantityHoldingLifecycle): boolean =>
  lifecycle === "OnHand";

export const isSerializedLifecycleAvailable = (lifecycle: SerializedAssetLifecycle): boolean =>
  lifecycle === "InStock";
