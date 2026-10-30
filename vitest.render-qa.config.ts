import { defineConfig } from "vitest/config";
import root from "./vitest.config.js";
export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: ["tests/render-qa/**/*.spec.ts"],
    maxWorkers: 1,
    allowOnly: false,
    passWithNoTests: false,
  },
});
