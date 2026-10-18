// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Composition } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import {
  FFmpegRenderer,
  resolveRenderQuality,
  type RenderOptions,
  type RenderSettings,
} from "../src/index.js";

const directories: string[] = [];
const settings = { width: 160, height: 90, frameRate: 30 };
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(duration = 0.4) {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-export-quality-"));
  directories.push(directory);
  const source = join(directory, "Original memories #1 & 旅.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=30:d=0.8",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=0.8",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-crf",
    "12",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-y",
    source,
  ]);
  const asset = await inspectMedia({
    path: source,
    uri: pathToFileURL(source).href,
    name: "Original memories #1 & 旅.mp4",
  });
  // A renderer must keep using the original, even when a catalog proxy exists.
  asset.proxyUri = pathToFileURL(join(directory, "unmounted-proxy.mp4")).href;
  const composition: Composition = {
    id: "quality-film",
    storyId: "story",
    duration,
    defaultLook: { version: 1, preset: "retro", strength: 0.5 },
    tracks: [
      {
        id: "visual",
        type: "video",
        clips: [
          {
            id: "spoken-memory",
            assetId: asset.id,
            timelineStart: 0,
            timelineDuration: duration,
            sourceIn: 0.1,
            sourceOut: 0.1 + duration,
            transform: { volume: 0.5 },
            locked: true,
          },
        ],
      },
    ],
  };
  const render = async (
    name: string,
    options: RenderOptions = {},
    outputSettings: RenderSettings = settings,
  ) => {
    const output = join(directory, `${name}.mp4`);
    await new FFmpegRenderer().render(
      composition,
      [asset],
      output,
      outputSettings,
      options,
    );
    const manifest = JSON.parse(
      await readFile(`${output}.manifest.json`, "utf8"),
    );
    return { output, manifest };
  };
  return { directory, source, asset, composition, render };
}

async function decode(path: string, type: "video" | "audio") {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      ...(type === "video"
        ? ["-map", "0:v:0", "-pix_fmt", "rgb24", "-f", "rawvideo"]
        : ["-map", "0:a:0", "-f", "f32le"]),
      "-",
    ])
  ).stdout;
}

describe("MP4 export compression quality", () => {
  it("resolves only the two supported immutable compression profiles", () => {
    expect(resolveRenderQuality()).toEqual({
      quality: "standard",
      video: "libx264",
      preset: "veryfast",
      crf: 23,
    });
    expect(resolveRenderQuality("standard")).toEqual(resolveRenderQuality());
    expect(resolveRenderQuality("high-detail")).toEqual({
      quality: "high-detail",
      video: "libx264",
      preset: "medium",
      crf: 18,
    });
    const profile = resolveRenderQuality("high-detail");
    try {
      (profile as { crf: number }).crf = 1;
    } catch {
      // Frozen profiles and fresh defensive copies both preserve later results.
    }
    expect(resolveRenderQuality("high-detail").crf).toBe(18);
    for (const quality of [
      null,
      "",
      "highest",
      "HIGH-DETAIL",
      18,
      true,
      {},
      [],
    ])
      expect(() => resolveRenderQuality(quality)).toThrow(/quality/iu);
  });

  it("keeps omitted quality identical to the explicit standard encoding", async () => {
    const { composition, asset, source, render } = await fixture();
    const before = structuredClone({ composition, asset });
    const sourceHash = await hashFile(source);
    const omitted = await render("default");
    const standard = await render("standard", {
      quality: "standard",
    });
    for (const result of [omitted, standard]) {
      expect(result.manifest.encoding).toEqual({
        quality: "standard",
        video: "libx264",
        preset: "veryfast",
        crf: 23,
        pixelFormat: "yuv420p",
        audio: "aac",
        sampleRate: 48000,
      });
      expect(result.manifest.sources).toEqual([
        expect.objectContaining({
          assetId: asset.id,
          uri: asset.uri,
          sha256: sourceHash,
        }),
      ]);
      expect(result.manifest.outputSha256).toBe(await hashFile(result.output));
    }
    expect(await decode(omitted.output, "video")).toEqual(
      await decode(standard.output, "video"),
    );
    expect(await decode(omitted.output, "audio")).toEqual(
      await decode(standard.output, "audio"),
    );
    expect({ composition, asset }).toEqual(before);
    expect(await hashFile(source)).toBe(sourceHash);
  });

  it("uses actual CRF 18 / medium encoding without changing trims, audio, saved looks or originals", async () => {
    const { composition, asset, source, render } = await fixture();
    const before = structuredClone({ composition, asset });
    const sourceHash = await hashFile(source);
    const standard = await render("standard", {
      quality: "standard",
    });
    const detailed = await render("high-detail", {
      quality: "high-detail",
    });
    expect(detailed.manifest.encoding).toEqual({
      quality: "high-detail",
      video: "libx264",
      preset: "medium",
      crf: 18,
      pixelFormat: "yuv420p",
      audio: "aac",
      sampleRate: 48000,
    });
    // Read x264's real encoder SEI, not only the application's own manifest.
    const standardBytes = (await readFile(standard.output)).toString("latin1");
    const detailedBytes = (await readFile(detailed.output)).toString("latin1");
    expect(standardBytes).toContain("crf=23.0");
    expect(standardBytes).toContain("subme=2");
    expect(detailedBytes).toContain("crf=18.0");
    expect(detailedBytes).toContain("subme=7");
    expect(detailed.manifest.composition).toEqual(composition);
    expect(detailed.manifest.compositionSha256).toBe(
      standard.manifest.compositionSha256,
    );
    expect(detailed.manifest.looks).toEqual(standard.manifest.looks);
    expect(detailed.manifest.sources).toEqual(standard.manifest.sources);
    expect(detailed.manifest.settings).toEqual(settings);
    expect(await decode(detailed.output, "audio")).toEqual(
      await decode(standard.output, "audio"),
    );
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,sample_rate",
      "-of",
      "json",
      detailed.output,
    ]);
    const metadata = JSON.parse(probe.stdout.toString());
    expect(metadata.streams).toEqual([
      expect.objectContaining({
        codec_type: "video",
        codec_name: "h264",
        width: 160,
        height: 90,
        r_frame_rate: "30/1",
        nb_frames: "12",
      }),
      expect.objectContaining({
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
      }),
    ]);
    expect(Number(metadata.format.duration)).toBeCloseTo(0.4, 3);
    expect(detailed.manifest.outputSha256).toBe(
      await hashFile(detailed.output),
    );
    expect(await hashFile(source)).toBe(sourceHash);
    expect({ composition, asset }).toEqual(before);
  });

  it("retains the requested Full HD canvas and fractional frame rate in high-detail output", async () => {
    const fullHd = { width: 1920, height: 1080, frameRate: 30000 / 1001 };
    // Use twelve complete frame intervals, respecting the renderer's existing
    // truncation policy for fractional frame rates rather than changing timing.
    const { render } = await fixture(12 / fullHd.frameRate);
    for (const quality of ["standard", "high-detail"] as const) {
      const { output, manifest } = await render(
        `full-hd-${quality}`,
        { quality },
        fullHd,
      );
      const probe = await runProcess("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,nb_frames",
        "-of",
        "json",
        output,
      ]);
      expect(JSON.parse(probe.stdout.toString()).streams).toEqual([
        {
          width: 1920,
          height: 1080,
          r_frame_rate: "30000/1001",
          nb_frames: "12",
        },
      ]);
      expect(manifest.settings).toEqual(fullHd);
      expect(manifest.encoding.quality).toBe(quality);
    }
  });

  it.each(
    [null, "", "highest", "HIGH-DETAIL", 18, true, {}, []].map((quality) => ({
      quality,
    })),
  )(
    "rejects invalid quality $quality before replacing existing output or its manifest",
    async ({ quality }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "openfilm-invalid-quality-"),
      );
      directories.push(directory);
      const output = join(directory, "precious.mp4");
      const manifest = `${output}.manifest.json`;
      await writeFile(output, "existing film");
      await writeFile(manifest, "existing manifest");
      await expect(
        new FFmpegRenderer().render(
          { id: "empty", storyId: "story", duration: 0.1, tracks: [] },
          [],
          output,
          settings,
          { quality } as RenderOptions,
        ),
      ).rejects.toThrow(/quality/iu);
      expect(await readFile(output, "utf8")).toBe("existing film");
      expect(await readFile(manifest, "utf8")).toBe("existing manifest");
      expect(await readdir(directory)).toEqual([
        "precious.mp4",
        "precious.mp4.manifest.json",
      ]);
    },
  );
});
