import { describe, expect, it } from "vitest";

import {
  DatabaseRoleBootstrapConfigurationError,
  loadDatabaseRoleBootstrapConfiguration,
} from "../src/role-bootstrap";

const migratorPassword = "m".repeat(32);
const runtimePassword = "r".repeat(32);

const validEnvironment = {
  DATABASE_ADMIN_URL: "postgresql://railway_admin:admin-secret@postgres.internal:5432/railway",
  DATABASE_MIGRATOR_URL: `postgresql://stockcontrol_migrator:${migratorPassword}@postgres.internal:5432/railway`,
  DATABASE_URL: `postgresql://stockcontrol_app:${runtimePassword}@postgres.internal:5432/railway`,
};

describe("database role bootstrap configuration", () => {
  it("derives the deployed database, endpoint, roles and passwords from the three URLs", () => {
    expect(loadDatabaseRoleBootstrapConfiguration(validEnvironment)).toEqual({
      adminConnection: {
        applicationName: "stockcontrol-role-bootstrap",
        connectionString: validEnvironment.DATABASE_ADMIN_URL,
        connectionTimeoutMilliseconds: 5_000,
        lockTimeoutMilliseconds: 10_000,
        maximumPoolSize: 1,
        statementTimeoutMilliseconds: 30_000,
      },
      adminRole: "railway_admin",
      databaseName: "railway",
      migratorConnection: {
        applicationName: "stockcontrol-role-bootstrap-migrator-check",
        connectionString: validEnvironment.DATABASE_MIGRATOR_URL,
        connectionTimeoutMilliseconds: 5_000,
        lockTimeoutMilliseconds: 10_000,
        maximumPoolSize: 1,
        statementTimeoutMilliseconds: 30_000,
      },
      migratorPassword,
      migratorRole: "stockcontrol_migrator",
      runtimeConnection: {
        applicationName: "stockcontrol-role-bootstrap-runtime-check",
        connectionString: validEnvironment.DATABASE_URL,
        connectionTimeoutMilliseconds: 5_000,
        lockTimeoutMilliseconds: 10_000,
        maximumPoolSize: 1,
        statementTimeoutMilliseconds: 30_000,
      },
      runtimePassword,
      runtimeRole: "stockcontrol_app",
    });
  });

  it("decodes URL-encoded credentials", () => {
    expect(
      loadDatabaseRoleBootstrapConfiguration({
        ...validEnvironment,
        DATABASE_MIGRATOR_URL: `postgresql://stockcontrol_migrator:${"m".repeat(31)}%40@postgres.internal/railway`,
        DATABASE_URL: `postgresql://stockcontrol_app:${"r".repeat(31)}%2F@postgres.internal/railway`,
      }),
    ).toMatchObject({
      migratorPassword: `${"m".repeat(31)}@`,
      runtimePassword: `${"r".repeat(31)}/`,
    });
  });

  it.each([
    [{ ...validEnvironment, DATABASE_ADMIN_URL: undefined }, "MissingEnvironmentVariable"],
    [
      {
        ...validEnvironment,
        DATABASE_URL: "postgresql://stockcontrol_app@postgres.internal/railway",
      },
      "InvalidPassword",
    ],
    [
      {
        ...validEnvironment,
        DATABASE_URL: `postgresql://stockcontrol_migrator:${runtimePassword}@postgres.internal/railway`,
      },
      "RoleConflict",
    ],
    [
      {
        ...validEnvironment,
        DATABASE_URL: `postgresql://railway_admin:${runtimePassword}@postgres.internal/railway`,
      },
      "AdminRoleConflict",
    ],
    [
      {
        ...validEnvironment,
        DATABASE_URL: `postgresql://stockcontrol_app:${runtimePassword}@postgres.internal/other`,
      },
      "DatabaseMismatch",
    ],
    [
      {
        ...validEnvironment,
        DATABASE_URL: `postgresql://stockcontrol_app:${runtimePassword}@different.internal/railway`,
      },
      "EndpointMismatch",
    ],
    [
      {
        ...validEnvironment,
        DATABASE_URL: `postgresql://stockcontrol_app:${migratorPassword}@postgres.internal/railway`,
      },
      "PasswordConflict",
    ],
    [
      {
        ...validEnvironment,
        DATABASE_URL: "postgresql://stockcontrol_app:too-short@postgres.internal/railway",
      },
      "InvalidPassword",
    ],
  ] as const)("rejects incompatible configuration without exposing it", (environment, code) => {
    let thrown: unknown;

    try {
      loadDatabaseRoleBootstrapConfiguration(environment);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toEqual(new DatabaseRoleBootstrapConfigurationError(code));
    expect(String(thrown)).not.toContain("secret");
    expect(String(thrown)).not.toContain("postgres.internal");
  });
});
