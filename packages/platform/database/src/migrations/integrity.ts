import { createHash } from "node:crypto";

import { sql, type Kysely, type Migration } from "kysely";

export interface CanonicalMigrationDefinition {
  readonly name: string;
  readonly version: number;
  readonly upStatements: readonly string[];
  readonly downStatements: readonly string[];
}

export interface MigrationIntegrityDescriptor {
  readonly name: string;
  readonly version: number;
  readonly checksum: string;
}

export interface ChecksummedMigration {
  readonly descriptor: MigrationIntegrityDescriptor;
  readonly migration: Migration;
}

const migrationIntegrityInsert = (descriptor: MigrationIntegrityDescriptor): string =>
  [
    "insert into stockcontrol.migration_integrity",
    "(migration_name, migration_version, checksum)",
    `values ('${descriptor.name}', ${String(descriptor.version)}, '${descriptor.checksum}')`,
  ].join(" ");

const migrationIntegrityDelete = (migrationName: string): string =>
  `delete from stockcontrol.migration_integrity where migration_name = '${migrationName}'`;

export const checksumMigrationDefinition = (definition: CanonicalMigrationDefinition): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        downStatements: definition.downStatements,
        name: definition.name,
        upStatements: definition.upStatements,
        version: definition.version,
      }),
      "utf8",
    )
    .digest("hex");

const executeStatements = async (
  database: Kysely<unknown>,
  statements: readonly string[],
): Promise<void> => {
  for (const statement of statements) {
    await sql.raw(statement).execute(database);
  }
};

export const createChecksummedMigration = (
  definition: CanonicalMigrationDefinition,
): ChecksummedMigration => {
  const descriptor = Object.freeze({
    name: definition.name,
    version: definition.version,
    checksum: checksumMigrationDefinition(definition),
  });

  return Object.freeze({
    descriptor,
    migration: Object.freeze({
      up: async (database: Kysely<unknown>): Promise<void> => {
        await executeStatements(database, definition.upStatements);
        await sql.raw(migrationIntegrityInsert(descriptor)).execute(database);
      },
      down: async (database: Kysely<unknown>): Promise<void> => {
        await sql.raw(migrationIntegrityDelete(descriptor.name)).execute(database);
        await executeStatements(database, definition.downStatements);
      },
    }),
  });
};
