// SPDX-License-Identifier: Apache-2.0
// Everything outside this small, reviewed pure-logic allowlist stays in media QA.
export const contractTestPatterns = [
  "packages/core/tests/**/*.test.ts",
  "packages/solver/tests/**/*.test.ts",
  "packages/story/tests/**/*.test.ts",
  "packages/metadata/tests/**/*.test.ts",
  "packages/events/tests/**/*.test.ts",
] as const;

export function validateTestPartition(
  all: readonly string[],
  contracts: readonly string[],
  media: readonly string[],
): { total: number; contracts: number; media: number } {
  for (const [name, files] of [
    ["all", all],
    ["contracts", contracts],
    ["media", media],
  ] as const) {
    if (!files.length || new Set(files).size !== files.length)
      throw new Error(`Empty or duplicate ${name} test inventory.`);
    if (
      files.some(
        (file) =>
          !/^(?:packages|templates|tests)\/.+\.test\.ts$/u.test(file) ||
          file.split("/").some((part) => part === ".." || part === ".") ||
          file.includes("\\"),
      )
    )
      throw new Error(`Invalid ${name} test path.`);
  }
  const expected = new Set(all);
  const selected = new Set([...contracts, ...media]);
  if (selected.size !== contracts.length + media.length)
    throw new Error("Contract and media test lanes overlap.");
  if (
    selected.size !== expected.size ||
    [...selected].some((file) => !expected.has(file))
  )
    throw new Error("Test lanes do not exactly cover the root inventory.");
  return {
    total: all.length,
    contracts: contracts.length,
    media: media.length,
  };
}
