import { link, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  evaluateClipAtTime,
  type Clip,
  type Composition,
} from "@openfilm/core";
import { inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-photo-quality-test-"));
  roots.push(root);
  const photo = async (name: string, filter: string) => {
    const path = join(root, `${name}.png`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      filter,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      path,
    ]);
    return inspectMedia({
      path,
      name: `${name}.png`,
      uri: pathToFileURL(path).href,
    });
  };
  return { root, photo };
}
function film(clips: Clip[]): Composition {
  return {
    id: "quality",
    storyId: "story",
    duration: 2,
    tracks: [{ id: "visual", type: "video", clips }],
  };
}
async function pixels(path: string, frame = 0) {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      `select=eq(n\\,${frame}),format=rgb24`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
}
const settings = { width: 160, height: 90, frameRate: 30 };
it("preserves an original when an output aliases it through a hard link", async () => {
  const { root, photo } = await fixture();
  const asset = await photo("original", "color=red:s=160x90");
  const original = join(root, "original.png");
  const before = await readFile(original);
  const output = join(root, "alias.mp4");
  await link(original, output);
  await expect(
    new FFmpegRenderer().render(
      film([
        {
          id: "photo",
          assetId: asset.id,
          timelineStart: 0,
          timelineDuration: 2,
        },
      ]),
      [asset],
      output,
      settings,
    ),
  ).rejects.toThrow(/original media/iu);
  expect(await readFile(original)).toEqual(before);
  expect(await readFile(output)).toEqual(before);
});
it("renders protected hero and both diptych sources rather than silently using contain", async () => {
  const { root, photo } = await fixture();
  const red = await photo("red", "color=red:s=60x120");
  const blue = await photo("blue", "color=blue:s=60x120");
  const clip: Clip = {
    id: "photo",
    assetId: red.id,
    timelineStart: 0,
    timelineDuration: 2,
    layout: { version: 1, preset: "hero", focalPoint: { x: 0.5, y: 0.5 } },
  };
  const renderer = new FFmpegRenderer();
  const hero = join(root, "hero.mp4");
  await renderer.render(film([clip]), [red, blue], hero, settings);
  const heroPixels = await pixels(hero);
  expect(heroPixels[(45 * 160 + 4) * 3]).toBeGreaterThan(200);
  clip.layout = {
    version: 1,
    preset: "diptych",
    secondary: { assetId: blue.id },
    gap: 8,
  };
  const pair = join(root, "pair.mp4");
  await renderer.render(film([clip]), [red, blue], pair, settings);
  const pairPixels = await pixels(pair);
  expect(pairPixels[(45 * 160 + 40) * 3]).toBeGreaterThan(200);
  expect(pairPixels[(45 * 160 + 120) * 3 + 2]).toBeGreaterThan(200);
});
it.each([1, 2])(
  "samples photo motion at the same clip-local frame time as the shared evaluator (speed %s)",
  async (speed) => {
    const { root, photo } = await fixture();
    const source = await photo(
      "subject",
      "color=black:s=160x90,drawbox=x=20:y=30:w=20:h=30:color=white:t=fill",
    );
    const clip: Clip = {
      id: "moving",
      assetId: source.id,
      timelineStart: 0,
      timelineDuration: 2,
      transform: { speed },
      motion: {
        version: 1,
        preset: "push-in",
        easing: "ease-in-out",
        from: { scale: 1, x: 0, y: 0 },
        to: { scale: 1.2, x: 0, y: 0 },
      },
    };
    const output = join(root, "motion.mp4");
    await new FFmpegRenderer().render(film([clip]), [source], output, settings);
    for (const n of [0, 30, 59]) {
      const frame = await pixels(output, n);
      const left = Array.from(
        { length: 160 },
        (_, x) => frame[(45 * 160 + x) * 3]!,
      ).findIndex((value) => value > 200);
      const evaluated = evaluateClipAtTime(
        clip,
        n / 30,
        { [source.id]: { width: 160, height: 90 } },
        settings,
      );
      expect(
        Math.abs(left - (80 + (20 - 80) * evaluated.transform.scale)),
      ).toBeLessThanOrEqual(1.5);
    }
  },
);
it("renders manual ducking and fades into the actual mixed audio without extending the film", async () => {
  const { root } = await fixture();
  const path = join(root, "music.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2:sample_rate=48000",
    "-y",
    path,
  ]);
  const asset = await inspectMedia({
    path,
    name: "music.wav",
    uri: pathToFileURL(path).href,
  });
  const composition: Composition = {
    id: "audio",
    storyId: "story",
    duration: 2,
    tracks: [
      {
        id: "music",
        type: "music",
        timing: "overlay",
        clips: [
          {
            id: "music",
            assetId: asset.id,
            sourceIn: 0,
            sourceOut: 2,
            timelineStart: 0,
            timelineDuration: 2,
            audioAutomation: {
              version: 1,
              role: "music",
              fadeIn: 0.2,
              fadeOut: 0.2,
              ducking: [
                { start: 0.7, end: 1.3, gain: 0.1, attack: 0.1, release: 0.1 },
              ],
            },
          },
        ],
      },
    ],
  };
  const output = join(root, "audio.mp4");
  await new FFmpegRenderer().render(composition, [asset], output, settings);
  const rms = async (time: number) => {
    const data = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        output,
        "-t",
        "0.08",
        "-vn",
        "-ac",
        "1",
        "-f",
        "f32le",
        "-",
      ])
    ).stdout;
    let square = 0;
    for (let offset = 0; offset < data.length; offset += 4)
      square += data.readFloatLE(offset) ** 2;
    return Math.sqrt(square / (data.length / 4));
  };
  expect((await rms(0.96)) / (await rms(0.4))).toBeLessThan(0.2);
  expect((await rms(0.02)) / (await rms(0.4))).toBeLessThan(0.5);
  const probe = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    output,
  ]);
  expect(
    Number(JSON.parse(probe.stdout.toString()).format.duration),
  ).toBeCloseTo(2, 1);
});
