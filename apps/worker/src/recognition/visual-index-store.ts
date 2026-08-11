import type { Kysely, Transaction } from "kysely";

import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";

import { decodeFloat16Buffer, type VisualExample } from "./visual-index";

/*
 * The database half of stage 3 (specification section 7.6): loading the
 * in-memory index visual-index.ts's pure `findNearestNeighbours` searches.
 * Split from that file because this half only means anything against a real
 * PostgreSQL — see test/visual-index.integration.spec.ts.
 */

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

type Database = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

/** Bounds how large a catalogue's exemplar set this linear scan will load. */
const DEFAULT_INDEX_LIMIT = 20_000;

/**
 * Loads confirmed exemplars for the exact embedding model revision the query
 * vector came from — a vector from a different model version is not on the
 * same scale and a similarity score across the two would be meaningless.
 *
 * Archived items are excluded: unlike an identifier match, a visual
 * "similar item" suggestion pointing at stock nobody can receive against is
 * a false lead rather than useful evidence.
 */
export const loadVisualIndex = async (
  database: Database,
  embeddingModel: string,
  limit: number = DEFAULT_INDEX_LIMIT,
): Promise<readonly VisualExample[]> => {
  const rows = await database
    .withSchema(SCHEMA)
    .selectFrom("item_visual_examples")
    .innerJoin("items", "items.id", "item_visual_examples.item_id")
    .select([
      "item_visual_examples.item_id as itemId",
      "item_visual_examples.embedding as embedding",
    ])
    .where("item_visual_examples.embedding_model", "=", embeddingModel)
    .where("item_visual_examples.retired_at", "is", null)
    .where("items.is_active", "=", true)
    .limit(limit)
    .execute();

  return rows.map((row) => ({ itemId: row.itemId, vector: decodeFloat16Buffer(row.embedding) }));
};
