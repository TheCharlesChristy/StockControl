import { describe, expect, it } from "vitest";

import {
  add,
  atLeast,
  compare,
  formatQuantity,
  formatQuantityCompact,
  isNegative,
  isPositive,
  isZero,
  MAX_QUANTITY_UNITS,
  negate,
  parseQuantity,
  quantityFromDatabase,
  subtract,
  sum,
  toNumber,
  ZERO,
  type Quantity,
} from "../../src/stock/quantity";

const q = (value: string): Quantity => {
  const parsed = parseQuantity(value);

  if (parsed === null) {
    throw new Error(`Test fixture "${value}" is not a valid quantity.`);
  }

  return parsed;
};

describe("parseQuantity", () => {
  it.each([
    ["0", "0.000"],
    ["1", "1.000"],
    ["12.5", "12.500"],
    ["0.001", "0.001"],
    ["  7.25  ", "7.250"],
    ["-3.5", "-3.500"],
    ["1000000000", "1000000000.000"],
  ])("accepts %s", (input, formatted) => {
    const parsed = parseQuantity(input);

    expect(parsed).not.toBeNull();
    expect(formatQuantity(parsed as Quantity)).toBe(formatted);
  });

  it.each([
    ["", "empty"],
    ["abc", "not a number"],
    ["1.2345", "more than three decimal places"],
    ["1e3", "exponent notation"],
    ["1,000", "thousands separator"],
    ["--1", "double sign"],
    ["1.", "trailing point"],
    [".5", "leading point"],
    ["Infinity", "infinity"],
    ["1000000001", "beyond the supported maximum"],
  ])("rejects %s (%s)", (input) => {
    expect(parseQuantity(input)).toBeNull();
  });

  it("accepts numeric input as well as text", () => {
    expect(formatQuantity(q("2.5"))).toBe(formatQuantity(parseQuantity(2.5) as Quantity));
  });

  it("bounds input at the supported maximum", () => {
    expect(parseQuantity(String(MAX_QUANTITY_UNITS))).not.toBeNull();
    expect(parseQuantity(String(MAX_QUANTITY_UNITS + 1))).toBeNull();
  });
});

describe("exact arithmetic", () => {
  it("adds tenths without binary floating-point drift", () => {
    expect(formatQuantity(add(q("0.1"), q("0.2")))).toBe("0.300");
    expect(toNumber(add(q("0.1"), q("0.2")))).toBe(0.3);
  });

  it("stays exact across a long run of fractional additions", () => {
    let total = ZERO;

    for (let index = 0; index < 1000; index += 1) {
      total = add(total, q("0.001"));
    }

    expect(formatQuantity(total)).toBe("1.000");
  });

  it("subtracts to exactly zero", () => {
    expect(isZero(subtract(q("12.345"), q("12.345")))).toBe(true);
  });

  it("subtracts below zero when asked", () => {
    expect(formatQuantity(subtract(q("1"), q("3.5")))).toBe("-2.500");
  });

  it("sums an empty collection to zero", () => {
    expect(sum([])).toBe(ZERO);
  });

  it("sums a collection exactly", () => {
    expect(formatQuantity(sum([q("1.1"), q("2.2"), q("3.3")]))).toBe("6.600");
  });

  it("negates symmetrically", () => {
    expect(formatQuantity(negate(q("4.25")))).toBe("-4.250");
    expect(formatQuantity(negate(negate(q("4.25"))))).toBe("4.250");
  });
});

describe("comparison", () => {
  it.each([
    ["1", "2", -1],
    ["2", "1", 1],
    ["2.500", "2.5", 0],
  ])("compares %s against %s", (left, right, expected) => {
    expect(compare(q(left), q(right))).toBe(expected);
  });

  it("treats an exactly equal quantity as sufficient", () => {
    expect(atLeast(q("5"), q("5"))).toBe(true);
    expect(atLeast(q("4.999"), q("5"))).toBe(false);
  });

  it.each([
    ["1", true, false, false],
    ["0", false, true, false],
    ["-1", false, false, true],
  ])("classifies %s", (value, positive, zero, negative) => {
    expect(isPositive(q(value))).toBe(positive);
    expect(isZero(q(value))).toBe(zero);
    expect(isNegative(q(value))).toBe(negative);
  });
});

describe("formatting", () => {
  it("always writes three decimal places for the database", () => {
    expect(formatQuantity(q("7"))).toBe("7.000");
    expect(formatQuantity(q("-0.5"))).toBe("-0.500");
  });

  it("trims trailing zeros for display", () => {
    expect(formatQuantityCompact(q("7.000"))).toBe("7");
    expect(formatQuantityCompact(q("7.500"))).toBe("7.5");
    expect(formatQuantityCompact(q("7.050"))).toBe("7.05");
    expect(formatQuantityCompact(ZERO)).toBe("0");
  });
});

describe("quantityFromDatabase", () => {
  it("reads a numeric(18,3) value back exactly", () => {
    expect(formatQuantity(quantityFromDatabase("123.450"))).toBe("123.450");
  });

  it("throws when the database holds something this code cannot represent", () => {
    expect(() => quantityFromDatabase("1.23456")).toThrow(
      'Stored quantity "1.23456" is not an exact quantity.',
    );
  });
});
