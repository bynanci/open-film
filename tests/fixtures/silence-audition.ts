// SPDX-License-Identifier: Apache-2.0
// Generated signals and colour frames only; no speech recordings or private media.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MediaAsset } from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";

async function generatedStereoWave(
  root: string,
  id: string,
  rate: number,
  duration: number,
  pcmValue: (frame: number, channel: number) => number,
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
    for (let c = 0; c < 2; c++)
      bytes.writeInt16LE(Math.round(pcmValue(i, c)), 44 + (i * 2 + c) * 2);
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

function stereoWave(
  root: string,
  id: string,
  rate: number,
  duration: number,
  silence: boolean,
  rightActiveDuringSilence = false,
) {
  return generatedStereoWave(root, id, rate, duration, (frame, channel) => {
    const t = frame / rate;
    const amplitude =
      silence && t >= 1 && t < 2 && !(channel === 1 && rightActiveDuringSilence)
        ? 0
        : silence
          ? 0.2
          : 0.025;
    const frequency = silence
      ? channel === 0
        ? 440
        : 660
      : channel === 0
        ? 220
        : 330;
    return amplitude * 32767 * Math.sin(2 * Math.PI * frequency * t);
  });
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

/**
 * A bounded low-energy case, not a speech/VAD or perceptual-quality fixture.
 * Each active 20ms window contains a damped transient, with a quiet guard at
 * its edges so resampling does not move activity into an adjacent quiet window.
 * Nonzero seeded room floor and breath envelopes stay well below -40 dBFS.
 */
export async function transientSilenceAuditionFixture(
  root: string,
  rate: 44100 | 48000,
) {
  const duration = 5;
  const seed = 0x5eeda11;
  let noiseState = seed;
  const noise = () => {
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    return ((noiseState >>> 0) / 0x100000000) * 2 - 1;
  };
  const quietSpans: readonly (readonly [number, number])[] = [
    [0.5, 1.3],
    [2, 2.4],
    [3, 4],
  ];
  const voice = await generatedStereoWave(
    root,
    "voice",
    rate,
    duration,
    (frame, channel) => {
      const t = frame / rate;
      const quietSpan = quietSpans.find(
        ([start, end]) =>
          frame >= Math.round(start * rate) && frame < Math.round(end * rate),
      );
      const random = noise();
      const room = 0.0012 * random + 0.0004 * Math.sin(2 * Math.PI * 75 * t);
      const breathPhase = quietSpan ? (t - quietSpan[0] - 0.1) / 0.3 : -1;
      const breath =
        breathPhase >= 0 && breathPhase < 1
          ? 0.003 * random * Math.sin(Math.PI * breathPhase) ** 2
          : 0;
      const rightOnly =
        channel === 1 &&
        frame >= Math.round(3.6 * rate) &&
        frame < Math.round(3.7 * rate);
      if (quietSpan && !rightOnly) return (room + breath) * 32767;
      const phase = (frame % (rate / 50)) / rate - 0.003;
      const transient =
        phase >= 0 && phase < 0.012
          ? 0.18 *
            Math.exp(-phase * 220) *
            Math.sin(2 * Math.PI * (channel === 0 ? 730 : 1090) * phase)
          : 0;
      return (room + transient) * 32767;
    },
  );
  const musicRate = rate === 44100 ? 48000 : 44100;
  const music = await generatedStereoWave(
    root,
    "music",
    musicRate,
    duration,
    (frame, channel) => {
      const t = frame / musicRate;
      let value = 0;
      for (const start of [0.35, 2.85]) {
        const elapsed = t - start;
        if (elapsed < 0 || elapsed >= 1.4) continue;
        const attack = Math.min(1, elapsed / 0.01);
        const release = Math.min(1, (1.4 - elapsed) / 0.04);
        const envelope = 0.09 * attack * release * Math.exp(-2 * elapsed);
        const frequency = channel === 0 ? 220 : 330;
        value +=
          envelope *
          (Math.sin(2 * Math.PI * frequency * elapsed) +
            0.2 * Math.sin(2 * Math.PI * 2 * frequency * elapsed));
      }
      return value * 32767;
    },
  );
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Seeded transient silence audition",
  );
  // Every proposed padded boundary is exact at 30fps and at both source rates.
  app.project.settings = { width: 160, height: 90, frameRate: 30 };
  app.project.stories = [
    { id: "story", title: "Synthetic low-energy review", beats: [] },
  ];
  app.project.timelines = [
    {
      id: "timeline",
      storyId: "story",
      duration,
      tracks: [
        {
          id: "dialogue",
          type: "audio",
          clips: [
            {
              id: "voice-clip",
              assetId: voice.id,
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
  for (const asset of [voice, music]) app.catalog.upsertAsset(asset);
  await app.save();
  return { app, assets: [voice, music], voice, music, duration, seed };
}
