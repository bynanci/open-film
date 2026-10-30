// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { PRIMARY_COLOR_IDENTITY, type Composition } from "@openfilm/core";
import {
  hashFile,
  hdrToneMapFilter,
  inspectMedia,
  runProcess,
} from "@openfilm/media";
import * as render from "../src/index.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function root() {
  const p = await mkdtemp(join(tmpdir(), "primary-render-"));
  roots.push(p);
  return p;
}
const correction = {
  ...PRIMARY_COLOR_IDENTITY,
  temperature: 1,
  exposureEv: 2,
  contrast: 1.5,
};
it("applies the saved primary recipe to renderer pixels without relying on a creative look", async () => {
  const dir = await root(),
    path = join(dir, "patch.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x4050a0:s=160x90,format=rgb24",
    "-frames:v",
    "1",
    "-threads",
    "1",
    path,
  ]);
  const asset = await inspectMedia({
    path,
    name: "patch.png",
    uri: pathToFileURL(path).href,
  });
  const film: Composition = {
    id: "f",
    storyId: "s",
    duration: 0.5,
    defaultPrimaryColor: {
      ...PRIMARY_COLOR_IDENTITY,
      exposureEv: 1,
      contrast: 0.5,
    },
    tracks: [
      {
        id: "v",
        type: "video",
        clips: [
          {
            id: "c",
            assetId: asset.id,
            timelineStart: 0,
            timelineDuration: 0.5,
          },
        ],
      },
    ],
  };
  const output = join(dir, "graded.mp4");
  await new render.FFmpegRenderer().render(film, [asset], output, {
    width: 160,
    height: 90,
    frameRate: 12,
  });
  const pixels = (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ])
  ).stdout;
  const pixel = [
    ...pixels.subarray((45 * 160 + 80) * 3, (45 * 160 + 80) * 3 + 3),
  ];
  for (const [i, expected] of [128, 144, 224].entries())
    expect(Math.abs(pixel[i]! - expected)).toBeLessThanOrEqual(3);
});
it("applies gain up to 6.6 with one clamp and preserves raw alpha", async () => {
  expect(render.primaryColorFilters).toBeTypeOf("function");
  expect(render.primaryColorFilters(PRIMARY_COLOR_IDENTITY)).toEqual([]);
  const path = join(await root(), "pixels.rgba");
  await writeFile(
    path,
    Buffer.from([20, 20, 20, 0, 20, 20, 20, 128, 64, 16, 128, 255]),
  );
  const result = await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "rawvideo",
    "-pixel_format",
    "rgba",
    "-video_size",
    "3x1",
    "-i",
    path,
    "-vf",
    render.primaryColorFilters(correction).join(","),
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-",
  ]);
  expect([...result.stdout]).toEqual([
    68, 56, 44, 0, 68, 56, 44, 128, 255, 32, 255, 255,
  ]);
});
it("clamps primary before Film Look and grades both diptych sources without coloring gaps or titles", async () => {
  const dir = await root(),
    path = join(dir, "patch.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x2850dc:s=160x90,format=rgb24",
    "-frames:v",
    "1",
    "-threads",
    "1",
    path,
  ]);
  const asset = await inspectMedia({
    path,
    name: "patch",
    uri: pathToFileURL(path).href,
  });
  const settings = { width: 160, height: 90, frameRate: 12 };
  const film: Composition = {
    id: "f",
    storyId: "s",
    duration: 0.5,
    defaultPrimaryColor: { ...PRIMARY_COLOR_IDENTITY, exposureEv: 1 },
    defaultLook: { version: 1, preset: "retro", strength: 1 },
    tracks: [
      {
        id: "v",
        type: "video",
        clips: [
          {
            id: "c",
            assetId: asset.id,
            timelineStart: 0,
            timelineDuration: 0.5,
          },
        ],
      },
    ],
  };
  const decode = async (p: string) =>
    (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        p,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ])
    ).stdout;
  const output = join(dir, "ordered.mp4");
  await new render.FFmpegRenderer().render(film, [asset], output, settings);
  const bytes = await decode(output);
  const sample = (pixels: Buffer, x: number, y: number) => [
    ...pixels.subarray((y * 160 + x) * 3, (y * 160 + x) * 3 + 3),
  ];
  for (const [i, expected] of [102, 165, 227].entries())
    expect(Math.abs(sample(bytes, 80, 45)[i]! - expected)).toBeLessThanOrEqual(
      4,
    );
  const diptych: Composition = {
    ...film,
    defaultPrimaryColor: {
      ...PRIMARY_COLOR_IDENTITY,
      exposureEv: 1,
      contrast: 0.5,
    },
    defaultLook: undefined,
    tracks: [
      {
        ...film.tracks[0]!,
        clips: [
          {
            ...film.tracks[0]!.clips[0]!,
            layout: {
              version: 1,
              preset: "diptych",
              gap: 16,
              secondary: { assetId: asset.id },
            },
            title: "WHITE",
            titleStyle: {
              version: 1,
              role: "film-title",
              fontSize: 20,
              position: "center",
              background: "none",
            },
          },
        ],
      },
    ],
  };
  const paired = join(dir, "diptych.mp4");
  await new render.FFmpegRenderer().render(diptych, [asset], paired, settings);
  const pixels = await decode(paired);
  for (const x of [15, 145])
    for (const [i, expected] of [104, 144, 255].entries())
      expect(
        Math.abs(sample(pixels, x, 45)[i]! - expected),
      ).toBeLessThanOrEqual(4);
  expect(sample(pixels, 80, 5).every((x) => x <= 1)).toBe(true);
  let white = 0;
  for (let i = 0; i < pixels.length; i += 3)
    if (pixels[i]! > 240 && pixels[i + 1]! > 240 && pixels[i + 2]! > 240)
      white++;
  expect(white).toBeGreaterThan(10);
});
it.each(["SDR", "smpte2084", "arib-std-b67"])(
  "renders actual %s chart MP4 with identity parity and source receipts",
  async (transfer) => {
    const dir = await root(),
      path = join(dir, "chart.mp4");
    const hdr = transfer !== "SDR";
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=160x90:r=12${hdr ? `,format=yuv420p10le,setparams=range=limited:color_primaries=bt2020:color_trc=${transfer}:colorspace=bt2020nc` : ""}`,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "0.5",
      "-c:v",
      hdr ? "libx265" : "libx264",
      ...(hdr
        ? ["-x265-params", "pools=1:frame-threads=1:log-level=error"]
        : []),
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-y",
      path,
    ]);
    const asset = await inspectMedia({
      path,
      name: "chart.mp4",
      uri: pathToFileURL(path).href,
    });
    const hash = await hashFile(path);
    const film: Composition = {
      id: "f",
      storyId: "s",
      duration: 0.5,
      tracks: [
        {
          id: "v",
          type: "video",
          clips: [
            {
              id: "c",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 0.5,
              sourceIn: 0,
              sourceOut: 0.5,
            },
          ],
        },
      ],
    };
    const settings = { width: 160, height: 90, frameRate: 12 };
    const decode = async (p: string) =>
      (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          p,
          "-an",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ])
      ).stdout;
    const base = join(dir, "base.mp4"),
      identity = join(dir, "identity.mp4"),
      graded = join(dir, "graded.mp4");
    await new render.FFmpegRenderer().render(film, [asset], base, settings);
    await new render.FFmpegRenderer().render(
      { ...film, defaultPrimaryColor: { ...PRIMARY_COLOR_IDENTITY } },
      [asset],
      identity,
      settings,
    );
    await new render.FFmpegRenderer().render(
      {
        ...film,
        defaultPrimaryColor: {
          ...PRIMARY_COLOR_IDENTITY,
          temperature: 0.6,
          exposureEv: 0.3,
          contrast: 1.1,
        },
        defaultLook: { version: 1, preset: "retro", strength: 0.5 },
      },
      [asset],
      graded,
      settings,
    );
    const pixels = await decode(base);
    expect(await decode(identity)).toEqual(pixels);
    const corrected = await decode(graded);
    expect(corrected).not.toEqual(pixels);
    expect(pixels.length).toBe(160 * 90 * 3 * 6);
    for (const frame of [5, 0, 3, 1]) {
      const seek = (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          graded,
          "-ss",
          String(Math.max(0, frame / 12 - 0.00001)),
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ])
      ).stdout;
      expect(seek).toEqual(
        corrected.subarray(frame * 160 * 90 * 3, (frame + 1) * 160 * 90 * 3),
      );
    }
    const audio = async (p: string) =>
      (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          p,
          "-vn",
          "-f",
          "s16le",
          "-c:a",
          "pcm_s16le",
          "-",
        ])
      ).stdout;
    expect(await audio(graded)).toEqual(await audio(base));
    const manifest = JSON.parse(
      await readFile(`${graded}.manifest.json`, "utf8"),
    );
    expect(manifest.primaryColor).toMatchObject({
      version: 1,
      domain: "encoded-sdr-rgb",
      clips: [{ clipId: "c", source: "film" }],
    });
    expect(manifest.sources[0].sha256).toBe(hash);
    expect(await hashFile(path)).toBe(hash);
    console.info(
      "D5C chart",
      JSON.stringify({
        transfer,
        sourceSha256: hash,
        outputSha256: await hashFile(graded),
        frames: 6,
        decodedBytes: corrected.length,
        identityExact: true,
        shuffledSeeksExact: 4,
        audioExact: true,
      }),
    );
    if (hdr) {
      expect(asset.hdr).toBe(true);
      expect(hdrToneMapFilter(asset)).toContain("hable");
      await expect(
        new render.FFmpegRenderer().render(
          film,
          [{ ...asset, metadata: { "openfilm.color": {} } }],
          join(dir, "bad.mp4"),
          settings,
        ),
      ).rejects.toThrow(/incomplete|unsupported/);
    }
  },
);
