import type { Kysely, Transaction } from "kysely";

import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "@stockcontrol/platform-database";

export type IdentityDatabaseExecutor =
  Kysely<StockControlDatabase> | Transaction<StockControlDatabase>;

export type IdentityRootDatabase = Kysely<StockControlDatabase>;

export const IDENTITY_DATABASE_SCHEMA = STOCKCONTROL_SCHEMA;
