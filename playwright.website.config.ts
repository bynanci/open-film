import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/website",
  outputDir: "website-test-results",
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:4175/open-film/",
    launchOptions: process.env.OPENFILM_CHROMIUM
      ? { executablePath: process.env.OPENFILM_CHROMIUM }
      : {},
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm --prefix docs run preview -- --host 127.0.0.1 --port 4175",
    url: "http://127.0.0.1:4175/open-film/",
    reuseExistingServer: false,
  },
});
