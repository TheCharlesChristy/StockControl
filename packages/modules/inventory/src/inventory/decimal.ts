import { InventoryDomainError } from "./errors";

const MAXIMUM_SUPPORTED_SCALE = 18;
const MAXIMUM_SUPPORTED_SIGNIFICANT_DIGITS = 38;

export interface DecimalPolicy {
  readonly maximumScale: number;
  readonly maximumSignificantDigits: number;
}

export const defaultQuantityDecimalPolicy: DecimalPolicy = Object.freeze({
  maximumScale: 6,
  maximumSignificantDigits: 38,
});

export interface DecimalPolicyInput {
  readonly maximumScale: number;
  readonly maximumSignificantDigits: number;
}

const assertDecimalPolicy = (input: DecimalPolicyInput): void => {
  if (
    !Number.isInteger(input.maximumScale) ||
    input.maximumScale < 0 ||
    input.maximumScale > MAXIMUM_SUPPORTED_SCALE ||
    !Number.isInteger(input.maximumSignificantDigits) ||
    input.maximumSignificantDigits < 1 ||
    input.maximumSignificantDigits > MAXIMUM_SUPPORTED_SIGNIFICANT_DIGITS
  ) {
    throw new InventoryDomainError(
      "DecimalPolicyInvalid",
      `Decimal policy must use scale 0-${String(MAXIMUM_SUPPORTED_SCALE)} and 1-${String(MAXIMUM_SUPPORTED_SIGNIFICANT_DIGITS)} significant digits.`,
    );
  }
};

export function createDecimalPolicy(input: DecimalPolicyInput): DecimalPolicy {
  assertDecimalPolicy(input);

  return Object.freeze({
    maximumScale: input.maximumScale,
    maximumSignificantDigits: input.maximumSignificantDigits,
  });
}

export type DecimalRoundingMode = "TowardZero" | "AwayFromZero" | "HalfUp" | "HalfEven";

export const decimalRoundingModes = [
  "TowardZero",
  "AwayFromZero",
  "HalfUp",
  "HalfEven",
] as const satisfies readonly DecimalRoundingMode[];

export interface DecimalRoundingPolicy {
  readonly scale: number;
  readonly mode: DecimalRoundingMode;
}

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

const absolute = (value: bigint): bigint => (value < 0n ? -value : value);

const greatestCommonDivisor = (left: bigint, right: bigint): bigint => {
  let dividend = absolute(left);
  let divisor = absolute(right);

  while (divisor !== 0n) {
    const remainder = dividend % divisor;
    dividend = divisor;
    divisor = remainder;
  }

  return dividend;
};

const normaliseParts = (
  coefficientValue: bigint,
  scaleValue: number,
): { readonly coefficient: bigint; readonly scale: number } => {
  let coefficient = coefficientValue;
  let scale = scaleValue;

  if (coefficient === 0n) {
    return { coefficient: 0n, scale: 0 };
  }

  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }

  return { coefficient, scale };
};

const significantDigits = (coefficient: bigint): number => absolute(coefficient).toString().length;

const validateParts = (coefficient: bigint, scale: number, policy: DecimalPolicy): void => {
  assertDecimalPolicy(policy);

  if (scale > policy.maximumScale) {
    throw new InventoryDomainError(
      "DecimalScaleExceeded",
      `Decimal scale ${String(scale)} exceeds the configured maximum ${String(policy.maximumScale)}.`,
    );
  }

  if (significantDigits(coefficient) > policy.maximumSignificantDigits) {
    throw new InventoryDomainError(
      "DecimalMagnitudeExceeded",
      `Decimal magnitude exceeds ${String(policy.maximumSignificantDigits)} significant digits.`,
    );
  }
};

const canonicalString = (coefficient: bigint, scale: number): string => {
  if (coefficient === 0n) {
    return "0";
  }

  const sign = coefficient < 0n ? "-" : "";
  const digits = absolute(coefficient).toString();

  if (scale === 0) {
    return `${sign}${digits}`;
  }

  const padded = digits.padStart(scale + 1, "0");
  const splitAt = padded.length - scale;
  return `${sign}${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`;
};

const validateRoundingPolicy = (rounding: DecimalRoundingPolicy, policy: DecimalPolicy): void => {
  if (
    !Number.isInteger(rounding.scale) ||
    rounding.scale < 0 ||
    rounding.scale > policy.maximumScale ||
    !decimalRoundingModes.some((mode) => mode === rounding.mode)
  ) {
    throw new InventoryDomainError(
      "DecimalRoundingPolicyInvalid",
      "Rounding scale must be a non-negative integer within the decimal policy.",
    );
  }
};

export class ExactDecimal {
  private constructor(
    private readonly coefficient: bigint,
    private readonly scale: number,
  ) {
    Object.freeze(this);
  }

  private static fromParts(
    coefficientValue: bigint,
    scaleValue: number,
    policy: DecimalPolicy,
  ): ExactDecimal {
    const { coefficient, scale } = normaliseParts(coefficientValue, scaleValue);
    validateParts(coefficient, scale, policy);
    return new ExactDecimal(coefficient, scale);
  }

  public static parse(
    value: string,
    policy: DecimalPolicy = defaultQuantityDecimalPolicy,
  ): ExactDecimal {
    assertDecimalPolicy(policy);

    if (
      value.length === 0 ||
      value.length > policy.maximumSignificantDigits + policy.maximumScale + 2 ||
      !/^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u.test(value)
    ) {
      throw new InventoryDomainError(
        "DecimalNotCanonical",
        "Decimal values must use canonical plain notation without whitespace, exponents, leading zeroes, or trailing fractional zeroes.",
      );
    }

    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [integerPart = "", fractionalPart = ""] = unsigned.split(".");
    const scale = fractionalPart.length;
    const coefficient = BigInt(`${negative ? "-" : ""}${integerPart}${fractionalPart}`);
    const result = ExactDecimal.fromParts(coefficient, scale, policy);

    if (result.toString() !== value) {
      throw new InventoryDomainError(
        "DecimalNotCanonical",
        "Decimal values must use their unique canonical representation.",
      );
    }

    return result;
  }

  public static fromInteger(
    value: bigint,
    policy: DecimalPolicy = defaultQuantityDecimalPolicy,
  ): ExactDecimal {
    return ExactDecimal.fromParts(value, 0, policy);
  }

  public static zero(): ExactDecimal {
    return new ExactDecimal(0n, 0);
  }

  public add(
    other: ExactDecimal,
    policy: DecimalPolicy = defaultQuantityDecimalPolicy,
  ): ExactDecimal {
    const resultScale = Math.max(this.scale, other.scale);
    const left = this.coefficient * pow10(resultScale - this.scale);
    const right = other.coefficient * pow10(resultScale - other.scale);
    return ExactDecimal.fromParts(left + right, resultScale, policy);
  }

  public subtract(
    other: ExactDecimal,
    policy: DecimalPolicy = defaultQuantityDecimalPolicy,
  ): ExactDecimal {
    return this.add(other.negate(policy), policy);
  }

  public multiply(
    other: ExactDecimal,
    policy: DecimalPolicy = defaultQuantityDecimalPolicy,
  ): ExactDecimal {
    return ExactDecimal.fromParts(
      this.coefficient * other.coefficient,
      this.scale + other.scale,
      policy,
    );
  }

  public divide(
    divisor: ExactDecimal,
    policy: DecimalPolicy = defaultQuantityDecimalPolicy,
    rounding?: DecimalRoundingPolicy,
  ): ExactDecimal {
    assertDecimalPolicy(policy);

    if (divisor.isZero()) {
      throw new InventoryDomainError("DecimalDivisionByZero", "Cannot divide by zero.");
    }

    let numerator = this.coefficient * pow10(divisor.scale);
    let denominator = divisor.coefficient * pow10(this.scale);

    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }

    const commonDivisor = greatestCommonDivisor(numerator, denominator);
    const reducedNumerator = numerator / commonDivisor;
    let reducedDenominator = denominator / commonDivisor;
    let powersOfTwo = 0;
    let powersOfFive = 0;

    while (reducedDenominator % 2n === 0n) {
      reducedDenominator /= 2n;
      powersOfTwo += 1;
    }

    while (reducedDenominator % 5n === 0n) {
      reducedDenominator /= 5n;
      powersOfFive += 1;
    }

    const exactScale = Math.max(powersOfTwo, powersOfFive);

    if (reducedDenominator === 1n && exactScale <= policy.maximumScale) {
      const coefficient =
        reducedNumerator *
        2n ** BigInt(exactScale - powersOfTwo) *
        5n ** BigInt(exactScale - powersOfFive);
      return ExactDecimal.fromParts(coefficient, exactScale, policy);
    }

    if (rounding === undefined) {
      throw new InventoryDomainError(
        "DecimalRoundingRequired",
        "The quotient is not exactly representable within the configured decimal scale.",
      );
    }

    validateRoundingPolicy(rounding, policy);
    const scaledNumerator = numerator * pow10(rounding.scale);
    const quotient = scaledNumerator / denominator;
    const remainder = scaledNumerator % denominator;
    const remainderMagnitude = absolute(remainder);
    const quotientSign = numerator < 0n ? -1n : 1n;
    let increment = false;

    if (remainderMagnitude !== 0n) {
      switch (rounding.mode) {
        case "TowardZero":
          break;
        case "AwayFromZero":
          increment = true;
          break;
        case "HalfUp":
          increment = remainderMagnitude * 2n >= denominator;
          break;
        case "HalfEven": {
          const twiceRemainder = remainderMagnitude * 2n;
          increment =
            twiceRemainder > denominator ||
            (twiceRemainder === denominator && absolute(quotient) % 2n === 1n);
          break;
        }
      }
    }

    return ExactDecimal.fromParts(
      increment ? quotient + quotientSign : quotient,
      rounding.scale,
      policy,
    );
  }

  public negate(policy: DecimalPolicy = defaultQuantityDecimalPolicy): ExactDecimal {
    return ExactDecimal.fromParts(-this.coefficient, this.scale, policy);
  }

  public absolute(policy: DecimalPolicy = defaultQuantityDecimalPolicy): ExactDecimal {
    if (this.coefficient < 0n) {
      return this.negate(policy);
    }

    validateParts(this.coefficient, this.scale, policy);
    return this;
  }

  public compare(other: ExactDecimal): -1 | 0 | 1 {
    const comparisonScale = Math.max(this.scale, other.scale);
    const left = this.coefficient * pow10(comparisonScale - this.scale);
    const right = other.coefficient * pow10(comparisonScale - other.scale);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  public equals(other: ExactDecimal): boolean {
    return this.coefficient === other.coefficient && this.scale === other.scale;
  }

  public isZero(): boolean {
    return this.coefficient === 0n;
  }

  public isNegative(): boolean {
    return this.coefficient < 0n;
  }

  public isPositive(): boolean {
    return this.coefficient > 0n;
  }

  public isInteger(): boolean {
    return this.scale === 0;
  }

  public toString(): string {
    return canonicalString(this.coefficient, this.scale);
  }

  public toJSON(): string {
    return this.toString();
  }
}

export function requireNonNegativeQuantity(value: ExactDecimal): ExactDecimal {
  if (value.isNegative()) {
    throw new InventoryDomainError("QuantityNegative", "Stock quantities cannot be negative.");
  }

  return value;
}

export function requirePositiveQuantity(value: ExactDecimal): ExactDecimal {
  requireNonNegativeQuantity(value);

  if (value.isZero()) {
    throw new InventoryDomainError("QuantityZero", "Stock quantity must be greater than zero.");
  }

  return value;
}
