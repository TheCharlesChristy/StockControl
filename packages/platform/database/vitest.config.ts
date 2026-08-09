import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@stockcontrol/contracts": path.resolve(import.meta.dirname, "../../contracts/src/index.ts"),
      "@stockcontrol/module-system": path.resolve(
        import.meta.dirname,
        "../../modules/system/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    exclude: ["test/**/*.integration.spec.ts"],
    include: ["test/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      /*
       * The queue store is covered by test/job-store.integration.spec.ts
       * against a real server, not here. What it does is what PostgreSQL does
       * when two transactions reach for one row — `for update skip locked`,
       * lease expiry, `on conflict do nothing` — and a mocked query builder
       * would assert the shape of the SQL we wrote rather than that any of it
       * works. Its retry policy is pure and is unit-tested beside it.
       */
      exclude: ["src/jobs/job-store.ts"],
      /* Ratchet floors, not targets — see apps/api/vitest.config.ts. */
      thresholds: {
        branches: 80,
        functions: 87,
        lines: 86,
        statements: 87,
      },
    },
  },
});
