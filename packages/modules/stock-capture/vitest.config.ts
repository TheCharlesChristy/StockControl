import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      "@stockcontrol/contracts": path.resolve(import.meta.dirname, "../../contracts/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      /* Ratchet floors, not targets — see apps/api/vitest.config.ts. */
      thresholds: {
        branches: 96,
        functions: 100,
        lines: 99,
        statements: 98,
      },
    },
  },
});
