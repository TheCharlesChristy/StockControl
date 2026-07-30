import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @stockcontrol/api start:dev",
      cwd: workspaceRoot,
      env: {
        APP_VERSION: "e2e",
        DATABASE_URL:
          process.env.DATABASE_URL ??
          "postgresql://stockcontrol_app:stockcontrol_app@127.0.0.1:5432/stockcontrol_e2e",
        GIT_SHA: "e2e",
        HOST: "127.0.0.1",
        LOG_LEVEL: "warn",
        NODE_ENV: "test",
        PORT: "3000",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: "http://127.0.0.1:3000/api/v1/health/ready",
    },
    {
      command: "pnpm --filter @stockcontrol/web dev --host 127.0.0.1",
      cwd: workspaceRoot,
      env: {
        NODE_ENV: "test",
        VITE_ENABLE_AUTH_PREVIEW: "true",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: "http://127.0.0.1:5173/sign-in",
    },
  ],
});
