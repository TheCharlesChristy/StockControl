import type { StockControlDatabase } from "@stockcontrol/platform-database";
import type { Kysely, Transaction } from "kysely";

export type DatabaseExecutor = Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

/**
 * An MCP write tool commits its business effect, its audit receipt and its
 * effect links in one PostgreSQL transaction, so every service a tool reaches
 * needs a way to join the caller's transaction rather than open its own. The
 * HTTP controllers pass nothing and keep their existing single-statement-
 * transaction behaviour.
 */
export function withTransaction<T>(
  database: Kysely<StockControlDatabase>,
  existing: Transaction<StockControlDatabase> | undefined,
  work: (tx: Transaction<StockControlDatabase>) => Promise<T>,
): Promise<T> {
  return existing === undefined ? database.transaction().execute(work) : work(existing);
}
