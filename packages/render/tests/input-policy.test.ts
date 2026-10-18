// SPDX-License-Identifier: GPL-3.0-only
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { hashFile, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("rejects manifest asset inputs without publishing a render or source-evidence manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-render-policy-"));
  directories.push(directory);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-threads",
    "1",
    "-y",
    join(directory, "benign.wav"),
  ]);
  const source = join(directory, "playlist.mp4");
  await writeFile(source, "ffconcat version 1.0\nfile 'benign.wav'\n");
  const before = await hashFile(source);
  const asset: MediaAsset = {
    id: "audio",
    name: "playlist.mp4",
    uri: pathToFileURL(source).href,
    mediaType: "audio",
    duration: 1,
    state: {},
    tags: [],
    metadata: {},
  };
  await expect(
    new FFmpegRenderer().render(
      {
        id: "film",
        storyId: "story",
        duration: 1,
        tracks: [
          {
            id: "sound",
            type: "audio",
            clips: [
              {
                id: "clip",
                assetId: "audio",
                timelineStart: 0,
                timelineDuration: 1,
              },
            ],
          },
        ],
      },
      [asset],
      join(directory, "render.mp4"),
      { width: 32, height: 32, frameRate: 10 },
    ),
  ).rejects.toThrow(/(?:format.*whitelist|whitelist.*format)/i);
  expect(await readdir(directory)).not.toContain("render.mp4");
  expect(await readdir(directory)).not.toContain("render.mp4.manifest.json");
  expect(await hashFile(source)).toBe(before);
});
