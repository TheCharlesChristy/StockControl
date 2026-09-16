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
      exclude: [
        "src/jobs/job-store.ts",
        /*
         * Same reasoning as the queue store above. What the purge does is what
         * PostgreSQL does with twelve `on delete restrict` constraints when
         * rows are removed in a particular order, and a mocked query builder
         * would assert the shape of the SQL we wrote rather than that any of
         * it works. test/retention.integration.spec.ts runs it against a real
         * server, with real rows, and checks what survived. The policy it
         * applies — which tables, in which order, on which clock — is pure,
         * and is unit-tested in test/retention-schedule.spec.ts.
         */
        "src/retention/purge.ts",
      ],
      /* Ratchet floors, not targets — see apps/api/vitest.config.ts. */
      thresholds: {
        branches: 81,
        functions: 88,
        lines: 88,
        statements: 88,
      },
    },
  },
});
