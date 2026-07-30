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
      alias: {
        "@stockcontrol/contracts": path.resolve(workspaceRoot, "packages/contracts/src/index.ts"),
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
        thresholds: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
  };
});
