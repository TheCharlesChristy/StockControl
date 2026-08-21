import { Migrator, sql, type Kysely, type MigrationResult } from "kysely";

import type { StockControlDatabase } from "../schema";
import { STOCKCONTROL_SCHEMA } from "../schema";
import { MIGRATION_INTEGRITY_MANIFEST, StockControlMigrationProvider } from "./provider";

const MIGRATION_TABLE_NAME = "stockcontrol_migration";
const MIGRATION_LOCK_TABLE_NAME = "stockcontrol_migration_lock";

export type DatabaseRuntimePrivilege = "select" | "insert" | "update" | "delete";

/**
 * This registry is intentionally exhaustive. Adding a table to the schema does
 * not make it runtime-accessible until its minimum privileges are reviewed here.
 */
export const RUNTIME_TABLE_PRIVILEGES = Object.freeze({
  items: ["select", "insert", "update"],
  job_assignments: ["select", "insert", "delete"],
  jobs: ["select", "insert", "update"],
  locations: ["select", "insert", "update", "delete"],
  maps: ["select", "insert", "update"],
  map_edit_events: ["select", "insert"],
  floor_plan_documents: ["select", "insert"],
  user_profile_photos: ["select", "insert", "update", "delete"],
  item_photos: ["select", "insert", "update", "delete"],
  /*
   * Assisted stock capture. Delete is granted where a row is temporary
   * evidence the application is obliged to destroy: images, candidates and
   * their feedback are purged after the session finishes, and a visual example
   * disappears when its item is retired or exemplars are switched off.
   * `stock_capture_entries` is withheld delete for the opposite reason — it is
   * the idempotency record that proves a receipt happened exactly once, so
   * losing it would let a retry create a second one.
   */
  item_visual_examples: ["select", "insert", "update", "delete"],
  migration_integrity: [],
  mcp_command_receipts: ["select", "insert"],
  mcp_effect_links: ["select", "insert"],
  mcp_tool_call_events: ["select", "insert"],
  mcp_tool_calls: ["select", "insert"],
  oauth_grant_events: ["select", "insert"],
  // OAuth grant state is the one mutable part of the integration.
  oauth_grants: ["select", "insert", "update"],
  recognition_feedback: ["select", "insert", "delete"],
  reservations: ["select", "insert", "update"],
  sessions: ["select", "insert", "delete"],
  stock_capture_batches: ["select", "insert", "update"],
  stock_capture_entries: ["select", "insert", "update"],
  stock_levels: ["select", "insert", "update"],
  stock_recognition_candidates: ["select", "insert", "delete"],
  stock_recognition_images: ["select", "insert", "update", "delete"],
  stock_recognition_jobs: ["select", "insert", "update", "delete"],
  stock_recognition_sessions: ["select", "insert", "update"],
  stock_requests: ["select", "insert", "update"],
  system_metadata: ["select", "insert", "update", "delete"],
  transactions: ["select", "insert"],
  // Delete is granted so an Admin can remove an account created by mistake.
  // Every table that records what a person did references users with
  // `on delete restrict`, so the database refuses to erase anyone with history.
  users: ["select", "insert", "update", "delete"],
} as const satisfies Readonly<
  Record<keyof StockControlDatabase, readonly DatabaseRuntimePrivilege[]>
>);

export interface MigrationResultSummary {
  readonly direction: MigrationResult["direction"];
  readonly migrationName: string;
  readonly status: MigrationResult["status"];
}

export interface MigrationRunResult {
  readonly results: readonly MigrationResultSummary[];
}

export interface RunMigrationsOptions {
  readonly runtimeRole: string;
}

export type MigrationIntegrityErrorCode =
  | "IntegrityTableMissing"
  | "ChecksumMissing"
  | "ChecksumMismatch"
  | "UnknownAppliedMigration"
  | "UnexpectedChecksum";

export class MigrationIntegrityError extends Error {
  public constructor(
    public readonly code: MigrationIntegrityErrorCode,
    public readonly migrationName: string,
  ) {
    super(`Migration integrity validation failed for ${migrationName} (${code}).`);
    this.name = "MigrationIntegrityError";
  }
}

export class DatabaseMigrationError extends Error {
  public constructor(
    message: string,
    cause: unknown,
    public readonly results: readonly MigrationResultSummary[] = [],
    public readonly sqlState?: string,
  ) {
    super(message, { cause });
    this.name = "DatabaseMigrationError";
  }
}

interface MigrationMetadataTable {
  readonly name: string;
  readonly timestamp: string;
}

interface MigrationMetadataDatabase extends StockControlDatabase {
  readonly stockcontrol_migration: MigrationMetadataTable;
}

interface AppliedMigration {
  readonly name: string;
}

interface IntegrityRecord {
  readonly checksum: string;
  readonly migration_name: string;
  readonly migration_version: number;
}

const migrationResultSummaries = (
  results: readonly MigrationResult[] | undefined,
): readonly MigrationResultSummary[] =>
  (results ?? []).map(({ direction, migrationName, status }) =>
    Object.freeze({ direction, migrationName, status }),
  );

const sqlStateFromError = (
  error: unknown,
  visited: ReadonlySet<object> = new Set(),
): string | undefined => {
  if (typeof error !== "object" || error === null || visited.has(error)) {
    return undefined;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(error);
  const candidate = (error as { readonly code?: unknown }).code;
  if (typeof candidate === "string" && /^[0-9A-Z]{5}$/.test(candidate)) {
    return candidate;
  }

  return sqlStateFromError((error as { readonly cause?: unknown }).cause, nextVisited);
};

const tableExists = (
  tables: readonly { readonly name: string; readonly schema?: string }[],
  name: string,
  schema?: string,
): boolean =>
  tables.some(
    (table) =>
      table.name === name &&
      (schema === undefined || table.schema === schema || table.schema === undefined),
  );

const readMigrationIntegrityState = async (
  database: Kysely<StockControlDatabase>,
): Promise<{
  readonly applied: readonly AppliedMigration[];
  readonly integrity: readonly IntegrityRecord[];
  readonly integrityTableExists: boolean;
}> => {
  const tables = await database.introspection.getTables({
    withInternalKyselyTables: true,
  });
  const migrationTableExists = tableExists(tables, MIGRATION_TABLE_NAME);
  const integrityTableExists = tableExists(tables, "migration_integrity", STOCKCONTROL_SCHEMA);
  const metadataDatabase = database as unknown as Kysely<MigrationMetadataDatabase>;

  const applied = migrationTableExists
    ? await metadataDatabase
        .selectFrom(MIGRATION_TABLE_NAME)
        .select("name")
        .orderBy("timestamp", "asc")
        .orderBy("name", "asc")
        .execute()
    : [];
  const integrity = integrityTableExists
    ? await database
        .withSchema(STOCKCONTROL_SCHEMA)
        .selectFrom("migration_integrity")
        .select(["migration_name", "migration_version", "checksum"])
        .orderBy("migration_name", "asc")
        .execute()
    : [];

  return {
    applied,
    integrity,
    integrityTableExists,
  };
};

export const validateMigrationIntegrity = async (
  database: Kysely<StockControlDatabase>,
): Promise<void> => {
  const state = await readMigrationIntegrityState(database);

  if (state.applied.length > 0 && !state.integrityTableExists) {
    throw new MigrationIntegrityError("IntegrityTableMissing", state.applied[0]?.name ?? "unknown");
  }

  const appliedNames = new Set(state.applied.map(({ name }) => name));
  const recordsByName = new Map(
    state.integrity.map((record) => [record.migration_name, record] as const),
  );

  for (const { name } of state.applied) {
    if (!Object.hasOwn(MIGRATION_INTEGRITY_MANIFEST, name)) {
      throw new MigrationIntegrityError("UnknownAppliedMigration", name);
    }

    const expected =
      MIGRATION_INTEGRITY_MANIFEST[name as keyof typeof MIGRATION_INTEGRITY_MANIFEST];
    const actual = recordsByName.get(name);

    if (actual === undefined) {
      throw new MigrationIntegrityError("ChecksumMissing", name);
    }

    if (actual.checksum !== expected.checksum || actual.migration_version !== expected.version) {
      throw new MigrationIntegrityError("ChecksumMismatch", name);
    }
  }

  for (const record of state.integrity) {
    if (!appliedNames.has(record.migration_name)) {
      throw new MigrationIntegrityError("UnexpectedChecksum", record.migration_name);
    }
  }
};

const configureRuntimeDatabaseAccess = async (
  database: Kysely<StockControlDatabase>,
  runtimeRole: string,
): Promise<void> => {
  if (runtimeRole.trim().length === 0) {
    throw new DatabaseMigrationError("The runtime database role cannot be empty.", undefined);
  }

  const role = sql.id(runtimeRole);
  const schema = sql.id(STOCKCONTROL_SCHEMA);

  await sql`revoke all privileges on schema ${schema} from ${role}`.execute(database);
  await sql`revoke all privileges on all tables in schema ${schema} from ${role}`.execute(database);
  await sql`revoke all privileges on all sequences in schema ${schema} from ${role}`.execute(
    database,
  );
  await sql`
    alter default privileges in schema ${schema}
    revoke all privileges on tables from ${role}
  `.execute(database);
  await sql`
    alter default privileges in schema ${schema}
    revoke all privileges on sequences from ${role}
  `.execute(database);
  await sql`grant usage on schema ${schema} to ${role}`.execute(database);

  for (const [tableName, privileges] of Object.entries(RUNTIME_TABLE_PRIVILEGES)) {
    if (privileges.length === 0) {
      continue;
    }

    const privilegeList = sql.raw(privileges.join(", "));
    const table = sql.id(STOCKCONTROL_SCHEMA, tableName);
    await sql`grant ${privilegeList} on table ${table} to ${role}`.execute(database);
  }
};

export const runMigrations = async (
  database: Kysely<StockControlDatabase>,
  options: RunMigrationsOptions,
): Promise<MigrationRunResult> => {
  if (options.runtimeRole.trim().length === 0) {
    throw new DatabaseMigrationError("The runtime database role cannot be empty.", undefined);
  }

  const migrator = new Migrator({
    db: database,
    migrationLockTableName: MIGRATION_LOCK_TABLE_NAME,
    migrationTableName: MIGRATION_TABLE_NAME,
    provider: new StockControlMigrationProvider(),
  });

  await validateMigrationIntegrity(database);
  const migration = await migrator.migrateToLatest();
  const results = migrationResultSummaries(migration.results);

  if (migration.error !== undefined) {
    throw new DatabaseMigrationError(
      "PostgreSQL migrations failed.",
      migration.error,
      results,
      sqlStateFromError(migration.error),
    );
  }

  await validateMigrationIntegrity(database);
  await configureRuntimeDatabaseAccess(database, options.runtimeRole);

  return { results };
};
