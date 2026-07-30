/**
 * Quantities are exact to three decimal places, matching the numeric(18,3)
 * columns in the stock schema.
 *
 * They are held as an integer number of thousandths so that arithmetic never
 * drifts: 0.1 + 0.2 is exactly 0.3, not 0.30000000000000004. A demo that shows
 * a wrong total has failed at the one thing it is meant to prove.
 */

const SCALE = 3;
const SCALE_FACTOR = 1000;

/** Well inside Number.MAX_SAFE_INTEGER once multiplied by SCALE_FACTOR. */
export const MAX_QUANTITY_UNITS = 1_000_000_000;

declare const quantityBrand: unique symbol;

/** An exact quantity, stored as an integer number of thousandths. */
export type Quantity = number & { readonly [quantityBrand]: true };

const asQuantity = (thousandths: number): Quantity => thousandths as Quantity;

export const ZERO: Quantity = asQuantity(0);

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/u;

/**
 * Parses untrusted input. Returns null rather than throwing so callers can turn
 * it into their own validation failure.
 */
export function parseQuantity(input: string | number): Quantity | null {
  const text = typeof input === "number" ? String(input) : input.trim();

  if (text.length === 0 || !DECIMAL_PATTERN.test(text)) {
    return null;
  }

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = unsigned.split(".");

  if (fraction.length > SCALE) {
    return null;
  }

  const wholeUnits = Number(whole);

  if (!Number.isSafeInteger(wholeUnits) || wholeUnits > MAX_QUANTITY_UNITS) {
    return null;
  }

  const thousandths = wholeUnits * SCALE_FACTOR + Number(fraction.padEnd(SCALE, "0") || "0");

  return asQuantity(negative ? -thousandths : thousandths);
}

/**
 * Reads a value this application previously wrote to PostgreSQL. Throws on
 * anything unparseable, because that means the database and this code disagree.
 */
export function quantityFromDatabase(value: string): Quantity {
  const parsed = parseQuantity(value);

  if (parsed === null) {
    throw new Error(`Stored quantity "${value}" is not an exact quantity.`);
  }

  return parsed;
}

/** Formats for a numeric(18,3) column and for display. */
export function formatQuantity(quantity: Quantity): string {
  const negative = quantity < 0;
  const magnitude = Math.abs(quantity);
  const whole = Math.trunc(magnitude / SCALE_FACTOR);
  const fraction = String(magnitude % SCALE_FACTOR).padStart(SCALE, "0");

  return `${negative ? "-" : ""}${String(whole)}.${fraction}`;
}

/** Trims trailing zeros for places where a table cell reads better without them. */
export function formatQuantityCompact(quantity: Quantity): string {
  return formatQuantity(quantity).replace(/\.?0+$/u, "") || "0";
}

export function toNumber(quantity: Quantity): number {
  return quantity / SCALE_FACTOR;
}

export function add(left: Quantity, right: Quantity): Quantity {
  return asQuantity(left + right);
}

export function subtract(left: Quantity, right: Quantity): Quantity {
  return asQuantity(left - right);
}

export function negate(quantity: Quantity): Quantity {
  return asQuantity(0 - quantity);
}

export function sum(quantities: Iterable<Quantity>): Quantity {
  let total = 0;

  for (const quantity of quantities) {
    total += quantity;
  }

  return asQuantity(total);
}

export function compare(left: Quantity, right: Quantity): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function isZero(quantity: Quantity): boolean {
  return quantity === 0;
}

export function isPositive(quantity: Quantity): boolean {
  return quantity > 0;
}

export function isNegative(quantity: Quantity): boolean {
  return quantity < 0;
}

export function greaterThan(left: Quantity, right: Quantity): boolean {
  return left > right;
}

export function atLeast(left: Quantity, right: Quantity): boolean {
  return left >= right;
}
