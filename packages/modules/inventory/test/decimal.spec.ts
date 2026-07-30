import { describe, expect, it } from "vitest";

import {
  createDecimalPolicy,
  defaultQuantityDecimalPolicy,
  ExactDecimal,
  requireNonNegativeQuantity,
  requirePositiveQuantity,
  type DecimalPolicyInput,
  type DecimalRoundingMode,
} from "../src/inventory/decimal";
import { InventoryDomainError, type InventoryDomainErrorCode } from "../src/inventory/errors";

function expectInventoryError(action: () => unknown, code: InventoryDomainErrorCode): void {
  expect(action).toThrowError(
    expect.objectContaining({
      name: "InventoryDomainError",
      code,
    }),
  );
}

const scaleTwoPolicy = createDecimalPolicy({
  maximumScale: 2,
  maximumSignificantDigits: 38,
});

describe("decimal policy", () => {
  it("provides a frozen default suitable for fractional stock quantities", () => {
    expect(defaultQuantityDecimalPolicy).toEqual({
      maximumScale: 6,
      maximumSignificantDigits: 38,
    });
    expect(Object.isFrozen(defaultQuantityDecimalPolicy)).toBe(true);
  });

  it.each([
    { maximumScale: 0, maximumSignificantDigits: 1 },
    { maximumScale: 18, maximumSignificantDigits: 38 },
    { maximumScale: 6, maximumSignificantDigits: 20 },
  ] satisfies readonly DecimalPolicyInput[])(
    "accepts and freezes the bounded policy $maximumScale/$maximumSignificantDigits",
    (input) => {
      const policy = createDecimalPolicy(input);

      expect(policy).toEqual(input);
      expect(policy).not.toBe(input);
      expect(Object.isFrozen(policy)).toBe(true);
    },
  );

  it.each([
    {
      label: "fractional scale",
      input: { maximumScale: 1.5, maximumSignificantDigits: 10 },
    },
    {
      label: "negative scale",
      input: { maximumScale: -1, maximumSignificantDigits: 10 },
    },
    {
      label: "scale beyond the hard resource bound",
      input: { maximumScale: 19, maximumSignificantDigits: 10 },
    },
    {
      label: "non-finite scale",
      input: { maximumScale: Number.POSITIVE_INFINITY, maximumSignificantDigits: 10 },
    },
    {
      label: "fractional significant digits",
      input: { maximumScale: 6, maximumSignificantDigits: 1.5 },
    },
    {
      label: "zero significant digits",
      input: { maximumScale: 6, maximumSignificantDigits: 0 },
    },
    {
      label: "significant digits beyond the hard resource bound",
      input: { maximumScale: 6, maximumSignificantDigits: 39 },
    },
    {
      label: "non-finite significant digits",
      input: { maximumScale: 6, maximumSignificantDigits: Number.NaN },
    },
  ] satisfies readonly { readonly label: string; readonly input: DecimalPolicyInput }[])(
    "rejects a policy with $label",
    ({ input }) => {
      expectInventoryError(() => createDecimalPolicy(input), "DecimalPolicyInvalid");
    },
  );
});

describe("canonical exact decimals", () => {
  it.each([
    ["0", "0"],
    ["1", "1"],
    ["-1", "-1"],
    ["0.000001", "0.000001"],
    ["-0.000001", "-0.000001"],
    ["10.01", "10.01"],
    ["-99999999999999999999999999999999999999", "-99999999999999999999999999999999999999"],
  ])("round-trips the canonical representation %s", (source, expected) => {
    const value = ExactDecimal.parse(source);

    expect(value.toString()).toBe(expected);
    expect(value.toJSON()).toBe(expected);
    expect(JSON.stringify({ value })).toBe(`{"value":"${expected}"}`);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("supports the hard maximum exact scale when explicitly configured", () => {
    const policy = createDecimalPolicy({
      maximumScale: 18,
      maximumSignificantDigits: 38,
    });

    expect(ExactDecimal.parse("0.000000000000000001", policy).toString()).toBe(
      "0.000000000000000001",
    );
  });

  it.each([
    "",
    " ",
    " 1",
    "1 ",
    "+1",
    "01",
    "-01",
    "00",
    ".5",
    "-.5",
    "1.",
    "1.0",
    "1.20",
    "1e3",
    "1E-3",
    "1_000",
    "NaN",
    "Infinity",
    "--1",
    "1..2",
    "-0",
    "1,000",
  ])("rejects the non-canonical input %j", (source) => {
    expectInventoryError(() => ExactDecimal.parse(source), "DecimalNotCanonical");
  });

  it("rejects an input before parsing when it exceeds the bounded input length", () => {
    expectInventoryError(() => ExactDecimal.parse("1".repeat(47)), "DecimalNotCanonical");
  });

  it("distinguishes configured scale and magnitude violations", () => {
    const scaleOne = createDecimalPolicy({
      maximumScale: 1,
      maximumSignificantDigits: 38,
    });
    const threeDigits = createDecimalPolicy({
      maximumScale: 6,
      maximumSignificantDigits: 3,
    });

    expectInventoryError(() => ExactDecimal.parse("0.01", scaleOne), "DecimalScaleExceeded");
    expectInventoryError(() => ExactDecimal.parse("1234", threeDigits), "DecimalMagnitudeExceeded");
  });

  it("constructs canonical integers and zero without a floating-point bridge", () => {
    expect(ExactDecimal.fromInteger(-42n).toString()).toBe("-42");
    expect(ExactDecimal.zero().toString()).toBe("0");
    expect(ExactDecimal.zero().equals(ExactDecimal.fromInteger(0n))).toBe(true);

    const twoDigits = createDecimalPolicy({
      maximumScale: 0,
      maximumSignificantDigits: 2,
    });
    expectInventoryError(
      () => ExactDecimal.fromInteger(100n, twoDigits),
      "DecimalMagnitudeExceeded",
    );
  });
});

describe("exact decimal arithmetic", () => {
  it("adds, aligns scales, normalises trailing zeroes, and cancels exactly", () => {
    expect(ExactDecimal.parse("1.25").add(ExactDecimal.parse("2.5")).toString()).toBe("3.75");
    expect(ExactDecimal.parse("0.000001").add(ExactDecimal.parse("1")).toString()).toBe("1.000001");
    expect(ExactDecimal.parse("-1.25").add(ExactDecimal.parse("1.25")).toString()).toBe("0");
    expect(ExactDecimal.parse("1.2").add(ExactDecimal.parse("0.8")).toString()).toBe("2");
  });

  it("subtracts without losing fractional precision", () => {
    expect(ExactDecimal.parse("5").subtract(ExactDecimal.parse("2.125")).toString()).toBe("2.875");
    expect(ExactDecimal.parse("-2").subtract(ExactDecimal.parse("-3.5")).toString()).toBe("1.5");
  });

  it("multiplies exact coefficients, signs, and scales", () => {
    expect(ExactDecimal.parse("12.5").multiply(ExactDecimal.parse("0.04")).toString()).toBe("0.5");
    expect(ExactDecimal.parse("-1.5").multiply(ExactDecimal.parse("2")).toString()).toBe("-3");
    expect(ExactDecimal.zero().multiply(ExactDecimal.parse("-999")).toString()).toBe("0");
  });

  it("applies the requested resource policy to every arithmetic result", () => {
    const scaleOne = createDecimalPolicy({
      maximumScale: 1,
      maximumSignificantDigits: 38,
    });
    const twoDigits = createDecimalPolicy({
      maximumScale: 6,
      maximumSignificantDigits: 2,
    });

    expectInventoryError(
      () => ExactDecimal.parse("0.12").add(ExactDecimal.zero(), scaleOne),
      "DecimalScaleExceeded",
    );
    expectInventoryError(() => ExactDecimal.parse("0.12").negate(scaleOne), "DecimalScaleExceeded");
    expectInventoryError(
      () => ExactDecimal.parse("-0.12").absolute(scaleOne),
      "DecimalScaleExceeded",
    );
    expectInventoryError(
      () => ExactDecimal.parse("9.9").multiply(ExactDecimal.parse("0.1"), scaleOne),
      "DecimalScaleExceeded",
    );
    expectInventoryError(
      () => ExactDecimal.parse("99").add(ExactDecimal.parse("1"), twoDigits),
      "DecimalMagnitudeExceeded",
    );
    expectInventoryError(
      () => ExactDecimal.parse("50").multiply(ExactDecimal.parse("2"), twoDigits),
      "DecimalMagnitudeExceeded",
    );
  });

  it.each([
    ["1", "2", "0.5"],
    ["1", "5", "0.2"],
    ["1", "40", "0.025"],
    ["3", "8", "0.375"],
    ["1.5", "0.5", "3"],
    ["-1", "2", "-0.5"],
    ["1", "-2", "-0.5"],
    ["-1", "-2", "0.5"],
    ["0", "-7", "0"],
  ])("divides %s by %s exactly as %s", (dividend, divisor, expected) => {
    expect(ExactDecimal.parse(dividend).divide(ExactDecimal.parse(divisor)).toString()).toBe(
      expected,
    );
  });

  it("rejects division by zero", () => {
    expectInventoryError(
      () => ExactDecimal.parse("1").divide(ExactDecimal.zero()),
      "DecimalDivisionByZero",
    );
  });

  it("requires an explicit rounding decision for recurring or over-scale quotients", () => {
    expectInventoryError(
      () => ExactDecimal.parse("1").divide(ExactDecimal.parse("3")),
      "DecimalRoundingRequired",
    );
    expectInventoryError(
      () => ExactDecimal.parse("1").divide(ExactDecimal.parse("8"), scaleTwoPolicy),
      "DecimalRoundingRequired",
    );
  });

  it.each([
    {
      dividend: "1",
      divisor: "8",
      mode: "TowardZero",
      expected: "0.12",
    },
    {
      dividend: "-1",
      divisor: "8",
      mode: "TowardZero",
      expected: "-0.12",
    },
    {
      dividend: "1",
      divisor: "8",
      mode: "AwayFromZero",
      expected: "0.13",
    },
    {
      dividend: "-1",
      divisor: "8",
      mode: "AwayFromZero",
      expected: "-0.13",
    },
    {
      dividend: "1",
      divisor: "8",
      mode: "HalfUp",
      expected: "0.13",
    },
    {
      dividend: "-1",
      divisor: "8",
      mode: "HalfUp",
      expected: "-0.13",
    },
    {
      dividend: "1",
      divisor: "7",
      mode: "HalfUp",
      expected: "0.14",
    },
    {
      dividend: "1",
      divisor: "6",
      mode: "HalfUp",
      expected: "0.17",
    },
    {
      dividend: "1",
      divisor: "8",
      mode: "HalfEven",
      expected: "0.12",
    },
    {
      dividend: "3",
      divisor: "8",
      mode: "HalfEven",
      expected: "0.38",
    },
    {
      dividend: "-3",
      divisor: "8",
      mode: "HalfEven",
      expected: "-0.38",
    },
    {
      dividend: "1",
      divisor: "7",
      mode: "HalfEven",
      expected: "0.14",
    },
    {
      dividend: "1",
      divisor: "6",
      mode: "HalfEven",
      expected: "0.17",
    },
  ] satisfies readonly {
    readonly dividend: string;
    readonly divisor: string;
    readonly mode: DecimalRoundingMode;
    readonly expected: string;
  }[])(
    "rounds $dividend / $divisor using $mode to $expected",
    ({ dividend, divisor, mode, expected }) => {
      expect(
        ExactDecimal.parse(dividend)
          .divide(ExactDecimal.parse(divisor), scaleTwoPolicy, {
            scale: 2,
            mode,
          })
          .toString(),
      ).toBe(expected);
    },
  );

  it("can explicitly round a small recurring result to canonical zero", () => {
    expect(
      ExactDecimal.parse("1")
        .divide(ExactDecimal.parse("1000"), scaleTwoPolicy, {
          scale: 2,
          mode: "TowardZero",
        })
        .toString(),
    ).toBe("0");
  });

  it.each([
    { scale: -1, mode: "HalfUp" as const },
    { scale: 1.5, mode: "HalfUp" as const },
    { scale: 3, mode: "HalfUp" as const },
  ])("rejects the invalid rounding scale $scale", (rounding) => {
    expectInventoryError(
      () => ExactDecimal.parse("1").divide(ExactDecimal.parse("3"), scaleTwoPolicy, rounding),
      "DecimalRoundingPolicyInvalid",
    );
  });

  it("enforces magnitude bounds on exact and rounded division results", () => {
    const twoDigits = createDecimalPolicy({
      maximumScale: 2,
      maximumSignificantDigits: 2,
    });

    expectInventoryError(
      () => ExactDecimal.parse("999").divide(ExactDecimal.parse("1"), twoDigits),
      "DecimalMagnitudeExceeded",
    );
    expectInventoryError(
      () =>
        ExactDecimal.parse("999").divide(ExactDecimal.parse("7"), twoDigits, {
          scale: 2,
          mode: "HalfUp",
        }),
      "DecimalMagnitudeExceeded",
    );
  });

  it("compares exact values without coercing them to floating point", () => {
    const one = ExactDecimal.parse("1");
    const fraction = ExactDecimal.parse("0.999999");

    expect(fraction.compare(one)).toBe(-1);
    expect(one.compare(fraction)).toBe(1);
    expect(ExactDecimal.parse("1.25").compare(ExactDecimal.parse("1.25"))).toBe(0);
    expect(ExactDecimal.parse("-2").compare(ExactDecimal.parse("-1.999999"))).toBe(-1);
  });

  it("reports equality, sign, integer status, negation, and absolute value", () => {
    const positive = ExactDecimal.parse("1.5");
    const negative = ExactDecimal.parse("-1.5");
    const zero = ExactDecimal.zero();

    expect(positive.equals(ExactDecimal.parse("1.5"))).toBe(true);
    expect(positive.equals(ExactDecimal.parse("1.6"))).toBe(false);
    expect(positive.isPositive()).toBe(true);
    expect(positive.isNegative()).toBe(false);
    expect(positive.isZero()).toBe(false);
    expect(positive.isInteger()).toBe(false);
    expect(ExactDecimal.parse("2").isInteger()).toBe(true);
    expect(negative.isNegative()).toBe(true);
    expect(negative.isPositive()).toBe(false);
    expect(negative.negate().equals(positive)).toBe(true);
    expect(negative.absolute().equals(positive)).toBe(true);
    expect(positive.absolute()).toBe(positive);
    expect(zero.absolute()).toBe(zero);
    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);
  });
});

describe("stock quantity guards", () => {
  it("accepts zero and positive non-negative quantities by identity", () => {
    const zero = ExactDecimal.zero();
    const positive = ExactDecimal.parse("0.001");

    expect(requireNonNegativeQuantity(zero)).toBe(zero);
    expect(requireNonNegativeQuantity(positive)).toBe(positive);
    expect(requirePositiveQuantity(positive)).toBe(positive);
  });

  it("rejects negative and zero values with distinct stable errors", () => {
    expectInventoryError(
      () => requireNonNegativeQuantity(ExactDecimal.parse("-0.001")),
      "QuantityNegative",
    );
    expectInventoryError(
      () => requirePositiveQuantity(ExactDecimal.parse("-0.001")),
      "QuantityNegative",
    );
    expectInventoryError(() => requirePositiveQuantity(ExactDecimal.zero()), "QuantityZero");
  });

  it("uses the package's typed domain error", () => {
    try {
      requirePositiveQuantity(ExactDecimal.zero());
      throw new Error("Expected the quantity guard to throw.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InventoryDomainError);
      expect((error as InventoryDomainError).code).toBe("QuantityZero");
      expect((error as InventoryDomainError).name).toBe("InventoryDomainError");
    }
  });
});
