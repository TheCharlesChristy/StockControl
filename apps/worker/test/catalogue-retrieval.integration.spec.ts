import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createMigratorDatabase,
  createRuntimeDatabase,
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadWorkerDatabaseConfiguration,
  runMigrations,
  STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";

import { queryCatalogue } from "../src/recognition/catalogue-retrieval";

describe.sequential("catalogue retrieval", () => {
  let migrator: Kysely<StockControlDatabase>;
  let database: Kysely<StockControlDatabase>;
  const createdItemIds: string[] = [];

  // The worker's runtime role is deliberately read-only on items — catalogue
  // mutation is the API's job, gated by manageCatalogue. Test fixtures go
  // through the migrator connection, which has full privileges, rather than
  // proving anything about the (intentionally absent) write path.
  const insertItem = async (input: {
    readonly reference: string;
    readonly name: string;
    readonly barcode?: string | null;
    readonly partNumber?: string | null;
    readonly isActive?: boolean;
  }): Promise<string> => {
    const id = randomUUID();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("items")
      .values({
        id,
        reference: input.reference,
        name: input.name,
        unit: "each",
        barcode: input.barcode ?? null,
        part_number: input.partNumber ?? null,
        ...(input.isActive === undefined ? {} : { is_active: input.isActive }),
      })
      .execute();
    createdItemIds.push(id);
    return id;
  };

  beforeAll(async () => {
    const workerConfiguration = loadWorkerDatabaseConfiguration();
    migrator = createMigratorDatabase(loadMigratorDatabaseConfiguration());
    await runMigrations(migrator, {
      runtimeRole: databaseRoleFromConnectionString(workerConfiguration.connectionString),
    });
    database = createRuntimeDatabase(workerConfiguration);
  });

  afterEach(async () => {
    if (createdItemIds.length === 0) return;
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("items")
      .where("id", "in", createdItemIds)
      .execute();
    createdItemIds.length = 0;
  });

  afterAll(async () => {
    await database.destroy();
    await migrator.destroy();
  });

  it("matches an exact barcode", async () => {
    const itemId = await insertItem({
      reference: `CAT-${randomUUID()}`,
      name: "Test Barcode Item",
      barcode: "5012345678900",
    });

    const matches = await queryCatalogue(database, {
      barcodeLikeCandidates: ["5012345678900"],
      partNumberCandidates: [],
      nameFragments: [],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.itemId).toBe(itemId);
    expect(matches[0]?.matchedBy).toBe("Barcode");
  });

  it("matches an exact reference", async () => {
    const reference = `CAT-${randomUUID()}`;
    const itemId = await insertItem({ reference, name: "Test Reference Item" });

    const matches = await queryCatalogue(database, {
      barcodeLikeCandidates: [reference],
      partNumberCandidates: [],
      nameFragments: [],
    });

    expect(matches.map((match) => match.itemId)).toContain(itemId);
  });

  it("matches an exact part number, case-insensitively", async () => {
    const itemId = await insertItem({
      reference: `CAT-${randomUUID()}`,
      name: "Test Part Item",
      partNumber: "RS-1234A",
    });

    const matches = await queryCatalogue(database, {
      barcodeLikeCandidates: [],
      partNumberCandidates: ["rs-1234a"],
      nameFragments: [],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.itemId).toBe(itemId);
    expect(matches[0]?.matchedBy).toBe("PartNumber");
  });

  it("matches a name fragment", async () => {
    const unique = randomUUID().slice(0, 8);
    const itemId = await insertItem({
      reference: `CAT-${randomUUID()}`,
      name: `Heavy Duty Widget ${unique}`,
    });

    const matches = await queryCatalogue(database, {
      barcodeLikeCandidates: [],
      partNumberCandidates: [],
      nameFragments: [`Widget ${unique}`],
    });

    expect(matches.map((match) => match.itemId)).toContain(itemId);
    expect(matches.find((match) => match.itemId === itemId)?.matchedBy).toBe("Name");
  });

  it("returns an archived match rather than hiding it", async () => {
    const itemId = await insertItem({
      reference: `CAT-${randomUUID()}`,
      name: "Archived Item",
      barcode: "9999999999999",
      isActive: false,
    });

    const matches = await queryCatalogue(database, {
      barcodeLikeCandidates: ["9999999999999"],
      partNumberCandidates: [],
      nameFragments: [],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.itemId).toBe(itemId);
    expect(matches[0]?.isActive).toBe(false);
  });

  it("does not duplicate an item matched by more than one field", async () => {
    const itemId = await insertItem({
      reference: `CAT-${randomUUID()}`,
      name: "Double Match Item",
      barcode: "1111111111111",
      partNumber: "DM-1111",
    });

    const matches = await queryCatalogue(database, {
      barcodeLikeCandidates: ["1111111111111"],
      partNumberCandidates: ["DM-1111"],
      nameFragments: [],
    });

    expect(matches.filter((match) => match.itemId === itemId)).toHaveLength(1);
    expect(matches.find((match) => match.itemId === itemId)?.matchedBy).toBe("Barcode");
  });

  it("returns nothing for candidates that match no item", async () => {
    const matches = await queryCatalogue(database, {
      barcodeLikeCandidates: ["0000000000000"],
      partNumberCandidates: ["NO-SUCH-PART"],
      nameFragments: ["NoSuchNameFragmentAtAll"],
    });

    expect(matches).toEqual([]);
  });

  it("ignores empty query inputs without querying", async () => {
    const matches = await queryCatalogue(database, {
      barcodeLikeCandidates: [],
      partNumberCandidates: [],
      nameFragments: [],
    });

    expect(matches).toEqual([]);
  });
});
