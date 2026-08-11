import type { OnApplicationShutdown } from "@nestjs/common";
import type { Kysely } from "kysely";

import type { StockControlDatabase } from "@stockcontrol/platform-database";

/**
 * Closes the pool last. Nest calls shutdown hooks in registration order, and
 * this provider is registered after the runtime so the claim loop has already
 * drained and handed its leases back before the connections go away.
 */
export class DatabaseLifecycle implements OnApplicationShutdown {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.database.destroy();
  }
}
