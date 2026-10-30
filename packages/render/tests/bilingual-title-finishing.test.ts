// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { type Composition, type TitleStyle } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import {
  assertRenderQaMetric,
  RenderQaMetricError,
} from "../../../tests/helpers/render-qa-policy.js";
import { titleTestFontOptions } from "../../../tests/helpers/title-test-fonts.js";
import { serializeCaptions } from "@openfilm/exporters";
import { FFmpegRenderer, createTitleOverlay } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const width = 640,
  height = 360;
const style: TitleStyle = {
  version: 1,
  role: "film-title",
  fontFamily: "Noto Sans CJK TC",
  fontSize: 32,
  background: "none",
  position: "center",
  fadeOut: 0.5,
  finishing: {
    version: 1,
    shadow: {
      color: "#000000",
      opacity: 0.7,
      offsetX: 8,
      offsetY: 12,
      blur: 0,
    },
    stroke: { color: "#112299", width: 8 },
    pill: {
      color: "#442211",
      opacity: 0.8,
      paddingX: 16,
      paddingY: 8,
      radius: 8,
    },
  },
};
const text = "繁體標題\nOur story",
  textRuns = {
    version: 1 as const,
    splitAt: 4,
    primary: { fontSize: 32, tracking: 1, fontWeight: 400 },
    secondary: { fontSize: 20, tracking: 2, fontWeight: 700 },
    gap: 16,
  };
const decode = (path: string, index: number, rgba = false) =>
  runProcess("ffmpeg", [
    "-v",
    "error",
    "-i",
    path,
    "-vf",
    `select=eq(n\\,${index})`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    rgba ? "rgba" : "rgb24",
    "pipe:1",
  ]).then((result) => result.stdout);
function sample(
  pixels: Buffer,
  predicate: (index: number, x: number, y: number) => boolean,
) {
  for (let y = 2; y < height - 2; y += 2)
    for (let x = 2; x < width - 2; x += 2)
      if (
        [0, 1].every((dy) =>
          [0, 1].every((dx) =>
            predicate(((y + dy) * width + x + dx) * 4, x + dx, y + dy),
          ),
        )
      )
        return { x, y };
  throw new Error("No flat witness patch for the requested glyph/effect.");
}
function assertPatch(
  actual: Buffer,
  plain: Buffer,
  raster: Buffer,
  point: { x: number; y: number },
  opacity = 1,
) {
  const rgb = (point.y * width + point.x) * 3,
    rgba = (point.y * width + point.x) * 4,
    alpha = (raster[rgba + 3]! / 255) * opacity;
  for (let channel = 0; channel < 3; channel++)
    assertRenderQaMetric(
      "title.highDetailGlyphChannelError",
      Math.abs(
        actual[rgb + channel]! -
          (raster[rgba + channel]! * alpha +
            plain[rgb + channel]! * (1 - alpha)),
      ),
    );
}

it.each([
  { frameRate: 30, attached: true },
  { frameRate: 30000 / 1001, attached: false },
])(
  "retains shared bilingual raster pixels and both caption texts at $frameRate fps",
  async ({ frameRate, attached }) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-bilingual-mp4-"));
    roots.push(root);
    const source = join(root, "source.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x7090b0:s=320x180:r=30:d=5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=5",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      source,
    ]);
    const hash = await hashFile(source),
      asset = await inspectMedia({
        path: source,
        uri: pathToFileURL(source).href,
        name: "synthetic.mp4",
      });
    const title = { title: text, titleRuns: textRuns, titleStyle: style };
    const composition: Composition = {
      id: "film",
      storyId: "story",
      duration: 3,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: asset.id,
              timelineStart: 0.5,
              timelineDuration: 2,
              sourceIn: 1,
              sourceOut: 5,
              transform: { speed: 2 },
              ...(attached ? title : {}),
            },
          ],
        },
      ],
      captionTracks: [
        {
          version: 1,
          id: "captions",
          name: "Bilingual",
          style: {
            ...style,
            role: "subtitle",
            position: "bottom",
            fontSize: 24,
          },
          cues: [
            {
              version: 1,
              id: "cue",
              startMs: 900,
              endMs: 1500,
              text: "繁體字幕\nOur caption",
              textRuns: {
                ...textRuns,
                secondary: { fontSize: 16, fontWeight: 700 },
              },
              source: { kind: "manual" },
              manualRevision: 0,
            },
          ],
        },
      ],
    };
    if (!attached)
      composition.tracks.push({
        id: "titles",
        type: "titles",
        clips: [
          {
            id: "standalone",
            assetId: asset.id,
            timelineStart: 0.5,
            timelineDuration: 2,
            ...title,
          },
        ],
      });
    const fonts = await titleTestFontOptions();
    const renderer = new FFmpegRenderer(),
      settings = { width, height, frameRate },
      output = join(root, "finished.mp4"),
      baseline = join(root, "baseline.mp4");
    const bare = structuredClone(composition);
    delete bare.captionTracks;
    bare.tracks = bare.tracks.filter((track) => track.type !== "titles");
    for (const track of bare.tracks)
      for (const clip of track.clips) {
        delete clip.title;
        delete clip.titleRuns;
        delete clip.titleStyle;
      }
    await renderer.render(bare, [asset], baseline, settings, {
      ...fonts,
      quality: "high-detail",
    });
    await renderer.render(composition, [asset], output, settings, {
      ...fonts,
      quality: "high-detail",
    });
    const overlay = await createTitleOverlay(
      text,
      style,
      settings,
      join(root, "shared-title.png"),
      { ...fonts, textRuns },
    );
    const pixels = await decode(overlay.path, 0, true);
    const primary = overlay.layout.runLayouts!.runs[0]!.bounds,
      secondary = overlay.layout.runLayouts!.runs[1]!.bounds;
    const patches = {
      primary: sample(
        pixels,
        (i, _x, y) =>
          pixels[i]! > 250 &&
          pixels[i + 1]! > 250 &&
          pixels[i + 2]! > 250 &&
          pixels[i + 3]! > 250 &&
          y >= primary.y &&
          y < primary.y + primary.height,
      ),
      secondary: sample(
        pixels,
        (i, _x, y) =>
          pixels[i]! > 250 &&
          pixels[i + 1]! > 250 &&
          pixels[i + 2]! > 250 &&
          pixels[i + 3]! > 250 &&
          y >= secondary.y &&
          y < secondary.y + secondary.height,
      ),
      stroke: sample(
        pixels,
        (i) => pixels[i]! < 30 && pixels[i + 2]! > 130 && pixels[i + 3]! > 250,
      ),
      pill: sample(
        pixels,
        (i) =>
          Math.abs(pixels[i]! - 68) <= 2 &&
          Math.abs(pixels[i + 1]! - 34) <= 2 &&
          Math.abs(pixels[i + 2]! - 17) <= 2 &&
          pixels[i + 3]! > 190 &&
          pixels[i + 3]! < 220,
      ),
      shadow: sample(
        pixels,
        (i) =>
          pixels[i]! < 3 &&
          pixels[i + 1]! < 3 &&
          pixels[i + 2]! < 3 &&
          pixels[i + 3]! > 150 &&
          pixels[i + 3]! < 210,
      ),
    };
    const first = Math.round(0.5 * frameRate),
      last = first + Math.ceil((2 - 1e-9) * frameRate) - 1;
    // Deliberately shuffled seeks include first/last active and an independent midpoint.
    for (const index of [last, first, Math.round(0.7 * frameRate)]) {
      const opacity = Math.min(1, (2 - (index - first) / frameRate) / 0.5);
      const actual = await decode(output, index),
        plain = await decode(baseline, index);
      for (const point of Object.values(patches))
        assertPatch(actual, plain, pixels, point, opacity);
    }

    const before = await decode(output, first - 1),
      beforePlain = await decode(baseline, first - 1),
      after = await decode(output, last + 1),
      afterPlain = await decode(baseline, last + 1);
    expect(before).toEqual(beforePlain);
    expect(after).toEqual(afterPlain);
    const active = await decode(output, Math.round(0.7 * frameRate)),
      plain = await decode(baseline, Math.round(0.7 * frameRate));
    const witness = (patches.secondary.y * width + patches.secondary.x) * 3;
    expect(Math.abs(active[witness]! - plain[witness]!)).toBeGreaterThan(20); // removing the second run cannot pass.
    const cue = composition.captionTracks![0]!.cues[0]!;
    const caption = await createTitleOverlay(
      cue.text,
      composition.captionTracks![0]!.style,
      settings,
      join(root, "shared-caption.png"),
      { ...fonts, textRuns: cue.textRuns },
    );
    const captionPixels = await decode(caption.path, 0, true);
    const captionPatches = caption.layout.runLayouts!.runs.map((run) =>
      sample(
        captionPixels,
        (i, _x, y) =>
          captionPixels[i]! > 250 &&
          captionPixels[i + 1]! > 250 &&
          captionPixels[i + 2]! > 250 &&
          captionPixels[i + 3]! > 250 &&
          y >= run.bounds.y &&
          y < run.bounds.y + run.bounds.height,
      ),
    );
    const cueStart = Math.ceil(0.9 * frameRate - 1e-9),
      cueEnd = Math.ceil(1.5 * frameRate - 1e-9);
    for (const index of [
      cueEnd - 1,
      cueStart,
      Math.round(1.1 * frameRate),
      cueStart - 1,
      cueEnd,
    ]) {
      const actual = await decode(output, index),
        plain = await decode(baseline, index);
      const visible = index >= cueStart && index < cueEnd;
      for (const point of captionPatches)
        assertPatch(actual, plain, captionPixels, point, visible ? 1 : 0);
    }
    // Real decoded wrong-frame and unstyled-output controls use the same comparator.
    expect(() => assertPatch(before, plain, pixels, patches.secondary)).toThrow(
      RenderQaMetricError,
    );
    for (const point of Object.values(patches))
      expect(() => assertPatch(plain, plain, pixels, point)).toThrow(
        RenderQaMetricError,
      );

    expect(serializeCaptions("srt", [cue]).content).toContain(
      "00:00:00,900 --> 00:00:01,500\n繁體字幕\nOur caption",
    );
    expect(serializeCaptions("vtt", [cue]).content).toContain(
      "00:00:00.900 --> 00:00:01.500\n繁體字幕\nOur caption",
    );
    const manifest = JSON.parse(
      await readFile(`${output}.manifest.json`, "utf8"),
    );
    expect(
      manifest.fontBindings
        .filter(
          (binding: { usage: string[] }) => binding.usage[0] === "caption",
        )
        .map((binding: { run: string }) => binding.run),
    ).toEqual(["primary", "secondary"]);
    expect(
      manifest.fontBindings
        .filter((binding: { usage: string[] }) => binding.usage[0] === "title")
        .map((binding: { run: string }) => binding.run),
    ).toEqual(["primary", "secondary"]);
    expect(await hashFile(source)).toBe(hash);
    expect(
      manifest.sources.map((item: { sha256: string }) => item.sha256),
    ).toContain(hash);
    const pcm = (path: string) =>
      runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        path,
        "-vn",
        "-f",
        "s16le",
        "-ac",
        "1",
        "-ar",
        "48000",
        "pipe:1",
      ]).then((result) => result.stdout);
    expect(await pcm(output)).toEqual(await pcm(baseline));
  },
  90_000,
);
