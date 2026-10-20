import * as nativePath from "node:path";
import { pathToFileURL } from "node:url";
import type { MediaAsset } from "@openfilm/core";

export function isInside(
  parent: string,
  child: string,
  path: Pick<typeof nativePath, "relative" | "isAbsolute" | "sep"> = nativePath,
): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

export function managedSourceUri(
  directory: string,
  asset: MediaAsset,
): string | undefined {
  const managed = asset.metadata["openfilm.managedSource"] as
    { relativePath?: unknown; uri?: unknown } | undefined;
  if (
    typeof managed?.relativePath !== "string" ||
    managed.uri !== asset.uri ||
    !managed.relativePath.startsWith("sources/") ||
    managed.relativePath.includes("\\")
  )
    return undefined;
  const root = nativePath.join(directory, "sources");
  const path = nativePath.resolve(directory, managed.relativePath);
  return isInside(root, path) && path !== root
    ? pathToFileURL(path).href
    : undefined;
}
