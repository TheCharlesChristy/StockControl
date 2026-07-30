import { describe, expect, it } from "vitest";

import {
  MIGRATION_INTEGRITY_MANIFEST,
  MIGRATION_NAMES,
  StockControlMigrationProvider,
} from "../src/migrations/provider";

describe("StockControlMigrationProvider", () => {
  it("returns an explicit, deterministic migration order", async () => {
    const migrations = await new StockControlMigrationProvider().getMigrations();

    expect(Object.keys(migrations)).toEqual(MIGRATION_NAMES);
  });

  it("returns a fresh migration map so callers cannot mutate the provider", async () => {
    const provider = new StockControlMigrationProvider();
    const first = await provider.getMigrations();

    delete first["0001_foundation"];

    await expect(provider.getMigrations()).resolves.toHaveProperty("0001_foundation");
  });

  it("publishes one immutable SHA-256 integrity descriptor per migration", () => {
    expect(Object.keys(MIGRATION_INTEGRITY_MANIFEST)).toEqual(MIGRATION_NAMES);

    for (const [name, descriptor] of Object.entries(MIGRATION_INTEGRITY_MANIFEST)) {
      expect(descriptor).toEqual({
        name,
        version: Number(name.slice(0, 4)),
        checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    }
  });

  it("numbers migrations from one, in order, with no gaps", () => {
    expect(MIGRATION_NAMES.map((name) => Number(name.slice(0, 4)))).toEqual(
      MIGRATION_NAMES.map((_, index) => index + 1),
    );
  });

  it("gives every migration a distinct checksum", () => {
    const checksums = Object.values(MIGRATION_INTEGRITY_MANIFEST).map(({ checksum }) => checksum);

    expect(new Set(checksums).size).toBe(checksums.length);
  });
});
