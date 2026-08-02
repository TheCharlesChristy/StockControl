import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  createMigratorDatabase: vi.fn(),
  loadMigrationDatabaseRoles: vi.fn(),
  loadMigratorDatabaseConfiguration: vi.fn(),
  runMigrations: vi.fn(),
}));

vi.mock("../src/configuration", () => ({
  loadMigrationDatabaseRoles: serviceMocks.loadMigrationDatabaseRoles,
  loadMigratorDatabaseConfiguration: serviceMocks.loadMigratorDatabaseConfiguration,
}));

vi.mock("../src/connection", () => ({
  createMigratorDatabase: serviceMocks.createMigratorDatabase,
}));

vi.mock("../src/migrations/runner", () => ({
  runMigrations: serviceMocks.runMigrations,
}));

import { migrateConfiguredDatabase } from "../src/migrations/service";

describe("configured database migration service", () => {
  const environment = {
    DATABASE_MIGRATOR_URL: "postgresql://migrator:secret@database/stockcontrol",
    DATABASE_RUNTIME_ROLE: "stockcontrol_app",
  };
  const configuration = {
    applicationName: "stockcontrol-migrator",
    connectionString: environment.DATABASE_MIGRATOR_URL,
  };
  const database = {
    destroy: vi.fn(),
  };

  beforeEach(() => {
    serviceMocks.createMigratorDatabase.mockReset().mockReturnValue(database);
    serviceMocks.loadMigrationDatabaseRoles.mockReset().mockReturnValue({
      migratorRole: "migrator",
      runtimeRole: "stockcontrol_app",
    });
    serviceMocks.loadMigratorDatabaseConfiguration.mockReset().mockReturnValue(configuration);
    serviceMocks.runMigrations.mockReset();
    database.destroy.mockReset().mockResolvedValue(undefined);
  });

  it("runs configured migrations and closes the migrator pool", async () => {
    const result = { results: [] };
    serviceMocks.runMigrations.mockResolvedValue(result);

    await expect(migrateConfiguredDatabase(environment)).resolves.toBe(result);

    expect(serviceMocks.loadMigratorDatabaseConfiguration).toHaveBeenCalledWith(environment);
    expect(serviceMocks.loadMigrationDatabaseRoles).toHaveBeenCalledWith(
      environment,
      configuration.connectionString,
    );
    expect(serviceMocks.createMigratorDatabase).toHaveBeenCalledWith(configuration);
    expect(serviceMocks.runMigrations).toHaveBeenCalledWith(database, {
      runtimeRole: "stockcontrol_app",
    });
    expect(database.destroy).toHaveBeenCalledOnce();
  });

  it("closes the migrator pool when migration validation fails", async () => {
    const failure = new Error("Migration integrity validation failed.");
    serviceMocks.runMigrations.mockRejectedValue(failure);

    await expect(migrateConfiguredDatabase(environment)).rejects.toBe(failure);
    expect(database.destroy).toHaveBeenCalledOnce();
  });
});
