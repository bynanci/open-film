import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Clip, Composition, MediaAsset, Track } from "@openfilm/core";
import { inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";

let root: string;
let silentVideo: MediaAsset;
let photo: MediaAsset;
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
