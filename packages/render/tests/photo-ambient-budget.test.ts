import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import type { Clip, FrameSize, MediaAsset } from "@openfilm/core";
import * as media from "@openfilm/media";
import { preparePhotoAmbientFills } from "../src/photo-ambient.js";
import { FFmpegRenderer } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const clip: Clip = {
  id: "photo",
  assetId: "source",
  timelineStart: 0,
  timelineDuration: 6,
  layout: {
    version: 2,
    preset: "contain",
    fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
  },
};
const frame = { width: 3840, height: 2160 };
async function fixture(dimensions: FrameSize, metadata = {}) {
  const work = await mkdtemp(join(tmpdir(), "openfilm-ambient-budget-"));
  roots.push(work);
  const path = join(work, "original.png");
  // A bounded 1x1 PNG: no child process or allocation of the claimed geometry.
  await writeFile(
    path,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const asset: MediaAsset = {
    id: "source",
    uri: pathToFileURL(path).href,
    name: "Original",
    mediaType: "image",
    dimensions,
    metadata,
    tags: [],
    state: {},
  };
  // Fail closed at the process boundary even while observing RED. Never execute
  // FFmpeg with adversarial geometry, including if admission regresses later.
  const spawn = vi
    .spyOn(media, "runProcess")
    .mockRejectedValue(new Error("test subprocess fence"));
  return { work, asset, spawn, originalHash: await media.hashFile(path) };
}

it.each([
  ["portrait cover", { width: 100, height: 20000 }, frame, {}],
  ["landscape cover", { width: 20000, height: 100 }, frame, {}],
  [
    "SAR cover",
    { width: 100, height: 100 },
    frame,
    {
      "openfilm.ffprobe": {
        streams: [{ codec_type: "video", sample_aspect_ratio: "200:1" }],
      },
    },
  ],
  [
    "display cover",
    { width: 100, height: 100 },
    frame,
    { "openfilm.display": { version: 1, width: 100, height: 20000 } },
  ],
  [
    "RGBA byte budget",
    { width: 2048, height: 8193 },
    { width: 2048, height: 1024 },
    {},
  ],
  [
    "intermediate edge",
    { width: 100, height: 8193 },
    { width: 100, height: 100 },
    {},
  ],
  ["frame edge", { width: 100, height: 100 }, { width: 4097, height: 1 }, {}],
  [
    "unsafe frame product",
    { width: 100, height: 100 },
    { width: Number.MAX_SAFE_INTEGER, height: 2 },
    {},
  ],
  [
    "unsafe source product",
    { width: Number.MAX_SAFE_INTEGER, height: 2 },
    frame,
    {},
  ],
  ["nonfinite source", { width: Infinity, height: 100 }, frame, {}],
  [
    "overflowed display",
    { width: 100, height: 100 },
    frame,
    { "openfilm.display": { version: 1, width: 1e308, height: 1e308 } },
  ],
  ["subnormal source", { width: Number.MIN_VALUE, height: 1 }, frame, {}],
  [
    "overflowed cover",
    { width: 1, height: 1 },
    frame,
    { "openfilm.display": { version: 1, width: Number.MIN_VALUE, height: 1 } },
  ],
] as const)(
  "rejects %s before any subprocess or private-copy publication",
  async (_name, dimensions, output, metadata) => {
    const { work, asset, spawn, originalHash } = await fixture(
      dimensions,
      metadata,
    );
    await expect(
      preparePhotoAmbientFills([clip], [asset], output, work),
    ).rejects.toMatchObject({ code: "request.tooLarge", status: 413 });
    expect(spawn).not.toHaveBeenCalled();
    expect(await readdir(work)).toEqual(["original.png"]);
    expect(await media.hashFile(new URL(asset.uri).pathname)).toBe(
      originalHash,
    );
  },
);

it.each([
  [
    "RGBA boundary",
    { width: 2048, height: 8192 },
    { width: 2048, height: 1024 },
  ],
  ["edge boundary", { width: 100, height: 8192 }, { width: 100, height: 100 }],
  [
    "ordinary portrait",
    { width: 100, height: 200 },
    { width: 320, height: 180 },
  ],
  [
    "ordinary landscape",
    { width: 200, height: 100 },
    { width: 320, height: 180 },
  ],
  ["4K frame", { width: 3840, height: 2160 }, frame],
] as const)(
  "admits %s to source verification without allocating its geometry",
  async (_name, dimensions, output) => {
    const { work, asset, spawn } = await fixture(dimensions);
    // Only the deliberately fenced probe is reached. No filter is executed.
    await expect(
      preparePhotoAmbientFills([clip], [asset], output, work),
    ).rejects.toThrow(/unavailable|malformed|unsupported/iu);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]).toBe("ffprobe");
  },
);

it("preflights later clips before admitting an earlier safe source", async () => {
  const { work, asset, spawn } = await fixture({ width: 100, height: 200 });
  const strip = {
    ...asset,
    id: "strip",
    dimensions: { width: 100, height: 20000 },
  };
  await expect(
    preparePhotoAmbientFills(
      [clip, { ...clip, id: "later", assetId: "strip" }],
      [asset, strip],
      frame,
      work,
    ),
  ).rejects.toMatchObject({ code: "request.tooLarge", status: 413 });
  expect(spawn).not.toHaveBeenCalled();
  expect(await readdir(work)).toEqual(["original.png"]);
});

it("preflights both diptych cells before admitting either source", async () => {
  const { work, asset, spawn } = await fixture({ width: 100, height: 200 });
  const strip = {
    ...asset,
    id: "strip",
    dimensions: { width: 20000, height: 100 },
  };
  const paired: Clip = {
    ...clip,
    layout: {
      version: 2,
      preset: "diptych",
      gap: 8,
      secondary: { assetId: "strip" },
      fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
    },
  };
  await expect(
    preparePhotoAmbientFills([paired], [asset, strip], frame, work),
  ).rejects.toMatchObject({ code: "request.tooLarge", status: 413 });
  expect(spawn).not.toHaveBeenCalled();
  expect(await readdir(work)).toEqual(["original.png"]);
});

it("preserves a completed MP4 and manifest when unsafe geometry is rejected", async () => {
  const { work, asset, spawn, originalHash } = await fixture({
    width: 100,
    height: 20000,
  });
  const output = join(work, "completed.mp4");
  await writeFile(output, "completed film");
  await writeFile(`${output}.manifest.json`, "completed receipt");
  await expect(
    new FFmpegRenderer().render(
      {
        id: "film",
        storyId: "story",
        duration: 6,
        tracks: [{ id: "visual", type: "video", clips: [clip] }],
      },
      [asset],
      output,
      { ...frame, frameRate: 30 },
    ),
  ).rejects.toMatchObject({ code: "request.tooLarge", status: 413 });
  expect(spawn).not.toHaveBeenCalled();
  expect(await readFile(output, "utf8")).toBe("completed film");
  expect(await readFile(`${output}.manifest.json`, "utf8")).toBe(
    "completed receipt",
  );
  expect((await readdir(work)).sort()).toEqual([
    "completed.mp4",
    "completed.mp4.manifest.json",
    "original.png",
  ]);
  expect(await media.hashFile(new URL(asset.uri).pathname)).toBe(originalHash);
});
