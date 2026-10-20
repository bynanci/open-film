import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import { runProcess } from "@openfilm/media";
export async function createMotionFixture(
  root: string,
  runtime: import("@openfilm/application").OpenFilmRuntimeOptions = {},
) {
  const media = join(root, "synthetic");
  await mkdir(media, { recursive: true });
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=12",
    "-frames:v",
    "1",
    "-threads",
    "1",
    join(media, "landscape.png"),
  ]);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4:sample_rate=48000",
    join(media, "narration.wav"),
  ]);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Synthetic motion",
    {},
    runtime,
  );
  await app.importFolder(media);
  const assets = app.catalog.listAssets({ limit: 10 });
  const image = assets.find((asset) => asset.mediaType === "image")!;
  const audio = assets.find((asset) => asset.mediaType === "audio")!;
  app.project.settings = { width: 160, height: 90, frameRate: 12 };
  app.project.stories = [
    {
      id: "story",
      title: "Synthetic",
      beats: [
        {
          id: "beat",
          title: "Synthetic",
          candidateAssetIds: [image.id],
          selectedAssetIds: [image.id],
        },
      ],
    },
  ];
  app.project.timelines = [
    {
      id: "film",
      storyId: "story",
      duration: 4,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "photo",
              assetId: image.id,
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 4,
              sourceIn: 0,
              sourceOut: 4,
            },
          ],
        },
      ],
    },
  ];
  app.project.timelines[0]!.tracks.push({
    id: "narration",
    type: "audio",
    clips: [
      {
        id: "voice",
        assetId: audio.id,
        timelineStart: 0,
        timelineDuration: 4,
        sourceIn: 0,
        sourceOut: 4,
        audioAutomation: { version: 1, role: "narration", fadeIn: 0.25 },
      },
    ],
  });
  await app.save();
  const editor = new TimelineEditor(app);
  return { app, editor, image };
}
