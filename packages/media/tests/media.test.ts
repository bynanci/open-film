import { link, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { generateSampleMedia } from "../../../fixtures/sample-media/generate.mjs";
import type {
  MediaSourceAdapter,
  MediaSourceAdapterV2,
} from "@openfilm/plugin-sdk";
import {
  FilesystemSource,
  createProxy,
  createThumbnail,
  extractRepresentativeFrame,
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
  await rm(join(directory, "streaming"), { recursive: true, force: true });
  await rm(join(directory, "sample-frame.jpg"), { force: true });
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
    const streamingSource: MediaSourceAdapterV2 = new FilesystemSource();
    expect(streamingSource.id).toBe(source.id);
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

  it("extracts deterministic bounded representative frames from synthetic still and moving media", async () => {
    const imagePath = join(directory, "01-photo.png");
    const videoPath = join(directory, "04-motion.mp4");
    const image = await inspectMedia({
      path: imagePath,
      uri: pathToFileURL(imagePath).href,
      name: "01-photo.png",
    });
    const video = await inspectMedia({
      path: videoPath,
      uri: pathToFileURL(videoPath).href,
      name: "04-motion.mp4",
    });
    const sourceHashBefore = await hashFile(videoPath);
    const stillA = await extractRepresentativeFrame(image, 0);
    const stillB = await extractRepresentativeFrame(image, 0);
    const motionA = await extractRepresentativeFrame(video, 0.5);
    const motionB = await extractRepresentativeFrame(video, 2);
    expect(stillA).toMatchObject({
      mimeType: "image/jpeg",
      width: 640,
      height: 360,
    });
    expect(stillA.bytes.byteLength).toBeLessThanOrEqual(512 * 1024);
    expect(Buffer.from(stillA.bytes)).toEqual(Buffer.from(stillB.bytes));
    expect(Buffer.from(motionA.bytes)).not.toEqual(Buffer.from(motionB.bytes));
    await writeFile(join(directory, "sample-frame.jpg"), motionA.bytes);
    const decoded = await runProcess("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      join(directory, "sample-frame.jpg"),
    ]);
    expect(decoded.stdout.toString("utf8").trim()).toBe("640x360");
    expect(await hashFile(videoPath)).toBe(sourceHashBefore);
  });

  it("streams relative paths, honors recursion, and never follows symlinks", async () => {
    const root = join(directory, "streaming");
    const nested = join(root, "nested");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "root.jpg"), "synthetic image bytes");
    await writeFile(join(root, "notes.txt"), "not media");
    await writeFile(join(nested, "nested.mp4"), "synthetic video bytes");
    await symlink(join(root, "root.jpg"), join(root, "linked.jpg"));
    const source = new FilesystemSource();
    const notices: Array<{ reason: string; relativePath?: string }> = [];
    const shallow: string[] = [];
    for await (const candidate of source.discover(
      {
        uri: pathToFileURL(root).href,
        type: "folder",
        options: { recursive: false },
      },
      { onSkipped: (notice) => notices.push(notice) },
    ))
      shallow.push(candidate.relativePath!);

    expect(shallow).toEqual(["root.jpg"]);
    expect(notices).toContainEqual({
      reason: "unsupported",
      relativePath: "notes.txt",
    });
    expect(notices).toContainEqual({
      reason: "symlink",
      relativePath: "linked.jpg",
    });

    const recursive: string[] = [];
    for await (const candidate of source.discover(root))
      recursive.push(candidate.relativePath!);
    expect(recursive).toEqual(
      expect.arrayContaining(["root.jpg", "nested/nested.mp4"]),
    );
    expect(recursive).not.toContain("linked.jpg");
    await expect(
      source.discover(join(root, "linked.jpg")).next(),
    ).rejects.toThrow("symlinks");
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
