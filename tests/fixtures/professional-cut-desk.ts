// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Composition, MediaAsset, ProjectSettings } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { graphicNode, graphicScene } from "./graphic-scene.js";

/** Only fixture construction lives here; expected frames/pixels/tones live in tests. */
export async function professionalCutDeskFixture(root: string) {
  const assets: MediaAsset[] = [];
  const paths: string[] = [];
  for (const [index, color, tone, x] of [
    [0, "0xff0000", 440, 8],
    [1, "0x00ff00", 660, 64],
    [2, "0x0000ff", 880, 120],
  ] as const) {
    const path = join(root, `${index}-${color}.mp4`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=160x90:r=30000/1001:d=3,drawbox=x=${x}:y=30:w=16:h=16:color=white:t=fill,drawbox=x=8:y=6:w=12:h=12:color=white:t=fill:enable='lt(n,30)',drawbox=x=40:y=6:w=12:h=12:color=white:t=fill:enable='gte(n,30)*lt(n,60)',drawbox=x=72:y=6:w=12:h=12:color=white:t=fill:enable='gte(n,60)'`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${tone}:sample_rate=48000:duration=3`,
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-y",
      path,
    ]);
    paths.push(path);
  }
  const overlay = join(root, "overlay-1100.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1100:sample_rate=48000:duration=3",
    "-c:a",
    "pcm_s16le",
    "-y",
    overlay,
  ]);
  paths.push(overlay);
  for (const path of paths)
    assets.push(
      await inspectMedia({
        path,
        uri: pathToFileURL(path).href,
        name: path.split("/").at(-1)!,
      }),
    );
  const hashes = await Promise.all(paths.map((path) => hashFile(path)));
  const settings: ProjectSettings = {
    width: 160,
    height: 90,
    frameRate: 30000 / 1001,
    timebase: {
      version: 1,
      rateNumerator: 30000,
      rateDenominator: 1001,
      dropFrame: true,
    },
  };
  const composition: Composition = {
    id: "professional-cut",
    storyId: "synthetic-story",
    duration: 6.006,
    tracks: [
      {
        id: "picture",
        type: "video",
        clips: assets.slice(0, 3).map((asset, index) => ({
          id: ["red", "green", "blue"][index]!,
          assetId: asset.id,
          beatId: "synthetic-beat",
          sourceIn: 0.5005,
          sourceOut: 2.5025,
          timelineStart: index * 2.002,
          timelineDuration: 2.002,
          transform: { volume: [0.4, 0.6, 0.8][index]! },
          ...(index === 1
            ? { transition: { type: "crossfade" as const, duration: 0.5005 } }
            : {}),
        })),
      },
      {
        id: "audible-overlay",
        type: "audio",
        timing: "overlay",
        clips: [
          {
            id: "tone-overlay",
            assetId: assets[3]!.id,
            beatId: "synthetic-beat",
            sourceIn: 0,
            sourceOut: 2.002,
            timelineStart: 2.5025,
            timelineDuration: 2.002,
            transform: { volume: 0.5 },
            audioAutomation: {
              version: 1,
              role: "ambience",
              points: [{ time: 0, gain: 0.5 }],
            },
          },
        ],
      },
    ],
    graphicScenes: [
      graphicScene({
        id: "moving-square",
        name: "Synthetic square 合成方塊",
        duration: 6.006,
        nodes: [
          graphicNode({
            id: "yellow",
            fill: "#ffff00",
            width: 12,
            height: 12,
            y: 25,
            end: 6.006,
            animation: {
              enter: { duration: 6.006, easing: "linear", from: { x: -60 } },
            },
          }),
        ],
      }),
    ],
  };
  return { assets, paths, hashes, settings, composition };
}
