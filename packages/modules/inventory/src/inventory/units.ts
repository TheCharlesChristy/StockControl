import {
  defaultQuantityDecimalPolicy,
  type DecimalPolicy,
  type DecimalRoundingPolicy,
  ExactDecimal,
  requireNonNegativeQuantity,
} from "./decimal";
import { InventoryDomainError } from "./errors";

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type UnitId = Brand<string, "UnitId">;
export type UnitDimension = Brand<string, "UnitDimension">;
export type UnitName = Brand<string, "UnitName">;
export type UnitSymbol = Brand<string, "UnitSymbol">;

export const unitDimensions = Object.freeze({
  count: "Count" as UnitDimension,
  length: "Length" as UnitDimension,
  mass: "Mass" as UnitDimension,
  volume: "Volume" as UnitDimension,
});

const boundedUnitText = <Name extends string>(
  value: string,
  label: string,
  maximumLength: number,
): Brand<string, Name> => {
  if (value.trim() !== value || value.length === 0) {
    throw new InventoryDomainError(
      "UnitConversionInvalid",
      `${label} must be non-empty and cannot have surrounding whitespace.`,
    );
  }

  if (value.length > maximumLength || hasControlCharacter(value)) {
    throw new InventoryDomainError("UnitConversionInvalid", `${label} is invalid.`);
  }

  return value as Brand<string, Name>;
};

export const unitId = (value: string): UnitId => boundedUnitText<"UnitId">(value, "Unit ID", 64);

export const unitDimension = (value: string): UnitDimension =>
  boundedUnitText<"UnitDimension">(value, "Unit dimension", 64);

export const unitName = (value: string): UnitName =>
  boundedUnitText<"UnitName">(value, "Unit name", 100);

export const unitSymbol = (value: string): UnitSymbol =>
  boundedUnitText<"UnitSymbol">(value, "Unit symbol", 20);

export interface UnitDefinition {
  readonly id: UnitId;
  readonly name: UnitName;
  readonly symbol: UnitSymbol;
  readonly dimension: UnitDimension;
  readonly baseUnitId: UnitId;
  /**
   * The exact number of base units represented by one of this unit.
   */
  readonly baseUnitsPerUnit: ExactDecimal;
  readonly wholeNumbersOnly: boolean;
}

export interface UnitDefinitionInput {
  readonly id: UnitId;
  readonly name: UnitName;
  readonly symbol: UnitSymbol;
  readonly dimension: UnitDimension;
  readonly baseUnitId: UnitId;
  readonly baseUnitsPerUnit: ExactDecimal;
  readonly wholeNumbersOnly?: boolean;
}

const one = ExactDecimal.fromInteger(1n);

export function createUnitDefinition(input: UnitDefinitionInput): UnitDefinition {
  if (input.wholeNumbersOnly !== undefined && typeof input.wholeNumbersOnly !== "boolean") {
    throw new InventoryDomainError(
      "UnitConversionInvalid",
      "Whole-number unit handling must be a boolean.",
    );
  }

  if (!input.baseUnitsPerUnit.isPositive()) {
    throw new InventoryDomainError(
      "UnitConversionInvalid",
      "A unit conversion factor must be greater than zero.",
    );
  }

  const id = unitId(input.id);
  const baseUnitId = unitId(input.baseUnitId);

  if (id === baseUnitId && !input.baseUnitsPerUnit.equals(one)) {
    throw new InventoryDomainError(
      "UnitConversionInvalid",
      "A base unit must convert to exactly one base unit.",
    );
  }

  return Object.freeze({
    id,
    name: unitName(input.name),
    symbol: unitSymbol(input.symbol),
    dimension: unitDimension(input.dimension),
    baseUnitId,
    baseUnitsPerUnit: input.baseUnitsPerUnit,
    wholeNumbersOnly: input.wholeNumbersOnly ?? false,
  });
}

export function assertCompatibleUnits(from: UnitDefinition, to: UnitDefinition): void {
  if (from.dimension !== to.dimension || from.baseUnitId !== to.baseUnitId) {
    throw new InventoryDomainError(
      "UnitDimensionMismatch",
      `Cannot convert ${from.id} to incompatible unit ${to.id}.`,
    );
  }
}

export function assertQuantityAllowedByUnit(quantity: ExactDecimal, unit: UnitDefinition): void {
  requireNonNegativeQuantity(quantity);

  if (unit.wholeNumbersOnly && !quantity.isInteger()) {
    throw new InventoryDomainError(
      "QuantityFractionalNotAllowed",
      `Unit ${unit.id} only permits whole-number quantities.`,
    );
  }
}

export function convertUnitQuantity(
  quantity: ExactDecimal,
  from: UnitDefinition,
  to: UnitDefinition,
  policy: DecimalPolicy = defaultQuantityDecimalPolicy,
  rounding?: DecimalRoundingPolicy,
): ExactDecimal {
  assertCompatibleUnits(from, to);
  assertQuantityAllowedByUnit(quantity, from);
  const baseQuantity = quantity.multiply(from.baseUnitsPerUnit, policy);
  const converted = baseQuantity.divide(to.baseUnitsPerUnit, policy, rounding);
  assertQuantityAllowedByUnit(converted, to);
  return converted;
}

const eachId = unitId("each");
const gramId = unitId("g");
const millimetreId = unitId("mm");
const millilitreId = unitId("ml");

export const builtinUnits = Object.freeze({
  each: createUnitDefinition({
    id: eachId,
    name: unitName("each"),
    symbol: unitSymbol("ea"),
    dimension: unitDimensions.count,
    baseUnitId: eachId,
    baseUnitsPerUnit: one,
    wholeNumbersOnly: true,
  }),
  gram: createUnitDefinition({
    id: gramId,
    name: unitName("gram"),
    symbol: unitSymbol("g"),
    dimension: unitDimensions.mass,
    baseUnitId: gramId,
    baseUnitsPerUnit: one,
  }),
  kilogram: createUnitDefinition({
    id: unitId("kg"),
    name: unitName("kilogram"),
    symbol: unitSymbol("kg"),
    dimension: unitDimensions.mass,
    baseUnitId: gramId,
    baseUnitsPerUnit: ExactDecimal.fromInteger(1_000n),
  }),
  millimetre: createUnitDefinition({
    id: millimetreId,
    name: unitName("millimetre"),
    symbol: unitSymbol("mm"),
    dimension: unitDimensions.length,
    baseUnitId: millimetreId,
    baseUnitsPerUnit: one,
  }),
  metre: createUnitDefinition({
    id: unitId("m"),
    name: unitName("metre"),
    symbol: unitSymbol("m"),
    dimension: unitDimensions.length,
    baseUnitId: millimetreId,
    baseUnitsPerUnit: ExactDecimal.fromInteger(1_000n),
  }),
  millilitre: createUnitDefinition({
    id: millilitreId,
    name: unitName("millilitre"),
    symbol: unitSymbol("ml"),
    dimension: unitDimensions.volume,
    baseUnitId: millilitreId,
    baseUnitsPerUnit: one,
  }),
  litre: createUnitDefinition({
    id: unitId("l"),
    name: unitName("litre"),
    symbol: unitSymbol("l"),
    dimension: unitDimensions.volume,
    baseUnitId: millilitreId,
    baseUnitsPerUnit: ExactDecimal.fromInteger(1_000n),
  }),
});

export function assertSerializedBaseUnit(unit: UnitDefinition): void {
  if (
    unit.dimension !== unitDimensions.count ||
    unit.id !== unit.baseUnitId ||
    !unit.wholeNumbersOnly ||
    !unit.baseUnitsPerUnit.equals(one)
  ) {
    throw new InventoryDomainError(
      "CatalogueInvariantViolation",
      "Serialized assets require an indivisible counted base unit.",
    );
  }
}
