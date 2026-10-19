import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { OpenFilmApplication } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
export async function createAudioQualityFixture(root: string) {
  const media = join(root, "media");
  await mkdir(media, { recursive: true });
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=s=160x90:r=12:d=4",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    join(media, "synthetic.mp4"),
  ]);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4:sample_rate=48000",
    "-af",
    "volume=4",
    join(media, "synthetic.wav"),
  ]);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Synthetic audio quality",
  );
  await app.importFolder(media);
  const assets = app.catalog.listAssets({ limit: 100 });
  const video = assets.find((a) => a.name.endsWith(".mp4"))!;
  const audio = assets.find((a) => a.name.endsWith(".wav"))!;
  app.project.settings = { width: 160, height: 90, frameRate: 12 };
  app.project.stories.push({
    id: "story",
    title: "Synthetic",
    beats: [{ id: "beat", title: "Synthetic", candidateAssetIds: [video.id] }],
  });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration: 4,
    tracks: [
      {
        id: "video",
        type: "video",
        clips: [
          {
            id: "picture",
            assetId: video.id,
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 4,
            sourceIn: 0,
            sourceOut: 4,
          },
        ],
      },
      {
        id: "sound",
        type: "music",
        timing: "overlay",
        clips: [
          {
            id: "sound",
            assetId: audio.id,
            timelineStart: 0,
            timelineDuration: 4,
            sourceIn: 0,
            sourceOut: 4,
            transform: { volume: 0.8 },
            audioAutomation: {
              version: 1,
              role: "music",
              fadeIn: 0.2,
              fadeOut: 0.2,
              points: [
                { time: 0, gain: 1 },
                { time: 4, gain: 0.8 },
              ],
              ducking: [
                { start: 1, end: 2, gain: 0.5, attack: 0.1, release: 0.1 },
              ],
            },
          },
        ],
      },
    ],
  });
  await app.save();
  return { app, audio, video };
}
