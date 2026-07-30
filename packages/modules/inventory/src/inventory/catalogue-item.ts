import {
  defaultQuantityDecimalPolicy,
  type DecimalPolicy,
  ExactDecimal,
  requireNonNegativeQuantity,
  requirePositiveQuantity,
} from "./decimal";
import { InventoryDomainError } from "./errors";
import {
  assertQuantityAllowedByUnit,
  assertSerializedBaseUnit,
  createUnitDefinition,
  type UnitDefinition,
} from "./units";
import { catalogueItemId, type CatalogueItemId } from "./value-objects";

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type CatalogueItemName = Brand<string, "CatalogueItemName">;
export type IdentifierNamespace = Brand<string, "IdentifierNamespace">;
export type ExactIdentifierValue = Brand<string, "ExactIdentifierValue">;
export type PackId = Brand<string, "PackId">;
export type PackName = Brand<string, "PackName">;

const requiredText = <Name extends string>(
  value: string,
  label: string,
  maximumLength: number,
  trim: boolean,
): Brand<string, Name> => {
  const result = trim ? value.trim() : value;

  if (result.length === 0) {
    throw new InventoryDomainError("ValueRequired", `${label} is required.`);
  }

  if (
    result.length > maximumLength ||
    hasControlCharacter(result) ||
    (!trim && result.trim() !== result)
  ) {
    throw new InventoryDomainError("ValueInvalid", `${label} is invalid.`);
  }

  return result as Brand<string, Name>;
};

export const catalogueItemName = (value: string): CatalogueItemName =>
  requiredText<"CatalogueItemName">(value, "Catalogue item name", 200, true);

export function identifierNamespace(value: string): IdentifierNamespace {
  if (!/^[a-z][a-z0-9._-]{0,63}$/u.test(value)) {
    throw new InventoryDomainError(
      "ValueInvalid",
      "Identifier namespace must be a lower-case stable identifier.",
    );
  }

  return value as IdentifierNamespace;
}

export const exactIdentifierValue = (value: string): ExactIdentifierValue =>
  requiredText<"ExactIdentifierValue">(value, "Exact identifier value", 256, false);

export const packId = (value: string): PackId =>
  requiredText<"PackId">(value, "Pack ID", 64, false);

export const packName = (value: string): PackName =>
  requiredText<"PackName">(value, "Pack name", 100, true);

export const identifierNamespaces = Object.freeze({
  barcode: identifierNamespace("barcode"),
  manufacturerPartNumber: identifierNamespace("manufacturer-part-number"),
  supplierItemCode: identifierNamespace("supplier-item-code"),
});

export interface ExactIdentifierAlias {
  readonly namespace: IdentifierNamespace;
  readonly value: ExactIdentifierValue;
}

export function exactIdentifierAlias(
  namespace: IdentifierNamespace,
  value: ExactIdentifierValue,
): ExactIdentifierAlias {
  return Object.freeze({
    namespace: identifierNamespace(namespace),
    value: exactIdentifierValue(value),
  });
}

export const exactIdentifierKey = (alias: ExactIdentifierAlias): string =>
  `${String(alias.namespace.length)}:${alias.namespace}${alias.value}`;

export const exactIdentifierMatches = (
  left: ExactIdentifierAlias,
  right: ExactIdentifierAlias,
): boolean => left.namespace === right.namespace && left.value === right.value;

export interface PackDefinition {
  readonly id: PackId;
  readonly name: PackName;
  readonly containedBaseQuantity: ExactDecimal;
  readonly fractionalPackCountAllowed: boolean;
  readonly identifiers: readonly ExactIdentifierAlias[];
}

export interface PackDefinitionInput {
  readonly id: PackId;
  readonly name: PackName;
  readonly containedBaseQuantity: ExactDecimal;
  readonly fractionalPackCountAllowed?: boolean;
  readonly identifiers?: readonly ExactIdentifierAlias[];
}

const freezeIdentifiers = (
  identifiers: readonly ExactIdentifierAlias[],
): readonly ExactIdentifierAlias[] => {
  const seen = new Set<string>();
  const frozen = identifiers.map((identifier) => {
    const copy = exactIdentifierAlias(identifier.namespace, identifier.value);
    const key = exactIdentifierKey(copy);

    if (seen.has(key)) {
      throw new InventoryDomainError(
        "DuplicateIdentifier",
        `Exact identifier ${identifier.namespace}:${identifier.value} is duplicated.`,
      );
    }

    seen.add(key);
    return copy;
  });

  return Object.freeze(frozen);
};

export function createPackDefinition(
  input: PackDefinitionInput,
  baseUnit: UnitDefinition,
): PackDefinition {
  if (
    baseUnit.id !== baseUnit.baseUnitId ||
    !baseUnit.baseUnitsPerUnit.equals(ExactDecimal.fromInteger(1n))
  ) {
    throw new InventoryDomainError(
      "CatalogueInvariantViolation",
      "Pack quantities must be expressed in a catalogue base unit.",
    );
  }

  if (
    input.fractionalPackCountAllowed !== undefined &&
    typeof input.fractionalPackCountAllowed !== "boolean"
  ) {
    throw new InventoryDomainError(
      "CatalogueInvariantViolation",
      "Fractional pack handling must be a boolean.",
    );
  }

  requirePositiveQuantity(input.containedBaseQuantity);
  assertQuantityAllowedByUnit(input.containedBaseQuantity, baseUnit);

  return Object.freeze({
    id: packId(input.id),
    name: packName(input.name),
    containedBaseQuantity: input.containedBaseQuantity,
    fractionalPackCountAllowed: input.fractionalPackCountAllowed ?? false,
    identifiers: freezeIdentifiers(input.identifiers ?? []),
  });
}

export function convertPackCountToBaseQuantity(
  packCount: ExactDecimal,
  pack: PackDefinition,
  baseUnit: UnitDefinition,
  policy: DecimalPolicy = defaultQuantityDecimalPolicy,
): ExactDecimal {
  requirePositiveQuantity(packCount);

  if (!pack.fractionalPackCountAllowed && !packCount.isInteger()) {
    throw new InventoryDomainError(
      "QuantityFractionalNotAllowed",
      `Pack ${pack.id} only permits whole pack counts.`,
    );
  }

  const quantity = packCount.multiply(pack.containedBaseQuantity, policy);
  assertQuantityAllowedByUnit(quantity, baseUnit);
  return quantity;
}

export const trackingModes = ["QuantityBased", "Serialized"] as const;
export type TrackingMode = (typeof trackingModes)[number];

export const handlingPolicies = ["Consumable", "PartiallyConsumable", "Returnable"] as const;
export type HandlingPolicy = (typeof handlingPolicies)[number];

export const accessClasses = ["FreeUse", "Standard", "Privileged"] as const;
export type AccessClass = (typeof accessClasses)[number];

export const catalogueItemStatuses = ["Active", "Archived"] as const;
export type CatalogueItemStatus = (typeof catalogueItemStatuses)[number];

export interface ReorderSettings {
  readonly lowStockThreshold: ExactDecimal;
  readonly targetStockLevel: ExactDecimal;
}

export interface CatalogueItem {
  readonly id: CatalogueItemId;
  readonly name: CatalogueItemName;
  readonly trackingMode: TrackingMode;
  readonly handlingPolicy: HandlingPolicy;
  readonly baseUnit: UnitDefinition;
  readonly accessClass: AccessClass;
  readonly consumeOnIssue: boolean;
  readonly status: CatalogueItemStatus;
  readonly identifiers: readonly ExactIdentifierAlias[];
  readonly reorderSettings?: ReorderSettings;
  readonly packs: readonly PackDefinition[];
}

export interface CatalogueItemInput {
  readonly id: CatalogueItemId;
  readonly name: CatalogueItemName;
  readonly trackingMode: TrackingMode;
  readonly handlingPolicy: HandlingPolicy;
  readonly baseUnit: UnitDefinition;
  readonly accessClass: AccessClass;
  readonly consumeOnIssue?: boolean;
  readonly status?: CatalogueItemStatus;
  readonly identifiers?: readonly ExactIdentifierAlias[];
  readonly reorderSettings?: ReorderSettings;
  readonly packs?: readonly PackDefinitionInput[];
}

const contains = <Value extends string>(values: readonly Value[], value: string): value is Value =>
  values.some((candidate) => candidate === value);

const createReorderSettings = (
  settings: ReorderSettings,
  baseUnit: UnitDefinition,
): ReorderSettings => {
  requireNonNegativeQuantity(settings.lowStockThreshold);
  requireNonNegativeQuantity(settings.targetStockLevel);
  assertQuantityAllowedByUnit(settings.lowStockThreshold, baseUnit);
  assertQuantityAllowedByUnit(settings.targetStockLevel, baseUnit);

  if (settings.targetStockLevel.compare(settings.lowStockThreshold) < 0) {
    throw new InventoryDomainError(
      "CatalogueInvariantViolation",
      "Target stock level cannot be below the low-stock threshold.",
    );
  }

  return Object.freeze({
    lowStockThreshold: settings.lowStockThreshold,
    targetStockLevel: settings.targetStockLevel,
  });
};

export function createCatalogueItem(input: CatalogueItemInput): CatalogueItem {
  if (
    !contains(trackingModes, input.trackingMode) ||
    !contains(handlingPolicies, input.handlingPolicy) ||
    !contains(accessClasses, input.accessClass) ||
    (input.status !== undefined && !contains(catalogueItemStatuses, input.status)) ||
    (input.consumeOnIssue !== undefined && typeof input.consumeOnIssue !== "boolean")
  ) {
    throw new InventoryDomainError(
      "CatalogueInvariantViolation",
      "Catalogue enum and boolean values must use supported canonical values.",
    );
  }

  const baseUnit = createUnitDefinition(input.baseUnit);

  if (
    baseUnit.id !== baseUnit.baseUnitId ||
    !baseUnit.baseUnitsPerUnit.equals(ExactDecimal.fromInteger(1n))
  ) {
    throw new InventoryDomainError(
      "CatalogueInvariantViolation",
      "A catalogue item's storage unit must be the dimension's base unit.",
    );
  }

  if (input.trackingMode === "Serialized") {
    assertSerializedBaseUnit(baseUnit);
  }

  if (input.handlingPolicy === "Returnable" && input.trackingMode !== "Serialized") {
    throw new InventoryDomainError(
      "CatalogueInvariantViolation",
      "Returnable stock must be serialized in the MVP.",
    );
  }

  const consumeOnIssue = input.consumeOnIssue ?? false;

  if (consumeOnIssue && input.handlingPolicy !== "Consumable") {
    throw new InventoryDomainError(
      "CatalogueInvariantViolation",
      "Consume on issue is only legal for consumable catalogue items.",
    );
  }

  const identifiers = freezeIdentifiers(input.identifiers ?? []);
  const allIdentifierKeys = new Set(identifiers.map(exactIdentifierKey));
  const packIds = new Set<PackId>();
  const packs = (input.packs ?? []).map((packInput) => {
    if (packIds.has(packInput.id)) {
      throw new InventoryDomainError("DuplicatePack", `Pack ${packInput.id} is duplicated.`);
    }

    packIds.add(packInput.id);
    const pack = createPackDefinition(packInput, baseUnit);

    for (const identifier of pack.identifiers) {
      const key = exactIdentifierKey(identifier);

      if (allIdentifierKeys.has(key)) {
        throw new InventoryDomainError(
          "DuplicateIdentifier",
          `Exact identifier ${identifier.namespace}:${identifier.value} resolves to more than one item or pack.`,
        );
      }

      allIdentifierKeys.add(key);
    }

    return pack;
  });

  const reorderSettings =
    input.reorderSettings === undefined
      ? undefined
      : createReorderSettings(input.reorderSettings, baseUnit);

  return Object.freeze({
    id: catalogueItemId(input.id),
    name: catalogueItemName(input.name),
    trackingMode: input.trackingMode,
    handlingPolicy: input.handlingPolicy,
    baseUnit,
    accessClass: input.accessClass,
    consumeOnIssue,
    status: input.status ?? "Active",
    identifiers,
    ...(reorderSettings === undefined ? {} : { reorderSettings }),
    packs: Object.freeze(packs),
  });
}

export function archiveCatalogueItem(item: CatalogueItem): CatalogueItem {
  if (item.status === "Archived") {
    return item;
  }

  return Object.freeze({
    ...item,
    status: "Archived",
  });
}

export interface ExactIdentifierResolution {
  readonly kind: "Item" | "Pack";
  readonly itemId: CatalogueItemId;
  readonly packId?: PackId;
}

export function resolveExactIdentifier(
  item: CatalogueItem,
  candidate: ExactIdentifierAlias,
): ExactIdentifierResolution | undefined {
  if (item.identifiers.some((identifier) => exactIdentifierMatches(identifier, candidate))) {
    return Object.freeze({
      kind: "Item",
      itemId: item.id,
    });
  }

  const pack = item.packs.find((candidatePack) =>
    candidatePack.identifiers.some((identifier) => exactIdentifierMatches(identifier, candidate)),
  );

  return pack === undefined
    ? undefined
    : Object.freeze({
        kind: "Pack",
        itemId: item.id,
        packId: pack.id,
      });
}
