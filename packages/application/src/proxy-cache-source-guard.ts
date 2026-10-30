// SPDX-License-Identifier: Apache-2.0
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import type { ProjectCatalog } from "@openfilm/catalog";
import { localPath } from "@openfilm/media";

/** Original references may use directory aliases; lexical paths are insufficient. */
export function proxyPathHasOriginalReference(
  catalog: ProjectCatalog,
  target: string,
  kind: "file" | "directory",
): boolean {
  let canonical: string;
  let identity: ReturnType<typeof statSync>;
  try {
    canonical = realpathSync(target);
    identity = statSync(canonical);
  } catch {
    return true;
  }
  for (const asset of catalog.iterateAssetSummaries()) {
    if (!asset.uri.startsWith("file:")) continue;
    try {
      const source = realpathSync(localPath(asset.uri));
      if (kind === "directory") {
        const child = relative(canonical, source);
        if (
          !child ||
          (!isAbsolute(child) &&
            child !== ".." &&
            !child.startsWith(`..${sep}`))
        )
          return true;
      } else {
        const info = statSync(source);
        if (
          source === canonical ||
          (info.dev === identity.dev && info.ino === identity.ino)
        )
          return true;
      }
    } catch {
      // Missing/inaccessible local originals cannot prove a deletion safe.
      return true;
    }
  }
  return false;
}
