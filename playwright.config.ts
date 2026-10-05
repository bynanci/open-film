import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:1420",
    launchOptions: process.env.OPENFILM_CHROMIUM
      ? { executablePath: process.env.OPENFILM_CHROMIUM }
      : {},
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm server",
      url: "http://127.0.0.1:4310/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @openfilm/desktop dev",
      url: "http://127.0.0.1:1420",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
