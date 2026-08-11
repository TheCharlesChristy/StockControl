import { sql, type Kysely, type Transaction } from "kysely";

import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";

/*
 * The catalogue query behind OCR/identifier evidence, specification section
 * 7.5: exact reference/barcode, exact part-number matches, and bounded name
 * tokens, each kept up to five candidates including ties. A name match is
 * weaker evidence than a barcode or part-number match, and the caller (
 * candidate-fusion.ts) ranks results accordingly rather than this module
 * claiming an ordering across match kinds itself.
 */

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

type Database = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

export type CatalogueMatchKind = "Barcode" | "PartNumber" | "Name";

export interface CatalogueMatch {
  readonly itemId: string;
  readonly isActive: boolean;
  readonly reference: string;
  readonly name: string;
  readonly barcode: string | null;
  readonly partNumber: string | null;
  readonly matchedBy: CatalogueMatchKind;
}

export interface CatalogueQuery {
  readonly barcodeLikeCandidates: readonly string[];
  readonly partNumberCandidates: readonly string[];
  readonly nameFragments: readonly string[];
}

const MAX_MATCHES_PER_KIND = 5;
const MAX_TOTAL_MATCHES = 5;

const upper = (values: readonly string[]): readonly string[] => [
  ...new Set(values.map((value) => value.trim().toUpperCase()).filter((value) => value.length > 0)),
];

/**
 * Queries by barcode/reference first, then part number, then name, stopping
 * once five distinct items have been found — matching the evidence cap every
 * other stage in this pipeline uses. Archived items are returned like active
 * ones: the person is shown the match and told it cannot receive stock,
 * which is more use than silence when the item is in their hand.
 */
export const queryCatalogue = async (
  database: Database,
  query: CatalogueQuery,
): Promise<readonly CatalogueMatch[]> => {
  const byItemId = new Map<string, CatalogueMatch>();

  const barcodeValues = upper(query.barcodeLikeCandidates);
  if (barcodeValues.length > 0) {
    const rows = await database
      .withSchema(SCHEMA)
      .selectFrom("items")
      .select(["id", "is_active", "reference", "name", "barcode", "part_number"])
      .where((eb) =>
        eb.or([
          eb(sql<string>`upper(coalesce(barcode, ''))`, "in", barcodeValues),
          eb(sql<string>`upper(reference)`, "in", barcodeValues),
        ]),
      )
      .limit(MAX_MATCHES_PER_KIND)
      .execute();
    for (const row of rows) {
      byItemId.set(row.id, {
        itemId: row.id,
        isActive: row.is_active,
        reference: row.reference,
        name: row.name,
        barcode: row.barcode,
        partNumber: row.part_number,
        matchedBy: "Barcode",
      });
    }
  }

  const partNumberValues = upper(query.partNumberCandidates);
  if (partNumberValues.length > 0 && byItemId.size < MAX_TOTAL_MATCHES) {
    const rows = await database
      .withSchema(SCHEMA)
      .selectFrom("items")
      .select(["id", "is_active", "reference", "name", "barcode", "part_number"])
      .where(sql<string>`upper(coalesce(part_number, ''))`, "in", partNumberValues)
      .limit(MAX_MATCHES_PER_KIND)
      .execute();
    for (const row of rows) {
      if (byItemId.has(row.id)) continue;
      byItemId.set(row.id, {
        itemId: row.id,
        isActive: row.is_active,
        reference: row.reference,
        name: row.name,
        barcode: row.barcode,
        partNumber: row.part_number,
        matchedBy: "PartNumber",
      });
    }
  }

  const nameTokens = query.nameFragments
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= 3)
    .slice(0, MAX_MATCHES_PER_KIND);
  if (nameTokens.length > 0 && byItemId.size < MAX_TOTAL_MATCHES) {
    const rows = await database
      .withSchema(SCHEMA)
      .selectFrom("items")
      .select(["id", "is_active", "reference", "name", "barcode", "part_number"])
      .where((eb) => eb.or(nameTokens.map((token) => eb("name", "ilike", `%${token}%`))))
      .limit(MAX_MATCHES_PER_KIND)
      .execute();
    for (const row of rows) {
      if (byItemId.has(row.id)) continue;
      byItemId.set(row.id, {
        itemId: row.id,
        isActive: row.is_active,
        reference: row.reference,
        name: row.name,
        barcode: row.barcode,
        partNumber: row.part_number,
        matchedBy: "Name",
      });
    }
  }

  return [...byItemId.values()].slice(0, MAX_TOTAL_MATCHES);
};
