import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { defineConfig } from "vitest/config";

const localEnvironmentPath = path.resolve(import.meta.dirname, "../../../.env");

if (existsSync(localEnvironmentPath)) {
  loadEnvFile(localEnvironmentPath);
}

const requiredEnvironmentVariables = ["DATABASE_MIGRATOR_URL", "DATABASE_URL"] as const;
const missingEnvironmentVariables = requiredEnvironmentVariables.filter((name) => {
  const value = process.env[name];
  return value === undefined || value.trim() === "";
});

if (missingEnvironmentVariables.length > 0) {
  throw new Error(
    `Database integration tests require ${missingEnvironmentVariables.join(
      " and ",
    )}. Start the local PostgreSQL service and configure the missing variable(s).`,
  );
}

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
    include: ["test/**/*.integration.spec.ts"],
    testTimeout: 30_000,
    /*
     * One database, and every suite here runs the migrator, which revokes the
     * runtime role's privileges before re-granting them. Two suites in parallel
     * means one revoking while the other is mid-insert, so a passing test fails
     * with a permission error that has nothing to do with what it asserts.
     */
    fileParallelism: false,
  },
});
