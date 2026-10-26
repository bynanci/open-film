import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "record-monitor.spec.ts",
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: {
    launchOptions: {
      executablePath:
        process.env.OPENFILM_CHROMIUM ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
});
