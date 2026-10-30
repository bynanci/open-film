import { assertRenderQaMetric } from "../../../tests/helpers/render-qa-policy.js";
import { link, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  evaluateClipAtTime,
  validatePhotoMotion,
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
async function allPixels(path: string) {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
}
const settings = { width: 160, height: 90, frameRate: 30 };
it("renders a pull-out from close to wide framing without changing film timing, soundtrack or original photo", async () => {
  const { root, photo } = await fixture();
  const source = await photo(
    "pull-out-subject",
    "color=blue:s=160x90,drawbox=x=10:y=30:w=20:h=30:color=white:t=fill",
  );
  const original = await readFile(join(root, "pull-out-subject.png"));
  const musicPath = join(root, "pull-out-music.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2:sample_rate=48000",
    "-y",
    musicPath,
  ]);
  const music = await inspectMedia({
    path: musicPath,
    name: "pull-out-music.wav",
    uri: pathToFileURL(musicPath).href,
  });
  const moving: Clip = {
    id: "pull-out",
    assetId: source.id,
    timelineStart: 0,
    timelineDuration: 2,
    motion: validatePhotoMotion({
      version: 1,
      preset: "pull-out",
      easing: "ease-in-out",
      from: { scale: 1.06, x: 0, y: 0 },
      to: { scale: 1, x: 0, y: 0 },
    }),
  };
  const composition = film([moving]);
  composition.tracks.push({
    id: "music",
    type: "music",
    timing: "overlay",
    clips: [
      {
        id: "sound",
        assetId: music.id,
        timelineStart: 0,
        timelineDuration: 2,
        sourceIn: 0,
        sourceOut: 2,
        audioAutomation: {
          version: 1,
          role: "music",
          fadeIn: 0.1,
          fadeOut: 0.1,
        },
      },
    ],
  });
  const before = structuredClone(composition);
  const output = join(root, "pull-out.mp4");
  const held = join(root, "held.mp4");
  const renderer = new FFmpegRenderer();
  await renderer.render(composition, [source, music], output, settings);
  const heldComposition = structuredClone(composition);
  heldComposition.tracks[0]!.clips[0]!.motion = {
    version: 1,
    preset: "hold",
    easing: "linear",
    from: { scale: 1, x: 0, y: 0 },
    to: { scale: 1, x: 0, y: 0 },
  };
  await renderer.render(heldComposition, [source, music], held, settings);
  const decoded = await allPixels(output);
  const frameBytes = settings.width * settings.height * 3;
  expect(decoded.length).toBe(60 * frameBytes);
  const subjectEdges: number[] = [];
  for (const n of [0, 30, 59]) {
    const rgb = decoded.subarray(n * frameBytes, (n + 1) * frameBytes);
    const left = Array.from(
      { length: settings.width },
      (_, x) => rgb[(45 * settings.width + x) * 3]!,
    ).findIndex((value) => value > 200);
    const expected = evaluateClipAtTime(
      moving,
      n / settings.frameRate,
      { [source.id]: { width: 160, height: 90 } },
      settings,
    );
    assertRenderQaMetric(
      "photo.subjectEdgeError",
      Math.abs(left - (80 + (10 - 80) * expected.transform.scale)),
    );
    subjectEdges.push(left);
    // The procedural blue photo fills the complete output throughout the
    // decrease in scale. No black canvas is exposed at the visible corners.
    for (const [x, y] of [
      [2, 2],
      [157, 2],
      [2, 87],
      [157, 87],
    ])
      expect(rgb[(y! * settings.width + x!) * 3 + 2]).toBeGreaterThan(200);
  }
  expect(subjectEdges[0]!).toBeLessThan(subjectEdges[1]!);
  expect(subjectEdges[1]!).toBeLessThan(subjectEdges[2]!);
  const audio = async (path: string) =>
    (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        path,
        "-vn",
        "-f",
        "f32le",
        "-ac",
        "1",
        "-",
      ])
    ).stdout;
  expect(await audio(output)).toEqual(await audio(held));
  const probe = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    output,
  ]);
  assertRenderQaMetric(
    "photo.tightDuration",
    Number(JSON.parse(probe.stdout.toString()).format.duration),
    2,
  );
  expect(composition).toEqual(before);
  expect(await readFile(join(root, "pull-out-subject.png"))).toEqual(original);
});
it("shows the incoming photo on frame 111 at a 3.7-second hard cut", async () => {
  const start = 3.7;
  const firstFrame = 111;
  const { root, photo } = await fixture();
  const red = await photo("before-cut", "color=red:s=160x90");
  const blue = await photo("after-cut", "color=blue:s=160x90");
  const output = join(root, "fractional-cut.mp4");
  const composition: Composition = {
    ...film([
      {
        id: "before-cut",
        assetId: red.id,
        timelineStart: 0,
        timelineDuration: start,
      },
      {
        id: "after-cut",
        assetId: blue.id,
        timelineStart: start,
        timelineDuration: 4 - start,
      },
    ]),
    duration: 4,
  };
  await new FFmpegRenderer().render(composition, [red, blue], output, settings);
  const decoded = await allPixels(output);
  const frameBytes = settings.width * settings.height * 3;
  expect(decoded.length).toBe(120 * frameBytes);
  const center = (45 * settings.width + 80) * 3;
  // Include the first/last frames and both sides of the cut. The exact 3.7s
  // cut used to expose the black canvas for frame 111.
  for (let frame = 0; frame < 120; frame++) {
    const channel = frame < firstFrame ? 0 : 2;
    expect(
      decoded[frame * frameBytes + center + channel],
      `frame ${frame}`,
    ).toBeGreaterThan(200);
  }
});
it("shows a 3.7-second title on its first frame without leaking outside its interval", async () => {
  const start = 3.7;
  const duration = 0.1;
  const firstFrame = 111;
  const { root } = await fixture();
  const output = join(root, "fractional-title.mp4");
  await new FFmpegRenderer().render(
    {
      id: "fractional-title",
      storyId: "story",
      duration: 4,
      tracks: [
        {
          id: "titles",
          type: "titles",
          clips: [
            {
              id: "short-title",
              assetId: "",
              title: "FRAME",
              titleStyle: {
                version: 1,
                role: "film-title",
                fontSize: 20,
                position: "center",
                background: "none",
              },
              timelineStart: start,
              timelineDuration: duration,
            },
          ],
        },
      ],
    },
    [],
    output,
    settings,
  );
  const decoded = await allPixels(output);
  const frameBytes = settings.width * settings.height * 3;
  expect(decoded.length).toBe(120 * frameBytes);
  const brightPixels = (frame: number) =>
    decoded
      .subarray(frame * frameBytes, (frame + 1) * frameBytes)
      .filter((value) => value > 200).length;
  expect(brightPixels(112), "visible control frame").toBeGreaterThan(10);
  for (let frame = 0; frame < 120; frame++) {
    if (frame >= firstFrame && frame < 114)
      expect(
        brightPixels(frame),
        `inside title at frame ${frame}`,
      ).toBeGreaterThan(10);
    else expect(brightPixels(frame), `outside title at frame ${frame}`).toBe(0);
  }
});
it("starts photo motion at the authored first-frame position", async () => {
  const { root, photo } = await fixture();
  const source = await photo(
    "first-frame-subject",
    "color=black:s=160x90,drawbox=x=60:y=20:w=20:h=40:color=white:t=fill",
  );
  const from = { scale: 1.2, x: -10, y: 0 };
  const clip: Clip = {
    id: "motion-start",
    assetId: source.id,
    timelineStart: 0,
    timelineDuration: 2,
    motion: {
      version: 1,
      preset: "pan",
      easing: "linear",
      from,
      to: { ...from, x: 10 },
    },
  };
  const renderer = new FFmpegRenderer();
  const moving = join(root, "moving.mp4");
  const held = join(root, "held.mp4");
  await renderer.render(film([clip]), [source], moving, settings);
  await renderer.render(
    film([{ ...clip, motion: { ...clip.motion!, preset: "hold", to: from } }]),
    [source],
    held,
    settings,
  );
  const center = (frame: Buffer) => {
    let weighted = 0;
    let total = 0;
    for (let x = 30; x < 115; x++) {
      const weight = frame[(45 * settings.width + x) * 3]!;
      weighted += x * weight;
      total += weight;
    }
    return weighted / total;
  };
  assertRenderQaMetric(
    "photo.firstFrameCenterError",
    Math.abs(center(await pixels(moving)) - center(await pixels(held))),
  );
});
it.each(["x", "y"] as const)(
  "keeps a slow %s pan continuous between adjacent output frames",
  async (axis) => {
    const { root, photo } = await fixture();
    const source = await photo(
      "slow-pan-subject",
      "color=black:s=160x90,drawbox=x=60:y=30:w=20:h=20:color=white:t=fill",
    );
    const output = join(root, "slow-pan.mp4");
    await new FFmpegRenderer().render(
      film([
        {
          id: "slow-pan",
          assetId: source.id,
          timelineStart: 0,
          timelineDuration: 2,
          motion: {
            version: 1,
            preset: "pan",
            easing: "linear",
            from: { scale: 1.05, x: 0, y: 0, [axis]: -1 },
            to: { scale: 1.05, x: 0, y: 0, [axis]: 1 },
          },
        },
      ]),
      [source],
      output,
      settings,
    );
    const decoded = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-pix_fmt",
        "gray",
        "-f",
        "rawvideo",
        "-",
      ])
    ).stdout;
    const frameBytes = settings.width * settings.height;
    expect(decoded.length).toBe(60 * frameBytes);
    const centers = Array.from({ length: 60 }, (_, frame) => {
      let weighted = 0;
      let total = 0;
      for (let y = 20; y < 65; y++) {
        for (let x = 45; x < 95; x++) {
          const weight = decoded[frame * frameBytes + y * settings.width + x]!;
          weighted += (axis === "x" ? x : y) * weight;
          total += weight;
        }
      }
      return weighted / total;
    });
    assertRenderQaMetric("photo.panTravel", centers.at(-1)! - centers[0]!);
    const steps = centers.slice(1).map((center, i) => center - centers[i]!);
    // The authored camera advances only 1/30 px per frame. Crop rounding used
    // to hold it in place, then jump by about half a pixel in either axis.
    assertRenderQaMetric("photo.panStep", Math.max(...steps.map(Math.abs)));
  },
);
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
      assertRenderQaMetric(
        "photo.subjectEdgeError",
        Math.abs(left - (80 + (20 - 80) * evaluated.transform.scale)),
      );
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
  assertRenderQaMetric(
    "photo.fadeOutRmsRatio",
    (await rms(0.96)) / (await rms(0.4)),
  );
  assertRenderQaMetric(
    "photo.fadeInRmsRatio",
    (await rms(0.02)) / (await rms(0.4)),
  );
  const probe = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    output,
  ]);
  assertRenderQaMetric(
    "photo.duration",
    Number(JSON.parse(probe.stdout.toString()).format.duration),
    2,
  );
});
