import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@stockcontrol/contracts": path.resolve(
        import.meta.dirname,
        "../../packages/contracts/src/index.ts",
      ),
      "@stockcontrol/module-locations": path.resolve(
        import.meta.dirname,
        "../../packages/modules/locations/src/index.ts",
      ),
      "@stockcontrol/module-stock-capture": path.resolve(
        import.meta.dirname,
        "../../packages/modules/stock-capture/src/index.ts",
      ),
      "@stockcontrol/module-system": path.resolve(
        import.meta.dirname,
        "../../packages/modules/system/src/index.ts",
      ),
      "@stockcontrol/platform": path.resolve(
        import.meta.dirname,
        "../../packages/platform/core/src/index.ts",
      ),
      "@stockcontrol/platform-database": path.resolve(
        import.meta.dirname,
        "../../packages/platform/database/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    /* Real-database suites run from vitest.integration.config.ts. */
    exclude: ["test/**/*.db.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        // Process entry points: argument-free scripts whose logic lives
        // elsewhere (the seed's simulation is covered through
        // src/seed/simulate.ts).
        "src/main.ts",
        "src/seed/seed.ts",
        // Transaction-scoped writers: locking, advisory-lock serialisation
        // and rollback-on-error only mean something against a real
        // PostgreSQL — test:integration proves them (stock-capture-commit.db
        // .spec.ts in particular), a mocked query builder would only assert
        // the SQL they write.
        "src/inventory/catalogue-writer.ts",
        "src/inventory/stock-writer.ts",
      ],
      /*
       * Ratchet floors, not targets. CI enforces these from the commit that
       * turned coverage on, so the numbers may only ever go up; 80 across the
       * board remains the goal. They read low because the controllers, services
       * and read models are exercised by test:integration and the browser
       * journey rather than by unit tests, and neither run reports into this
       * config. Raise a floor whenever a change lifts the measured value.
       */
      thresholds: {
        branches: 35,
        functions: 40,
        lines: 42,
        statements: 41,
      },
    },
  },
});
