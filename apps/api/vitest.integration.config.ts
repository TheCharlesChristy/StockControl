import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { defineConfig } from "vitest/config";

const localEnvironmentPath = path.resolve(import.meta.dirname, "../../.env");

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
    `API integration tests require ${missingEnvironmentVariables.join(
      " and ",
    )}. Start the local PostgreSQL service and configure the missing variable(s).`,
  );
}

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
    include: ["test/**/*.db.spec.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    /* One database, so suites must not interleave their fixtures. */
    fileParallelism: false,
  },
});
