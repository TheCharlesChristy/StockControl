import { describe, expect, it } from "vitest";

import * as database from "../src";

describe("database public API", () => {
  it("exports the supported database foundation", () => {
    expect(database).toMatchObject({
      DatabaseConfigurationError: expect.any(Function),
      DatabaseMigrationError: expect.any(Function),
      PostgresReadinessCheck: expect.any(Function),
      STOCKCONTROL_SCHEMA: "stockcontrol",
      StockControlMigrationProvider: expect.any(Function),
      createMigratorDatabase: expect.any(Function),
      createRuntimeDatabase: expect.any(Function),
      databaseRoleFromConnectionString: expect.any(Function),
      databaseRolesForMigration: expect.any(Function),
      loadMigratorDatabaseConfiguration: expect.any(Function),
      loadRuntimeDatabaseConfiguration: expect.any(Function),
      migrateConfiguredDatabase: expect.any(Function),
      runMigrations: expect.any(Function),
    });
  });
});
