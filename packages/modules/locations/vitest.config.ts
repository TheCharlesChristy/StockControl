import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      /* Ratchet floors, not targets — see apps/api/vitest.config.ts. */
      thresholds: {
        branches: 70,
        functions: 84,
        lines: 85,
        statements: 84,
      },
    },
  },
});
