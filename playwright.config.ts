import { resolve } from "node:path";
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
      // Explicit test-only protocol runner; this is not a speech model or ASR QA.
      env: {
        OPENFILM_WHISPER_PYTHON: "python3",
        OPENFILM_WHISPER_FIXTURE_DELAY: "6",
        OPENFILM_WHISPER_RUNNER: resolve("tests/fixtures/whisper-protocol.py"),
        OPENFILM_WHISPER_MODEL: resolve("tests/fixtures/whisper-model"),
      },
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
