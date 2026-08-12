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

import { loadVisualIndex } from "../src/recognition/visual-index-store";

/** Encodes a JS number as an IEEE-754 half-precision little-endian buffer,
 * mirroring what numpy's float16 `.tobytes()` produces — used only to build
 * fixtures, never in the module under test. */
const encodeFloat16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  const sign = value < 0 ? 1 : 0;
  const absolute = Math.abs(value);

  if (absolute === 0) {
    buffer.writeUInt16LE(sign << 15, 0);
    return buffer;
  }

  const exponent = Math.floor(Math.log2(absolute));
  const normalisedExponent = exponent + 15;
  const fraction = Math.round((absolute / 2 ** exponent - 1) * 1024);
  buffer.writeUInt16LE((sign << 15) | (normalisedExponent << 10) | (fraction & 0x3ff), 0);
  return buffer;
};

const encodeVector = (values: readonly number[]): Buffer =>
  Buffer.concat(values.map(encodeFloat16));

describe.sequential("visual index loading", () => {
  let migrator: Kysely<StockControlDatabase>;
  let database: Kysely<StockControlDatabase>;
  const createdItemIds: string[] = [];
  const createdUserIds: string[] = [];

  const insertUser = async (): Promise<string> => {
    const id = randomUUID();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("users")
      .values({
        id,
        email: `${id}@example.invalid`,
        display_name: "Visual Index Test User",
        role: "Office",
        password_hash: "not-a-real-hash",
      })
      .execute();
    createdUserIds.push(id);
    return id;
  };

  const insertItem = async (isActive = true): Promise<string> => {
    const id = randomUUID();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("items")
      .values({
        id,
        reference: `VIS-${randomUUID()}`,
        name: "Visual Index Test Item",
        unit: "each",
        is_active: isActive,
      })
      .execute();
    createdItemIds.push(id);
    return id;
  };

  const insertExample = async (input: {
    readonly itemId: string;
    readonly userId: string;
    readonly vector: readonly number[];
    readonly embeddingModel?: string;
    readonly retired?: boolean;
  }): Promise<void> => {
    const buffer = encodeVector(input.vector);

    await database
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("item_visual_examples")
      .values({
        id: randomUUID(),
        item_id: input.itemId,
        embedding: buffer,
        embedding_model: input.embeddingModel ?? "synthetic-visual-revision-a",
        verified_by_user_id: input.userId,
        quality_score: 0.9,
        ...(input.retired === true ? { retired_at: new Date() } : {}),
      })
      .execute();
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
    if (createdItemIds.length > 0) {
      await database
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("item_visual_examples")
        .where("item_id", "in", createdItemIds)
        .execute();
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("items")
        .where("id", "in", createdItemIds)
        .execute();
      createdItemIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await migrator
        .withSchema(STOCKCONTROL_SCHEMA)
        .deleteFrom("users")
        .where("id", "in", createdUserIds)
        .execute();
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await database.destroy();
    await migrator.destroy();
  });

  it("loads a confirmed exemplar for the matching model revision", async () => {
    const userId = await insertUser();
    const itemId = await insertItem();
    await insertExample({ itemId, userId, vector: [1, 0, 0, 0] });

    const index = await loadVisualIndex(database, "synthetic-visual-revision-a");

    expect(index.some((entry) => entry.itemId === itemId)).toBe(true);
    const loaded = index.find((entry) => entry.itemId === itemId);
    expect(loaded?.vector[0]).toBeCloseTo(1, 3);
  });

  it("excludes exemplars from a different model revision", async () => {
    const userId = await insertUser();
    const itemId = await insertItem();
    await insertExample({ itemId, userId, vector: [1, 0], embeddingModel: "old-model-v0" });

    const index = await loadVisualIndex(database, "synthetic-visual-revision-a");

    expect(index.some((entry) => entry.itemId === itemId)).toBe(false);
  });

  it("excludes retired exemplars", async () => {
    const userId = await insertUser();
    const itemId = await insertItem();
    await insertExample({ itemId, userId, vector: [1, 0], retired: true });

    const index = await loadVisualIndex(database, "synthetic-visual-revision-a");

    expect(index.some((entry) => entry.itemId === itemId)).toBe(false);
  });

  it("excludes exemplars belonging to an archived item", async () => {
    const userId = await insertUser();
    const itemId = await insertItem(false);
    await insertExample({ itemId, userId, vector: [1, 0] });

    const index = await loadVisualIndex(database, "synthetic-visual-revision-a");

    expect(index.some((entry) => entry.itemId === itemId)).toBe(false);
  });
});
