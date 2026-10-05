import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { FFmpegRenderer } from "@openfilm/render";
import {
  createProxy,
  createThumbnail,
  hashFile,
  hdrToneMapFilter,
  inspectMedia,
  previewIssue,
  probeColor,
  runProcess,
} from "../src/index.js";
import type { MediaAsset } from "@openfilm/core";

describe("explicit HDR source and safe SDR preview", () => {
  it("distinguishes 10-bit SDR from HDR and blocks incomplete HDR metadata", () => {
    expect(
      probeColor({
        pix_fmt: "yuv420p10le",
        color_transfer: "bt709",
        color_primaries: "bt2020",
      }),
    ).toMatchObject({ bitDepth: 10, hdr: false, kind: "SDR" });
    expect(
      probeColor({ pix_fmt: "p010le", color_transfer: "arib-std-b67" }),
    ).toMatchObject({ bitDepth: 10, hdr: true, kind: "HLG" });
    const asset: MediaAsset = {
      id: "hdr",
      name: "Unknown HDR",
      uri: "file:///hdr.mp4",
      mediaType: "video",
      hdr: true,
      tags: [],
      state: {},
      metadata: {},
    };
    expect(() => hdrToneMapFilter(asset)).toThrow(
      "incomplete or unsupported color metadata",
    );
    expect(previewIssue({ ...asset, mediaType: "360-video" })).toContain(
      "Requires reframed export",
    );
    expect(
      previewIssue({
        ...asset,
        metadata: {
          "openfilm.preview": {
            supported: false,
            reason: "Export a JPEG from this RAW file",
          },
        },
      }),
    ).toContain("Export a JPEG");
  });

  it.each(["arib-std-b67", "smpte2084"])(
    "detects generated HEVC10-bit %s, tone maps thumbnail/proxy/render and preserves original bytes",
    async (transfer) => {
      const root = await mkdtemp(join(tmpdir(), "openfilm-hdr-"));
      try {
        const path = join(root, "synthetic-hdr.mp4");
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-nostdin",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=160x90:rate=12",
          "-t",
          "0.5",
          "-vf",
          "format=yuv420p10le",
          "-c:v",
          "libx265",
          "-threads",
          "1",
          "-filter_threads",
          "1",
          "-x265-params",
          `pools=1:frame-threads=1:log-level=error:colorprim=9:transfer=${transfer === "arib-std-b67" ? 18 : 16}:colormatrix=9`,
          "-color_primaries",
          "bt2020",
          "-color_trc",
          transfer,
          "-colorspace",
          "bt2020nc",
          "-y",
          path,
        ]);
        const originalHash = await hashFile(path);
        const asset = await inspectMedia({
          path,
          uri: pathToFileURL(path).href,
          name: "Synthetic HDR",
        });
        expect(asset).toMatchObject({
          codec: "hevc",
          hdr: true,
          colorSpace: "bt2020nc",
        });
        expect(asset.metadata["openfilm.color"]).toMatchObject({
          bitDepth: 10,
          transfer,
          primaries: "bt2020",
          hdr: true,
        });
        expect(asset.metadata["openfilm.preview"]).toMatchObject({
          supported: true,
          warnings: expect.arrayContaining([
            expect.stringContaining("tone mapping"),
          ]),
        });
        const thumbnail = join(root, "thumbnail.jpg");
        const proxy = join(root, "proxy.mp4");
        await createThumbnail(asset, thumbnail);
        await createProxy(asset, proxy);
        expect((await readFile(thumbnail)).length).toBeGreaterThan(100);
        const proxyAsset = await inspectMedia({
          path: proxy,
          uri: pathToFileURL(proxy).href,
          name: "SDR proxy",
        });
        expect(proxyAsset).toMatchObject({ codec: "h264", hdr: false });
        expect(proxyAsset.metadata["openfilm.color"]).toMatchObject({
          bitDepth: 8,
          transfer: "bt709",
          primaries: "bt709",
          matrix: "bt709",
        });
        const rendered = join(root, "render.mp4");
        await new FFmpegRenderer().render(
          {
            id: "cut",
            storyId: "story",
            duration: 0.5,
            tracks: [
              {
                id: "v",
                type: "video",
                clips: [
                  {
                    id: "clip",
                    assetId: asset.id,
                    sourceIn: 0,
                    sourceOut: 0.5,
                    timelineStart: 0,
                    timelineDuration: 0.5,
                  },
                ],
              },
            ],
          },
          [asset],
          rendered,
          { width: 160, height: 90, frameRate: 12 },
        );
        const frame = await runProcess("ffmpeg", [
          "-v",
          "error",
          "-threads",
          "1",
          "-filter_threads",
          "1",
          "-i",
          rendered,
          "-frames:v",
          "1",
          "-vf",
          "scale=8:8,format=gray",
          "-f",
          "rawvideo",
          "-",
        ]);
        expect(frame.stdout.length).toBe(64);
        expect(new Set(frame.stdout).size).toBeGreaterThan(8);
        expect(await hashFile(path)).toBe(originalHash);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
