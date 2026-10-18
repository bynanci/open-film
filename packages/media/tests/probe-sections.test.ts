import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { assetDisplayDimensions } from "@openfilm/core";
import { inspectMedia, runProcess } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it.each(["png", "jpg"])(
  "retains stream and format metadata when reading a bounded first frame from ordinary %s media",
  async (extension) => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-probe-sections-"));
    directories.push(directory);
    const path = join(directory, `ordinary.${extension}`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=blue:s=80x40",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      path,
    ]);
    const asset = await inspectMedia({
      path,
      uri: pathToFileURL(path).href,
      name: `ordinary.${extension}`,
    });
    const exif = asset.metadata["openfilm.exif"] as Record<string, unknown>;
    expect(exif.Orientation).toBeUndefined();
    const probe = asset.metadata["openfilm.ffprobe"] as {
      streams: { codec_type: string; width: number; height: number }[];
      format: { format_name: string };
      frames: { width: number; height: number }[];
    };
    expect(probe.streams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codec_type: "video", width: 80, height: 40 }),
      ]),
    );
    expect(probe.format.format_name).toMatch(
      extension === "png" ? /png/ : /jpeg/,
    );
    expect(probe.frames).toHaveLength(1);
    expect(probe.frames[0]).toMatchObject({ width: 80, height: 40 });
    expect(asset.mediaType).toBe("image");
    expect(asset.dimensions).toEqual({ width: 80, height: 40 });
    expect(assetDisplayDimensions(asset)).toEqual({ width: 80, height: 40 });
  },
);
