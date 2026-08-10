import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@stockcontrol/contracts": path.resolve(
        import.meta.dirname,
        "../../packages/contracts/src/index.ts",
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
    exclude: ["test/**/*.integration.spec.ts"],
    include: ["test/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      /*
       * Covered by test/*.integration.spec.ts against a real database rather
       * than here. The claim loop's behaviour is what PostgreSQL does when a
       * lease expires or two transactions reach for one row, and the module
       * and pool lifecycle only mean anything once something composes and
       * closes them — a mocked query builder would assert the SQL we wrote
       * instead of that any of it works.
       */
      exclude: [
        "src/main.ts",
        "src/database-lifecycle.ts",
        "src/recognition/catalogue-retrieval.ts",
        "src/recognition/image-storage.ts",
        "src/recognition/recognition-dispatcher.ts",
        "src/recognition/recognition-handler.ts",
        "src/recognition/visual-index-store.ts",
        "src/worker.module.ts",
      ],
      /* Ratchet floors, not targets — see apps/api/vitest.config.ts. */
      thresholds: {
        branches: 98,
        functions: 97,
        lines: 99,
        statements: 99,
      },
    },
  },
});
