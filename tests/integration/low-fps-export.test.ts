// Modified by OpenFilm contributors on 2026-10-20. See LICENSE/NOTICE.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { createExportProfile } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function pixels(path: string) {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-threads",
      "1",
      "-",
    ])
  ).stdout;
}

it.each([0.25, 0.5])(
  "previews and delivers the first and last output frames of a saved %s fps project",
  async (savedRate) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-low-fps-export-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const source = join(root, "synthetic-red.png");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=160x90",
      "-frames:v",
      "1",
      "-threads",
      "1",
      source,
    ]);
    const asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "synthetic-red.png",
    });
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Synthetic low frame rate",
      {},
      { userDataDirectory: join(root, "user-data") },
    );
    cleanup.push(() => app.close());
    const duration = 1 / savedRate;
    app.project.settings = { width: 160, height: 90, frameRate: savedRate };
    app.catalog.upsertAsset(asset);
    app.project.stories.push({ id: "story", title: "Synthetic", beats: [] });
    app.project.timelines.push({
      id: "film",
      storyId: "story",
      duration,
      tracks: [
        {
          id: "pictures",
          type: "video",
          clips: [
            {
              id: "red",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: duration,
            },
          ],
        },
      ],
    });
    await app.save();
    const before = structuredClone(app.project);
    const originalProject = await readFile(join(app.directory, "project.json"));
    const originalSourceHash = await hashFile(source);
    const png = createExportProfile({
      ratio: "16:9",
      width: 160,
      height: 90,
      frameRate: 1,
      format: "png",
    });
    const decoded: Buffer[] = [];
    for (const time of [0, duration - 1]) {
      const preview = await app.previewExportFrame({
        compositionId: "film",
        profile: png,
        time,
      });
      expect(preview).toMatchObject({
        frameIndex: time,
        time,
        width: 160,
        height: 90,
      });
      const previewPixels = await pixels(
        await app.exportProfiles.previewPath(preview.token),
      );
      expect(previewPixels).toHaveLength(160 * 90 * 3);
      expect(previewPixels[0]).toBeGreaterThan(240);
      expect(previewPixels[1]).toBeLessThan(8);
      expect(previewPixels[2]).toBeLessThan(8);
      const still = await app.exportStill({
        compositionId: "film",
        profile: png,
        time,
        requestId: `low-fps-${savedRate * 100}-${time}-001`,
      });
      expect(await pixels(still.path)).toEqual(previewPixels);
      decoded.push(previewPixels);
    }
    const output = await app.exportMp4("film", {
      exportProfile: { ...png, format: "mp4" },
    });
    const probe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-count_frames",
          "-show_entries",
          "stream=width,height,r_frame_rate,nb_read_frames",
          "-of",
          "json",
          output.path,
        ])
      ).stdout.toString(),
    );
    expect(probe.streams).toEqual([
      expect.objectContaining({
        width: 160,
        height: 90,
        r_frame_rate: "1/1",
        nb_read_frames: String(duration),
      }),
    ]);
    expect(await pixels(output.path)).toEqual(decoded[0]);
    const last = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        output.path,
        "-vf",
        `select=eq(n\\,${duration - 1})`,
        "-fps_mode",
        "passthrough",
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-threads",
        "1",
        "-",
      ])
    ).stdout;
    expect(last).toEqual(decoded[1]);
    const receipt = JSON.parse(
      await readFile(`${output.path}.manifest.json`, "utf8"),
    );
    expect(receipt.settings.frameRate).toBe(savedRate);
    expect(receipt.exportProfile.frameRate).toBe(1);
    expect(app.project).toEqual(before);
    expect(await readFile(join(app.directory, "project.json"))).toEqual(
      originalProject,
    );
    expect(await hashFile(source)).toBe(originalSourceHash);
  },
);
