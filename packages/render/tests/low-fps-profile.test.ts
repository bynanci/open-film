// Modified by OpenFilm contributors on 2026-10-20. See LICENSE/NOTICE.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { createExportProfile, type Composition } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-low-fps-profile-"));
  roots.push(root);
  const assets = [];
  for (const color of ["red", "blue"]) {
    const path = join(root, `${color}.png`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=${color}:s=160x90`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      path,
    ]);
    assets.push(
      await inspectMedia({
        path,
        uri: pathToFileURL(path).href,
        name: `${color}.png`,
      }),
    );
  }
  return { root, assets };
}

async function video(path: string) {
  const probe = JSON.parse(
    (
      await runProcess("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        "stream=width,height,r_frame_rate,nb_read_frames:format=duration",
        "-of",
        "json",
        path,
      ])
    ).stdout.toString(),
  ) as {
    streams: Array<{
      width: number;
      height: number;
      r_frame_rate: string;
      nb_read_frames: string;
    }>;
    format: { duration: string };
  };
  const pixels = (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-map",
      "0:v:0",
      "-fps_mode",
      "passthrough",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-threads",
      "1",
      "-",
    ])
  ).stdout;
  return { probe, pixels };
}

function expectColor(pixels: Buffer, frame: number, color: "red" | "blue") {
  const offset = frame * 160 * 90 * 3 + (45 * 160 + 80) * 3;
  const rgb = [...pixels.subarray(offset, offset + 3)];
  expect(rgb).toHaveLength(3);
  expect(rgb[color === "red" ? 0 : 2]).toBeGreaterThan(240);
  expect(rgb[1]).toBeLessThan(8);
  expect(rgb[color === "red" ? 2 : 0]).toBeLessThan(8);
}

it.each([0.25, 0.5, 1, 12])(
  "renders a complete profiled stream from one saved %s fps picture frame",
  async (savedRate) => {
    const { root, assets } = await fixture();
    const duration = 1 / savedRate;
    const rate = Math.max(1, savedRate);
    const composition: Composition = {
      id: "film",
      storyId: "story",
      duration,
      tracks: [
        {
          id: "pictures",
          type: "video",
          clips: [
            {
              id: "red",
              assetId: assets[0]!.id,
              timelineStart: 0,
              timelineDuration: duration,
            },
          ],
        },
      ],
    };
    const settings = { width: 160, height: 90, frameRate: savedRate };
    const before = structuredClone({ composition, settings });
    const sourceHashes = await Promise.all(
      assets.map((asset) => hashFile(new URL(asset.uri).pathname)),
    );
    const path = join(root, "delivered.mp4");
    const profile = createExportProfile({
      ratio: "16:9",
      width: 160,
      height: 90,
      frameRate: rate,
      format: "mp4",
    });
    await new FFmpegRenderer().render(composition, assets, path, settings, {
      exportProfile: profile,
      videoOnly: true,
    });
    const output = await video(path);
    const count = duration * rate;
    expect(output.probe.streams).toEqual([
      expect.objectContaining({
        width: 160,
        height: 90,
        r_frame_rate: `${rate}/1`,
        nb_read_frames: String(count),
      }),
    ]);
    expect(Number(output.probe.format.duration)).toBeCloseTo(duration, 3);
    expect(output.pixels).toHaveLength(count * 160 * 90 * 3);
    for (let index = 0; index < count; index++)
      expectColor(output.pixels, index, "red");
    const receipt = JSON.parse(await readFile(`${path}.manifest.json`, "utf8"));
    expect(receipt.settings).toEqual(settings);
    expect(receipt.exportProfile).toEqual(profile);
    expect(receipt.outputSha256).toBe(await hashFile(path));
    expect({ composition, settings }).toEqual(before);
    expect(
      await Promise.all(
        assets.map((asset) => hashFile(new URL(asset.uri).pathname)),
      ),
    ).toEqual(sourceHashes);
  },
);

it("preserves both saved half-fps picture holds when delivering four one-fps frames", async () => {
  const { root, assets } = await fixture();
  const composition: Composition = {
    id: "film",
    storyId: "story",
    duration: 4,
    tracks: [
      {
        id: "pictures",
        type: "video",
        clips: assets.map((asset, index) => ({
          id: `picture-${index}`,
          assetId: asset.id,
          timelineStart: index * 2,
          timelineDuration: 2,
        })),
      },
    ],
  };
  const before = structuredClone(composition);
  const path = join(root, "delivered.mp4");
  await new FFmpegRenderer().render(
    composition,
    assets,
    path,
    { width: 160, height: 90, frameRate: 0.5 },
    {
      exportProfile: createExportProfile({
        ratio: "16:9",
        width: 160,
        height: 90,
        frameRate: 1,
        format: "mp4",
      }),
    },
  );
  const output = await video(path);
  expect(output.probe.streams[0]).toMatchObject({
    r_frame_rate: "1/1",
    nb_read_frames: "4",
  });
  expect(output.pixels).toHaveLength(4 * 160 * 90 * 3);
  for (const [index, color] of ["red", "red", "blue", "blue"].entries())
    expectColor(output.pixels, index, color as "red" | "blue");
  expect(composition).toEqual(before);
});
