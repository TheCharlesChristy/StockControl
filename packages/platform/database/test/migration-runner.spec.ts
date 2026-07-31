import type { Kysely } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StockControlDatabase } from "../src/schema";

const runnerMocks = vi.hoisted(() => {
  const constructedMigrators: unknown[] = [];
  const migrateToLatest = vi.fn();
  const queries: Array<{
    readonly execute: ReturnType<typeof vi.fn>;
    readonly parameters: unknown[];
    readonly strings: string[];
  }> = [];
  const identifiers: string[][] = [];
  const rawFragments: string[] = [];
  const sqlTag = Object.assign(
    (strings: TemplateStringsArray, ...parameters: unknown[]) => {
      const query = {
        execute: vi.fn().mockResolvedValue(undefined),
        parameters,
        strings: [...strings],
      };
      queries.push(query);
      return query;
    },
    {
      id: vi.fn((...identifier: string[]) => {
        identifiers.push(identifier);
        return { identifier };
      }),
      raw: vi.fn((value: string) => {
        rawFragments.push(value);
        return { raw: value };
      }),
    },
  );

  return {
    constructedMigrators,
    identifiers,
    migrateToLatest,
    queries,
    rawFragments,
    sqlTag,
  };
});

vi.mock("kysely", () => ({
  Migrator: class MockMigrator {
    public constructor(public readonly options: unknown) {
      runnerMocks.constructedMigrators.push(this);
    }

    public migrateToLatest(): Promise<unknown> {
      return runnerMocks.migrateToLatest();
    }
  },
  sql: runnerMocks.sqlTag,
}));

import {
  DatabaseMigrationError,
  MigrationIntegrityError,
  RUNTIME_TABLE_PRIVILEGES,
  runMigrations,
  validateMigrationIntegrity,
} from "../src/migrations/runner";
import {
  MIGRATION_INTEGRITY_MANIFEST,
  StockControlMigrationProvider,
} from "../src/migrations/provider";

interface IntegrityState {
  applied: string[];
  integrity: Array<{
    checksum: string;
    migration_name: string;
    migration_version: number;
  }>;
  integrityTableExists: boolean;
  migrationTableExists: boolean;
}

const descriptorRecord = (
  name: keyof typeof MIGRATION_INTEGRITY_MANIFEST,
): IntegrityState["integrity"][number] => {
  const descriptor = MIGRATION_INTEGRITY_MANIFEST[name];
  return {
    checksum: descriptor.checksum,
    migration_name: descriptor.name,
    migration_version: descriptor.version,
  };
};

const completeState = (): IntegrityState => ({
  applied: ["0001_foundation"],
  integrity: [descriptorRecord("0001_foundation")],
  integrityTableExists: true,
  migrationTableExists: true,
});

const createDatabase = (
  state: IntegrityState,
): {
  readonly database: Kysely<StockControlDatabase>;
  readonly getTables: ReturnType<typeof vi.fn>;
} => {
  const executeApplied = vi.fn(() => Promise.resolve(state.applied.map((name) => ({ name }))));
  const executeIntegrity = vi.fn(() => Promise.resolve([...state.integrity]));
  const orderedApplied = {
    orderBy: vi.fn(),
    execute: executeApplied,
  };
  orderedApplied.orderBy.mockReturnValue(orderedApplied);
  const orderedIntegrity = {
    orderBy: vi.fn(),
    execute: executeIntegrity,
  };
  orderedIntegrity.orderBy.mockReturnValue(orderedIntegrity);
  const metadataSelect = vi.fn(() => orderedApplied);
  const metadataSelectFrom = vi.fn(() => ({ select: metadataSelect }));
  const integritySelect = vi.fn(() => orderedIntegrity);
  const integritySelectFrom = vi.fn(() => ({ select: integritySelect }));
  const withSchema = vi.fn(() => ({ selectFrom: integritySelectFrom }));
  const getTables = vi.fn(() =>
    Promise.resolve([
      ...(state.migrationTableExists ? [{ name: "stockcontrol_migration", schema: "public" }] : []),
      ...(state.integrityTableExists
        ? [{ name: "migration_integrity", schema: "stockcontrol" }]
        : []),
    ]),
  );

  return {
    database: {
      introspection: { getTables },
      selectFrom: metadataSelectFrom,
      withSchema,
    } as unknown as Kysely<StockControlDatabase>,
    getTables,
  };
};

describe("migration integrity validation", () => {
  it("accepts a pristine database and a fully checksummed database", async () => {
    await expect(
      validateMigrationIntegrity(
        createDatabase({
          applied: [],
          integrity: [],
          integrityTableExists: false,
          migrationTableExists: false,
        }).database,
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateMigrationIntegrity(createDatabase(completeState()).database),
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      code: "IntegrityTableMissing",
      mutate: (state: IntegrityState) => {
        state.integrityTableExists = false;
        state.integrity = [];
      },
    },
    {
      code: "ChecksumMissing",
      mutate: (state: IntegrityState) => {
        state.integrity.pop();
      },
    },
    {
      code: "ChecksumMismatch",
      mutate: (state: IntegrityState) => {
        const record = state.integrity[0];
        if (record !== undefined) {
          record.checksum = "0".repeat(64);
        }
      },
    },
    {
      code: "UnknownAppliedMigration",
      mutate: (state: IntegrityState) => {
        state.applied.push("9999_unknown");
        state.integrity.push({
          checksum: "0".repeat(64),
          migration_name: "9999_unknown",
          migration_version: 1,
        });
      },
    },
    {
      code: "UnexpectedChecksum",
      mutate: (state: IntegrityState) => {
        state.integrity.push({
          checksum: "0".repeat(64),
          migration_name: "0003_not_applied",
          migration_version: 1,
        });
      },
    },
  ] as const)("fails closed with $code", async ({ code, mutate }) => {
    const state = completeState();
    mutate(state);

    await expect(validateMigrationIntegrity(createDatabase(state).database)).rejects.toMatchObject({
      code,
      name: "MigrationIntegrityError",
    });
  });
});

describe("runMigrations", () => {
  beforeEach(() => {
    runnerMocks.constructedMigrators.length = 0;
    runnerMocks.identifiers.length = 0;
    runnerMocks.queries.length = 0;
    runnerMocks.rawFragments.length = 0;
    runnerMocks.migrateToLatest.mockReset();
    runnerMocks.sqlTag.id.mockClear();
    runnerMocks.sqlTag.raw.mockClear();
  });

  it("installs the foundation migration, validates it, and grants the minimum registry", async () => {
    const state: IntegrityState = {
      applied: [],
      integrity: [],
      integrityTableExists: false,
      migrationTableExists: false,
    };
    const fake = createDatabase(state);
    const results = [
      {
        direction: "Up",
        migrationName: "0001_foundation",
        status: "Success",
      },
    ];
    runnerMocks.migrateToLatest.mockImplementation(() => {
      Object.assign(state, completeState());
      return Promise.resolve({ results });
    });

    await expect(
      runMigrations(fake.database, { runtimeRole: "stockcontrol_app" }),
    ).resolves.toEqual({ results });

    expect(fake.getTables).toHaveBeenCalledTimes(2);
    expect(runnerMocks.constructedMigrators[0]).toMatchObject({
      options: {
        db: fake.database,
        migrationLockTableName: "stockcontrol_migration_lock",
        migrationTableName: "stockcontrol_migration",
        provider: expect.any(StockControlMigrationProvider),
      },
    });

    const nonEmptyPrivilegeEntries = Object.values(RUNTIME_TABLE_PRIVILEGES).filter(
      (privileges) => privileges.length > 0,
    );
    expect(runnerMocks.queries).toHaveLength(6 + nonEmptyPrivilegeEntries.length);
    expect(runnerMocks.rawFragments).not.toContain("");
    expect(runnerMocks.identifiers).not.toContainEqual(["stockcontrol", "migration_integrity"]);

    const metadataPrivilegeIndex = Object.keys(RUNTIME_TABLE_PRIVILEGES)
      .filter(
        (table) =>
          RUNTIME_TABLE_PRIVILEGES[table as keyof typeof RUNTIME_TABLE_PRIVILEGES].length > 0,
      )
      .indexOf("system_metadata");
    const metadataGrant = runnerMocks.queries[6 + metadataPrivilegeIndex];
    expect(metadataGrant?.parameters).toEqual([
      { raw: "select, insert, update, delete" },
      { identifier: ["stockcontrol", "system_metadata"] },
      { identifier: ["stockcontrol_app"] },
    ]);

    const defaultPrivilegeQueries = runnerMocks.queries
      .map(({ strings }) => strings.join(" "))
      .filter((statement) => statement.includes("alter default privileges"));
    expect(defaultPrivilegeQueries).toHaveLength(2);
    expect(defaultPrivilegeQueries.every((statement) => statement.includes("revoke"))).toBe(true);
    expect(defaultPrivilegeQueries.every((statement) => !statement.includes("grant"))).toBe(true);
  });

  it("returns an empty result list on a safe rerun", async () => {
    const fake = createDatabase(completeState());
    runnerMocks.migrateToLatest.mockResolvedValue({});

    await expect(
      runMigrations(fake.database, { runtimeRole: "stockcontrol_app" }),
    ).resolves.toEqual({ results: [] });
  });

  it("exposes only migration coordinates and SQLSTATE on a migration failure", async () => {
    const fake = createDatabase(completeState());
    const cause = Object.assign(new Error("postgresql://role:password@database/stockcontrol"), {
      code: "42P01",
    });
    runnerMocks.migrateToLatest.mockResolvedValue({
      error: cause,
      results: [
        {
          direction: "Up",
          error: cause,
          migrationName: "0002_example",
          status: "Error",
        },
      ],
    });

    const operation = runMigrations(fake.database, {
      runtimeRole: "stockcontrol_app",
    });

    await expect(operation).rejects.toEqual(
      expect.objectContaining({
        cause,
        message: "PostgreSQL migrations failed.",
        name: "DatabaseMigrationError",
        results: [
          {
            direction: "Up",
            migrationName: "0002_example",
            status: "Error",
          },
        ],
        sqlState: "42P01",
      }),
    );
    expect(runnerMocks.queries).toHaveLength(0);
  });

  it("reads a nested safe SQLSTATE and ignores an unsafe error code", async () => {
    const fake = createDatabase(completeState());
    runnerMocks.migrateToLatest.mockResolvedValueOnce({
      error: { cause: { code: "23505" } },
    });

    await expect(
      runMigrations(fake.database, { runtimeRole: "stockcontrol_app" }),
    ).rejects.toMatchObject({ sqlState: "23505" });

    runnerMocks.migrateToLatest.mockResolvedValueOnce({
      error: { code: "password leaked" },
    });
    const second = runMigrations(fake.database, {
      runtimeRole: "stockcontrol_app",
    });
    await expect(second).rejects.toMatchObject({
      name: "DatabaseMigrationError",
      sqlState: undefined,
    });
  });

  it("refuses invalid integrity before migration or grants", async () => {
    const state = completeState();
    state.integrity[0] = {
      ...state.integrity[0]!,
      checksum: "f".repeat(64),
    };

    await expect(
      runMigrations(createDatabase(state).database, {
        runtimeRole: "stockcontrol_app",
      }),
    ).rejects.toBeInstanceOf(MigrationIntegrityError);
    expect(runnerMocks.migrateToLatest).not.toHaveBeenCalled();
    expect(runnerMocks.queries).toHaveLength(0);
  });

  it.each(["", " \t "])("rejects an empty runtime role %j before database access", async (role) => {
    const fake = createDatabase(completeState());

    await expect(runMigrations(fake.database, { runtimeRole: role })).rejects.toEqual(
      new DatabaseMigrationError("The runtime database role cannot be empty.", undefined),
    );
    expect(fake.getTables).not.toHaveBeenCalled();
    expect(runnerMocks.migrateToLatest).not.toHaveBeenCalled();
  });
});
