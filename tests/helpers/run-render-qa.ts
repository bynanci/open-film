// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import {
  appendFile,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir, release } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createExportProfile } from "@openfilm/core";
import { hashFile, runProcess } from "@openfilm/media";
import {
  createTitleOverlay,
  FFmpegRenderer,
  prepareGraphicScenes,
} from "@openfilm/render";
import pins from "../../fixtures/render-qa/toolchain.json";
import type { RenderQaToolReceipt } from "../../scripts/ci/setup-render-qa.js";
import { professionalCutDeskFixture } from "../fixtures/professional-cut-desk.js";
import { renderQaDepthFixture } from "../fixtures/render-qa.js";
import { readPinnedTestFonts } from "./render-qa-fonts.js";
import {
  assertRenderQaIdentity,
  assertRenderQaMetric,
  RenderQaMetricError,
  renderQaPolicySha256,
  type RenderQaMeasurement,
} from "./render-qa-policy.js";
import {
  observeRenderQaFailure,
  renderQaPlatforms,
  writeRenderQaEvidence,
  type RenderQaEvidence,
  type RenderQaSample,
} from "./render-qa-evidence.js";
import {
  observeRenderQaTools,
  renderQaAmplitude,
  renderQaAudio,
  renderQaFrameCount,
  renderQaMae,
  renderQaRgb,
} from "./render-qa-media.js";

const ffmpeg = (args: string[]) =>
  runProcess("ffmpeg", ["-v", "error", "-nostdin", ...args], {
    maxOutputBytes: 32 * 1024 ** 2,
  });
/** Actual bounded source/output run. Only the numerical JSON receipt survives cleanup. */
export async function runRenderQa(): Promise<void> {
  const output = process.env.OPENFILM_RENDER_QA_OUTPUT;
  if (!output || !isAbsolute(output))
    throw new Error(
      "OPENFILM_RENDER_QA_OUTPUT must name an absolute evidence directory",
    );
  const fonts = await readPinnedTestFonts();
  const receiptPath =
    process.env.OPENFILM_RENDER_QA_TOOL_RECEIPT ??
    join(dirname(fonts.sansRegular.path), "..", "tool-receipt.json");
  const admission = JSON.parse(
    await readFile(receiptPath, "utf8"),
  ) as RenderQaToolReceipt;
  const platformId =
    `${process.platform}-${process.arch}` as RenderQaEvidence["platformId"];
  if (!renderQaPlatforms.includes(platformId))
    throw new Error("Unsupported render QA platform");
  const hosted = process.env.GITHUB_ACTIONS === "true";
  if (
    hosted &&
    (admission.admittedPackageSha256 !== pins.tools[platformId].sha256 ||
      admission.platformId !== platformId)
  )
    throw new Error("Hosted render QA requires the reviewed tool package");
  const observedTools = await observeRenderQaTools(admission, hosted);
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (
    process.env.OPENFILM_SOURCE_CANDIDATE &&
    process.env.OPENFILM_SOURCE_CANDIDATE !== candidateSha
  )
    throw new Error("Render QA checkout differs from the selected candidate");
  const pnpmVersion = /pnpm\/([0-9.]+)/u.exec(
    process.env.npm_config_user_agent ?? "",
  )?.[1];
  if (!pnpmVersion)
    throw new Error("Render QA requires its actual pnpm invocation identity");
  const report: RenderQaEvidence = {
    schemaVersion: 1,
    scope: hosted ? "hosted-pinned" : "local-observation",
    candidateSha,
    workingTreeDirty: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
    ),
    runId: process.env.GITHUB_RUN_ID ?? "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
    platformId,
    host: {
      release: release(),
      runnerImage: process.env.ImageVersion ?? "local",
    },
    nodeVersion: process.version,
    pnpmVersion,
    policy: { version: 1, sha256: renderQaPolicySha256 },
    admission,
    observedTools,
    sources: [],
    outputs: [],
    metrics: [],
    controls: [],
    complete: false,
    failureId: "fixture.running",
    workstationVerified: false,
  };
  const root = await mkdtemp(join(tmpdir(), "openfilm-render-qa-"));
  const collect = (
    sampleId: string,
    measurement: RenderQaMeasurement,
  ): RenderQaSample => {
    const sample = { sampleId, ...measurement };
    report.metrics.push(sample);
    return sample;
  };
  async function identity(id: string, path: string) {
    const sha256 = await hashFile(path);
    report.outputs.push({ id, sha256 });
    return sha256;
  }
  try {
    const fixture = await professionalCutDeskFixture(root);
    const sourceFiles: Array<{ id: string; path: string; sha256: string }> =
      fixture.paths.map((path, index) => ({
        id: `original${index}`,
        path,
        sha256: fixture.hashes[index]!,
      }));
    report.sources.push(
      ...sourceFiles.map(({ id, sha256 }) => ({ id, sha256 })),
    );
    const video = join(root, "valid.mp4");
    await new FFmpegRenderer().render(
      fixture.composition,
      fixture.assets,
      video,
      fixture.settings,
      { quality: "high-detail" },
    );
    await identity("validVideo", video);
    const count = collect(
      "video.frameCount",
      assertRenderQaIdentity(
        "frameCount",
        await renderQaFrameCount(video),
        180,
      ),
    );
    const probe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "frame=best_effort_timestamp_time",
          "-of",
          "json",
          video,
        ])
      ).stdout.toString(),
    );
    const videoRgb = (
      await ffmpeg([
        "-i",
        video,
        "-map",
        "0:v:0",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ])
    ).stdout;
    if (videoRgb.length !== 180 * 160 * 90 * 3)
      throw new Error("Unexpected decoded video dimensions/frame count");
    let firstPixel: RenderQaSample | undefined;
    for (const [frame, timestamp, color] of [
      [0, 0, [255, 0, 0]],
      [59, 1.968633, [255, 0, 0]],
      [60, 2.002, [255, 0, 0]],
      [67, 2.235567, [136, 119, 0]],
      [75, 2.5025, [0, 255, 0]],
      [90, 3.003, [0, 255, 0]],
      [119, 3.970633, [0, 255, 0]],
      [120, 4.004, [0, 0, 255]],
      [179, 5.972633, [0, 0, 255]],
    ] as const) {
      collect(
        `video.pts.f${frame}`,
        assertRenderQaMetric(
          "cutDesk.pts",
          Number(probe.frames?.[frame]?.best_effort_timestamp_time),
          timestamp,
        ),
      );
      for (let channel = 0; channel < 3; channel++) {
        const sample = collect(
          `video.color.f${frame}.c${channel}`,
          assertRenderQaMetric(
            "cutDesk.channelError",
            Math.abs(
              videoRgb[((frame * 90 + 10) * 160 + 145) * 3 + channel]! -
                color[channel]!,
            ),
          ),
        );
        if (frame === 0 && channel === 0) firstPixel = sample;
      }
    }
    const audio = await renderQaAudio(video);
    let primary: RenderQaSample | undefined,
      overlay: RenderQaSample | undefined,
      absent: RenderQaSample | undefined;
    for (const [index, [start, frequency, peak, hasOverlay]] of (
      [
        [0.7, 440, 0.052632, false],
        [2.2, 660, 0.078947, false],
        [2.8, 660, 0.078947, true],
        [4.2, 880, 0.105263, true],
        [4.8, 880, 0.105263, false],
        [5.7, 880, 0.105263, false],
      ] as const
    ).entries()) {
      const p = collect(
        `audio.primary.t${index}`,
        assertRenderQaMetric(
          "cutDesk.primaryAmplitudeError",
          Math.abs(renderQaAmplitude(audio, start, frequency) - peak),
        ),
      );
      const o = collect(
        `audio.overlay.t${index}`,
        assertRenderQaMetric(
          "cutDesk.overlayAmplitudeError",
          Math.abs(
            renderQaAmplitude(audio, start, 1100) - (hasOverlay ? 0.032895 : 0),
          ),
        ),
      );
      if (index === 0) primary = p;
      if (index === 2) overlay = o;
      for (const other of [440, 660, 880].filter(
        (value) => value !== frequency,
      )) {
        const a = collect(
          `audio.absent.t${index}.f${other}`,
          assertRenderQaMetric(
            "cutDesk.absentAmplitude",
            renderQaAmplitude(audio, start, other),
          ),
        );
        if (index === 0 && other === 880) absent = a;
      }
    }
    const diagnostic = join(root, "diagnostic.wav");
    await new FFmpegRenderer().render(
      fixture.composition,
      fixture.assets,
      diagnostic,
      fixture.settings,
      {
        audioOnly: true,
        exportProfile: createExportProfile({
          ratio: "16:9",
          width: 160,
          height: 90,
          frameRate: 30000 / 1001,
          format: "wav",
        }),
      },
    );
    await identity("diagnosticPcm", diagnostic);
    const pcm = await renderQaAudio(diagnostic);
    for (const [index, [start, frequency, peak]] of (
      [
        [1.927, 440, 0.052632],
        [2.027, 660, 0.078947],
        [3.929, 660, 0.078947],
        [4.029, 880, 0.105263],
        [2.4275, 1100, 0],
        [2.5275, 1100, 0.032895],
        [4.4295, 1100, 0.032895],
        [4.5295, 1100, 0],
      ] as const
    ).entries()) {
      if (frequency === 1100)
        collect(
          `audio.edgeOverlay.t${index}`,
          assertRenderQaMetric(
            "cutDesk.overlayAmplitudeError",
            Math.abs(renderQaAmplitude(audio, start, frequency, 0.05) - peak),
          ),
        );
      else {
        collect(
          `audio.edgePcm.t${index}`,
          assertRenderQaMetric(
            "cutDesk.primaryAmplitudeError",
            Math.abs(renderQaAmplitude(pcm, start, frequency, 0.05) - peak),
          ),
        );
        collect(
          `audio.edgeRatio.t${index}`,
          assertRenderQaMetric(
            "cutDesk.onsetGainRatio",
            renderQaAmplitude(audio, start, frequency, 0.05) / peak,
          ),
        );
        for (const other of [440, 660, 880].filter(
          (value) => value !== frequency,
        ))
          collect(
            `audio.edgeAbsent.t${index}.f${other}`,
            assertRenderQaMetric(
              "cutDesk.absentAmplitude",
              renderQaAmplitude(audio, start, other, 0.05),
            ),
          );
      }
    }
    const validEdge = report.metrics.find(
      (metric) => metric.sampleId === "audio.edgeAbsent.t1.f440",
    )!;
    const shifted = join(root, "one-frame-delay.mp4");
    await ffmpeg([
      "-i",
      video,
      "-c:v",
      "copy",
      "-af",
      "adelay=1602S:all=1",
      "-c:a",
      "aac",
      "-t",
      "6.006",
      "-y",
      shifted,
    ]);
    const shiftedHash = await identity("oneFrameAudio", shifted);
    const shiftedAudio = await renderQaAudio(shifted);
    report.controls.push(
      observeRenderQaFailure(
        "oneFrameAudio",
        validEdge,
        () =>
          assertRenderQaMetric(
            "cutDesk.absentAmplitude",
            renderQaAmplitude(shiftedAudio, 2.027, 440, 0.05),
          ),
        shiftedHash,
      ),
    );
    const gain = join(root, "half-gain.mp4");
    await ffmpeg([
      "-i",
      video,
      "-c:v",
      "copy",
      "-af",
      "volume=0.5",
      "-c:a",
      "aac",
      "-y",
      gain,
    ]);
    const gainHash = await identity("halfGain", gain),
      gainAudio = await renderQaAudio(gain);
    report.controls.push(
      observeRenderQaFailure(
        "primaryGain",
        primary!,
        () =>
          assertRenderQaMetric(
            "cutDesk.primaryAmplitudeError",
            Math.abs(renderQaAmplitude(gainAudio, 0.7, 440) - 0.052632),
          ),
        gainHash,
      ),
    );
    report.controls.push(
      observeRenderQaFailure(
        "overlayGain",
        overlay!,
        () =>
          assertRenderQaMetric(
            "cutDesk.overlayAmplitudeError",
            Math.abs(renderQaAmplitude(gainAudio, 2.8, 1100) - 0.032895),
          ),
        gainHash,
      ),
    );
    const contaminated = join(root, "absent-tone.mp4");
    await ffmpeg([
      "-i",
      video,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000:duration=6.006",
      "-filter_complex",
      "[0:a][1:a]amix=inputs=2:normalize=0[a]",
      "-map",
      "0:v:0",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      "-y",
      contaminated,
    ]);
    const contaminatedHash = await identity("absentTone", contaminated),
      contaminatedAudio = await renderQaAudio(contaminated);
    report.controls.push(
      observeRenderQaFailure(
        "absentTone",
        absent!,
        () =>
          assertRenderQaMetric(
            "cutDesk.absentAmplitude",
            renderQaAmplitude(contaminatedAudio, 0.7, 880),
          ),
        contaminatedHash,
      ),
    );
    const black = join(root, "black.mp4");
    await ffmpeg([
      "-i",
      video,
      "-vf",
      "lutrgb=r=0:g=0:b=0",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "copy",
      "-y",
      black,
    ]);
    const blackHash = await identity("blackVideo", black),
      blackRgb = await renderQaRgb(black, 0);
    report.controls.push(
      observeRenderQaFailure(
        "pixelColor",
        firstPixel!,
        () =>
          assertRenderQaMetric(
            "cutDesk.channelError",
            Math.abs(blackRgb[(10 * 160 + 145) * 3]! - 255),
          ),
        blackHash,
      ),
    );
    const short = join(root, "missing-frame.mp4");
    await ffmpeg([
      "-i",
      video,
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
      "-frames:v",
      "179",
      "-an",
      "-y",
      short,
    ]);
    const shortHash = await identity("missingFrame", short),
      shortCount = await renderQaFrameCount(short);
    report.controls.push(
      observeRenderQaFailure(
        "missingFrame",
        count,
        () => assertRenderQaIdentity("frameCount", shortCount, 180),
        shortHash,
      ),
    );

    const depth = await renderQaDepthFixture(root),
      depthSettings = { width: 320, height: 180, frameRate: 30 };
    const depthSources = await Promise.all(
      depth.assets.map(async (asset, index) => ({
        id: `depth${index}`,
        path: fileURLToPath(asset.uri),
        sha256: await hashFile(fileURLToPath(asset.uri)),
      })),
    );
    sourceFiles.push(...depthSources);
    report.sources.push(
      ...depthSources.map(({ id, sha256 }) => ({ id, sha256 })),
    );
    const prepared = await prepareGraphicScenes(
      depth.composition,
      depth.assets,
      depthSettings,
      root,
    );
    const depthVideo = join(root, "depth.mp4");
    await new FFmpegRenderer().render(
      depth.composition,
      depth.assets,
      depthVideo,
      depthSettings,
    );
    await identity("depthVideo", depthVideo);
    let depthBaseline: RenderQaSample | undefined,
      expectedDepth: Buffer | undefined;
    for (const frame of [0, 90, 179]) {
      const path = join(root, `monitor${frame}.png`);
      await writeFile(path, await prepared.frame(null, frame));
      const expected = await renderQaRgb(path),
        actual = await renderQaRgb(depthVideo, frame);
      if (actual.length !== 320 * 180 * 3 || expected.length !== actual.length)
        throw new Error("Unexpected depth decoded dimensions");
      const sample = collect(
        `depth.mae.f${frame}`,
        assertRenderQaMetric(
          "photoDepth.rgbMae",
          renderQaMae(actual, expected),
        ),
      );
      for (let channel = 0; channel < 3; channel++)
        collect(
          `depth.edge.f${frame}.c${channel}`,
          assertRenderQaMetric(
            "photoDepth.edgeChannelError",
            Math.abs(
              actual[(90 * 320 + 10) * 3 + channel]! -
                expected[(90 * 320 + 10) * 3 + channel]!,
            ),
          ),
        );
      if (frame === 90) {
        depthBaseline = sample;
        expectedDepth = expected;
      }
    }
    const blackDepth = join(root, "black-depth.mp4");
    await ffmpeg([
      "-i",
      depthVideo,
      "-vf",
      "lutrgb=r=0:g=0:b=0",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-y",
      blackDepth,
    ]);
    const blackDepthHash = await identity("blackDepth", blackDepth),
      blackDepthRgb = await renderQaRgb(blackDepth, 90);
    report.controls.push(
      observeRenderQaFailure(
        "photoDepthPixels",
        depthBaseline!,
        () =>
          assertRenderQaMetric(
            "photoDepth.rgbMae",
            renderQaMae(blackDepthRgb, expectedDepth!),
          ),
        blackDepthHash,
      ),
    );

    let firstPng: string | undefined,
      firstPngRgb: Buffer | undefined,
      firstFont: RenderQaSample | undefined;
    for (const [key, font] of Object.entries(fonts)) {
      const png = join(root, `${key}.png`);
      const overlay = await createTitleOverlay(
        "合成 ABC",
        {
          version: 1,
          role: "subtitle",
          fontFamily: font.family,
          fontWeight: font.weight,
          fontSize: 48,
          background: "none",
        },
        { width: 320, height: 180 },
        png,
        { fontPath: font.path },
      );
      const fontMetric = collect(
        `font.${key}.identity`,
        assertRenderQaIdentity("fontHash", overlay.font.sha256, font.sha256),
      );
      const rgba = await renderQaRgb(png, undefined, "rgba");
      if (rgba.length !== 320 * 180 * 4)
        throw new Error("Unexpected title raster dimensions");
      let offset = -1;
      for (let y = 2; y < 178 && offset < 0; y += 2)
        for (let x = 2; x < 318; x += 2) {
          if (
            [0, 1].every((dy) =>
              [0, 1].every((dx) =>
                [0, 1, 2, 3].every(
                  (channel) =>
                    rgba[((y + dy) * 320 + x + dx) * 4 + channel] === 255,
                ),
              ),
            )
          ) {
            offset = y * 320 + x;
            break;
          }
        }
      if (offset < 0) throw new Error("No flat pinned-font glyph sample");
      const titleVideo = join(root, `${key}.mp4`);
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=black:s=320x180:r=30000/1001:d=0.2002",
        "-loop",
        "1",
        "-i",
        png,
        "-filter_complex",
        "[0:v][1:v]overlay=shortest=1[v]",
        "-map",
        "[v]",
        "-frames:v",
        "6",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-y",
        titleVideo,
      ]);
      await identity(`title.${key}`, titleVideo);
      const decoded = await renderQaRgb(titleVideo, 0);
      if (decoded.length !== 320 * 180 * 3)
        throw new Error("Unexpected title decoded dimensions");
      for (let channel = 0; channel < 3; channel++)
        collect(
          `title.${key}.c${channel}`,
          assertRenderQaMetric(
            "title.highDetailGlyphChannelError",
            Math.abs(decoded[offset * 3 + channel]! - 255),
          ),
        );
      if (key === "sansRegular") {
        firstPng = png;
        firstPngRgb = rgba;
        firstFont = fontMetric;
      }
    }
    const wrongFont = join(root, "substituted-font.otf");
    await copyFile(fonts.serifRegular.path, wrongFont);
    const wrongFontHash = await identity("substitutedFont", wrongFont);
    report.controls.push(
      observeRenderQaFailure(
        "fontSubstitution",
        firstFont!,
        () =>
          assertRenderQaIdentity(
            "fontHash",
            wrongFontHash,
            fonts.sansRegular.sha256,
          ),
        wrongFontHash,
      ),
    );
    const lossless = join(root, "lossless-copy.png");
    await ffmpeg([
      "-i",
      firstPng!,
      "-frames:v",
      "1",
      "-c:v",
      "png",
      "-threads",
      "1",
      "-y",
      lossless,
    ]);
    await identity("losslessCopy", lossless);
    const losslessRgb = await renderQaRgb(lossless, undefined, "rgba");
    const losslessMetric = collect(
      "png.lossless",
      assertRenderQaIdentity("decodedLossless", losslessRgb, firstPngRgb!),
    );
    const negated = join(root, "lossless-negated.png");
    await ffmpeg([
      "-i",
      firstPng!,
      "-vf",
      "negate",
      "-frames:v",
      "1",
      "-c:v",
      "png",
      "-threads",
      "1",
      "-y",
      negated,
    ]);
    const negatedHash = await identity("losslessNegated", negated),
      negatedRgb = await renderQaRgb(negated, undefined, "rgba");
    report.controls.push(
      observeRenderQaFailure(
        "losslessPixels",
        losslessMetric,
        () =>
          assertRenderQaIdentity("decodedLossless", negatedRgb, firstPngRgb!),
        negatedHash,
      ),
    );
    for (const source of sourceFiles)
      collect(
        `source.${source.id}`,
        assertRenderQaIdentity(
          "sourceHash",
          await hashFile(source.path),
          source.sha256,
        ),
      );
    const mutatedSource = join(root, "mutated-source.mp4");
    await copyFile(sourceFiles[0]!.path, mutatedSource);
    await appendFile(mutatedSource, Buffer.from([0]));
    const mutatedHash = await identity("mutatedSource", mutatedSource);
    report.controls.push(
      observeRenderQaFailure(
        "sourceMutation",
        report.metrics.find(
          (metric) => metric.sampleId === "source.original0",
        )!,
        () =>
          assertRenderQaIdentity(
            "sourceHash",
            mutatedHash,
            sourceFiles[0]!.sha256,
          ),
        mutatedHash,
      ),
    );
    report.complete = true;
    delete report.failureId;
  } catch (error) {
    report.failureId =
      error instanceof RenderQaMetricError
        ? `metric.${error.metricId}`
        : "fixture.failed";
    throw error;
  } finally {
    try {
      await writeRenderQaEvidence(output, report);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
