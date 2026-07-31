import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rawSql = vi.hoisted(() => {
  const executions: Array<{
    readonly statement: string;
    readonly execute: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    executions,
    raw: vi.fn((statement: string) => {
      const query = {
        statement,
        execute: vi.fn().mockResolvedValue(undefined),
      };
      executions.push(query);
      return query;
    }),
  };
});

vi.mock("kysely", () => ({
  sql: {
    raw: rawSql.raw,
  },
}));

import {
  stockMigration,
  stockMigrationDefinition,
  stockMigrationIntegrity,
} from "../src/migrations/0002-stock";

describe("stock migration", () => {
  const database = { name: "stock-test" } as unknown as Kysely<unknown>;
  const upSql = stockMigrationDefinition.upStatements.join("\n");

  beforeEach(() => {
    rawSql.executions.length = 0;
    rawSql.raw.mockClear();
  });

  it("is the second canonical migration with a recorded checksum", () => {
    expect(stockMigrationDefinition).toMatchObject({
      name: "0002_stock",
      version: 2,
    });
    expect(stockMigrationIntegrity).toEqual({
      name: "0002_stock",
      version: 2,
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it.each([
    "users",
    "sessions",
    "jobs",
    "locations",
    "items",
    "stock_levels",
    "reservations",
    "transactions",
  ])("creates the %s table", (table) => {
    expect(upSql).toContain(`create table stockcontrol.${table} (`);
  });

  it("prevents a stock level from going negative in the database as well as the application", () => {
    expect(upSql).toContain("constraint stock_levels_quantity_not_negative check (quantity >= 0)");
  });

  it("holds one stock level per item and location", () => {
    expect(upSql).toContain(
      "create unique index stock_levels_item_location_key on stockcontrol.stock_levels (item_id, location_id)",
    );
  });

  it("keeps collected quantity within the reserved quantity", () => {
    expect(upSql).toContain("check (quantity_collected <= quantity_reserved)".replace(/\s+/g, " "));
  });

  it("ties exactly one job-site location to each job", () => {
    expect(upSql).toContain(
      "constraint locations_job_site_has_job check ((kind = 'JobSite') = (job_id is not null))",
    );
    expect(upSql).toContain(
      "create unique index locations_job_id_key on stockcontrol.locations (job_id) where job_id is not null",
    );
  });

  it("records every transaction kind the demo supports", () => {
    for (const kind of [
      "Receive",
      "Issue",
      "Transfer",
      "Adjust",
      "Reserve",
      "Collect",
      "Release",
    ]) {
      expect(upSql).toContain(`'${kind}'`);
    }
  });

  it("never creates a rule or trigger that silently discards a transaction write", () => {
    expect(upSql).not.toContain("do instead nothing");
  });

  it("executes every canonical up statement then records its checksum", async () => {
    await stockMigration.up(database);

    expect(rawSql.executions.map(({ statement }) => statement)).toEqual([
      ...stockMigrationDefinition.upStatements,
      expect.stringContaining(`values ('0002_stock', 2, '${stockMigrationIntegrity.checksum}')`),
    ]);
    for (const query of rawSql.executions) {
      expect(query.execute).toHaveBeenCalledWith(database);
    }
  });

  it("drops its tables in dependency order after removing the integrity record", async () => {
    if (stockMigration.down === undefined) {
      throw new Error("The stock migration must remain reversible.");
    }

    await stockMigration.down(database);

    expect(rawSql.executions.map(({ statement }) => statement)).toEqual([
      "delete from stockcontrol.migration_integrity where migration_name = '0002_stock'",
      ...stockMigrationDefinition.downStatements,
    ]);
    expect(stockMigrationDefinition.downStatements[0]).toContain("transactions");
    expect(stockMigrationDefinition.downStatements.at(-1)).toContain("users");
  });
});
