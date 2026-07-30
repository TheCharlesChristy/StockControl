import { createHash } from "node:crypto";

import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
  type TransactionSettings,
} from "kysely";

import type { StockControlDatabase } from "@stockcontrol/platform-database";
import {
  createSha256Digest,
  type IdentityAuditIntegrityInput,
  type IdentityAuditIntegrity,
} from "@stockcontrol/module-identity";

export const testAuditIntegrity: IdentityAuditIntegrity = Object.freeze({
  seal: (event: IdentityAuditIntegrityInput) =>
    Object.freeze({
      version: 1,
      keyId: "test-audit-key",
      eventHash: createSha256Digest(
        createHash("sha256")
          .update(event.id)
          .update(event.sequence.toString())
          .update(event.previousEventHash ?? new Uint8Array())
          .digest(),
      ),
    }),
});

export interface TransactionEvent {
  readonly kind: "begin" | "commit" | "rollback";
  readonly settings?: TransactionSettings;
}

export class RecordingDriver implements Driver {
  public readonly queries: CompiledQuery[] = [];
  public readonly transactions: TransactionEvent[] = [];
  private readonly results: QueryResult<unknown>[] = [];

  private readonly connection: DatabaseConnection = {
    executeQuery: <Result>(query: CompiledQuery): Promise<QueryResult<Result>> => {
      this.queries.push(query);
      const result = this.results.shift() ?? { rows: [] };
      return Promise.resolve(result as QueryResult<Result>);
    },
    streamQuery: async function* <Result>(): AsyncIterableIterator<QueryResult<Result>> {
      await Promise.resolve();
      yield { rows: [] };
    },
  };

  public enqueueRows(...rows: readonly unknown[][]): void {
    this.results.push(...rows.map((resultRows) => ({ rows: [...resultRows] })));
  }

  public enqueueAffectedRows(...counts: readonly bigint[]): void {
    this.results.push(...counts.map((numAffectedRows) => ({ numAffectedRows, rows: [] })));
  }

  public init(): Promise<void> {
    return Promise.resolve();
  }

  public acquireConnection(): Promise<DatabaseConnection> {
    return Promise.resolve(this.connection);
  }

  public beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    void connection;
    this.transactions.push({ kind: "begin", settings });
    return Promise.resolve();
  }

  public commitTransaction(connection: DatabaseConnection): Promise<void> {
    void connection;
    this.transactions.push({ kind: "commit" });
    return Promise.resolve();
  }

  public rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    void connection;
    this.transactions.push({ kind: "rollback" });
    return Promise.resolve();
  }

  public releaseConnection(connection: DatabaseConnection): Promise<void> {
    void connection;
    return Promise.resolve();
  }

  public destroy(): Promise<void> {
    return Promise.resolve();
  }
}

class RecordingPostgresDialect implements Dialect {
  public constructor(private readonly driver: RecordingDriver) {}

  public createAdapter(): PostgresAdapter {
    return new PostgresAdapter();
  }

  public createDriver(): Driver {
    return this.driver;
  }

  public createIntrospector(database: Kysely<unknown>): PostgresIntrospector {
    return new PostgresIntrospector(database);
  }

  public createQueryCompiler(): PostgresQueryCompiler {
    return new PostgresQueryCompiler();
  }
}

export const createRecordingDatabase = (): {
  readonly database: Kysely<StockControlDatabase>;
  readonly driver: RecordingDriver;
} => {
  const driver = new RecordingDriver();
  const database = new Kysely<StockControlDatabase>({
    dialect: new RecordingPostgresDialect(driver),
  });

  return { database, driver };
};
