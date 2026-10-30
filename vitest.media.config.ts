import { defineConfig } from "vitest/config";
import root from "./vitest.config.js";
import { contractTestPatterns } from "./scripts/ci/test-lanes.js";

export default defineConfig({
  ...root,
  test: {
    ...root.test,
    exclude: [...(root.test?.exclude ?? []), ...contractTestPatterns],
  },
});
