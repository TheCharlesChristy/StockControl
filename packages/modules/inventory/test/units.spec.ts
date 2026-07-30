import { describe, expect, it } from "vitest";

import { createDecimalPolicy, ExactDecimal, type DecimalPolicy } from "../src/inventory/decimal";
import { type InventoryDomainErrorCode } from "../src/inventory/errors";
import {
  assertCompatibleUnits,
  assertQuantityAllowedByUnit,
  assertSerializedBaseUnit,
  builtinUnits,
  convertUnitQuantity,
  createUnitDefinition,
  unitDimension,
  unitDimensions,
  unitId,
  unitName,
  unitSymbol,
  type UnitDefinition,
  type UnitDefinitionInput,
} from "../src/inventory/units";

function expectInventoryError(action: () => unknown, code: InventoryDomainErrorCode): void {
  expect(action).toThrowError(
    expect.objectContaining({
      name: "InventoryDomainError",
      code,
    }),
  );
}

function customUnit(overrides: Partial<UnitDefinitionInput> = {}): UnitDefinition {
  const baseId = unitId("custom-base");

  return createUnitDefinition({
    id: baseId,
    name: unitName("custom base"),
    symbol: unitSymbol("cb"),
    dimension: unitDimension("Custom"),
    baseUnitId: baseId,
    baseUnitsPerUnit: ExactDecimal.fromInteger(1n),
    ...overrides,
  });
}

describe("unit value objects", () => {
  it("accepts exact maximum lengths and preserves meaningful case", () => {
    expect(unitId("A".repeat(64))).toBe("A".repeat(64));
    expect(unitDimension("D".repeat(64))).toBe("D".repeat(64));
    expect(unitName("N".repeat(100))).toBe("N".repeat(100));
    expect(unitSymbol("S".repeat(20))).toBe("S".repeat(20));
  });

  it("supports extensible human-readable custom unit metadata", () => {
    expect(unitId("sheet-4x8")).toBe("sheet-4x8");
    expect(unitDimension("Area")).toBe("Area");
    expect(unitName("four by eight sheet")).toBe("four by eight sheet");
    expect(unitSymbol("4×8")).toBe("4×8");
  });

  it("rejects missing and surrounding-whitespace values", () => {
    expectInventoryError(() => unitId(" id"), "UnitConversionInvalid");
    expectInventoryError(() => unitDimension(""), "UnitConversionInvalid");
    expectInventoryError(() => unitName("name\t"), "UnitConversionInvalid");
    expectInventoryError(() => unitSymbol(" "), "UnitConversionInvalid");
  });

  it("enforces each unit value's length bound", () => {
    expectInventoryError(() => unitId("i".repeat(65)), "UnitConversionInvalid");
    expectInventoryError(() => unitDimension("d".repeat(65)), "UnitConversionInvalid");
    expectInventoryError(() => unitName("n".repeat(101)), "UnitConversionInvalid");
    expectInventoryError(() => unitSymbol("s".repeat(21)), "UnitConversionInvalid");
  });

  it("rejects embedded ASCII control characters", () => {
    expectInventoryError(() => unitId("id\u0000x"), "UnitConversionInvalid");
    expectInventoryError(() => unitDimension("Dim\u001fx"), "UnitConversionInvalid");
    expectInventoryError(() => unitName("name\u007fvalue"), "UnitConversionInvalid");
    expectInventoryError(() => unitSymbol("x\u0007y"), "UnitConversionInvalid");
  });
});

describe("unit definitions", () => {
  it("creates an immutable base unit with an explicit whole-number policy", () => {
    const countId = unitId("custom-each");
    const definition = customUnit({
      id: countId,
      name: unitName("custom each"),
      symbol: unitSymbol("ce"),
      dimension: unitDimensions.count,
      baseUnitId: countId,
      wholeNumbersOnly: true,
    });

    expect(definition).toEqual({
      id: "custom-each",
      name: "custom each",
      symbol: "ce",
      dimension: "Count",
      baseUnitId: "custom-each",
      baseUnitsPerUnit: ExactDecimal.fromInteger(1n),
      wholeNumbersOnly: true,
    });
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it("defaults a quantity unit to allowing fractional quantities", () => {
    const definition = customUnit();

    expect(definition.wholeNumbersOnly).toBe(false);
  });

  it("rejects a non-boolean whole-number policy at runtime", () => {
    expectInventoryError(
      () =>
        customUnit({
          wholeNumbersOnly: "yes" as unknown as boolean,
        }),
      "UnitConversionInvalid",
    );
  });

  it("allows an exact positive conversion factor for a derived unit", () => {
    const definition = customUnit({
      id: unitId("custom-pack"),
      name: unitName("custom pack"),
      symbol: unitSymbol("pack"),
      baseUnitId: unitId("custom-base"),
      baseUnitsPerUnit: ExactDecimal.parse("12.5"),
    });

    expect(definition.baseUnitsPerUnit.toString()).toBe("12.5");
  });

  it("rejects zero and negative conversion factors", () => {
    expectInventoryError(
      () => customUnit({ baseUnitsPerUnit: ExactDecimal.zero() }),
      "UnitConversionInvalid",
    );
    expectInventoryError(
      () =>
        customUnit({
          baseUnitsPerUnit: ExactDecimal.parse("-0.001"),
        }),
      "UnitConversionInvalid",
    );
  });

  it("requires a base unit to convert to exactly one of itself", () => {
    expectInventoryError(
      () =>
        customUnit({
          baseUnitsPerUnit: ExactDecimal.parse("1.000001"),
        }),
      "UnitConversionInvalid",
    );
  });

  it("publishes the exact immutable MVP built-in unit system", () => {
    expect(Object.isFrozen(builtinUnits)).toBe(true);
    expect(Object.values(builtinUnits).every(Object.isFrozen)).toBe(true);

    expect(builtinUnits.each).toMatchObject({
      id: "each",
      dimension: "Count",
      baseUnitId: "each",
      wholeNumbersOnly: true,
    });
    expect(builtinUnits.gram).toMatchObject({
      id: "g",
      dimension: "Mass",
      baseUnitId: "g",
      wholeNumbersOnly: false,
    });
    expect(builtinUnits.kilogram).toMatchObject({
      id: "kg",
      dimension: "Mass",
      baseUnitId: "g",
    });
    expect(builtinUnits.millimetre).toMatchObject({
      id: "mm",
      dimension: "Length",
      baseUnitId: "mm",
    });
    expect(builtinUnits.metre).toMatchObject({
      id: "m",
      dimension: "Length",
      baseUnitId: "mm",
    });
    expect(builtinUnits.millilitre).toMatchObject({
      id: "ml",
      dimension: "Volume",
      baseUnitId: "ml",
    });
    expect(builtinUnits.litre).toMatchObject({
      id: "l",
      dimension: "Volume",
      baseUnitId: "ml",
    });

    expect(builtinUnits.gram.baseUnitsPerUnit.toString()).toBe("1");
    expect(builtinUnits.kilogram.baseUnitsPerUnit.toString()).toBe("1000");
    expect(builtinUnits.metre.baseUnitsPerUnit.toString()).toBe("1000");
    expect(builtinUnits.litre.baseUnitsPerUnit.toString()).toBe("1000");
  });
});

describe("unit compatibility and quantity policy", () => {
  it("accepts units sharing both a dimension and an exact base-unit identity", () => {
    expect(() => assertCompatibleUnits(builtinUnits.kilogram, builtinUnits.gram)).not.toThrow();
  });

  it("rejects both dimension and same-dimension base-root mismatches", () => {
    const alternateMassId = unitId("alternate-mass-base");
    const alternateMass = customUnit({
      id: alternateMassId,
      name: unitName("alternate mass"),
      symbol: unitSymbol("am"),
      dimension: unitDimensions.mass,
      baseUnitId: alternateMassId,
    });

    expectInventoryError(
      () => assertCompatibleUnits(builtinUnits.gram, builtinUnits.metre),
      "UnitDimensionMismatch",
    );
    expectInventoryError(
      () => assertCompatibleUnits(builtinUnits.gram, alternateMass),
      "UnitDimensionMismatch",
    );
  });

  it("allows non-negative fractions only when the unit permits them", () => {
    expect(() =>
      assertQuantityAllowedByUnit(ExactDecimal.parse("0.5"), builtinUnits.gram),
    ).not.toThrow();
    expect(() => assertQuantityAllowedByUnit(ExactDecimal.zero(), builtinUnits.each)).not.toThrow();
    expect(() =>
      assertQuantityAllowedByUnit(ExactDecimal.parse("2"), builtinUnits.each),
    ).not.toThrow();

    expectInventoryError(
      () => assertQuantityAllowedByUnit(ExactDecimal.parse("-0.001"), builtinUnits.gram),
      "QuantityNegative",
    );
    expectInventoryError(
      () => assertQuantityAllowedByUnit(ExactDecimal.parse("0.5"), builtinUnits.each),
      "QuantityFractionalNotAllowed",
    );
  });
});

describe("exact unit conversion", () => {
  it.each([
    {
      quantity: "1.25",
      from: builtinUnits.kilogram,
      to: builtinUnits.gram,
      expected: "1250",
    },
    {
      quantity: "2500",
      from: builtinUnits.gram,
      to: builtinUnits.kilogram,
      expected: "2.5",
    },
    {
      quantity: "1.234",
      from: builtinUnits.metre,
      to: builtinUnits.millimetre,
      expected: "1234",
    },
    {
      quantity: "1250",
      from: builtinUnits.millimetre,
      to: builtinUnits.metre,
      expected: "1.25",
    },
    {
      quantity: "2.75",
      from: builtinUnits.litre,
      to: builtinUnits.millilitre,
      expected: "2750",
    },
    {
      quantity: "125",
      from: builtinUnits.millilitre,
      to: builtinUnits.litre,
      expected: "0.125",
    },
  ] satisfies readonly {
    readonly quantity: string;
    readonly from: UnitDefinition;
    readonly to: UnitDefinition;
    readonly expected: string;
  }[])(
    "converts $quantity $from.id to $expected $to.id without floating point",
    ({ quantity, from, to, expected }) => {
      expect(convertUnitQuantity(ExactDecimal.parse(quantity), from, to).toString()).toBe(expected);
    },
  );

  it("supports exact extensible counted packs", () => {
    const dozen = createUnitDefinition({
      id: unitId("dozen"),
      name: unitName("dozen"),
      symbol: unitSymbol("dz"),
      dimension: unitDimensions.count,
      baseUnitId: builtinUnits.each.id,
      baseUnitsPerUnit: ExactDecimal.fromInteger(12n),
      wholeNumbersOnly: true,
    });

    expect(convertUnitQuantity(ExactDecimal.parse("2"), dozen, builtinUnits.each).toString()).toBe(
      "24",
    );
    expect(convertUnitQuantity(ExactDecimal.parse("24"), builtinUnits.each, dozen).toString()).toBe(
      "2",
    );
  });

  it("permits a zero stock balance through an exact conversion", () => {
    expect(
      convertUnitQuantity(ExactDecimal.zero(), builtinUnits.kilogram, builtinUnits.gram).toString(),
    ).toBe("0");
  });

  it("checks compatibility and source quantity before conversion", () => {
    expectInventoryError(
      () => convertUnitQuantity(ExactDecimal.parse("-1"), builtinUnits.gram, builtinUnits.kilogram),
      "QuantityNegative",
    );
    expectInventoryError(
      () => convertUnitQuantity(ExactDecimal.parse("0.5"), builtinUnits.each, builtinUnits.each),
      "QuantityFractionalNotAllowed",
    );
    expectInventoryError(
      () => convertUnitQuantity(ExactDecimal.parse("-1"), builtinUnits.gram, builtinUnits.metre),
      "UnitDimensionMismatch",
    );
  });

  it("requires explicit rounding when an exact conversion exceeds policy scale", () => {
    expectInventoryError(
      () =>
        convertUnitQuantity(
          ExactDecimal.parse("1"),
          builtinUnits.gram,
          builtinUnits.kilogram,
          createDecimalPolicy({
            maximumScale: 2,
            maximumSignificantDigits: 38,
          }),
        ),
      "DecimalRoundingRequired",
    );

    expect(
      convertUnitQuantity(
        ExactDecimal.parse("1"),
        builtinUnits.gram,
        builtinUnits.kilogram,
        createDecimalPolicy({
          maximumScale: 2,
          maximumSignificantDigits: 38,
        }),
        { scale: 2, mode: "HalfUp" },
      ).toString(),
    ).toBe("0");
  });

  it("rejects a rounded target quantity that violates indivisibility", () => {
    const looseEach = createUnitDefinition({
      id: unitId("loose-each"),
      name: unitName("loose each"),
      symbol: unitSymbol("lea"),
      dimension: unitDimensions.count,
      baseUnitId: builtinUnits.each.id,
      baseUnitsPerUnit: ExactDecimal.fromInteger(1n),
    });
    const triplet = createUnitDefinition({
      id: unitId("triplet"),
      name: unitName("triplet"),
      symbol: unitSymbol("tri"),
      dimension: unitDimensions.count,
      baseUnitId: builtinUnits.each.id,
      baseUnitsPerUnit: ExactDecimal.fromInteger(3n),
      wholeNumbersOnly: true,
    });

    expectInventoryError(
      () =>
        convertUnitQuantity(ExactDecimal.parse("1"), looseEach, triplet, undefined, {
          scale: 2,
          mode: "HalfUp",
        }),
      "QuantityFractionalNotAllowed",
    );
  });

  it("applies the supplied scale bound to the intermediate base quantity", () => {
    const tenthOfAGram = createUnitDefinition({
      id: unitId("decigram"),
      name: unitName("decigram"),
      symbol: unitSymbol("dg"),
      dimension: unitDimensions.mass,
      baseUnitId: builtinUnits.gram.id,
      baseUnitsPerUnit: ExactDecimal.parse("0.1"),
    });
    const scaleTwo: DecimalPolicy = createDecimalPolicy({
      maximumScale: 2,
      maximumSignificantDigits: 38,
    });

    expectInventoryError(
      () =>
        convertUnitQuantity(ExactDecimal.parse("0.01"), tenthOfAGram, builtinUnits.gram, scaleTwo),
      "DecimalScaleExceeded",
    );
  });
});

describe("serialized asset unit invariant", () => {
  it("accepts an indivisible counted base unit", () => {
    expect(() => assertSerializedBaseUnit(builtinUnits.each)).not.toThrow();
  });

  it("rejects a non-counted, fraction-permitting, or multi-base unit", () => {
    const fractionalCount = createUnitDefinition({
      id: unitId("fractional-count"),
      name: unitName("fractional count"),
      symbol: unitSymbol("fc"),
      dimension: unitDimensions.count,
      baseUnitId: builtinUnits.each.id,
      baseUnitsPerUnit: ExactDecimal.fromInteger(1n),
    });
    const dozen = createUnitDefinition({
      id: unitId("serialized-dozen"),
      name: unitName("serialized dozen"),
      symbol: unitSymbol("sdz"),
      dimension: unitDimensions.count,
      baseUnitId: builtinUnits.each.id,
      baseUnitsPerUnit: ExactDecimal.fromInteger(12n),
      wholeNumbersOnly: true,
    });

    expectInventoryError(
      () => assertSerializedBaseUnit(builtinUnits.gram),
      "CatalogueInvariantViolation",
    );
    expectInventoryError(
      () => assertSerializedBaseUnit(fractionalCount),
      "CatalogueInvariantViolation",
    );
    expectInventoryError(() => assertSerializedBaseUnit(dozen), "CatalogueInvariantViolation");
  });
});
