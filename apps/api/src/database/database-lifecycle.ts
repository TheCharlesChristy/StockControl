import type { OnApplicationShutdown } from "@nestjs/common";
import type { Kysely } from "kysely";

import type { StockControlDatabase } from "@stockcontrol/platform-database";

export class DatabaseLifecycle implements OnApplicationShutdown {
  public constructor(private readonly database: Kysely<StockControlDatabase>) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.database.destroy();
  }
}
