import type { Migration, MigrationProvider } from "kysely";

import { foundationMigration, foundationMigrationIntegrity } from "./0001-foundation";
import type { MigrationIntegrityDescriptor } from "./integrity";

export const MIGRATION_NAMES = ["0001_foundation"] as const;

const migrations: Readonly<Record<(typeof MIGRATION_NAMES)[number], Migration>> = Object.freeze({
  "0001_foundation": foundationMigration,
});

export const MIGRATION_INTEGRITY_MANIFEST = Object.freeze({
  "0001_foundation": foundationMigrationIntegrity,
}) satisfies Readonly<Record<(typeof MIGRATION_NAMES)[number], MigrationIntegrityDescriptor>>;

export class StockControlMigrationProvider implements MigrationProvider {
  public getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...migrations });
  }
}
