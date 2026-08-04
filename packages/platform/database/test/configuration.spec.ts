import { describe, expect, it } from "vitest";

import {
  DatabaseConfigurationError,
  databaseRoleFromConnectionString,
  databaseRolesForMigration,
  databaseRolesForMigrationRole,
  loadMigrationDatabaseRoles,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
} from "../src/configuration";

describe("database configuration", () => {
  const runtimeUrl = "postgresql://runtime_role:secret@database:5432/stockcontrol";

  it("loads runtime and migrator connections from separate variables", () => {
    const environment = {
      DATABASE_CONNECTION_TIMEOUT_MS: "2500",
      DATABASE_MIGRATOR_URL: "postgresql://migration_role:secret@database:5432/stockcontrol",
      DATABASE_POOL_MAX: "7",
      DATABASE_URL: "postgresql://runtime_role:secret@database:5432/stockcontrol",
    };

    expect(loadRuntimeDatabaseConfiguration(environment)).toEqual({
      applicationName: "stockcontrol-api",
      connectionString: environment.DATABASE_URL,
      connectionTimeoutMilliseconds: 2_500,
      lockTimeoutMilliseconds: 5_000,
      maximumPoolSize: 7,
      statementTimeoutMilliseconds: 15_000,
    });
    expect(loadMigratorDatabaseConfiguration(environment)).toEqual({
      applicationName: "stockcontrol-migrator",
      connectionString: environment.DATABASE_MIGRATOR_URL,
      connectionTimeoutMilliseconds: 2_500,
      lockTimeoutMilliseconds: 10_000,
      maximumPoolSize: 1,
      statementTimeoutMilliseconds: 120_000,
    });
  });

  it("uses conservative defaults and trims environment values", () => {
    expect(
      loadRuntimeDatabaseConfiguration({
        DATABASE_CONNECTION_TIMEOUT_MS: " ",
        DATABASE_POOL_MAX: "",
        DATABASE_URL: `  ${runtimeUrl}  `,
      }),
    ).toEqual({
      applicationName: "stockcontrol-api",
      connectionString: runtimeUrl,
      connectionTimeoutMilliseconds: 5_000,
      lockTimeoutMilliseconds: 5_000,
      maximumPoolSize: 10,
      statementTimeoutMilliseconds: 15_000,
    });
  });

  it("rejects a missing connection URL without disclosing another URL", () => {
    expect(() => loadMigratorDatabaseConfiguration({ DATABASE_URL: runtimeUrl })).toThrow(
      new DatabaseConfigurationError("DATABASE_MIGRATOR_URL is required."),
    );
  });

  it.each([undefined, "", "   "])("rejects a missing runtime URL represented by %s", (value) => {
    expect(() => loadRuntimeDatabaseConfiguration({ DATABASE_URL: value })).toThrow(
      "DATABASE_URL is required.",
    );
  });

  it("rejects malformed connection URLs", () => {
    expect(() => loadRuntimeDatabaseConfiguration({ DATABASE_URL: "not a url" })).toThrow(
      "DATABASE_URL must be a valid PostgreSQL connection URL.",
    );
  });

  it("rejects non-PostgreSQL connection URLs", () => {
    expect(() =>
      loadRuntimeDatabaseConfiguration({
        DATABASE_URL: "mysql://runtime_role:secret@database:3306/stockcontrol",
      }),
    ).toThrow("DATABASE_URL must use the postgres or postgresql scheme.");
  });

  it("rejects a connection URL without a database role", () => {
    expect(() =>
      loadRuntimeDatabaseConfiguration({
        DATABASE_URL: "postgresql://database:5432/stockcontrol",
      }),
    ).toThrow("DATABASE_URL must include a database role.");
  });

  /*
   * A connection string is the one place a deployment can quietly stop being
   * private: repointing it at a managed provider's public proxy during an
   * incident puts the role's password on the open internet. Production is
   * therefore required to say plainly that it wants TLS, in the same way it is
   * required to state its public origin rather than have one inferred.
   */
  describe("transport security in production", () => {
    const production = { NODE_ENV: "production" };

    it.each([
      "postgresql://runtime_role:secret@postgres.railway.internal:5432/stockcontrol",
      "postgresql://runtime_role:secret@localhost:5432/stockcontrol",
      "postgresql://runtime_role:secret@127.0.0.1:5432/stockcontrol",
    ])("accepts the private host %s without an sslmode", (url) => {
      expect(() =>
        loadRuntimeDatabaseConfiguration({ ...production, DATABASE_URL: url }),
      ).not.toThrow();
    });

    it.each(["require", "verify-ca", "verify-full"])("accepts a public host with %s", (mode) => {
      expect(() =>
        loadRuntimeDatabaseConfiguration({
          ...production,
          DATABASE_URL: `postgresql://runtime_role:secret@db.example.com:5432/stockcontrol?sslmode=${mode}`,
        }),
      ).not.toThrow();
    });

    it.each([
      ["no sslmode at all", ""],
      ["sslmode=disable", "?sslmode=disable"],
      ["sslmode=prefer, which silently falls back", "?sslmode=prefer"],
      ["sslmode=allow, which silently falls back", "?sslmode=allow"],
    ])("rejects a public host with %s", (_description, query) => {
      expect(() =>
        loadRuntimeDatabaseConfiguration({
          ...production,
          DATABASE_URL: `postgresql://runtime_role:secret@db.example.com:5432/stockcontrol${query}`,
        }),
      ).toThrow(DatabaseConfigurationError);
    });

    it("holds the migrator to the same rule", () => {
      expect(() =>
        loadMigratorDatabaseConfiguration({
          ...production,
          DATABASE_MIGRATOR_URL:
            "postgresql://migration_role:secret@db.example.com:5432/stockcontrol",
        }),
      ).toThrow("DATABASE_MIGRATOR_URL reaches a public host");
    });

    it("leaves development and test free to use a plain local connection", () => {
      expect(() =>
        loadRuntimeDatabaseConfiguration({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://runtime_role:secret@db.example.com:5432/stockcontrol",
        }),
      ).not.toThrow();
    });
  });

  it.each(["0", "-1", "1.5", "many"])("rejects invalid pool size %s", (poolSize) => {
    expect(() =>
      loadRuntimeDatabaseConfiguration({
        DATABASE_POOL_MAX: poolSize,
        DATABASE_URL: runtimeUrl,
      }),
    ).toThrow("DATABASE_POOL_MAX must be a positive integer.");
  });

  it("rejects positive integers outside JavaScript's safe range", () => {
    expect(() =>
      loadRuntimeDatabaseConfiguration({
        DATABASE_POOL_MAX: "9007199254740992",
        DATABASE_URL: runtimeUrl,
      }),
    ).toThrow("DATABASE_POOL_MAX must be a safe positive integer.");
  });

  it("validates the shared connection timeout setting for the migrator", () => {
    expect(() =>
      loadMigratorDatabaseConfiguration({
        DATABASE_CONNECTION_TIMEOUT_MS: "0",
        DATABASE_MIGRATOR_URL: "postgresql://migration_role:secret@database:5432/stockcontrol",
      }),
    ).toThrow("DATABASE_CONNECTION_TIMEOUT_MS must be a positive integer.");
  });

  it("loads explicit bounded statement and lock timeouts", () => {
    const environment = {
      DATABASE_LOCK_TIMEOUT_MS: "250",
      DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "900",
      DATABASE_MIGRATION_STATEMENT_TIMEOUT_MS: "60000",
      DATABASE_MIGRATOR_URL: "postgresql://migration_role:secret@database/stockcontrol",
      DATABASE_STATEMENT_TIMEOUT_MS: "3000",
      DATABASE_URL: runtimeUrl,
    };

    expect(loadRuntimeDatabaseConfiguration(environment)).toMatchObject({
      lockTimeoutMilliseconds: 250,
      statementTimeoutMilliseconds: 3_000,
    });
    expect(loadMigratorDatabaseConfiguration(environment)).toMatchObject({
      lockTimeoutMilliseconds: 900,
      statementTimeoutMilliseconds: 60_000,
    });
  });

  it.each([
    ["DATABASE_LOCK_TIMEOUT_MS", "0"],
    ["DATABASE_STATEMENT_TIMEOUT_MS", "unbounded"],
    ["DATABASE_MIGRATION_LOCK_TIMEOUT_MS", "-1"],
    ["DATABASE_MIGRATION_STATEMENT_TIMEOUT_MS", "1.5"],
  ])("rejects an invalid %s", (name, value) => {
    expect(() =>
      name.startsWith("DATABASE_MIGRATION")
        ? loadMigratorDatabaseConfiguration({
            DATABASE_MIGRATOR_URL: "postgresql://migration_role:secret@database/stockcontrol",
            [name]: value,
          })
        : loadRuntimeDatabaseConfiguration({
            DATABASE_URL: runtimeUrl,
            [name]: value,
          }),
    ).toThrow(`${name} must be a positive integer.`);
  });

  it("extracts a percent-encoded runtime role", () => {
    expect(
      databaseRoleFromConnectionString(
        "postgresql://stockcontrol%2Dapp:secret@database:5432/stockcontrol",
      ),
    ).toBe("stockcontrol-app");
  });

  it("rejects a runtime role with malformed percent encoding", () => {
    expect(() =>
      databaseRoleFromConnectionString("postgresql://%E0%A4%A:secret@database:5432/stockcontrol"),
    ).toThrow("DATABASE_URL must contain a valid percent-encoded database role.");
  });

  it("rejects a percent-encoded whitespace-only runtime role", () => {
    expect(() =>
      databaseRoleFromConnectionString("postgresql://%20%20:secret@database:5432/stockcontrol"),
    ).toThrow("DATABASE_URL must include a database role.");
  });

  it("returns decoded, distinct migration and runtime roles", () => {
    expect(
      databaseRolesForMigration(
        "postgresql://stockcontrol%2Dmigrator:secret@database/stockcontrol",
        "postgresql://stockcontrol%2Dapp:secret@database/stockcontrol",
      ),
    ).toEqual({
      migratorRole: "stockcontrol-migrator",
      runtimeRole: "stockcontrol-app",
    });
  });

  it("rejects using the privileged migrator role as the runtime role", () => {
    expect(() =>
      databaseRolesForMigration(
        "postgresql://stockcontrol%2Dapp:migrator-secret@database/stockcontrol",
        "postgresql://stockcontrol-app:runtime-secret@database/stockcontrol",
      ),
    ).toThrow("DATABASE_MIGRATOR_URL and DATABASE_URL must use distinct database roles.");
  });

  it("labels malformed migrator role encoding without disclosing either URL", () => {
    expect(() =>
      databaseRolesForMigration("postgresql://%E0%A4%A:secret@database/stockcontrol", runtimeUrl),
    ).toThrow("DATABASE_MIGRATOR_URL must contain a valid percent-encoded database role.");
  });

  it("loads the runtime role for migrations without requiring its password or URL", () => {
    const migratorUrl = "postgresql://migration_role:secret@database/stockcontrol";

    expect(
      loadMigrationDatabaseRoles({ DATABASE_RUNTIME_ROLE: "stockcontrol-app" }, migratorUrl),
    ).toEqual({
      migratorRole: "migration_role",
      runtimeRole: "stockcontrol-app",
    });
  });

  it.each(["", "9invalid", "contains space", "x".repeat(64)])(
    "rejects invalid explicit migration runtime role %j",
    (role) => {
      expect(() =>
        databaseRolesForMigrationRole(
          "postgresql://migration_role:secret@database/stockcontrol",
          role,
        ),
      ).toThrow("DATABASE_RUNTIME_ROLE must be a valid database role");
    },
  );

  it("rejects an explicit runtime role equal to the migrator role", () => {
    expect(() =>
      databaseRolesForMigrationRole(
        "postgresql://migration_role:secret@database/stockcontrol",
        "migration_role",
      ),
    ).toThrow(
      "DATABASE_MIGRATOR_URL and DATABASE_RUNTIME_ROLE must identify distinct database roles.",
    );
  });

  it("requires the explicit migration runtime role without consulting DATABASE_URL", () => {
    expect(() =>
      loadMigrationDatabaseRoles(
        {
          DATABASE_URL: "postgresql://runtime:password-must-not-be-needed@database/stockcontrol",
        },
        "postgresql://migration_role:migrator-secret@database/stockcontrol",
      ),
    ).toThrow("DATABASE_RUNTIME_ROLE is required.");
  });
});
