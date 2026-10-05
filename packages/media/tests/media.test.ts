import { link, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateSampleMedia } from "../../../fixtures/sample-media/generate.mjs";
import type { MediaSourceAdapter } from "@openfilm/plugin-sdk";
import {
  FilesystemSource,
  createProxy,
  createThumbnail,
  hashFile,
  inspectMedia,
  perceptualHash,
  runProcess,
  safeProjectCachePath,
} from "../src/index";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openfilm-media-"));
  await generateSampleMedia(directory);
});
afterEach(async () => {
  await rm(join(directory, "loop"), { force: true });
});

describe("real local media adapters", () => {
  it("scans safely, normalizes metadata and fingerprints streamed originals", async () => {
    await symlink(directory, join(directory, "loop"));
    const candidates = await new FilesystemSource().scan(directory);
    expect(candidates).toHaveLength(5);
    const image = await inspectMedia(
      candidates.find((item) => item.name === "01-photo.png")!,
    );
    const video = await inspectMedia(
      candidates.find((item) => item.name === "04-motion.mp4")!,
    );
    expect(image.dimensions).toEqual({ width: 320, height: 180 });
    expect(image.capturedAt).toBe("2024-06-15T12:00:00.000Z");
    expect(video.duration).toBeCloseTo(3, 1);
    expect(video.capturedAtSource).not.toMatch(/filesystem/i);
    const source: MediaSourceAdapter = new FilesystemSource();
    const metadata = await source.extractMetadata(
      { uri: image.uri, name: image.name },
      {},
    );
    expect(metadata.dimensions).toEqual({ width: 320, height: 180 });
    expect("uri" in metadata).toBe(false);
    expect(await hashFile(join(directory, "01-photo.png"))).toBe(
      await hashFile(join(directory, "02-photo-copy.png")),
    );
    expect(await perceptualHash(join(directory, "01-photo.png"))).toBe(
      await perceptualHash(join(directory, "02-photo-copy.png")),
    );
    expect(await perceptualHash(join(directory, "01-photo.png"))).not.toBe(
      await perceptualHash(join(directory, "03-evening.png")),
    );
  });

  it("rejects malformed input and symlink cache paths, and aborts child processes", async () => {
    await writeFile(join(directory, "broken.mp4"), "this is not a movie");
    const candidates = await new FilesystemSource().scan(directory);
    await expect(
      inspectMedia(candidates.find((item) => item.name === "broken.mp4")!),
    ).rejects.toThrow("ffprobe");
    const project = join(directory, "project");
    await mkdir(project);
    await symlink(directory, join(project, "cache"));
    await expect(
      safeProjectCachePath(project, "thumbnail.jpg"),
    ).rejects.toThrow("symlinks");
    await expect(
      safeProjectCachePath(project, "..", "outside.jpg"),
    ).rejects.toThrow("inside");
    const controller = new AbortController();
    const command = runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "color=black:s=32x32",
        "-f",
        "null",
        "-",
      ],
      { signal: controller.signal },
    );
    controller.abort();
    await expect(command).rejects.toMatchObject({ name: "AbortError" });
    await rm(project, { recursive: true });
    await rm(join(directory, "broken.mp4"));
  });

  it("reads actual timezone-bearing EXIF through the vendored Perl adapter", async () => {
    const path = join(directory, "dated.jpg");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=blue:s=64x64",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-update",
      "1",
      "-y",
      path,
    ]);
    const require = createRequire(import.meta.url);
    const script = join(
      dirname(require.resolve("exiftool-vendored.pl/package.json")),
      "bin",
      "exiftool",
    );
    await runProcess("perl", [
      script,
      "-overwrite_original",
      "-DateTimeOriginal=2020:02:03 04:05:06",
      "-OffsetTimeOriginal=+08:00",
      path,
    ]);
    const asset = await inspectMedia({
      path,
      uri: pathToFileURL(path).href,
      name: "dated.jpg",
    });
    expect(asset.capturedAt).toBe("2020-02-02T20:05:06.000Z");
    expect(asset.capturedAtSource).toMatch(/exif/i);
    expect(asset.metadata["openfilm.metadata.exiftoolAvailable"]).toBe(true);
    await rm(path);
  });

  it("rejects hardlinked thumbnail and proxy destinations without changing source hashes", async () => {
    for (const [sourceName, outputName, derive] of [
      ["01-photo.png", "hardlinked-thumbnail.jpg", createThumbnail],
      ["04-motion.mp4", "hardlinked-proxy.mp4", createProxy],
    ] as const) {
      const source = join(directory, sourceName);
      const output = join(directory, outputName);
      const before = await hashFile(source);
      const asset = await inspectMedia({
        path: source,
        uri: pathToFileURL(source).href,
        name: sourceName,
      });
      await link(source, output);
      await expect(derive(asset, output)).rejects.toThrow("aliases source");
      expect(await hashFile(source)).toBe(before);
      await rm(output);
    }
  });
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
