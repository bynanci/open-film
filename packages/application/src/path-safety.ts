import { lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
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
  const parts = managed.relativePath.split("/");
  if (
    parts[0] !== "sources" ||
    parts.length < 2 ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    return undefined;
  try {
    const projectRoot = realpathSync(directory);
    const root = nativePath.join(projectRoot, "sources");
    const path = nativePath.resolve(projectRoot, ...parts);
    if (!isInside(root, path) || path === root) return undefined;

    // Reject symlinks in every existing path component. Missing components are
    // permitted here so passive relocation can still resolve absent media;
    // version capture validates the final file before hashing it.
    let component = projectRoot;
    for (const [index, part] of parts.entries()) {
      component = nativePath.join(component, part);
      let info;
      try {
        info = lstatSync(component);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          break;
        return undefined;
      }
      if (
        info.isSymbolicLink() ||
        (index < parts.length - 1 && !info.isDirectory()) ||
        (index === parts.length - 1 && !info.isFile())
      )
        return undefined;
    }
    const uri = pathToFileURL(path).href;
    const reference = asset.metadata["openfilm.reference"] as
      { originalUri?: unknown } | undefined;
    if (
      typeof reference?.originalUri === "string" &&
      reference.originalUri.startsWith("openfilm-origin:")
    ) {
      const identity = createHash("sha256")
        .update(asset.id)
        .digest("hex")
        .slice(0, 24);
      return `${uri}#openfilm-asset=${identity}`;
    }
    return uri;
  } catch {
    return undefined;
  }
}
