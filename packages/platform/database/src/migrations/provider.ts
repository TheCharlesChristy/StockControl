import type { Migration, MigrationProvider } from "kysely";

import { foundationMigration, foundationMigrationIntegrity } from "./0001-foundation";
import { stockMigration, stockMigrationIntegrity } from "./0002-stock";
import { collaborationMigration, collaborationMigrationIntegrity } from "./0003-collaboration";
import type { MigrationIntegrityDescriptor } from "./integrity";

export const MIGRATION_NAMES = ["0001_foundation", "0002_stock", "0003_collaboration"] as const;

const migrations: Readonly<Record<(typeof MIGRATION_NAMES)[number], Migration>> = Object.freeze({
  "0001_foundation": foundationMigration,
  "0002_stock": stockMigration,
  "0003_collaboration": collaborationMigration,
});

export const MIGRATION_INTEGRITY_MANIFEST = Object.freeze({
  "0001_foundation": foundationMigrationIntegrity,
  "0002_stock": stockMigrationIntegrity,
  "0003_collaboration": collaborationMigrationIntegrity,
}) satisfies Readonly<Record<(typeof MIGRATION_NAMES)[number], MigrationIntegrityDescriptor>>;

export class StockControlMigrationProvider implements MigrationProvider {
  public getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...migrations });
  }
}
