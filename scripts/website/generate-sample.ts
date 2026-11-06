// SPDX-License-Identifier: Apache-2.0
// Produces the public, silent sample through the real application renderer.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OpenFilmApplication } from "@openfilm/application";

const images = resolve("docs/public/images");
const media = resolve("docs/public/media");
await mkdir(media, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "openfilm-website-film-"));
const app = await OpenFilmApplication.create(
  join(root, "sample.openfilm"),
  "A quiet afternoon",
  {
    filmSettings: { templateId: "blank", targetDuration: 12, maxDuration: 12 },
  },
);
try {
  await app.importFiles([
    join(images, "garden-path.webp"),
    join(images, "garden-courtyard.webp"),
  ]);
  app.project.settings = { width: 1280, height: 720, frameRate: 24 };
  const assets = app.catalog.listAssets();
  const path = assets.find((asset) => asset.name === "garden-path.webp")!;
  const courtyard = assets.find(
    (asset) => asset.name === "garden-courtyard.webp",
  )!;
  const story = app.generateStory({
    title: "A quiet afternoon",
    template: "custom-outline",
    customOutline: ["Arriving", "Along the path", "A place to pause"],
    targetDuration: 12,
    maxDuration: 12,
  });
  app.project.timelines = [
    {
      id: "public-garden-film",
      storyId: story.id,
      duration: 12,
      tracks: [
        {
          id: "garden-pictures",
          type: "video",
          clips: [path, courtyard, path].map((asset, index) => ({
            id: `garden-shot-${index + 1}`,
            assetId: asset.id,
            beatId: story.beats[index]!.id,
            timelineStart: index * 4,
            timelineDuration: 4,
            ...(index < 2
              ? { transition: { type: "crossfade" as const, duration: 0.5 } }
              : {}),
          })),
        },
      ],
    },
  ];
  await app.save();
  const rendered = await app.render("public-garden-film");
  const output = join(media, "garden-film.mp4");
  await copyFile(rendered, output);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,width,height,r_frame_rate",
        "-of",
        "json",
        output,
      ],
      { encoding: "utf8" },
    ),
  );
  const pcm = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      output,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  let audioPeak = 0;
  for (let offset = 0; offset < pcm.length; offset += 4)
    audioPeak = Math.max(audioPeak, Math.abs(pcm.readFloatLE(offset)));
  if (
    Math.abs(Number(probe.format.duration) - 12) > 0.05 ||
    audioPeak > 0.00001
  )
    throw new Error(
      "The public sample must remain a twelve-second silent film.",
    );
  const hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  const provenance = {
    version: 1,
    createdAt: new Date().toISOString(),
    generator:
      "OpenAI image generation; original fictional garden scenes created for OpenFilm on 2026-11-06",
    license:
      "Apache-2.0 project assets; OpenFilm logo identity follows TRADEMARKS.md",
    imagery: await Promise.all(
      ["garden-path.webp", "garden-courtyard.webp"].map(async (file) => ({
        file,
        sha256: hash(await readFile(join(images, file))),
        type: "original-generated-artwork",
      })),
    ),
    film: {
      file: "../media/garden-film.mp4",
      rendererSourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      sha256: hash(await readFile(output)),
      probe,
      audioPeak,
      notes:
        "Rendered by OpenFilmApplication.render, with two crossfades and no external finishing. Silent sample, not hardware or audio-quality QA.",
    },
    screenshots: {
      source: "Actual Playwright browser captures with generated sample media",
      development: true,
      appSourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    },
  };
  await writeFile(
    join(images, "origins.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      output: "docs/public/media/garden-film.mp4",
      duration: probe.format.duration,
      streams: probe.streams,
    }),
  );
} finally {
  app.close();
  await rm(root, { recursive: true, force: true });
}
