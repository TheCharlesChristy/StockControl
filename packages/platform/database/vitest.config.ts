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
      /* Ratchet floors, not targets — see apps/api/vitest.config.ts. */
      thresholds: {
        branches: 75,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
