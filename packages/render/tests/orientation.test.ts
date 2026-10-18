import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { assetDisplayDimensions } from "@openfilm/core";
import { inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function orientedJpeg(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "openfilm-oriented-photo-"));
  directories.push(root);
  const path = join(root, "portrait.jpg");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=80x40",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    path,
  ]);
  const jpeg = await readFile(path);
  // A single little-endian TIFF Orientation=6 entry in a standard JPEG APP1.
  const exif = Buffer.from(
    "45786966000049492a0008000000010012010300010000000600000000000000",
    "hex",
  );
  const marker = Buffer.from([0xff, 0xe1, 0, exif.length + 2]);
  await writeFile(
    path,
    Buffer.concat([jpeg.subarray(0, 2), marker, exif, jpeg.subarray(2)]),
  );
  return { root, path };
}

it("renders a real EXIF-rotated JPEG without stretching its decoded portrait", async () => {
  const { root, path } = await orientedJpeg();
  const asset = await inspectMedia({
    path,
    uri: pathToFileURL(path).href,
    name: "portrait.jpg",
  });
  expect(asset.dimensions).toEqual({ width: 80, height: 40 });
  expect(assetDisplayDimensions(asset)).toEqual({ width: 40, height: 80 });
  const output = join(root, "portrait.mp4");
  await new FFmpegRenderer().render(
    {
      id: "film",
      storyId: "story",
      duration: 0.2,
      tracks: [
        {
          id: "visual",
          type: "video",
          clips: [
            {
              id: "photo",
              assetId: asset.id,
              timelineStart: 0,
              timelineDuration: 0.2,
              layout: { version: 1, preset: "contain" },
            },
          ],
        },
      ],
    },
    [asset],
    output,
    { width: 160, height: 90, frameRate: 30 },
  );
  const pixels = (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
  expect(pixels[(45 * 160 + 20) * 3]).toBeLessThan(15);
  expect(pixels[(45 * 160 + 80) * 3]).toBeGreaterThan(200);
});

it("persists first-frame display orientation when ExifTool and Perl are unavailable", async () => {
  const { root, path } = await orientedJpeg();
  const bin = join(root, "bin");
  await mkdir(bin);
  const which = await runProcess(
    process.platform === "win32" ? "where.exe" : "which",
    ["ffprobe"],
  );
  const executable = which.stdout.toString().trim().split(/\r?\n/u)[0]!;
  if (process.platform === "win32")
    await copyFile(executable, join(bin, "ffprobe.exe"));
  else await symlink(executable, join(bin, "ffprobe"));
  const script = `import { inspectMedia } from ${JSON.stringify(pathToFileURL(resolve("packages/media/src/index.ts")).href)}; console.log(JSON.stringify(await inspectMedia(${JSON.stringify({ path, uri: pathToFileURL(path).href, name: "portrait.jpg" })})));`;
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: process.cwd(), env: { ...process.env, PATH: bin } },
  );
  const asset = JSON.parse(result.stdout);
  expect(asset.metadata["openfilm.metadata.exiftoolAvailable"]).toBe(false);
  expect(asset.metadata["openfilm.display"]).toMatchObject({
    version: 1,
    width: 40,
    height: 80,
  });
  expect(assetDisplayDimensions(asset)).toEqual({ width: 40, height: 80 });
});
