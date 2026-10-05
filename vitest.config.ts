import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const packages = [
  "core",
  "plugin-sdk",
  "analysis",
  "metadata",
  "events",
  "story",
  "solver",
  "exporters",
  "catalog",
  "media",
  "render",
  "application",
  "source-pixel",
  "source-insta360",
];
export default defineConfig({
  resolve: {
    alias: Object.fromEntries([
      ...packages.map((name) => [
        `@openfilm/${name}`,
        resolve(`packages/${name}/src/index.ts`),
      ]),
      [
        "@openfilm/template-proposal",
        resolve("templates/proposal-film/src/index.ts"),
      ],
    ]),
  },
  test: {
    include: [
      "packages/**/*.test.ts",
      "templates/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/unit/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "tests/e2e/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxWorkers: 3,
  },
});
