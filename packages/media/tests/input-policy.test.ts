// SPDX-License-Identifier: GPL-3.0-only
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import {
  createProxy,
  createThumbnail,
  detectScenes,
  generateWaveform,
  hashFile,
  inspectMedia,
  localMediaInputOptions,
  perceptualHash,
  runProcess,
} from "../src/index.js";

let directory: string;
let concatenated: string;
let dash: string;
let still: string;
const blockedFormat =
  /(?:format.*(?:whitelist|allowlist)|(?:whitelist|allowlist).*format)/i;
const assetFor = (
  path: string,
  mediaType: MediaAsset["mediaType"] = "video",
): MediaAsset => ({
  id: "test",
  name: "playlist.mp4",
  uri: pathToFileURL(path).href,
  mediaType,
  duration: 1,
  dimensions: { width: 32, height: 32 },
  metadata: {
    "openfilm.ffprobe": {
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    },
  },
  tags: [],
  state: {},
});

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openfilm-media-policy-"));
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=32x32:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-threads",
    "1",
    "-y",
    join(directory, "benign.mp4"),
  ]);
  concatenated = join(directory, "playlist.mp4");
  await writeFile(concatenated, "ffconcat version 1.0\nfile 'benign.mp4'\n");
  const manifest = join(directory, "audio.mpd");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "aac",
    "-threads",
    "1",
    "-f",
    "dash",
    "-seg_duration",
    "1",
    "-y",
    manifest,
  ]);
  dash = join(directory, "manifest.mp4");
  await writeFile(dash, await readFile(manifest));
  still = join(directory, "single-frame.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=16x16",
    "-frames:v",
    "1",
    "-c:v",
    "png",
    "-f",
    "image2",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    still,
  ]);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("local self-contained media input policy", () => {
  it("provides per-input restrictions without mutating caller or fixture process arguments", async () => {
    const first = await localMediaInputOptions(concatenated);
    expect(first).toContain("-protocol_whitelist");
    expect(first[first.indexOf("-protocol_whitelist") + 1]).toBe("file");
    const formats = first[first.indexOf("-format_whitelist") + 1]!.split(",");
    for (const format of [
      "mov",
      "matroska",
      "avi",
      "mpegts",
      "jpeg_pipe",
      "png_pipe",
      "tiff_pipe",
      "bmp_pipe",
      "webp_pipe",
      "gif",
      "aac",
      "flac",
      "ogg",
      "wav",
      "mp3",
    ])
      expect(formats).toContain(format);
    for (const format of ["concat", "hls", "dash", "image2", "lavfi", "sdp"])
      expect(formats).not.toContain(format);
    first.length = 0;
    expect(await localMediaInputOptions(concatenated)).toContain(
      "-format_whitelist",
    );
  });

  it.each(["concat", "dash"] as const)(
    "rejects a local %s manifest with a supported MP4 suffix during inspection",
    async (kind) => {
      const path = kind === "concat" ? concatenated : dash;
      await expect(
        inspectMedia({
          path,
          uri: pathToFileURL(path).href,
          name: "source.mp4",
        }),
      ).rejects.toThrow(blockedFormat);
      const standalone = join(directory, "benign.mp4");
      expect(
        (
          await inspectMedia({
            path: standalone,
            uri: pathToFileURL(standalone).href,
            name: "benign.mp4",
          })
        ).mediaType,
      ).toBe("video");
    },
  );

  it("pins verified still-image content to a single-file demuxer without trusting its suffix", async () => {
    const options = await localMediaInputOptions(still);
    expect(options[options.indexOf("-f") + 1]).toBe("png_pipe");
    const disguised = join(directory, "not-a-photo.jpg");
    await writeFile(disguised, await readFile(concatenated));
    expect(await localMediaInputOptions(disguised)).not.toContain("-f");
    await expect(
      inspectMedia({
        path: disguised,
        uri: pathToFileURL(disguised).href,
        name: "not-a-photo.jpg",
      }),
    ).rejects.toThrow(blockedFormat);
  });

  it("preserves cancellation and rejects directories before attempting a decode", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      localMediaInputOptions(concatenated, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(localMediaInputOptions(directory)).rejects.toThrow(
      /regular local file/,
    );
  });

  it("rejects manifest decoding in fingerprints, thumbnails and proxies", async () => {
    await expect(perceptualHash(concatenated)).rejects.toThrow(blockedFormat);
    await expect(
      createThumbnail(assetFor(concatenated), join(directory, "thumb.jpg")),
    ).rejects.toThrow(blockedFormat);
    await expect(
      createProxy(assetFor(concatenated), join(directory, "proxy.mp4")),
    ).rejects.toThrow(blockedFormat);
    await expect(
      createProxy(
        assetFor(concatenated, "audio"),
        join(directory, "proxy.mp3"),
      ),
    ).rejects.toThrow(blockedFormat);
  });

  it("rejects manifests before waveform and scene decoding even for pre-existing asset records", async () => {
    const hash = await hashFile(concatenated);
    await expect(
      generateWaveform(assetFor(concatenated), hash),
    ).rejects.toThrow(blockedFormat);
    await expect(detectScenes(assetFor(concatenated), hash)).rejects.toThrow(
      blockedFormat,
    );
  });
});
