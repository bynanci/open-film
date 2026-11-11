// SPDX-License-Identifier: Apache-2.0
// QA runner containment only; the fresh output is created after source hash checks.
import assert from "node:assert/strict";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

type PathSyntax = Pick<typeof path, "relative" | "isAbsolute" | "sep">;
export function isOutsideCheckout(
  checkout: string,
  candidate: string,
  syntax: PathSyntax = path,
): boolean {
  const relative = syntax.relative(checkout, candidate);
  return (
    relative === ".." ||
    relative.startsWith(".." + syntax.sep) ||
    syntax.isAbsolute(relative)
  );
}
export async function resolveRecordedMediaPaths(
  checkout: string,
  media: string,
  output: string,
) {
  const checkoutRoot = await realpath(checkout),
    mediaRoot = await realpath(media);
  assert(
    (await stat(mediaRoot)).isDirectory(),
    "Media source must be an existing directory",
  );
  // mkdir is deliberately nonrecursive: the existing parent is the creation ancestor.
  const requestedOutput = path.resolve(output);
  const outputRoot = path.join(
    await realpath(path.dirname(requestedOutput)),
    path.basename(requestedOutput),
  );
  for (const directory of [mediaRoot, outputRoot])
    assert(
      isOutsideCheckout(checkoutRoot, directory),
      "Media and evidence must be outside the checkout",
    );
  return { checkoutRoot, mediaRoot, outputRoot };
}
export async function createExternalEvidenceDirectory(
  checkoutRoot: string,
  outputRoot: string,
) {
  await mkdir(outputRoot);
  const canonicalOutput = await realpath(outputRoot);
  assert(
    isOutsideCheckout(checkoutRoot, canonicalOutput),
    "Media and evidence must be outside the checkout",
  );
  return canonicalOutput;
}
