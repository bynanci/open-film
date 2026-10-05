import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaAsset, MediaLibrary } from "@openfilm/core";
import {
  planMediaRelink,
  referenceFor,
  sourceStatus,
  type PortableReference,
} from "../src/relink.js";

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const uri = (path: string): string => pathToFileURL(path).href;
function asset(path: string, patch: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "asset-original",
    uri: path.startsWith("file:") ? path : uri(path),
    name: "A display title",
    mediaType: "image",
    tags: ["holiday"],
    rating: 5,
    state: { locked: true },
    metadata: { "user.notes": "Keep this" },
    ...patch,
  };
}
const library = (path: string, id = "opaque-library-14"): MediaLibrary => ({
  id,
  name: "Travel archive",
  uri: path.startsWith("file:") ? path : uri(path),
});
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openfilm-relink-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function file(path: string, content: string): Promise<string> {
  const destination = join(directory, path);
  await mkdir(join(destination, ".."), { recursive: true });
  await writeFile(destination, content);
  return destination;
}

// These tests validate string normalization on Linux; native Windows mounts remain a manual gate.
describe("portable reference derivation", () => {
  it("chooses the longest library root, preserving opaque identity and legacy filesystem byte size", () => {
    const outer = join(directory, "original"),
      inner = join(outer, "nested");
    const original = asset(join(inner, "day one", "a #1.jpg"), {
      metadata: {
        "openfilm.filesystem": { size: 12345, modifiedAt: "2025-01-01" },
      },
    });
    const snapshot = structuredClone(original);
    const reference = referenceFor(original, [
      library(outer, "outer"),
      library(inner, "arbitrary/opaque:inner"),
    ]);
    expect(reference).toEqual({
      originalUri: original.uri,
      filename: "a #1.jpg",
      fileSize: 12345,
      mediaLibraryId: "arbitrary/opaque:inner",
      relativePath: "day one/a #1.jpg",
      volumeId: "library:arbitrary/opaque:inner",
      rootUri: uri(inner),
    });
    expect(original).toEqual(snapshot);
  });
  it("does not confuse sibling directory prefixes and handles filesystem root libraries", () => {
    const original = asset(join(directory, "archive-other", "a.jpg"));
    const reference = referenceFor(original, [
      library(join(directory, "archive")),
      library("/", "root-volume"),
    ]);
    expect(reference.mediaLibraryId).toBe("root-volume");
    expect(reference.relativePath).toBe(
      join(directory, "archive-other", "a.jpg").slice(1),
    );
  });
  it.each([
    {
      source: "D:\\Travel\\Day One\\photo #1.jpg",
      root: "d:\\travel",
      expectedRoot: "file:///D:/travel",
      relative: "Day One/photo #1.jpg",
    },
    {
      source: "file:///D:/Travel/Day%20One/photo%20%231.jpg",
      root: "file:///d:/Travel",
      expectedRoot: "file:///D:/Travel",
      relative: "Day One/photo #1.jpg",
    },
    {
      source: "E:/Travel/Day One/photo #1.jpg",
      root: "E:/Travel",
      expectedRoot: "file:///E:/Travel",
      relative: "Day One/photo #1.jpg",
    },
    {
      source: "\\\\nas-server\\photos\\Travel\\photo #1.jpg",
      root: "\\\\nas-server\\photos",
      expectedRoot: "file://nas-server/photos/",
      relative: "Travel/photo #1.jpg",
    },
    {
      source: "file://nas-server/photos/Travel/photo%20%231.jpg",
      root: "file://nas-server/photos/",
      expectedRoot: "file://nas-server/photos/",
      relative: "Travel/photo #1.jpg",
    },
  ])(
    "normalizes $source independently of the host OS",
    ({ source, root, expectedRoot, relative }) => {
      const original = asset("/unused", { uri: source });
      const reference = referenceFor(original, [
        { id: "portable-identity", name: "Drive", uri: root },
      ]);
      expect(reference.originalUri).toBe(source);
      expect(reference.rootUri).toBe(expectedRoot);
      expect(reference.relativePath).toBe(relative);
      expect(reference.filename).toBe("photo #1.jpg");
      expect(reference.volumeId).toBe("library:portable-identity");
    },
  );
  it("retains original URI and stable logical volume identity when drive letters change", () => {
    const original = asset("/unused", {
      uri: "file:///D:/Travel/photo.jpg",
      contentHash: digest("same"),
    });
    const first = referenceFor(original, [
      { id: "camera-library", name: "Camera", uri: "D:/Travel" },
    ]);
    const moved = {
      ...original,
      uri: "file:///E:/Remounted/photo.jpg",
      metadata: {
        ...original.metadata,
        "openfilm.reference": { ...first, rootUri: "file:///E:/Remounted" },
      },
    };
    const next = referenceFor(moved, [
      { id: "another-library", name: "Imported later", uri: "E:/Remounted" },
    ]);
    expect(next.originalUri).toBe(original.uri);
    expect(next.volumeId).toBe(first.volumeId);
    expect(next.mediaLibraryId).toBe(first.mediaLibraryId);
    expect(next.rootUri).toBe("file:///E:/Remounted");
    expect(next.contentHash).toBe(digest("same"));
  });
  it("preserves valid stored references and recovers partial legacy metadata safely", () => {
    const original = asset(join(directory, "photo.jpg"), {
      metadata: {
        "openfilm.filesystem": { size: 0 },
        "openfilm.reference": {
          originalUri: "file:///old/photo.jpg",
          mediaLibraryId: "opaque-old",
          volumeId: "logical-volume",
          relativePath: "../../escape.jpg",
          fileSize: -1,
        },
      },
    });
    const reference = referenceFor(original, []);
    expect(reference).toMatchObject({
      originalUri: "file:///old/photo.jpg",
      mediaLibraryId: "opaque-old",
      volumeId: "logical-volume",
      fileSize: 0,
      relativePath: "photo.jpg",
      rootUri: uri(directory),
    });
    const unknownSize = referenceFor(
      asset(join(directory, "photo.jpg"), {
        metadata: { "openfilm.filesystem": { size: "123" } },
      }),
      [],
    );
    expect(unknownSize.fileSize).toBeUndefined();
    expect(unknownSize.mediaLibraryId).toBe("legacy:asset-original");
  });
});

describe("source availability", () => {
  it("distinguishes available, missing, and nonregular source paths without modifying files", async () => {
    const source = await file("source.jpg", "source bytes");
    expect(await sourceStatus(asset(source))).toEqual({
      assetId: "asset-original",
      status: "available",
    });
    expect(
      await sourceStatus(asset(join(directory, "missing.jpg"))),
    ).toMatchObject({
      status: "missing",
      message: expect.stringContaining("Reconnect"),
    });
    expect(await sourceStatus(asset(directory))).toMatchObject({
      status: "inaccessible",
      message: expect.stringContaining("regular file"),
    });
    expect(await readFile(source, "utf8")).toBe("source bytes");
  });
  it("rejects final-file symlinks and symlinked parent directories", async () => {
    const source = await file("real/source.jpg", "bytes");
    const linked = join(directory, "source-link.jpg"),
      linkedParent = join(directory, "linked-parent");
    await symlink(source, linked);
    await symlink(join(directory, "real"), linkedParent, "dir");
    expect(await sourceStatus(asset(linked))).toMatchObject({
      status: "inaccessible",
      message: expect.stringContaining("Symbolic"),
    });
    expect(
      await sourceStatus(asset(join(linkedParent, "source.jpg"))),
    ).toMatchObject({
      status: "inaccessible",
      message: expect.stringContaining("Symbolic"),
    });
  });
  it("reports nonlocal and foreign Windows sources as inaccessible rather than pretending to mount them", async () => {
    expect(
      await sourceStatus(
        asset("/unused", { uri: "https://example.invalid/photo.jpg" }),
      ),
    ).toMatchObject({
      status: "inaccessible",
      message: expect.stringContaining("local"),
    });
    if (process.platform !== "win32")
      expect(
        await sourceStatus(
          asset("/unused", { uri: "file:///D:/Travel/photo.jpg" }),
        ),
      ).toMatchObject({
        status: "inaccessible",
        message: expect.stringContaining("current mount"),
      });
  });
});

describe("filesystem relink planning", () => {
  it("finds a renamed exact-hash file before a misleading matching path or name and keeps all input metadata immutable", async () => {
    const originalRoot = join(directory, "old"),
      movedRoot = join(directory, "new");
    await file("new/nested/photo.jpg", "wrong same name");
    const correct = await file("new/renamed.bin", "original content");
    const original = asset(join(originalRoot, "nested", "photo.jpg"), {
      contentHash: digest("original content"),
      metadata: { "openfilm.filesystem": { size: 16 }, "user.notes": "keep" },
    });
    const snapshot = structuredClone(original);
    const [match] = await planMediaRelink([original], [library(originalRoot)], {
      folder: movedRoot,
    });
    expect(match?.candidates).toHaveLength(1);
    expect(match?.candidates[0]).toMatchObject({
      path: correct,
      uri: uri(correct),
      contentHash: original.contentHash,
      fileSize: 16,
      match: "content-hash",
      automatic: true,
    });
    expect(match?.suggestedId).toBe(match?.candidates[0]?.id);
    expect(original).toEqual(snapshot);
    expect(await readFile(correct, "utf8")).toBe("original content");
  });
  it("blocks all fallbacks for a known hash mismatch, including explicit manual selection", async () => {
    const wrong = await file("new/photo.jpg", "wrong");
    const original = asset(join(directory, "old", "photo.jpg"), {
      contentHash: digest("right"),
      metadata: { "openfilm.filesystem": { size: 5 } },
    });
    for (const input of [{ folder: join(directory, "new") }, { file: wrong }]) {
      const [match] = await planMediaRelink(
        [original],
        [library(join(directory, "old"))],
        input,
      );
      expect(match?.candidates).toEqual([]);
      expect(match?.suggestedId).toBeUndefined();
      expect(match?.reason).toContain("hash mismatch blocks");
    }
  });
  it("uses known hash in portable reference metadata when the legacy asset field is absent", async () => {
    const correct = await file("new/renamed.jpg", "right");
    const original = asset(join(directory, "old", "photo.jpg"), {
      metadata: { "openfilm.reference": { contentHash: digest("right") } },
    });
    const [match] = await planMediaRelink([original], [], { file: correct });
    expect(match?.candidates[0]).toMatchObject({
      automatic: true,
      match: "content-hash",
    });
  });
  it("keeps duplicate exact hashes ambiguous, with no automatic or suggested choice", async () => {
    await file("new/one.jpg", "same");
    await file("new/two.jpg", "same");
    const original = asset(join(directory, "old", "photo.jpg"), {
      contentHash: digest("same"),
    });
    const [match] = await planMediaRelink([original], [], {
      folder: join(directory, "new"),
    });
    expect(match?.candidates).toHaveLength(2);
    expect(match?.candidates.every((candidate) => !candidate.automatic)).toBe(
      true,
    );
    expect(match?.suggestedId).toBeUndefined();
    expect(match?.reason).toContain("Ambiguous");
  });
  it("prefers relative path over filename-plus-size while requiring content confirmation", async () => {
    const relative = await file("new/day/photo.jpg", "changed");
    await file("new/other/photo.jpg", "old");
    const oldRoot = join(directory, "old");
    const original = asset(join(oldRoot, "day", "photo.jpg"), {
      metadata: { "openfilm.filesystem": { size: 3 } },
    });
    const [match] = await planMediaRelink([original], [library(oldRoot)], {
      folder: join(directory, "new"),
    });
    expect(match?.candidates).toHaveLength(1);
    expect(match?.candidates[0]).toMatchObject({
      path: relative,
      match: "relative-path",
      automatic: false,
    });
    expect(match?.candidates[0]?.reason).toContain("confirmation");
  });
  it("matches filename and actual byte size after folder layout changes and retains equal-rank ambiguity", async () => {
    await file("new/day-a/photo.jpg", "right");
    await file("new/day-b/photo.jpg", "other");
    await file("new/day-c/photo.jpg", "too long");
    const oldRoot = join(directory, "old");
    const original = asset(join(oldRoot, "old-day", "photo.jpg"), {
      metadata: { "openfilm.filesystem": { size: 5 } },
    });
    const [match] = await planMediaRelink([original], [library(oldRoot)], {
      folder: join(directory, "new"),
    });
    expect(match?.candidates).toHaveLength(2);
    expect(
      match?.candidates.every(
        (candidate) =>
          candidate.match === "filename-size" &&
          !candidate.automatic &&
          candidate.fileSize === 5,
      ),
    ).toBe(true);
    expect(match?.suggestedId).toBeUndefined();
  });
  it("never treats filename alone as enough evidence but accepts an explicit hashless manual candidate", async () => {
    const sameName = await file("new/different/photo.jpg", "unverified");
    const oldRoot = join(directory, "old"),
      original = asset(join(oldRoot, "day", "photo.jpg"));
    const [folderMatch] = await planMediaRelink(
      [original],
      [library(oldRoot)],
      { folder: join(directory, "new") },
    );
    expect(folderMatch?.candidates).toEqual([]);
    expect(folderMatch?.reason).toContain("filename alone is insufficient");
    const [manualMatch] = await planMediaRelink(
      [original],
      [library(oldRoot)],
      { file: sameName },
    );
    expect(manualMatch?.candidates[0]).toMatchObject({
      path: sameName,
      automatic: false,
      match: "manual",
    });
    expect(manualMatch?.candidates[0]?.reason).toContain("Verify");
  });
  it("compares original Windows relative paths case-insensitively after relinking onto a Linux mount", async () => {
    const moved = await file("mounted/day/photo.jpg", "legacy");
    const original = asset("/unused", {
      uri: "file:///D:/Travel/Day/PHOTO.JPG",
    });
    const [match] = await planMediaRelink(
      [original],
      [{ id: "travel", name: "Travel", uri: "D:/Travel" }],
      { folder: join(directory, "mounted") },
    );
    expect(match?.candidates[0]).toMatchObject({
      path: moved,
      match: "relative-path",
      automatic: false,
    });
  });
  it("rejects symlink and directory file selections, refuses linked roots, and never traverses linked children", async () => {
    const actual = await file("outside/photo.jpg", "same");
    await mkdir(join(directory, "new"));
    await symlink(actual, join(directory, "new", "photo.jpg"));
    await symlink(
      join(directory, "outside"),
      join(directory, "new", "linked"),
      "dir",
    );
    await symlink(
      join(directory, "new"),
      join(directory, "linked-root"),
      "dir",
    );
    const original = asset(join(directory, "old", "photo.jpg"), {
      contentHash: digest("same"),
    });
    const [match] = await planMediaRelink([original], [], {
      folder: join(directory, "new"),
    });
    expect(match?.candidates).toEqual([]);
    expect(match?.reason).toContain("symbolic link");
    await expect(
      planMediaRelink([original], [], {
        file: join(directory, "new", "photo.jpg"),
      }),
    ).rejects.toThrow("Symbolic links");
    await expect(
      planMediaRelink([original], [], {
        folder: join(directory, "linked-root"),
      }),
    ).rejects.toThrow("Symbolic links");
    await expect(
      planMediaRelink([original], [], { file: join(directory, "outside") }),
    ).rejects.toThrow("regular file");
  });
  it("accepts escaped file URLs, supplies deterministic candidate IDs, and validates exactly one scan input", async () => {
    const chosen = await file("new/a #1.jpg", "same");
    const original = asset(join(directory, "old", "original.jpg"), {
      contentHash: digest("same"),
    });
    const first = await planMediaRelink([original], [], { file: uri(chosen) });
    expect(await planMediaRelink([original], [], { file: chosen })).toEqual(
      first,
    );
    expect(first[0]?.candidates[0]?.uri).toBe(uri(chosen));
    await expect(planMediaRelink([original], [], {})).rejects.toThrow(
      "exactly one",
    );
    await expect(
      planMediaRelink([original], [], { folder: directory, file: chosen }),
    ).rejects.toThrow("exactly one");
    await expect(
      planMediaRelink([original], [], { folder: chosen }),
    ).rejects.toThrow("directory");
    await expect(
      planMediaRelink([original], [], {
        file: "https://example.invalid/source.jpg",
      }),
    ).rejects.toThrow("local");
  });
  it("retains explicit original URI and identifiers in already-portable metadata", () => {
    const stored: PortableReference = {
      originalUri: "file:///D:/camera/001.jpg",
      filename: "001.jpg",
      contentHash: digest("bytes"),
      fileSize: 5,
      mediaLibraryId: "media-id",
      relativePath: "camera/001.jpg",
      volumeId: "logical-uuid",
      rootUri: uri(directory),
    };
    expect(
      referenceFor(
        asset(join(directory, "camera", "001.jpg"), {
          metadata: { "openfilm.reference": stored },
        }),
        [],
      ),
    ).toEqual(stored);
  });
});
