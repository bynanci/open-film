import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
  win32,
  posix,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { MediaAsset, MediaLibrary } from "@openfilm/core";

export interface PortableReference {
  originalUri: string;
  contentHash?: string;
  filename: string;
  fileSize?: number;
  mediaLibraryId: string;
  relativePath: string;
  volumeId: string;
  rootUri: string;
}
export type SourceStatus = {
  assetId: string;
  status: "available" | "missing" | "inaccessible";
  message?: string;
};
export type RelinkCandidate = {
  id: string;
  path: string;
  uri: string;
  fileSize: number;
  contentHash: string;
  match: "content-hash" | "relative-path" | "filename-size" | "manual";
  automatic: boolean;
  reason: string;
};
export type RelinkMatch = {
  assetId: string;
  candidates: RelinkCandidate[];
  suggestedId?: string;
  reason?: string;
};
interface Location {
  path: string;
  windows: boolean;
  uri: string;
}
interface InspectedFile {
  path: string;
  uri: string;
  fileSize: number;
  contentHash: string;
  relativePath: string;
}
const string = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const size = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

/** Parse Windows references independently of the host that opens the project. */
function location(input: string): Location {
  if (typeof input !== "string" || !input.trim() || input.includes("\0"))
    throw new Error(
      "Media location must be a non-empty local path or file URL.",
    );
  let path = input;
  let windows =
    /^[A-Za-z]:[\\/]/.test(path) ||
    /^\\\\/.test(path) ||
    /^\/\/[^/]/.test(path);
  if (/^file:/i.test(input)) {
    const url = new URL(input);
    if (url.search || url.hash)
      throw new Error("File URLs must encode filename query/hash characters.");
    windows = !!url.hostname || /^\/[A-Za-z]:\//.test(url.pathname);
    path = fileURLToPath(url, { windows });
  } else if (
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(input) &&
    !/^[A-Za-z]:[\\/]/.test(input)
  ) {
    throw new Error(
      "Only local filesystem paths and file URLs support media relinking.",
    );
  }
  if (windows) {
    if (/^\\\\[?.]\\/.test(path))
      throw new Error(
        "Windows device paths are not supported; use a drive or UNC share path.",
      );
    path = win32.normalize(path).replaceAll("\\", "/");
    if (!win32.isAbsolute(path))
      throw new Error("Windows media paths must be absolute.");
    path = path.replace(
      /^([a-z]):/,
      (_, drive: string) => `${drive.toUpperCase()}:`,
    );
    return { path, windows, uri: pathToFileURL(path, { windows: true }).href };
  }
  path = resolve(path);
  return { path, windows, uri: pathToFileURL(path).href };
}
function nativePath(input: string): string {
  const parsed = location(input);
  if (parsed.windows && process.platform !== "win32")
    throw new Error(
      "This Windows source path is unavailable on this platform. Relink it to the drive's current mount.",
    );
  if (
    !parsed.windows &&
    process.platform === "win32" &&
    !isAbsolute(parsed.path)
  )
    throw new Error("Source path must be absolute on this platform.");
  return process.platform === "win32"
    ? win32.normalize(parsed.path)
    : parsed.path;
}
function comparison(path: string, windows: boolean): string {
  return windows ? path.toLowerCase() : path;
}
function within(path: Location, root: Location): boolean {
  if (path.windows !== root.windows) return false;
  const candidate = comparison(path.path, path.windows);
  const base = comparison(root.path.replace(/\/$/, ""), root.windows);
  return candidate === base || candidate.startsWith(`${base}/`);
}
function relativePart(path: Location, root: Location): string {
  return (
    path.windows
      ? win32.relative(root.path, path.path)
      : posix.relative(root.path, path.path)
  ).replaceAll("\\", "/");
}
function relativeReference(value: unknown): string | undefined {
  const text = string(value);
  if (!text) return undefined;
  const normalized = posix.normalize(text.replaceAll("\\", "/"));
  if (
    posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  )
    return undefined;
  return normalized === "." ? undefined : normalized;
}

/** Older projects derive a portable reference without changing catalog objects. */
export function referenceFor(
  asset: MediaAsset,
  libraries: MediaLibrary[],
): PortableReference {
  const stored = record(asset.metadata["openfilm.reference"]);
  const source = location(asset.uri);
  const matching = libraries
    .flatMap((library) => {
      try {
        const root = location(library.uri);
        return within(source, root) ? [{ library, root }] : [];
      } catch {
        return [];
      }
    })
    .sort(
      (a, b) =>
        b.root.path.length - a.root.path.length ||
        a.library.id.localeCompare(b.library.id),
    )[0];
  const fallbackRoot = location(
    source.windows ? win32.dirname(source.path) : dirname(source.path),
  );
  let root = matching?.root ?? fallbackRoot;
  if (string(stored.rootUri)) {
    try {
      root = location(stored.rootUri as string);
    } catch {
      /* Legacy root falls back to the current source library. */
    }
  }
  const filename =
    string(stored.filename) ??
    (source.windows ? win32.basename(source.path) : basename(source.path));
  const mediaLibraryId =
    string(stored.mediaLibraryId) ??
    matching?.library.id ??
    `legacy:${asset.id}`;
  const fileSize =
    size(stored.fileSize) ??
    size(record(asset.metadata["openfilm.filesystem"]).size);
  const contentHash = string(asset.contentHash) ?? string(stored.contentHash);
  return {
    originalUri: string(stored.originalUri) ?? asset.uri,
    ...(contentHash ? { contentHash } : {}),
    filename,
    ...(fileSize !== undefined ? { fileSize } : {}),
    mediaLibraryId,
    relativePath:
      relativeReference(stored.relativePath) ??
      (within(source, root) ? relativePart(source, root) : filename),
    volumeId: string(stored.volumeId) ?? `library:${mediaLibraryId}`,
    rootUri: root.uri,
  };
}

/** Refuse symlinks in the full path, including a symlinked parent directory. */
async function inspectPath(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  const root = parse(path).root;
  let current = root;
  let info = await lstat(root);
  for (const component of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, component);
    info = await lstat(current);
    if (info.isSymbolicLink())
      throw new Error(`Symbolic links are not accepted: ${current}`);
  }
  return info;
}
const message = (error: unknown): string =>
  error instanceof Error ? error.message : "Source could not be inspected.";
function missing(error: unknown): boolean {
  const code = record(error).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
export async function sourceStatus(asset: MediaAsset): Promise<SourceStatus> {
  try {
    const path = nativePath(asset.uri);
    const info = await inspectPath(path);
    if (!info.isFile())
      return {
        assetId: asset.id,
        status: "inaccessible",
        message:
          "The source is not a regular file. Select the media file when relinking.",
      };
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== info.dev ||
        opened.ino !== info.ino
      )
        throw new Error(
          "Source changed while its availability was checked. Check again.",
        );
    } finally {
      await handle.close();
    }
    return { assetId: asset.id, status: "available" };
  } catch (error) {
    return {
      assetId: asset.id,
      status: missing(error) ? "missing" : "inaccessible",
      message: missing(error)
        ? "Source file is missing. Reconnect its drive or relink the media."
        : message(error),
    };
  }
}

async function inspectFile(path: string, root: string): Promise<InspectedFile> {
  const before = await inspectPath(path);
  if (!before.isFile())
    throw new Error(`Relink source is not a regular file: ${path}`);
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      throw new Error(`Source changed before hashing: ${path}`);
    const canonical = await realpath(path);
    if (
      comparison(canonical, process.platform === "win32") !==
      comparison(resolve(path), process.platform === "win32")
    )
      throw new Error(`Symbolic links are not accepted: ${path}`);
    const hash = createHash("sha256");
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) hash.update(chunk as Buffer);
    const after = await handle.stat();
    const current = await inspectPath(path);
    if (
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      throw new Error(
        `Source changed while hashing: ${path}. Retry the relink scan.`,
      );
    return {
      path,
      uri: pathToFileURL(path).href,
      fileSize: after.size,
      contentHash: hash.digest("hex"),
      relativePath: relative(root, path).split(sep).join("/"),
    };
  } finally {
    await handle.close();
  }
}
async function discover(
  folder: string,
): Promise<{ files: InspectedFile[]; issues: string[] }> {
  const info = await inspectPath(folder);
  if (!info.isDirectory())
    throw new Error("Relink folder must be a directory, not a file.");
  const pending = [folder],
    files: InspectedFile[] = [],
    issues: string[] = [];
  while (pending.length) {
    const directory = pending.pop()!;
    try {
      const current = await inspectPath(directory);
      if (!current.isDirectory())
        throw new Error(
          `Relink directory changed during the scan: ${directory}`,
        );
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink())
          issues.push(`Skipped symbolic link: ${path}`);
        else if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) {
          try {
            files.push(await inspectFile(path, folder));
          } catch (error) {
            issues.push(message(error));
          }
        } else issues.push(`Skipped nonregular file: ${path}`);
      }
    } catch (error) {
      issues.push(message(error));
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, issues };
}

/** Hash identity outranks path evidence; only a unique hash match is automatic. */
export async function planMediaRelink(
  assets: MediaAsset[],
  libraries: MediaLibrary[],
  input: { folder?: string; file?: string },
): Promise<RelinkMatch[]> {
  if ((input.folder === undefined) === (input.file === undefined))
    throw new Error("Provide exactly one relink folder or file.");
  const explicit = input.file !== undefined;
  const path = nativePath(input.file ?? input.folder!);
  const scan = explicit
    ? { files: [await inspectFile(path, dirname(path))], issues: [] }
    : await discover(path);
  return assets.map((asset) => {
    const reference = referenceFor(asset, libraries);
    const knownHash = reference.contentHash?.toLowerCase();
    const windows = location(reference.originalUri).windows;
    let match: RelinkCandidate["match"] = "content-hash";
    let matched = knownHash
      ? scan.files.filter((file) => file.contentHash === knownHash)
      : [];
    if (!knownHash) {
      match = "relative-path";
      matched = scan.files.filter(
        (file) =>
          comparison(file.relativePath, windows) ===
          comparison(reference.relativePath, windows),
      );
      if (!matched.length) {
        match = "filename-size";
        matched =
          reference.fileSize === undefined
            ? []
            : scan.files.filter(
                (file) =>
                  comparison(basename(file.path), windows) ===
                    comparison(reference.filename, windows) &&
                  file.fileSize === reference.fileSize,
              );
      }
      if (!matched.length && explicit) {
        match = "manual";
        matched = scan.files;
      }
    }
    const automatic = match === "content-hash" && matched.length === 1;
    const candidates = matched.map((file) => ({
      id: createHash("sha256")
        .update(`${file.uri}\0${file.contentHash}`)
        .digest("hex"),
      path: file.path,
      uri: file.uri,
      fileSize: file.fileSize,
      contentHash: file.contentHash,
      match,
      automatic,
      reason:
        match === "content-hash"
          ? `SHA-256 matches the original content${matched.length > 1 ? "; multiple identical files require an explicit choice" : " exactly"}.`
          : match === "relative-path"
            ? "Relative path matches the original library location. Content identity is unverified; confirmation is required."
            : match === "filename-size"
              ? `Filename and ${file.fileSize} byte size match. Content identity is unverified; confirmation is required.`
              : "Explicitly selected file has no known hash contradiction. Verify its media content before confirming.",
    }));
    let reason: string | undefined;
    if (matched.length > 1)
      reason = `Ambiguous: ${matched.length} files have equally strong ${match} evidence. Choose one explicitly.`;
    else if (!matched.length) {
      reason = knownHash
        ? "No file matches the known SHA-256 hash. A hash mismatch blocks relative-path, filename, and manual fallback; choose the original media."
        : "No relative-path or filename-and-size match was found. A filename alone is insufficient; select a file explicitly for manual confirmation.";
      if (scan.issues.length)
        reason += ` ${scan.issues.length} source(s) could not be used. ${scan.issues[0]}`;
    }
    return {
      assetId: asset.id,
      candidates,
      ...(matched.length === 1 ? { suggestedId: candidates[0]!.id } : {}),
      ...(reason ? { reason } : {}),
    };
  });
}
