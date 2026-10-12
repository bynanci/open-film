import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { inspectMedia, referenceFor, sourceStatus } from "@openfilm/media";
import {
  createNativeBenchmarkFixture,
  NATIVE_BENCHMARK_DEFAULT_COUNTS,
  type NativeBenchmarkFixtureManifest,
} from "../../scripts/native-benchmark/create-fixture";

const directories: string[] = [];
async function destination() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-native-fixture-"));
  directories.push(root);
  return join(root, "benchmark 青森 # &");
}
const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("generated native workstation benchmark fixture", () => {
  it("reopens the default 500-clip workload with complete source identities and finalized hashes", async () => {
    const directory = await destination();
    const result = await createNativeBenchmarkFixture(directory);
    const manifest = JSON.parse(
      await readFile(result.manifestPath, "utf8"),
    ) as NativeBenchmarkFixtureManifest;
    expect(manifest.fixtureVersion).toBe("1.0.0");
    expect(manifest.counts).toEqual(NATIVE_BENCHMARK_DEFAULT_COUNTS);
    expect(manifest.counts).toEqual({ assets: 2000, clips: 500, beats: 10 });
    expect(manifest.durationSeconds).toBe(1500);
    expect(manifest.media).toHaveLength(2000);
    expect(manifest.linkedMediaCount + manifest.copiedMediaCount).toBe(2000);
    expect(manifest.limitations.join(" ")).toContain("not ASR");
    expect(manifest.limitations.join(" ")).toContain("not 4K");
    expect(manifest.generator.ffmpegVersion).toContain("ffmpeg version");
    const sourcePath = join(directory, manifest.source.relativePath);
    const metadata = await inspectMedia({
      uri: pathToFileURL(sourcePath).href,
      path: sourcePath,
      name: "source.mp4",
    });
    expect(metadata.duration).toBe(3);
    expect(metadata.dimensions).toEqual({ width: 320, height: 180 });
    expect(metadata.frameRate).toBe(24);
    expect(metadata.codec).toBe("h264");
    for (const file of manifest.files)
      expect(sha256(await readFile(join(directory, file.relativePath)))).toBe(
        file.sha256,
      );
    expect(manifest.files.map((file) => file.relativePath)).toEqual([
      "generated/source.mp4",
      "benchmark.openfilm/cache/thumbnails/benchmark.jpg",
      "benchmark.openfilm/project.json",
      "benchmark.openfilm/database.sqlite",
    ]);
    for (const media of [manifest.media[0]!, manifest.media.at(-1)!]) {
      const path = join(directory, media.relativePath);
      expect(sha256(await readFile(path))).toBe(media.sha256);
      expect((await stat(path)).size).toBe(media.fileSize);
    }
    const app = await OpenFilmApplication.open(result.projectPath, {
      userDataDirectory: join(directory, "isolated-user-data"),
    });
    try {
      expect(app.catalog.countAssets()).toBe(2000);
      const story = app.project.stories[0]!;
      const composition = app.project.timelines[0]!;
      const clips = composition.tracks[0]!.clips;
      expect(story.beats).toHaveLength(10);
      expect(composition.duration).toBe(1500);
      expect(clips).toHaveLength(500);
      expect(clips[0]).toMatchObject({
        id: "benchmark-0000",
        assetId: "asset-0000",
        sourceIn: 0,
        sourceOut: 3,
        timelineStart: 0,
        timelineDuration: 3,
      });
      expect(clips.at(-1)).toMatchObject({
        id: "benchmark-0499",
        beatId: "beat-9",
        timelineStart: 1497,
      });
      for (const beat of story.beats) {
        const selected = clips.filter((clip) => clip.beatId === beat.id);
        expect(selected).toHaveLength(50);
        expect(beat.selectedAssetIds).toEqual(
          selected.map((clip) => clip.assetId),
        );
        expect(beat.constraints).toContainEqual({
          type: "asset-order",
          assetIds: selected.map((clip) => clip.assetId),
        });
      }
      for (const id of ["asset-0000", "asset-1999"]) {
        const asset = app.catalog.getAsset(id)!;
        expect(await sourceStatus(asset)).toMatchObject({
          status: "available",
        });
        expect(fileURLToPath(asset.uri)).toBe(
          await realpath(join(directory, "media", `${id.slice(6)}.mp4`)),
        );
        expect(referenceFor(asset, app.project.mediaLibraries)).toMatchObject({
          mediaLibraryId: "benchmark-library",
          relativePath: `${id.slice(6)}.mp4`,
          contentHash: manifest.files[0]!.sha256,
        });
        expect(asset.thumbnailUri).toBe("cache/thumbnails/benchmark.jpg");
      }
      expect(
        app.catalog.intelligence.getTranscript(
          "asset-0000",
          manifest.source.sha256,
        ),
      ).toBeUndefined();
    } finally {
      app.close();
    }
  });

  it("distributes a smaller non-divisible workload without dropping clips or empty beats", async () => {
    const directory = await destination();
    const result = await createNativeBenchmarkFixture(directory, {
      assets: 8,
      clips: 7,
      beats: 3,
    });
    const app = await OpenFilmApplication.open(result.projectPath, {
      userDataDirectory: join(directory, "isolated-user-data"),
    });
    try {
      expect(app.catalog.countAssets()).toBe(8);
      const clips = app.project.timelines[0]!.tracks[0]!.clips;
      expect(clips).toHaveLength(7);
      expect(app.project.timelines[0]!.duration).toBe(21);
      const beats = app.project.stories[0]!.beats;
      expect(beats.map((beat) => beat.targetDuration)).toEqual([9, 6, 6]);
      expect(beats.flatMap((beat) => beat.selectedAssetIds)).toEqual(
        clips.map((clip) => clip.assetId),
      );
    } finally {
      app.close();
    }
  });

  it("refuses an existing destination without overwriting any file", async () => {
    const path = await destination();
    await writeFile(path, "existing user data");
    await expect(createNativeBenchmarkFixture(path)).rejects.toThrow(
      "must not already exist",
    );
    expect(await readFile(path, "utf8")).toBe("existing user data");
  });

  it("refuses even an empty existing directory and concurrent fixture creators", async () => {
    const existing = await destination();
    await mkdir(existing);
    await expect(createNativeBenchmarkFixture(existing)).rejects.toThrow(
      "must not already exist",
    );
    const fresh = await destination();
    const results = await Promise.allSettled([
      createNativeBenchmarkFixture(fresh, { assets: 2, clips: 2, beats: 1 }),
      createNativeBenchmarkFixture(fresh, { assets: 2, clips: 2, beats: 1 }),
    ]);
    expect(
      results.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    expect(results.filter((entry) => entry.status === "rejected")).toHaveLength(
      1,
    );
    const manifest = JSON.parse(
      await readFile(join(fresh, "fixture-manifest.json"), "utf8"),
    ) as NativeBenchmarkFixtureManifest;
    expect(manifest.counts).toEqual({ assets: 2, clips: 2, beats: 1 });
    expect(manifest.media).toHaveLength(2);
  });

  it.each([
    { assets: 0 },
    { clips: 0 },
    { beats: 0 },
    { assets: 3, clips: 4 },
    { assets: 3, clips: 3, beats: 4 },
    { clips: 1.5 },
    { assets: 10001 },
  ])("rejects invalid counts before creating files: %j", async (counts) => {
    const path = await destination();
    await expect(createNativeBenchmarkFixture(path, counts)).rejects.toThrow();
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
