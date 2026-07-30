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
  foundationMigration,
  foundationMigrationDefinition,
  foundationMigrationIntegrity,
} from "../src/migrations/0001-foundation";

describe("foundation migration", () => {
  const database = { name: "foundation-test" } as unknown as Kysely<unknown>;

  beforeEach(() => {
    rawSql.executions.length = 0;
    rawSql.raw.mockClear();
  });

  it("uses canonical schema, integrity and metadata statements", () => {
    expect(foundationMigrationDefinition).toMatchObject({
      name: "0001_foundation",
      version: 1,
    });
    expect(foundationMigrationDefinition.upStatements).toHaveLength(3);
    expect(foundationMigrationDefinition.upStatements.join("\n")).toContain(
      "create schema if not exists stockcontrol",
    );
    expect(foundationMigrationDefinition.upStatements.join("\n")).toContain(
      "create table stockcontrol.migration_integrity",
    );
    expect(foundationMigrationDefinition.upStatements.join("\n")).toContain(
      "create table stockcontrol.system_metadata",
    );
    expect(foundationMigrationIntegrity).toEqual({
      name: "0001_foundation",
      version: 1,
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("executes every canonical up statement then records its checksum", async () => {
    await foundationMigration.up(database);

    expect(rawSql.executions.map(({ statement }) => statement)).toEqual([
      ...foundationMigrationDefinition.upStatements,
      expect.stringContaining(
        `values ('0001_foundation', 1, '${foundationMigrationIntegrity.checksum}')`,
      ),
    ]);
    for (const query of rawSql.executions) {
      expect(query.execute).toHaveBeenCalledWith(database);
    }
  });

  it("removes the integrity record before explicitly dropping the schema", async () => {
    if (foundationMigration.down === undefined) {
      throw new Error("The foundation migration must remain reversible.");
    }

    await foundationMigration.down(database);

    expect(rawSql.executions.map(({ statement }) => statement)).toEqual([
      "delete from stockcontrol.migration_integrity where migration_name = '0001_foundation'",
      ...foundationMigrationDefinition.downStatements,
    ]);
  });
});
