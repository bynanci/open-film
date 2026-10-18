import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { Clip, Composition, MediaAsset, TitleStyle } from "@openfilm/core";
import { inspectMedia, runProcess } from "@openfilm/media";
import {
  createTitleOverlay,
  FFmpegRenderer,
  type RenderOptions,
} from "../src/index.js";

const roots: string[] = [];
const settings = { width: 320, height: 180, frameRate: 30 };
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-caption-delivery-"));
  roots.push(root);
  return root;
}
async function media(root: string, video = false, pattern = false) {
  const path = join(root, video ? "source.mp4" : "source.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    pattern
      ? "nullsrc=s=128x72,geq=lum='mod(X*17+Y*31,256)':cb=128:cr=128"
      : "color=black:s=320x180:r=30:d=1",
    ...(video ? ["-t", "1", "-c:v", "libx264"] : ["-frames:v", "1"]),
    "-threads",
    "1",
    "-y",
    path,
  ]);
  return inspectMedia({ path, name: "source", uri: pathToFileURL(path).href });
}
async function decoded(path: string, format = "rgb24") {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-threads",
      "1",
      "-i",
      path,
      "-an",
      "-pix_fmt",
      format,
      "-threads",
      "1",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
}
const style: TitleStyle = {
  version: 1,
  role: "film-title",
  fontSize: 30,
  position: "center",
  background: "none",
};
const renderer = new FFmpegRenderer();

it.each(["titles", "image", "video"] as const)(
  "fades %s title alpha on timeline frames, including transparent first/last frames",
  async (kind) => {
    const root = await fixture();
    const asset =
      kind === "titles" ? undefined : await media(root, kind === "video");
    const clip: Clip = {
      id: "caption",
      assetId: asset?.id ?? "",
      title: "FRAME",
      titleStyle: { ...style, fadeIn: 2 / 30, fadeOut: 3 / 30 },
      timelineStart: 3 / 30,
      timelineDuration: 8 / 30,
      ...(kind === "image"
        ? { layout: { version: 1 as const, preset: "contain" as const } }
        : {}),
      ...(kind === "video"
        ? { sourceIn: 0.2, sourceOut: 0.2 + 16 / 30, transform: { speed: 2 } }
        : {}),
    };
    const composition: Composition = {
      id: "caption",
      storyId: "story",
      duration: 0.5,
      tracks: [
        {
          id: "track",
          type: kind === "titles" ? "titles" : "video",
          clips: [clip],
        },
      ],
    };
    const output = join(root, "faded.mp4");
    await renderer.render(composition, asset ? [asset] : [], output, settings, {
      quality: "lossless",
    });
    const data = await decoded(output);
    const frameBytes = settings.width * settings.height * 3;
    expect(data.length).toBe(15 * frameBytes);
    const energy = Array.from({ length: 15 }, (_, frame) =>
      data
        .subarray(frame * frameBytes, (frame + 1) * frameBytes)
        .reduce((sum, value) => sum + value, 0),
    );
    const full = energy[5]!;
    expect(full).toBeGreaterThan(100_000);
    // Authored 8-frame title: 2-frame rise and 3-frame fall. Expected values
    // are hand-derived, not computed by the shared opacity implementation.
    const expected = [0, 0, 0, 0, 0.5, 1, 1, 1, 2 / 3, 1 / 3, 0, 0, 0, 0, 0];
    for (let frame = 0; frame < expected.length; frame++)
      expect(energy[frame]! / full, `frame ${frame}`).toBeCloseTo(
        expected[frame]!,
        1,
      );
  },
);

it("keeps a one-frame caption visible when its requested fades exceed its length", async () => {
  const root = await fixture();
  const output = join(root, "single.mp4");
  await renderer.render(
    {
      id: "single",
      storyId: "story",
      duration: 0.1,
      tracks: [
        {
          id: "titles",
          type: "titles",
          clips: [
            {
              id: "caption",
              assetId: "",
              title: "ONE",
              titleStyle: { ...style, fadeIn: 2, fadeOut: 2 },
              timelineStart: 1 / 30,
              timelineDuration: 1 / 30,
            },
          ],
        },
      ],
    },
    [],
    output,
    settings,
    { quality: "lossless" },
  );
  const data = await decoded(output);
  const bytes = settings.width * settings.height * 3;
  expect(data.length).toBe(3 * bytes);
  expect(data.subarray(0, bytes).some((v) => v > 10)).toBe(false);
  expect(
    data.subarray(bytes, 2 * bytes).filter((v) => v > 200).length,
  ).toBeGreaterThan(100);
  expect(data.subarray(2 * bytes).some((v) => v > 10)).toBe(false);
});

it("compresses overlapping fades into a short title while retaining a full-opacity peak", async () => {
  const root = await fixture();
  const output = join(root, "short-fades.mp4");
  await renderer.render(
    {
      id: "short",
      storyId: "story",
      duration: 4 / 30,
      tracks: [
        {
          id: "titles",
          type: "titles",
          clips: [
            {
              id: "caption",
              assetId: "",
              title: "PEAK",
              titleStyle: { ...style, fadeIn: 1, fadeOut: 1 },
              timelineStart: 0,
              timelineDuration: 4 / 30,
            },
          ],
        },
      ],
    },
    [],
    output,
    settings,
    { quality: "lossless" },
  );
  const data = await decoded(output);
  const bytes = settings.width * settings.height * 3;
  expect(data.length).toBe(4 * bytes);
  const energy = Array.from({ length: 4 }, (_, frame) =>
    data
      .subarray(frame * bytes, (frame + 1) * bytes)
      .reduce((sum, value) => sum + value, 0),
  );
  expect(energy[2]).toBeGreaterThan(100_000);
  for (const [frame, expected] of [0, 0.5, 1, 0].entries())
    expect(energy[frame]! / energy[2]!, `frame ${frame}`).toBeCloseTo(
      expected,
      1,
    );
});

it("keeps default title pixels visible to their last frame and ungraded by a film look", async () => {
  const root = await fixture();
  const output = join(root, "default-title.mp4");
  await renderer.render(
    {
      id: "default",
      storyId: "story",
      duration: 0.1,
      defaultLook: { version: 1, preset: "retro", strength: 1 },
      tracks: [
        {
          id: "titles",
          type: "titles",
          clips: [
            {
              id: "caption",
              assetId: "",
              title: "WHITE",
              titleStyle: style,
              look: { version: 1, preset: "none", strength: 1 },
              timelineStart: 0,
              timelineDuration: 0.1,
            },
          ],
        },
      ],
    },
    [],
    output,
    settings,
    { quality: "lossless" },
  );
  const data = await decoded(output);
  const bytes = settings.width * settings.height * 3;
  const first = data.subarray(0, bytes);
  expect(Buffer.compare(data.subarray(2 * bytes, 3 * bytes), first)).toBe(0);
  let white = 0;
  for (let offset = 0; offset < first.length; offset += 3) {
    if (first[offset]! > 220) {
      white++;
      expect(Math.abs(first[offset]! - first[offset + 1]!)).toBeLessThanOrEqual(
        2,
      );
      expect(Math.abs(first[offset]! - first[offset + 2]!)).toBeLessThanOrEqual(
        2,
      );
    }
  }
  expect(white).toBeGreaterThan(100);
});

it("keeps the native subtitle raster and scrim above the requested bottom inset", async () => {
  const root = await fixture();
  const title = await createTitleOverlay(
    "Readable caption",
    {
      version: 1,
      role: "subtitle",
      fontSize: 20,
      position: "bottom",
      background: "scrim",
      bottomInset: 0.15,
    },
    settings,
    join(root, "inset.png"),
  );
  const data = await decoded(title.path, "rgba");
  let lastY = -1;
  for (let offset = 3; offset < data.length; offset += 4)
    if (data[offset]! > 0) lastY = Math.floor(offset / 4 / settings.width);
  expect(lastY).toBeGreaterThan(100);
  expect(lastY).toBeLessThanOrEqual(153);
});

it.each([
  [undefined, 23, "veryfast", /rc=crf.*crf=23\.0/u],
  ["preview", 23, "veryfast", /rc=crf.*crf=23\.0/u],
  ["high", 17, "medium", /rc=crf.*crf=17\.0/u],
  ["lossless", 0, "veryfast", /rc=cqp.*qp=0/u],
] as const)(
  "uses the requested %s quality in the actual x264 stream and receipt",
  async (quality, crf, preset, sei) => {
    const root = await fixture();
    const asset = await media(root, false, true);
    const output = join(root, "quality.mp4");
    await renderer.render(
      {
        id: "quality",
        storyId: "story",
        duration: 0.1,
        tracks: [
          {
            id: "visual",
            type: "video",
            clips: [
              {
                id: "photo",
                assetId: asset.id,
                timelineStart: 0,
                timelineDuration: 0.1,
              },
            ],
          },
        ],
      },
      [asset],
      output,
      settings,
      quality ? { quality } : {},
    );
    const manifest = JSON.parse(
      await readFile(`${output}.manifest.json`, "utf8"),
    );
    expect(manifest.encoding).toMatchObject({
      crf,
      preset,
      video: "libx264",
      pixelFormat: "yuv420p",
    });
    expect((await readFile(output)).toString("latin1")).toMatch(sei);
  },
);

it.each(["-crf 0", null, 0, {}])(
  "rejects unknown quality %s before creating output files",
  async (quality) => {
    const root = await fixture();
    const options = { quality } as unknown as RenderOptions;
    await expect(
      renderer.render(
        { id: "invalid", storyId: "story", duration: 0.1, tracks: [] },
        [],
        join(root, "bad.mp4"),
        settings,
        options,
      ),
    ).rejects.toThrow(/quality/iu);
    expect(await readdir(root)).toEqual([]);
  },
);

it.each([
  ["photo", "lossless"],
  ["general", "lossless"],
  ["photo", "high"],
  ["general", "high"],
] as const)(
  "uses Lanczos for %s scaling with %s quality",
  async (kind, quality) => {
    const root = await fixture();
    const source = await media(root, false, true);
    const scaledPath = join(root, "lanczos.png");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      fileURLToPath(source.uri),
      "-vf",
      "scale=320:180:flags=lanczos",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      scaledPath,
    ]);
    const scaled = await inspectMedia({
      path: scaledPath,
      name: "scaled",
      uri: pathToFileURL(scaledPath).href,
    });
    const composition = (asset: MediaAsset): Composition => ({
      id: "scaling",
      storyId: "story",
      duration: 0.1,
      tracks: [
        {
          id: "visual",
          type: "video",
          clips: [
            {
              id: "photo",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 0.1,
              ...(kind === "photo"
                ? { layout: { version: 1, preset: "contain" } }
                : {}),
            },
          ],
        },
      ],
    });
    const native = join(root, "native.mp4");
    const reference = join(root, "reference.mp4");
    await renderer.render(composition(source), [source], native, settings, {
      quality,
    });
    await renderer.render(composition(scaled), [scaled], reference, settings, {
      quality,
    });
    const actual = await decoded(native);
    const expected = await decoded(reference);
    expect(actual.length).toBe(expected.length);
    const difference =
      actual.reduce(
        (sum, value, index) => sum + Math.abs(value - expected[index]!),
        0,
      ) / actual.length;
    expect(difference).toBeLessThan(0.01);
  },
);
