// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runProcess } from "@openfilm/media";
import { FFmpegRenderer, prepareGraphicScenes } from "@openfilm/render";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import {
  graphicNode,
  graphicScene,
} from "../../../tests/fixtures/graphic-scene.js";

it.each([
  [23.976, 24000],
  [29.97, 30000],
  [59.94, 60000],
  [30, 30030],
])(
  "matches real graphic rendering and admits the rational final frame in legacy %s without saving a migration",
  async (rate, numerator) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-legacy-graphic-"));
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Legacy graphic rate",
    );
    try {
      const duration = (180 * 1001) / numerator;
      const settings = { width: 160, height: 90, frameRate: rate };
      app.project.settings = settings;
      app.project.stories.push({ id: "story", title: "Synthetic", beats: [] });
      const composition = {
        id: "cut",
        storyId: "story",
        duration,
        tracks: [],
        graphicScenes: [
          graphicScene({
            duration,
            nodes: [
              graphicNode({
                id: "red",
                width: 160,
                height: 90,
                fill: "#ff0000",
                end: (60 * 1001) / numerator,
              }),
              graphicNode({
                id: "green",
                width: 160,
                height: 90,
                fill: "#00ff00",
                start: (60 * 1001) / numerator,
                end: (120 * 1001) / numerator,
              }),
              graphicNode({
                id: "blue",
                width: 160,
                height: 90,
                fill: "#0000ff",
                start: (120 * 1001) / numerator,
                end: duration,
              }),
            ],
          }),
        ],
      };
      app.project.timelines.push(composition);
      await app.save();
      const editor = new TimelineEditor(app);
      const before = editor.get("cut");
      const bytes = await readFile(join(app.directory, "project.json"));
      // The renderer's already-normalized rational settings are an independent
      // consumer of the same saved legacy project; final MP4 pixels are checked too.
      const prepared = await prepareGraphicScenes(
        composition,
        [],
        { ...settings, frameRate: numerator / 1001 },
        root,
      );
      const input = {
        projectId: app.project.id,
        baseRevision: before.revision,
      };
      for (const frame of [60, 179, 59, 120, 0, 119, 75, 178, 60, 179]) {
        expect(
          await app.graphics.frame("cut", { ...input, frameIndex: frame }),
        ).toEqual(await prepared.frame(null, frame));
      }
      await expect(
        app.graphics.frame("cut", { ...input, frameIndex: 180 }),
      ).rejects.toMatchObject({ code: "graphics.invalid" });
      await expect(
        app.graphics.frame("cut", {
          ...input,
          baseRevision: "stale",
          frameIndex: 60,
        }),
      ).rejects.toMatchObject({ code: "graphics.stale" });
      const output = join(root, "legacy.mp4");
      await new FFmpegRenderer().render(composition, [], output, settings, {
        quality: "high-detail",
      });
      const probe = JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=avg_frame_rate,nb_read_frames",
            "-of",
            "json",
            output,
          ])
        ).stdout.toString(),
      );
      expect(probe.streams[0]).toMatchObject({
        avg_frame_rate: rate === 30 ? "30/1" : `${numerator}/1001`,
        nb_read_frames: "180",
      });
      const rgb = (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          output,
          "-map",
          "0:v:0",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ])
      ).stdout;
      expect(rgb.length).toBe(180 * 160 * 90 * 3);
      for (const [frame, color] of [
        [0, [255, 0, 0]],
        [59, [255, 0, 0]],
        [60, [0, 255, 0]],
        [119, [0, 255, 0]],
        [120, [0, 0, 255]],
        [179, [0, 0, 255]],
      ] as const) {
        const pixel = [
          ...rgb.subarray(
            ((frame * 90 + 45) * 160 + 80) * 3,
            ((frame * 90 + 45) * 160 + 80) * 3 + 3,
          ),
        ];
        pixel.forEach((value, channel) =>
          expect(Math.abs(value - color[channel]!)).toBeLessThanOrEqual(12),
        );
      }
      expect(app.project.settings).toEqual(settings);
      expect(app.project.settings.timebase).toBeUndefined();
      expect(editor.get("cut")).toEqual(before);
      expect(await readFile(join(app.directory, "project.json"))).toEqual(
        bytes,
      );
    } finally {
      app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
