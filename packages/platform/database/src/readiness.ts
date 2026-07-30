import type { ReadinessCheckResult } from "@stockcontrol/contracts";
import type { ReadinessCheck } from "@stockcontrol/module-system";
import type { Kysely } from "kysely";

import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "./schema";

export class PostgresReadinessCheck implements ReadinessCheck {
  public readonly name = "database.postgresql";

  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async check(): Promise<ReadinessCheckResult> {
    try {
      await this.database
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom("system_metadata")
        .select("key")
        .limit(1)
        .executeTakeFirst();

      return {
        name: this.name,
        status: "ok",
      };
    } catch {
      return {
        name: this.name,
        status: "error",
        detail: "PostgreSQL is unavailable or migrations are incomplete.",
      };
    }
  }
}
