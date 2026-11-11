// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";
import media from "./vitest.media.config.js";

// Explicit opt-in measurement harness: original tests, assertions and timeout/retry settings.
export default defineConfig({
  ...media,
  test: {
    ...media.test,
    maxWorkers: 1,
    fileParallelism: false,
    setupFiles: ["./scripts/ci/media-profile-setup.mjs"],
  },
});
