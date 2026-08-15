import type { LocalBarcodeObservation } from "@stockcontrol/contracts";

/*
 * Narrows untrusted browser barcode observations before storing them as one
 * source of pipeline evidence. The client never nominates a matched item.
 */

const MAX_LOCAL_CODES = 20;

/**
 * Narrows what the client actually sent. Anything malformed is dropped rather
 * than rejected: a bad decode among five photographs is ordinary, and refusing
 * the whole session over it would be worse than ignoring it.
 */
export const readLocalCodes = (values: readonly unknown[]): readonly LocalBarcodeObservation[] => {
  const observations: LocalBarcodeObservation[] = [];

  for (const value of values.slice(0, MAX_LOCAL_CODES)) {
    if (typeof value !== "object" || value === null) continue;
    const candidate = value as Partial<Record<keyof LocalBarcodeObservation, unknown>>;

    if (
      typeof candidate.value !== "string" ||
      typeof candidate.symbology !== "string" ||
      typeof candidate.imageOrdinal !== "number" ||
      typeof candidate.readerVersion !== "string"
    ) {
      continue;
    }

    observations.push({
      value: candidate.value.slice(0, 200),
      symbology: candidate.symbology.slice(0, 40),
      imageOrdinal: Math.max(0, Math.min(5, Math.floor(candidate.imageOrdinal))),
      readerVersion: candidate.readerVersion.slice(0, 60),
    });
  }

  return observations;
};
