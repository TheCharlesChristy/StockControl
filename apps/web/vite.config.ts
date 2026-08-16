import path from "node:path";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, workspaceRoot, "");
  const apiOrigin = (environment.API_ORIGIN || "").trim() || "http://127.0.0.1:3000";

  return {
    envDir: workspaceRoot,
    plugins: [react()],
    resolve: {
      // Keep React and ReactDOM on a single module identity in the dev server.
      // This is especially important with pnpm's symlinked workspace packages:
      // MUI icons otherwise can resolve a second React copy and fail with the
      // browser's "Invalid hook call" error when an icon is rendered.
      dedupe: ["react", "react-dom"],
      alias: {
        "@stockcontrol/contracts": path.resolve(workspaceRoot, "packages/contracts/src/index.ts"),
        "@stockcontrol/module-locations": path.resolve(
          workspaceRoot,
          "packages/modules/locations/src/index.ts",
        ),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiOrigin,
        },
      },
    },
    preview: {
      port: 4173,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      testTimeout: 15_000,
      css: true,
      coverage: {
        provider: "v8",
        reporter: ["text", "json-summary", "lcov", "html"],
        include: ["src/**/*.ts", "src/**/*.tsx"],
        exclude: ["src/main.tsx", "src/test/**", "src/**/*.d.ts"],
        /* Ratchet floors, not targets — see apps/api/vitest.config.ts. */
        thresholds: {
          branches: 62,
          functions: 58,
          lines: 70,
          statements: 69,
        },
      },
    },
  };
});
