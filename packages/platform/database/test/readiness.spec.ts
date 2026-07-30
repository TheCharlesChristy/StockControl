import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { PostgresReadinessCheck } from "../src/readiness";
import { STOCKCONTROL_SCHEMA, type StockControlDatabase } from "../src/schema";

interface ReadinessDatabaseFake {
  readonly database: Kysely<StockControlDatabase>;
  readonly executeTakeFirst: ReturnType<typeof vi.fn>;
  readonly limit: ReturnType<typeof vi.fn>;
  readonly select: ReturnType<typeof vi.fn>;
  readonly selectFrom: ReturnType<typeof vi.fn>;
  readonly withSchema: ReturnType<typeof vi.fn>;
}

const createDatabase = (outcome: "error" | "ok"): ReadinessDatabaseFake => {
  const executeTakeFirst =
    outcome === "ok"
      ? vi.fn().mockResolvedValue({ key: "foundation" })
      : vi.fn().mockRejectedValue(new Error("connection details must not escape"));
  const limit = vi.fn(() => ({ executeTakeFirst }));
  const select = vi.fn(() => ({ limit }));
  const selectFrom = vi.fn(() => ({ select }));
  const withSchema = vi.fn(() => ({ selectFrom }));

  return {
    database: { withSchema } as unknown as Kysely<StockControlDatabase>,
    executeTakeFirst,
    limit,
    select,
    selectFrom,
    withSchema,
  };
};

describe("PostgresReadinessCheck", () => {
  it("reports ready after a minimal query against migrated metadata", async () => {
    const fake = createDatabase("ok");
    const check = new PostgresReadinessCheck(fake.database);

    await expect(check.check()).resolves.toEqual({
      name: "database.postgresql",
      status: "ok",
    });
    expect(check.name).toBe("database.postgresql");
    expect(fake.withSchema).toHaveBeenCalledWith(STOCKCONTROL_SCHEMA);
    expect(fake.selectFrom).toHaveBeenCalledWith("system_metadata");
    expect(fake.select).toHaveBeenCalledWith("key");
    expect(fake.limit).toHaveBeenCalledWith(1);
    expect(fake.executeTakeFirst).toHaveBeenCalledOnce();
  });

  it("reports a stable, non-sensitive error when PostgreSQL is unavailable", async () => {
    const fake = createDatabase("error");

    const result = await new PostgresReadinessCheck(fake.database).check();

    expect(result).toEqual({
      detail: "PostgreSQL is unavailable or migrations are incomplete.",
      name: "database.postgresql",
      status: "error",
    });
    expect(JSON.stringify(result)).not.toContain("connection details");
  });
});
