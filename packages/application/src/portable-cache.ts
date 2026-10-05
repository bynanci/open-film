import type { MediaAsset } from "@openfilm/core";

/** Old absolute cache URIs can be recovered after moving a project as a unit. */
export function portableCacheUri(
  asset: MediaAsset,
  uri: string,
  kind: "thumbnails" | "proxies",
): string {
  let path = uri;
  if (uri.startsWith("file:")) {
    try {
      path = decodeURIComponent(new URL(uri).pathname);
    } catch {
      return uri;
    }
  }
  path = path.replaceAll("\\", "/");
  const marker = `/cache/${kind}/`;
  const suffix = path.startsWith(`cache/${kind}/`)
    ? path.slice(`cache/${kind}/`.length)
    : path.includes(marker)
      ? path.slice(path.lastIndexOf(marker) + marker.length)
      : "";
  const extension = kind === "thumbnails" ? ".jpg" : ".mp4";
  // Only the application's generated cache filename convention is relocatable.
  if (
    !suffix ||
    suffix.includes("/") ||
    !suffix.startsWith(`${asset.id}-`) ||
    !suffix.endsWith(extension)
  )
    return uri;
  return `cache/${kind}/${suffix}`;
}
