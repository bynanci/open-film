// SPDX-License-Identifier: Apache-2.0
// Generated tones and colour frames only; no speech recordings or private media.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MediaAsset } from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";

async function stereoWave(
  root: string,
  id: string,
  rate: number,
  duration: number,
  silence: boolean,
  rightActiveDuringSilence = false,
): Promise<MediaAsset> {
  const frames = Math.round(rate * duration);
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    for (let c = 0; c < 2; c++) {
      const amplitude =
        silence && t >= 1 && t < 2 && !(c === 1 && rightActiveDuringSilence)
          ? 0
          : silence
            ? 0.2
            : 0.025;
      const frequency = silence ? (c === 0 ? 440 : 660) : c === 0 ? 220 : 330;
      bytes.writeInt16LE(
        Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * frequency * t)),
        44 + (i * 2 + c) * 2,
      );
    }
  }
  const path = join(root, `${id}.wav`);
  await writeFile(path, bytes);
  return {
    id,
    name: `${id}.wav`,
    uri: pathToFileURL(path).href,
    mediaType: "audio",
    duration,
    contentHash: await hashFile(path),
    tags: [],
    state: {},
    metadata: {},
  };
}

export async function silenceAuditionFixture(
  root: string,
  rate: 44100 | 48000,
  speed = 1,
  rightActiveDuringSilence = false,
) {
  const voice = await stereoWave(
    root,
    "voice",
    rate,
    4,
    true,
    rightActiveDuringSilence,
  );
  const music = await stereoWave(
    root,
    "music",
    rate === 44100 ? 48000 : 44100,
    8,
    false,
  );
  const duration = speed === 1 ? 8 : 5.6;
  const videoPath = join(root, "broll.mkv");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x223344:s=160x90:r=25:d=${duration}`,
    "-c:v",
    "ffv1",
    "-threads",
    "1",
    "-y",
    videoPath,
  ]);
  const broll: MediaAsset = {
    id: "broll",
    name: "broll.mkv",
    uri: pathToFileURL(videoPath).href,
    mediaType: "video",
    duration,
    dimensions: { width: 160, height: 90 },
    frameRate: 25,
    contentHash: await hashFile(videoPath),
    tags: [],
    state: {},
    metadata: {},
  };
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Synthetic silence audition",
  );
  app.project.settings = { width: 160, height: 90, frameRate: 25 };
  const sourceIn = speed === 1 ? 0 : 0.25;
  const sourceOut = speed === 1 ? 4 : 3.75;
  const clipDuration = (sourceOut - sourceIn) / speed;
  app.project.stories = [{ id: "story", title: "Synthetic review", beats: [] }];
  app.project.timelines = [
    {
      id: "timeline",
      storyId: "story",
      duration,
      tracks: [
        {
          id: "dialogue",
          type: "audio",
          clips: [0, 1].map((index) => ({
            id: `voice-${index}`,
            assetId: voice.id,
            sourceIn,
            sourceOut,
            timelineStart: index * clipDuration,
            timelineDuration: clipDuration,
            ...(speed !== 1 ? { transform: { speed } } : {}),
          })),
        },
        {
          id: "pictures",
          type: "video",
          clips: [
            {
              id: "broll-clip",
              assetId: broll.id,
              sourceIn: 0,
              sourceOut: duration,
              timelineStart: 0,
              timelineDuration: duration,
            },
          ],
        },
        {
          id: "music",
          type: "music",
          timing: "overlay",
          clips: [
            {
              id: "music-clip",
              assetId: music.id,
              sourceIn: 0,
              sourceOut: duration,
              timelineStart: 0,
              timelineDuration: duration,
            },
          ],
        },
      ],
    },
  ];
  for (const asset of [voice, music, broll]) app.catalog.upsertAsset(asset);
  await app.save();
  return { app, assets: [voice, music, broll], voice, music, broll, duration };
}
