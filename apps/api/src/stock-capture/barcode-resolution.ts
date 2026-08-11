import type { LocalBarcodeObservation } from "@stockcontrol/contracts";
import {
  distinctProductCodes,
  validateProductCode,
  type ValidatedProductCode,
} from "@stockcontrol/module-stock-capture";
import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";
import { sql, type Kysely, type Transaction } from "kysely";

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

type Database = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

/*
 * The exact-barcode short cut from specification section 7.2.
 *
 * The saving is model work, never the confirmation. What this decides is
 * whether the photographs need uploading at all — and it says yes far more
 * often than a naive reading suggests, because the bar is not "we decoded
 * something" but "every distinct code we decoded points at the same active
 * item and none points anywhere else".
 *
 * The client sends decoded values, symbologies and its reader version. It does
 * not send a matched item, and nothing here would believe it if it did: a
 * client that could nominate the item could receive stock against any item it
 * named.
 */

export interface BarcodeResolution {
  /** Every code that survived validation. Kept as evidence either way. */
  readonly validated: readonly ValidatedProductCode[];
  readonly outcome:
    | { readonly kind: "NoCodes" }
    | { readonly kind: "ExactMatch"; readonly itemId: string; readonly isActive: boolean }
    /* A valid code nobody has catalogued: real evidence, but not an answer. */
    | { readonly kind: "UnknownCode" }
    /* Codes disagree, or point at different items. The full pipeline runs. */
    | { readonly kind: "Ambiguous" };
}

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

/**
 * Resolves validated codes through the catalogue.
 *
 * An archived match still resolves: the person is shown the item and told it
 * cannot receive stock, which is more use than "no match" when the item is
 * sitting in their hand.
 */
export const resolveLocalCodes = async (
  database: Database,
  observations: readonly LocalBarcodeObservation[],
): Promise<BarcodeResolution> => {
  const validated = observations
    .map((observation) => validateProductCode(observation))
    .filter((code): code is ValidatedProductCode => code !== null);

  if (validated.length === 0) return { validated, outcome: { kind: "NoCodes" } };

  const distinct = distinctProductCodes(validated);

  /*
   * Two different product codes across one item's photographs means the frame
   * caught a neighbour, or the item carries a code for something else printed
   * beside it. Either way the short cut is unsafe and the full pipeline runs.
   */
  if (distinct.length > 1) return { validated, outcome: { kind: "Ambiguous" } };

  const searchValues = [
    ...new Set(
      validated.flatMap((code) =>
        code.canonicalGtin === null
          ? [code.value]
          : /* Both forms, because the catalogue stores whatever was typed. */
            [code.value, code.canonicalGtin, code.canonicalGtin.replace(/^0+/u, "")],
      ),
    ),
  ].map((value) => value.toUpperCase());

  const matches = await database
    .withSchema(SCHEMA)
    .selectFrom("items")
    .select(["id", "is_active"])
    .where(sql<string>`upper(coalesce(barcode, ''))`, "in", searchValues)
    .limit(5)
    .execute();

  if (matches.length === 0) return { validated, outcome: { kind: "UnknownCode" } };

  const distinctItems = new Set(matches.map(({ id }) => id));
  if (distinctItems.size > 1) return { validated, outcome: { kind: "Ambiguous" } };

  const match = matches[0];
  if (match === undefined) return { validated, outcome: { kind: "UnknownCode" } };

  return {
    validated,
    outcome: { kind: "ExactMatch", itemId: match.id, isActive: match.is_active },
  };
};
