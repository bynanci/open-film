// SPDX-License-Identifier: Apache-2.0
// Explicit external-SDK gate, separate from the default *.test.ts inventory.
import { defineConfig } from "vitest/config";
import base from "../vitest.config.js";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/integration/storytelling-compat.sdk.ts"],
  },
});
