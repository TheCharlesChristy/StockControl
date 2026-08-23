import { sql, type Kysely, type RawBuilder, type SelectQueryBuilder } from "kysely";

import { loadMigratorDatabaseConfiguration, type DatabaseEnvironment } from "../configuration";
import { createMigratorDatabase } from "../connection";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "../schema";

import {
  DEFAULT_RETENTION_WINDOWS,
  RETENTION_RULES,
  cutoffFor,
  loadRetentionWindows,
  type RetentionExecutor,
  type RetentionParent,
  type RetentionRule,
  type RetentionWindows,
} from "./schedule";

const withSchema = (executor: RetentionExecutor): Kysely<StockControlDatabase> =>
  executor.withSchema(STOCKCONTROL_SCHEMA);

/**
 * The ids of the parent rows a `parent`-scoped rule follows, as a subquery the
 * delete can hand to `in` — not as SQL text. Compiling this to a string would
 * strip the bound cutoff and put a value into raw SQL, which is the one thing
 * the query builder is here to stop.
 *
 * A capture session only counts as expired once it has stopped moving. One
 * still in flight has an old `updated_at` only if something has gone wrong,
 * and taking its rows out from under the worker is worse than keeping them a
 * little longer.
 */
const expiredParentIds = (
  executor: RetentionExecutor,
  parent: RetentionParent,
  cutoff: Date,
): SelectQueryBuilder<StockControlDatabase, never, { id: string }> => {
  const database = withSchema(executor);

  const query =
    parent === "toolCalls"
      ? database.selectFrom("mcp_tool_calls").select("id").where("received_at", "<", cutoff)
      : database
          .selectFrom("stock_recognition_sessions")
          .select("id")
          .where("updated_at", "<", cutoff)
          .where("status", "in", ["Committed", "Cancelled", "Expired", "Failed"]);

  return query;
};

/**
 * The column a rule filters on, as an identifier rather than a value. A
 * dynamic column name is precisely the case `sql.ref` exists for.
 */
const scopeColumn = (rule: RetentionRule): RawBuilder<unknown> => sql.ref(rule.scope.column);

export interface RetentionTableResult {
  readonly table: keyof StockControlDatabase;
  readonly window: keyof RetentionWindows;
  /** The moment before which a row is out of policy. */
  readonly cutoff: string;
  /** Rows removed, or — on a dry run — rows that would be. */
  readonly rows: number;
}

export interface RetentionRunResult {
  readonly dryRun: boolean;
  readonly windows: RetentionWindows;
  readonly ranAt: string;
  readonly tables: readonly RetentionTableResult[];
  readonly totalRows: number;
}

export interface RunRetentionOptions {
  readonly windows?: RetentionWindows;
  /** Report what is out of policy without removing it. */
  readonly dryRun?: boolean;
  readonly now?: Date;
}

/*
 * Kysely types a query against a literal table name, and these rules carry the
 * name as data so the schedule reads as a policy rather than as twelve
 * near-identical queries. That trade costs one cast where a name becomes a
 * query. The filter itself stays parameterised: the column is an identifier
 * through `sql.ref`, and the cutoff is a bound value, never spliced text.
 */
type AnyTable = keyof StockControlDatabase;

interface FilterableQuery<Result> {
  where(left: unknown, operator: string, right: unknown): FilterableQuery<Result>;
  executeTakeFirst(): Promise<Result | undefined>;
  executeTakeFirstOrThrow(): Promise<Result>;
}

const scoped = <Result>(
  database: Kysely<StockControlDatabase>,
  query: unknown,
  rule: RetentionRule,
  cutoff: Date,
): FilterableQuery<Result> => {
  const filterable = query as FilterableQuery<Result>;

  return rule.scope.kind === "own"
    ? filterable.where(scopeColumn(rule), "<", cutoff)
    : filterable.where(
        scopeColumn(rule),
        "in",
        expiredParentIds(database, rule.scope.parent, cutoff),
      );
};

const countExpired = async (
  database: Kysely<StockControlDatabase>,
  rule: RetentionRule,
  cutoff: Date,
): Promise<number> => {
  const row = await scoped<{ readonly total: string }>(
    database,
    withSchema(database)
      .selectFrom<AnyTable>(rule.table)
      .select((builder) => builder.fn.countAll<string>().as("total")),
    rule,
    cutoff,
  ).executeTakeFirstOrThrow();

  return Number(row.total);
};

const deleteExpired = async (
  database: Kysely<StockControlDatabase>,
  rule: RetentionRule,
  cutoff: Date,
): Promise<number> => {
  const result = await scoped<{ readonly numDeletedRows: bigint }>(
    database,
    withSchema(database).deleteFrom<AnyTable>(rule.table),
    rule,
    cutoff,
  ).executeTakeFirst();

  return Number(result?.numDeletedRows ?? 0n);
};

/**
 * Applies the retention schedule.
 *
 * Runs under the migrator role, not the API's. The audit tables are
 * append-only to the runtime role on purpose — granting it delete so that a
 * nightly sweep could work would hand an attacker who reached the API the
 * ability to erase the record of what they did. Ageing records out is a
 * maintenance step with its own credential, like a migration.
 *
 * The whole run is one transaction. A half-applied purge would leave children
 * whose parents survived, and the next run would then fail on the restrict
 * constraint rather than repair itself.
 */
export const runRetention = async (
  database: Kysely<StockControlDatabase>,
  options: RunRetentionOptions = {},
): Promise<RetentionRunResult> => {
  const windows = options.windows ?? DEFAULT_RETENTION_WINDOWS;
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;

  const tables = await database.transaction().execute(async (transaction) => {
    const results: RetentionTableResult[] = [];

    for (const rule of RETENTION_RULES) {
      const cutoff = cutoffFor(rule, windows, now);
      const rows = dryRun
        ? await countExpired(transaction, rule, cutoff)
        : await deleteExpired(transaction, rule, cutoff);

      results.push({
        table: rule.table,
        window: rule.window,
        cutoff: cutoff.toISOString(),
        rows,
      });
    }

    return results;
  });

  return {
    dryRun,
    windows,
    ranAt: now.toISOString(),
    tables,
    totalRows: tables.reduce((total, table) => total + table.rows, 0),
  };
};

export interface ApplyRetentionOptions {
  readonly dryRun?: boolean;
  readonly now?: Date;
}

/**
 * Applies the retention schedule against the configured database, under the
 * migrator credential. The pool is always closed, including on failure.
 */
export const applyConfiguredRetention = async (
  environment: DatabaseEnvironment = process.env,
  options: ApplyRetentionOptions = {},
): Promise<RetentionRunResult> => {
  const windows = loadRetentionWindows(environment);
  const database = createMigratorDatabase(loadMigratorDatabaseConfiguration(environment));

  try {
    return await runRetention(database, {
      windows,
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  } finally {
    await database.destroy();
  }
};
