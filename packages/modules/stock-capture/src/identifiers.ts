/*
 * Identifier handling for assisted stock capture. Everything a camera, an OCR
 * model or a web page hands us arrives as hostile text, so nothing here trusts
 * its input: values are stripped of control characters, length-checked, and
 * — where the symbology defines one — verified against a check digit before
 * they are allowed anywhere near a catalogue query.
 */

/** Lengths GS1 defines. Anything else is not a GTIN, whatever decoded it. */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

const MAX_IDENTIFIER_LENGTH = 64;
const MAX_TEXT_LENGTH = 200;

/**
 * Symbologies whose decoded value we are willing to treat as a product code.
 * Deliberately narrow: a QR code can carry anything, so it is handled by the
 * internal-URL path rather than being matched against `items.barcode`.
 */
export const PRODUCT_CODE_SYMBOLOGIES = [
  "EAN-8",
  "EAN-13",
  "UPC-A",
  "UPC-E",
  "ITF",
  "Code128",
  "Code39",
  "DataBar",
] as const;
export type ProductCodeSymbology = (typeof PRODUCT_CODE_SYMBOLOGIES)[number];

export const isProductCodeSymbology = (value: string): value is ProductCodeSymbology =>
  (PRODUCT_CODE_SYMBOLOGIES as readonly string[]).includes(value);

/**
 * Strips the characters that make text dangerous to store, log or put in a
 * prompt: C0/C1 controls, bidirectional overrides, and zero-width joiners that
 * let two different strings render identically.
 */
export const stripControlCharacters = (value: string): string => {
  let output = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBidirectionalOverride = code >= 0x202a && code <= 0x202e;
    const isIsolate = code >= 0x2066 && code <= 0x2069;
    const isZeroWidth = code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff;
    if (!isControl && !isBidirectionalOverride && !isIsolate && !isZeroWidth) {
      output += character;
    }
  }
  return output;
};

/** Collapses runs of whitespace so `"M10  ×  50"` and `"M10 × 50"` are one token. */
export const normaliseText = (value: string): string =>
  stripControlCharacters(value).replace(/\s+/gu, " ").trim().slice(0, MAX_TEXT_LENGTH);

/**
 * The GS1 modulo-10 check digit. Weights alternate 3 and 1 from the digit
 * immediately left of the check digit, which is why the string is walked from
 * the right — that makes the weighting independent of the GTIN's length.
 */
const gtinCheckDigit = (digitsWithoutCheck: string): number => {
  let sum = 0;
  for (let index = digitsWithoutCheck.length - 1, weight = 3; index >= 0; index -= 1, weight ^= 2) {
    sum += Number(digitsWithoutCheck[index]) * weight;
  }
  return (10 - (sum % 10)) % 10;
};

export const isValidGtin = (value: string): boolean => {
  if (!GTIN_LENGTHS.has(value.length) || !/^\d+$/u.test(value)) return false;
  const body = value.slice(0, -1);
  const check = Number(value.slice(-1));
  return gtinCheckDigit(body) === check;
};

/**
 * GTINs of different lengths can name the same trade item — a UPC-A is an
 * EAN-13 with a leading zero — so comparison happens on the 14-digit form.
 * Returns null when the value is not a GTIN at all.
 */
export const canonicalGtin = (value: string): string | null => {
  const trimmed = stripControlCharacters(value).trim();
  if (!isValidGtin(trimmed)) return null;
  return trimmed.padStart(14, "0");
};

/**
 * Part numbers are printed inconsistently: `RS-1234/A`, `RS1234 A`, `rs 1234a`
 * are routinely the same part. Comparison strips the separators and folds case.
 * This is a matching key only — the value shown to a person is never rewritten,
 * because a stockroom recognises the printed form, not this one.
 */
export const normalisePartNumber = (value: string): string | null => {
  const compact = stripControlCharacters(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "");
  if (compact.length < 3 || compact.length > MAX_IDENTIFIER_LENGTH) return null;
  return compact;
};

/**
 * A manufacturer name normalised for grouping. Legal-form suffixes are dropped
 * because "Acme Ltd" and "Acme Limited" are one manufacturer and would
 * otherwise produce two candidates for the same product.
 */
export const normaliseManufacturer = (value: string): string | null => {
  const cleaned = normaliseText(value)
    .toUpperCase()
    .replace(/[.,]/gu, " ")
    .replace(/\b(LTD|LIMITED|LLC|INC|INCORPORATED|PLC|GMBH|BV|SA|SAS|AG|CO|CORP)\b/gu, " ")
    .replace(/[^A-Z0-9]+/gu, " ")
    .trim();
  return cleaned.length === 0 ? null : cleaned;
};

export interface ValidatedProductCode {
  readonly value: string;
  readonly symbology: ProductCodeSymbology;
  /** Present only when the value is a well-formed GTIN. */
  readonly canonicalGtin: string | null;
}

/**
 * Validates one decoded barcode. A code that fails here is not evidence of
 * anything: a mis-decoded digit produces a plausible-looking string that would
 * match the wrong item, which is exactly the failure the check digit exists to
 * prevent.
 */
export const validateProductCode = (input: {
  readonly value: string;
  readonly symbology: string;
}): ValidatedProductCode | null => {
  if (!isProductCodeSymbology(input.symbology)) return null;

  const value = stripControlCharacters(input.value).trim();
  if (value.length < 4 || value.length > MAX_IDENTIFIER_LENGTH) return null;
  if (!/^[\x20-\x7e]+$/u.test(value)) return null;

  const gtin = canonicalGtin(value);

  /*
   * A numeric value at a GTIN length that fails its check digit is a misread,
   * not an unusual product code, so it is rejected rather than passed through
   * as a Code128-style free-form identifier.
   */
  if (gtin === null && GTIN_LENGTHS.has(value.length) && /^\d+$/u.test(value)) return null;

  return { value, symbology: input.symbology, canonicalGtin: gtin };
};

/**
 * Whether a set of validated codes agrees. Two readings of one label, or the
 * same code seen in three photographs, is agreement; two genuinely different
 * product codes is not, and suppresses the early-return path.
 */
export const distinctProductCodes = (codes: readonly ValidatedProductCode[]): readonly string[] => {
  const seen = new Set<string>();
  for (const code of codes) {
    seen.add(code.canonicalGtin ?? code.value);
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
};
