import {
  canonicalGtin,
  normaliseManufacturer,
  normalisePartNumber,
  normaliseText,
} from "./identifiers";

/*
 * How two results from different stages are decided to be the same product.
 *
 * The rule that matters: a name alone never merges two candidates. OCR reads
 * "M10 Hex Bolt" off two different boxes of two different lengths, and the
 * visual stages cannot tell those apart at all. Merging on the name would hide
 * one of them from the top five and present the wrong one as agreement between
 * stages, which is precisely the evidence a person uses to trust a suggestion.
 */

export type CandidateIdentityKey =
  | { readonly kind: "InternalItem"; readonly key: string }
  | { readonly kind: "Gtin"; readonly key: string }
  | { readonly kind: "ManufacturerPart"; readonly key: string }
  /** No identifier survived. Never merges with anything, including itself. */
  | { readonly kind: "Unmergeable"; readonly key: string };

export interface CandidateIdentityInput {
  readonly itemId?: string | null;
  readonly barcode?: string | null;
  readonly manufacturer?: string | null;
  readonly partNumber?: string | null;
  readonly name?: string | null;
}

/**
 * Precedence is internal id, then GTIN, then manufacturer plus part number.
 * An internal id wins because the catalogue already resolved that identity for
 * a person once; a GTIN beats a part number because it is globally unique and
 * check-digit protected, while part numbers are only unique within a
 * manufacturer and are not unique in this catalogue at all.
 */
export const candidateIdentityKey = (
  input: CandidateIdentityInput,
  /** Distinguishes otherwise-identical unmergeable candidates. */
  fallbackDiscriminator: string,
): CandidateIdentityKey => {
  const itemId = input.itemId?.trim();
  if (itemId !== undefined && itemId.length > 0) {
    return { kind: "InternalItem", key: itemId };
  }

  const gtin =
    input.barcode === null || input.barcode === undefined ? null : canonicalGtin(input.barcode);
  if (gtin !== null) {
    return { kind: "Gtin", key: gtin };
  }

  const manufacturer =
    input.manufacturer === null || input.manufacturer === undefined
      ? null
      : normaliseManufacturer(input.manufacturer);
  const partNumber =
    input.partNumber === null || input.partNumber === undefined
      ? null
      : normalisePartNumber(input.partNumber);
  if (manufacturer !== null && partNumber !== null) {
    return { kind: "ManufacturerPart", key: `${manufacturer} ${partNumber}` };
  }

  return { kind: "Unmergeable", key: fallbackDiscriminator };
};

export const identityKeyToString = (key: CandidateIdentityKey): string => `${key.kind}:${key.key}`;

/**
 * Whether two identities positively disagree, as opposed to one simply knowing
 * less than the other. A candidate with no part number does not contradict one
 * that has a part number; two different part numbers do, and that is worth a
 * heavy penalty because it usually means the wrong variant.
 */
export interface IdentityContradiction {
  readonly field: "barcode" | "partNumber" | "manufacturer";
}

export const contradictions = (
  left: CandidateIdentityInput,
  right: CandidateIdentityInput,
): readonly IdentityContradiction[] => {
  const found: IdentityContradiction[] = [];

  const leftGtin =
    left.barcode === null || left.barcode === undefined ? null : canonicalGtin(left.barcode);
  const rightGtin =
    right.barcode === null || right.barcode === undefined ? null : canonicalGtin(right.barcode);
  if (leftGtin !== null && rightGtin !== null && leftGtin !== rightGtin) {
    found.push({ field: "barcode" });
  }

  const leftPart =
    left.partNumber === null || left.partNumber === undefined
      ? null
      : normalisePartNumber(left.partNumber);
  const rightPart =
    right.partNumber === null || right.partNumber === undefined
      ? null
      : normalisePartNumber(right.partNumber);
  if (leftPart !== null && rightPart !== null && leftPart !== rightPart) {
    found.push({ field: "partNumber" });
  }

  const leftManufacturer =
    left.manufacturer === null || left.manufacturer === undefined
      ? null
      : normaliseManufacturer(left.manufacturer);
  const rightManufacturer =
    right.manufacturer === null || right.manufacturer === undefined
      ? null
      : normaliseManufacturer(right.manufacturer);
  if (
    leftManufacturer !== null &&
    rightManufacturer !== null &&
    leftManufacturer !== rightManufacturer
  ) {
    found.push({ field: "manufacturer" });
  }

  return found;
};

/**
 * Merges what two agreeing results know about one product. The more specific
 * value wins per field; neither result is authoritative, and the person edits
 * whatever comes out of this before anything is saved.
 */
export const mergeIdentities = (
  left: CandidateIdentityInput,
  right: CandidateIdentityInput,
): CandidateIdentityInput => {
  const pick = (
    first: string | null | undefined,
    second: string | null | undefined,
  ): string | null => {
    const firstValue = first === null || first === undefined ? "" : normaliseText(first);
    const secondValue = second === null || second === undefined ? "" : normaliseText(second);
    if (firstValue.length > 0) return firstValue;
    return secondValue.length > 0 ? secondValue : null;
  };

  return {
    itemId: left.itemId ?? right.itemId ?? null,
    barcode: pick(left.barcode, right.barcode),
    manufacturer: pick(left.manufacturer, right.manufacturer),
    partNumber: pick(left.partNumber, right.partNumber),
    name: pick(left.name, right.name),
  };
};
