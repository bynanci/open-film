import { defineConfig } from "vitest/config";
import root from "./vitest.config.js";
import { releaseV050RenderQaTestFiles } from "./tests/render-qa-v050/test-files.js";

export default defineConfig({
  ...root,
  test: {
    ...root.test,
    include: [...releaseV050RenderQaTestFiles],
    maxWorkers: 1,
    retry: 0,
    allowOnly: false,
    passWithNoTests: false,
  },
});
