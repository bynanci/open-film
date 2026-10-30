// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  filmLookMatrix,
  type Composition,
  type FilmLook,
} from "@openfilm/core";
import { createPresetSnapshot } from "@openfilm/application";
import { inspectMedia, hashFile, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
const roots: string[] = [];
afterEach(async () => {
  for (const p of roots.splice(0))
    await rm(p, { recursive: true, force: true });
});
const settings = { width: 160, height: 90, frameRate: 12 },
  frameBytes = 160 * 90 * 3,
  sha = (v: Buffer) => createHash("sha256").update(v).digest("hex");
async function decode(path: string, frame?: number) {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-threads",
      "1",
      ...(frame === undefined
        ? []
        : ["-ss", Math.max(0, frame / 12 - 0.00001).toFixed(6)]),
      "-i",
      path,
      ...(frame === undefined ? [] : ["-frames:v", "1"]),
      "-pix_fmt",
      "rgb24",
      "-threads",
      "1",
      "-f",
      "rawvideo",
      "pipe:1",
    ])
  ).stdout;
}
const pixel = (bytes: Buffer, x: number, y = 45, frame = 0) => [
  ...bytes.subarray(
    frame * frameBytes + (y * 160 + x) * 3,
    frame * frameBytes + (y * 160 + x) * 3 + 3,
  ),
];
function transform(rgb: number[], look: FilmLook) {
  const m = filmLookMatrix(look);
  return [0, 5, 10].map((i) =>
    Math.max(
      0,
      Math.min(
        255,
        rgb[0]! * m[i]! +
          rgb[1]! * m[i + 1]! +
          rgb[2]! * m[i + 2]! +
          255 * m[i + 3]!,
      ),
    ),
  );
}
it("renders imported matrices at 0/half/full strength, detects a wrong matrix, and seeks actual video frames in shuffled order", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-d8-render-"));
  roots.push(root);
  const chart = join(root, "chart.png"),
    video = join(root, "motion.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x705038:s=160x90,format=rgb24,drawbox=x=0:y=0:w=53:h=90:color=0x2070b0:t=fill,drawbox=x=106:y=0:w=54:h=90:color=0xb08030:t=fill",
    "-frames:v",
    "1",
    "-threads",
    "1",
    chart,
  ]);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=12",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  const photo = await inspectMedia({
      path: chart,
      name: "Synthetic chart",
      uri: pathToFileURL(chart).href,
    }),
    movie = await inspectMedia({
      path: video,
      name: "Synthetic motion",
      uri: pathToFileURL(video).href,
    }),
    p = presetPackage(),
    snapshot = createPresetSnapshot<"film-look">(
      p as never,
      p.entries[0] as never,
    ),
    source = await decode(chart),
    sourceSha = await hashFile(chart);
  const composition: Composition = {
    id: "d8",
    storyId: "s",
    duration: 0.5,
    tracks: [
      {
        id: "v",
        type: "video",
        clips: [
          {
            id: "c",
            assetId: photo.id,
            timelineStart: 0,
            timelineDuration: 0.5,
          },
        ],
      },
    ],
  };
  const evidence: Array<{
    strength: number;
    encodedSha256: string;
    frames: string[];
    matrix: number[];
  }> = [];
  let baseline: Buffer | undefined;
  const nonePath = join(root, "none.mp4");
  await new FFmpegRenderer().render(composition, [photo], nonePath, settings);
  const none = await decode(nonePath);
  for (const strength of [0, 0.5, 1]) {
    const look: FilmLook = { version: 2, preset: "local", strength, snapshot },
      path = join(root, `strength-${strength}.mp4`);
    await new FFmpegRenderer().render(
      { ...composition, defaultLook: look },
      [photo],
      path,
      settings,
    );
    const actual = await decode(path);
    expect(actual.length / frameBytes).toBe(6);
    if (strength === 0) expect(actual).toEqual(none);
    for (const frame of [0, 3, 5])
      for (const x of [20, 80, 140]) {
        const expected = transform(pixel(source, x), look),
          observed = pixel(actual, x, 45, frame);
        for (let channel = 0; channel < 3; channel++)
          expect(
            Math.abs(observed[channel]! - Math.round(expected[channel]!)),
            `strength ${strength},frame ${frame},x ${x},channel ${channel}`,
          ).toBeLessThanOrEqual(3);
      }
    if (strength === 1) baseline = actual;
    const manifest = JSON.parse(
      await readFile(path + ".manifest.json", "utf8"),
    );
    expect(manifest.looks.clips[0].presetSnapshotSha256).toBe(
      snapshot.snapshotSha256,
    );
    expect(manifest.presetSnapshots[0].license.spdxId).toBe("CC0-1.0");
    evidence.push({
      strength,
      encodedSha256: await hashFile(path),
      frames: [0, 3, 5].map((i) =>
        sha(actual.subarray(i * frameBytes, (i + 1) * frameBytes)),
      ),
      matrix: filmLookMatrix(look),
    });
  }
  const wrong = presetPackage();
  wrong.version = "1.0.1";
  wrong.entries[0]!.recipe.matrix![0] = 1.25;
  const wrongSnapshot = createPresetSnapshot<"film-look">(
      wrong as never,
      wrong.entries[0] as never,
    ),
    wrongPath = join(root, "wrong.mp4");
  await new FFmpegRenderer().render(
    {
      ...composition,
      defaultLook: {
        version: 2,
        preset: "local",
        strength: 1,
        snapshot: wrongSnapshot,
      },
    },
    [photo],
    wrongPath,
    settings,
  );
  const wrongPixels = await decode(wrongPath);
  expect(
    Math.abs(pixel(wrongPixels, 80)[0]! - pixel(baseline!, 80)[0]!),
  ).toBeGreaterThan(3);
  const moving: Composition = {
      ...composition,
      duration: 1,
      defaultLook: { version: 2, preset: "local", strength: 1, snapshot },
      tracks: [
        {
          id: "v",
          type: "video",
          clips: [
            {
              id: "moving",
              assetId: movie.id,
              timelineStart: 0,
              timelineDuration: 1,
              sourceIn: 0,
              sourceOut: 1,
            },
          ],
        },
      ],
    },
    movingPath = join(root, "graded-video.mp4");
  await new FFmpegRenderer().render(moving, [movie], movingPath, settings);
  const all = await decode(movingPath),
    seeks: Array<{ frame: number; sha256: string }> = [];
  expect(all.length / frameBytes).toBe(12);
  for (const frame of [11, 0, 5, 3, 8]) {
    const seek = await decode(movingPath, frame),
      expected = all.subarray(frame * frameBytes, (frame + 1) * frameBytes);
    expect(seek).toEqual(expected);
    seeks.push({ frame, sha256: sha(seek) });
  }
  expect(seeks[1]!.sha256).not.toBe(seeks[2]!.sha256);
  expect(await hashFile(chart)).toBe(sourceSha);
  const tool = (await runProcess("ffmpeg", ["-version"])).stdout
    .toString("utf8")
    .split("\n")[0];
  await writeFile(
    join(tmpdir(), "openfilm-d8-render-evidence.json"),
    JSON.stringify(
      {
        format: "openfilm.d8.synthetic-render",
        tool,
        packageSha256: snapshot.packageSha256,
        snapshotSha256: snapshot.snapshotSha256,
        sourceSha256: sourceSha,
        videoSourceSha256: await hashFile(video),
        rate: "12/1",
        strengths: evidence,
        seeks,
        wrongMatrixDetected: true,
      },
      null,
      2,
    ),
  );
});
