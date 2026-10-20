import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createExportProfile,
  type Clip,
  type Composition,
  type MediaAsset,
  type Track,
} from "@openfilm/core";
import { hashFile, inspectMedia, localPath, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";

let root: string;
let silentVideo: MediaAsset;
let photo: MediaAsset;
let narration: MediaAsset;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-presentation-capability-"));
  const videoPath = join(root, "silent.mp4");
  const photoPath = join(root, "photo.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x90:r=30:d=0.4",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    videoPath,
  ]);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=60x120",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    photoPath,
  ]);
  const audioPath = join(root, "narration.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000:duration=0.4",
    "-c:a",
    "pcm_s16le",
    "-y",
    audioPath,
  ]);
  narration = await inspectMedia({
    path: audioPath,
    name: "narration.wav",
    uri: pathToFileURL(audioPath).href,
  });
  silentVideo = await inspectMedia({
    path: videoPath,
    name: "silent.mp4",
    uri: pathToFileURL(videoPath).href,
  });
  photo = await inspectMedia({
    path: photoPath,
    name: "photo.png",
    uri: pathToFileURL(photoPath).href,
  });
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const layout: Clip["layout"] = {
  version: 1,
  preset: "hero",
  focalPoint: { x: 1, y: 1 },
};
const motion: Clip["motion"] = {
  version: 1,
  preset: "pan",
  easing: "linear",
  from: { scale: 1, x: 0, y: 0 },
  to: { scale: 1.1, x: 2, y: 0 },
};
const audioAutomation: Clip["audioAutomation"] = {
  version: 1,
  role: "dialogue",
  fadeIn: 0.2,
};
const cases: {
  name: string;
  source: "video" | "photo";
  track: Track["type"];
  fields: Partial<Clip>;
  error: RegExp;
}[] = [
  {
    name: "full-frame photo layout on a transparent overlay track",
    source: "photo",
    track: "overlay",
    fields: { layout },
    error: /story video track/iu,
  },
  {
    name: "photo layout on video",
    source: "video",
    track: "video",
    fields: { layout },
    error: /still image/iu,
  },
  {
    name: "photo motion on video",
    source: "video",
    track: "video",
    fields: { motion },
    error: /still image/iu,
  },
  {
    name: "audio automation on silent video",
    source: "video",
    track: "video",
    fields: { audioAutomation },
    error: /audio stream/iu,
  },
  {
    name: "audio automation on photo",
    source: "photo",
    track: "video",
    fields: { audioAutomation },
    error: /audio stream/iu,
  },
  {
    name: "photo layout on audio track",
    source: "photo",
    track: "audio",
    fields: { layout },
    error: /story video track/iu,
  },
  {
    name: "photo motion on music track",
    source: "photo",
    track: "music",
    fields: { motion },
    error: /story video track/iu,
  },
  {
    name: "photo layout on title track",
    source: "photo",
    track: "titles",
    fields: { layout },
    error: /title tracks/iu,
  },
  {
    name: "photo motion on title track",
    source: "photo",
    track: "titles",
    fields: { motion },
    error: /title tracks/iu,
  },
  {
    name: "audio automation on title track",
    source: "video",
    track: "titles",
    fields: { audioAutomation },
    error: /title tracks/iu,
  },
];
it.each(cases)(
  "rejects $name without replacing the prior render or manifest",
  async ({ name, source, track, fields, error }) => {
    const asset = source === "video" ? silentVideo : photo;
    const composition: Composition = {
      id: "unsupported",
      storyId: "story",
      duration: 0.4,
      tracks: [
        {
          id: "track",
          type: track,
          clips: [
            {
              id: "clip",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 0.4,
              ...fields,
            },
          ],
        },
      ],
    };
    const output = join(root, `${name.replaceAll(" ", "-")}.mp4`);
    await writeFile(output, "prior completed render");
    await writeFile(`${output}.manifest.json`, "prior completed manifest");
    await expect(
      new FFmpegRenderer().render(composition, [asset], output, {
        width: 160,
        height: 90,
        frameRate: 30,
      }),
    ).rejects.toThrow(error);
    expect(await readFile(output, "utf8")).toBe("prior completed render");
    expect(await readFile(`${output}.manifest.json`, "utf8")).toBe(
      "prior completed manifest",
    );
    expect(
      (await readdir(root)).filter((name) => name.startsWith(".render-")),
    ).toEqual([]);
  },
);

it.each(["audioOnly", "videoOnly"] as const)(
  "checks only consumed graph capabilities for %s delivery",
  async (mode) => {
    const composition: Composition = {
      id: "scoped-capabilities",
      storyId: "story",
      duration: 0.4,
      tracks: [
        {
          id: "visual",
          type: mode === "audioOnly" ? "overlay" : "video",
          clips: [
            {
              id: "photo",
              assetId: photo.id,
              timelineStart: 0,
              timelineDuration: 0.4,
              ...(mode === "audioOnly" ? { layout } : {}),
            },
          ],
        },
        {
          id: "narration",
          type: "audio",
          clips: [
            {
              id: "voice",
              assetId: narration.id,
              timelineStart: 0,
              timelineDuration: 0.4,
              ...(mode === "videoOnly" ? { motion } : {}),
            },
          ],
        },
      ],
    };
    const assets = [photo, narration];
    const before = structuredClone(composition);
    const sourceHashes = await Promise.all(
      assets.map((asset) => hashFile(localPath(asset.uri))),
    );
    const renderer = new FFmpegRenderer();
    await expect(
      renderer.render(composition, assets, join(root, `${mode}-full.mp4`), {
        width: 160,
        height: 90,
        frameRate: 30,
      }),
    ).rejects.toThrow(/still image|story video track/iu);
    const output = join(
      root,
      `${mode}.${mode === "audioOnly" ? "wav" : "mp4"}`,
    );
    await renderer.render(
      composition,
      assets,
      output,
      {
        width: 160,
        height: 90,
        frameRate: 30,
      },
      {
        [mode]: true,
        ...(mode === "audioOnly"
          ? {
              exportProfile: createExportProfile({
                ratio: "16:9",
                width: 160,
                height: 90,
                frameRate: 30,
                format: "wav",
              }),
            }
          : {}),
      },
    );
    const manifest = JSON.parse(
      await readFile(`${output}.manifest.json`, "utf8"),
    );
    expect(
      manifest.sources.map((source: { assetId: string }) => source.assetId),
    ).toEqual([mode === "audioOnly" ? narration.id : photo.id]);
    if (mode === "audioOnly") {
      const pcm = (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          output,
          "-f",
          "s24le",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-",
        ])
      ).stdout;
      expect(pcm.length / 6).toBe(19200);
      expect(pcm.some((value) => value !== 0)).toBe(true);
    } else {
      const streams = JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-count_frames",
            "-show_entries",
            "stream=codec_type,nb_read_frames",
            "-of",
            "json",
            output,
          ])
        ).stdout.toString(),
      ).streams;
      expect(streams).toEqual([{ codec_type: "video", nb_read_frames: "12" }]);
    }
    expect(composition).toEqual(before);
    expect(
      await Promise.all(assets.map((asset) => hashFile(localPath(asset.uri)))),
    ).toEqual(sourceHashes);
  },
);
