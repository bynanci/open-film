import { createHash } from "node:crypto";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeBenchmarkFixtureManifest } from "../../scripts/native-benchmark/create-fixture";
import { validateNativeBenchmarkFixture } from "../../scripts/native-benchmark/validate-fixture";

const unavailableIdentities = vi.hoisted(() => new Set<string>());
// The filesystem's unavailable inode boundary is injected; file creation,
// links/copies, canonical paths, streamed hashes and sizes remain real.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const info = await actual.stat(...args);
      if (
        typeof args[0] === "string" &&
        unavailableIdentities.has(args[0]) &&
        typeof info.ino === "bigint"
      )
        info.ino = 0n;
      return info;
    },
  };
});

const directories: string[] = [];
async function fixture(linkedMediaCount = 0) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-fixture-validation-"));
  directories.push(root);
  const project = join(root, "benchmark.openfilm");
  await mkdir(join(project, "cache", "thumbnails"), { recursive: true });
  await mkdir(join(root, "generated"));
  await mkdir(join(root, "media"));
  const contents = [
    ["generated/source.mp4", "generated source bytes"],
    ["benchmark.openfilm/cache/thumbnails/benchmark.jpg", "thumbnail bytes"],
    ["benchmark.openfilm/project.json", '{"id":"fixture-project"}'],
    ["benchmark.openfilm/database.sqlite", "finalized database bytes"],
    ["media/0000.mp4", "generated source bytes"],
    ["media/0001.mp4", "generated source bytes"],
  ];
  const descriptors = [];
  for (const [relativePath, text] of contents) {
    const bytes = Buffer.from(text!);
    await writeFile(join(root, relativePath!), bytes);
    descriptors.push({
      relativePath: relativePath!,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      fileSize: bytes.length,
    });
  }
  for (let index = 0; index < linkedMediaCount; index++) {
    const path = join(root, `media/${String(index).padStart(4, "0")}.mp4`);
    await rm(path);
    await link(join(root, "generated/source.mp4"), path);
  }
  const manifest: NativeBenchmarkFixtureManifest = {
    fixtureVersion: "1.0.0",
    createdAt: "2026-10-13T00:00:00.000Z",
    counts: { assets: 2, clips: 2, beats: 1 },
    durationSeconds: 6,
    projectRelativePath: "benchmark.openfilm",
    generator: {
      ffmpegVersion: "ffmpeg test fixture",
      nodeVersion: "v24.14.0",
    },
    source: {
      ...descriptors[0]!,
      durationSeconds: 3,
      width: 320,
      height: 180,
      frameRate: 24,
      videoCodec: "h264",
      audioCodec: "aac",
    },
    files: descriptors.slice(0, 4),
    media: descriptors.slice(4).map((file, index) => ({
      ...file,
      assetId: `asset-${index}`,
    })),
    linkedMediaCount,
    copiedMediaCount: 2 - linkedMediaCount,
    limitations: ["Small file-identity fixture; not actual media decoding QA."],
  };
  const manifestPath = join(root, "fixture-manifest.json");
  const save = () => writeFile(manifestPath, JSON.stringify(manifest));
  await save();
  return { root, project, manifest, manifestPath, save };
}
afterEach(async () => {
  unavailableIdentities.clear();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("native benchmark fixture preflight", () => {
  it("accepts the manifest's exact project and validates files for Welcome too", async () => {
    const f = await fixture();
    expect(
      await validateNativeBenchmarkFixture(f.manifestPath, f.project),
    ).toEqual(f.manifest);
    expect(await validateNativeBenchmarkFixture(f.manifestPath)).toEqual(
      f.manifest,
    );
  });

  it("accepts a genuine mixed fixture with source hard links and independent copies", async () => {
    const f = await fixture(1);
    const source = await stat(join(f.root, f.manifest.source.relativePath), {
      bigint: true,
    });
    const linked = await stat(join(f.root, f.manifest.media[0]!.relativePath), {
      bigint: true,
    });
    const copied = await stat(join(f.root, f.manifest.media[1]!.relativePath), {
      bigint: true,
    });
    expect([linked.dev, linked.ino]).toEqual([source.dev, source.ino]);
    expect([copied.dev, copied.ino]).not.toEqual([source.dev, source.ino]);

    expect(
      await validateNativeBenchmarkFixture(f.manifestPath, f.project),
    ).toEqual(f.manifest);
  });

  it("rejects a declared hard link replaced by a byte-identical independent copy", async () => {
    const f = await fixture(2);
    const source = join(f.root, f.manifest.source.relativePath);
    const media = join(f.root, f.manifest.media[0]!.relativePath);
    await rm(media);
    await copyFile(source, media);
    expect(await readFile(media)).toEqual(await readFile(source));

    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/topology|link.*count|cop.*count/iu);
  });

  it("rejects byte-identical source replacement that detaches the declared media links", async () => {
    const f = await fixture(2);
    const source = join(f.root, f.manifest.source.relativePath);
    const backup = join(f.root, "generated/source-backup.mp4");
    await copyFile(source, backup);
    await rm(source);
    await rename(backup, source);
    expect(await readFile(source)).toEqual(
      await readFile(join(f.root, f.manifest.media[0]!.relativePath)),
    );

    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/topology|independent|alias/iu);
  });

  it("rejects a declared independent copy replaced by a source hard link", async () => {
    const f = await fixture();
    const source = join(f.root, f.manifest.source.relativePath);
    const media = join(f.root, f.manifest.media[0]!.relativePath);
    await rm(media);
    await link(source, media);
    expect(await readFile(media)).toEqual(await readFile(source));

    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/topology|link.*count|cop.*count/iu);
  });

  it("rejects copied media that alias one another despite matching bytes and aggregate counts", async () => {
    const f = await fixture();
    const first = join(f.root, f.manifest.media[0]!.relativePath);
    const second = join(f.root, f.manifest.media[1]!.relativePath);
    await rm(second);
    await link(first, second);
    expect(await readFile(first)).toEqual(await readFile(second));

    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/topology|independent|alias/iu);
  });

  it("requires declared link and copy counts to match actual filesystem identities", async () => {
    const f = await fixture();
    f.manifest.linkedMediaCount = 1;
    f.manifest.copiedMediaCount = 1;
    await f.save();

    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/topology|link.*count|cop.*count/iu);
  });

  it.each(["generated/source.mp4", "media/0000.mp4"])(
    "rejects unavailable filesystem identity for source or media: %s",
    async (relativePath) => {
      const f = await fixture(2);
      unavailableIdentities.add(join(f.root, relativePath));

      await expect(
        validateNativeBenchmarkFixture(f.manifestPath),
      ).rejects.toThrow(/identity.*unavailable|unavailable.*identity/iu);
    },
  );

  it("does not treat unavailable inode identities as verified source hard links", async () => {
    const f = await fixture(2);
    for (const file of [f.manifest.source, ...f.manifest.media])
      unavailableIdentities.add(join(f.root, file.relativePath));

    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/identity.*unavailable|unavailable.*identity/iu);
  });

  it("binds to the canonical project even when its path uses a directory alias", async () => {
    const f = await fixture();
    const alias = join(f.root, "project-alias.openfilm");
    await symlink(f.project, alias, "junction");
    expect(await validateNativeBenchmarkFixture(f.manifestPath, alias)).toEqual(
      f.manifest,
    );
  });

  it("rejects an unrelated project even when its declared files are identical", async () => {
    const f = await fixture();
    const unrelated = join(f.root, "unrelated.openfilm");
    await mkdir(unrelated);
    for (const name of ["project.json", "database.sqlite"])
      await copyFile(join(f.project, name), join(unrelated, name));
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath, unrelated),
    ).rejects.toThrow(/project.*manifest|manifest.*project/iu);
  });

  it.each([
    "benchmark.openfilm/project.json",
    "benchmark.openfilm/database.sqlite",
    "benchmark.openfilm/cache/thumbnails/benchmark.jpg",
    "generated/source.mp4",
    "media/0001.mp4",
  ])("rejects changed content with the same byte length: %s", async (path) => {
    const f = await fixture();
    const filePath = join(f.root, path);
    const original = await readFile(filePath);
    const modified = Buffer.from(original);
    modified[0] = modified[0]! ^ 1;
    await writeFile(filePath, modified);
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath, f.project),
    ).rejects.toThrow(/hash|sha256/iu);
    expect(JSON.parse(await readFile(f.manifestPath, "utf8"))).toEqual(
      f.manifest,
    );
  });

  it("rejects changed size before accepting the declared hash", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "media/0001.mp4"), "different size");
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/size/iu);
  });

  it("rejects undeclared nonempty WAL pages even when the main database hash matches", async () => {
    const f = await fixture();
    await writeFile(
      join(f.project, "database.sqlite-wal"),
      "unhashed pending pages",
    );
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath, f.project),
    ).rejects.toThrow(/WAL|write-ahead/iu);
  });

  it("accepts an undeclared empty WAL without payload", async () => {
    const f = await fixture();
    await writeFile(join(f.project, "database.sqlite-wal"), "");
    expect(
      await validateNativeBenchmarkFixture(f.manifestPath, f.project),
    ).toEqual(f.manifest);
  });

  it("accepts explicitly declared WAL pages only with their matching size and hash", async () => {
    const f = await fixture();
    const bytes = Buffer.from("declared write-ahead pages");
    await writeFile(join(f.project, "database.sqlite-wal"), bytes);
    f.manifest.files.push({
      relativePath: "benchmark.openfilm/database.sqlite-wal",
      fileSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await f.save();
    expect(
      await validateNativeBenchmarkFixture(f.manifestPath, f.project),
    ).toEqual(f.manifest);
    bytes[0] = bytes[0]! ^ 1;
    await writeFile(join(f.project, "database.sqlite-wal"), bytes);
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath, f.project),
    ).rejects.toThrow(/hash|SHA256/iu);
  });

  it.each(["benchmark.openfilm/database.sqlite", "media/0001.mp4"])(
    "rejects a missing required artifact: %s",
    async (path) => {
      const f = await fixture();
      await rm(join(f.root, path));
      await expect(
        validateNativeBenchmarkFixture(f.manifestPath),
      ).rejects.toThrow(/ENOENT|missing|not found/iu);
    },
  );

  it.each(["project.json", "database.sqlite"])(
    "requires a declared project artifact: %s",
    async (name) => {
      const f = await fixture();
      f.manifest.files = f.manifest.files.filter(
        (file) => file.relativePath !== `benchmark.openfilm/${name}`,
      );
      await f.save();
      await expect(
        validateNativeBenchmarkFixture(f.manifestPath),
      ).rejects.toThrow(/declar|required/iu);
    },
  );

  it("rejects a source descriptor inconsistent with its declared file", async () => {
    const f = await fixture();
    f.manifest.source.sha256 = "0".repeat(64);
    await f.save();
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/source|hash|sha256/iu);
  });

  it.each([
    "../outside.mp4",
    "/absolute.mp4",
    "C:/absolute.mp4",
    "C:drive-relative.mp4",
    "media/../0001.mp4",
    "media\\0001.mp4",
    "media//0001.mp4",
    "./media/0001.mp4",
    "media/\0invalid.mp4",
  ])("rejects unsafe or ambiguous declared paths: %j", async (path) => {
    const f = await fixture();
    f.manifest.media[1]!.relativePath = path;
    await f.save();
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/relative|path/iu);
  });

  it("rejects a directory symlink escaping the fixture root", async () => {
    const f = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "openfilm-outside-fixture-"));
    directories.push(outside);
    await rename(f.project, join(outside, "project"));
    await symlink(join(outside, "project"), f.project, "junction");
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath, f.project),
    ).rejects.toThrow(/outside|escape|root/iu);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a media file symlink escaping the root even with matching bytes",
    async () => {
      const f = await fixture();
      const outside = await mkdtemp(join(tmpdir(), "openfilm-outside-media-"));
      directories.push(outside);
      const external = join(outside, "external.mp4");
      const original = join(f.root, "media/0001.mp4");
      await copyFile(original, external);
      await rm(original);
      await symlink(external, original);
      await expect(
        validateNativeBenchmarkFixture(f.manifestPath),
      ).rejects.toThrow(/outside|escape|root/iu);
    },
  );

  it.each(["files", "media"] as const)(
    "rejects duplicate paths in %s",
    async (collection) => {
      const f = await fixture();
      if (collection === "files")
        f.manifest.files.push({ ...f.manifest.files[0]! });
      else
        f.manifest.media[1]!.relativePath = f.manifest.media[0]!.relativePath;
      await f.save();
      await expect(
        validateNativeBenchmarkFixture(f.manifestPath),
      ).rejects.toThrow(/duplicate/iu);
    },
  );

  it("rejects media paths duplicated from the files collection", async () => {
    const f = await fixture();
    f.manifest.media[1]!.relativePath = f.manifest.source.relativePath;
    await f.save();
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/duplicate/iu);
  });

  it("rejects duplicate asset IDs", async () => {
    const f = await fixture();
    f.manifest.media[1]!.assetId = f.manifest.media[0]!.assetId;
    await f.save();
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/duplicate.*asset/iu);
  });

  it("requires one media declaration for every asset", async () => {
    const f = await fixture();
    f.manifest.media.pop();
    await f.save();
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow(/media|count/iu);
  });

  it.each([
    { fixtureVersion: "2.0.0" },
    { projectRelativePath: "../benchmark.openfilm" },
    { counts: { assets: 2, clips: 3, beats: 1 } },
    { counts: { assets: 2, clips: 2, beats: 3 } },
    { counts: { assets: 10001, clips: 2, beats: 1 } },
    { counts: { assets: 0, clips: 2, beats: 1 } },
    { counts: { assets: 2, clips: 1.5, beats: 1 } },
    { counts: null },
    { source: null },
    { files: null },
    { media: null },
    { durationSeconds: -1 },
    { linkedMediaCount: 3 },
  ])("rejects invalid manifest structure: %j", async (change) => {
    const f = await fixture();
    await writeFile(
      f.manifestPath,
      JSON.stringify({ ...f.manifest, ...change }),
    );
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow();
  });

  it.each([
    { sha256: "not-a-hash" },
    { fileSize: -1 },
    { fileSize: 1.5 },
    { relativePath: "" },
  ])("rejects invalid file identity: %j", async (change) => {
    const f = await fixture();
    Object.assign(f.manifest.media[1]!, change);
    await f.save();
    await expect(
      validateNativeBenchmarkFixture(f.manifestPath),
    ).rejects.toThrow();
  });

  it("supports Unicode, spaces, # and & without interpreting file paths", async () => {
    const f = await fixture();
    const path = "media/青森 記憶 # &.mp4";
    await rename(
      join(f.root, f.manifest.media[1]!.relativePath),
      join(f.root, path),
    );
    f.manifest.media[1]!.relativePath = path;
    await f.save();
    expect(
      await validateNativeBenchmarkFixture(f.manifestPath, f.project),
    ).toEqual(f.manifest);
    expect((await stat(join(f.root, path))).isFile()).toBe(true);
  });
});
