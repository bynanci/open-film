// SPDX-License-Identifier: Apache-2.0
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import {
  PRIMARY_COLOR_IDENTITY,
  primaryColorCoefficients,
  validatePrimaryColorCorrection,
  type MediaAsset,
  type PrimaryColorCorrection,
} from "@openfilm/core";
import {
  hashFile,
  inspectMedia,
  localMediaInputOptions,
  localPath,
  previewVideoFilters,
  runProcess,
} from "@openfilm/media";
import { primaryColorFilters } from "./primary-color-filters.js";

export interface PrimaryColorStatistics {
  pixelCount: number;
  p10Y: number;
  p50Y: number;
  p90Y: number;
  meanR: number;
  meanB: number;
  clippedFraction: number;
}
export function measurePrimaryColorPixels(
  pixels: Uint8Array,
): PrimaryColorStatistics {
  if (!pixels.length || pixels.length % 3 || pixels.length > 4096 * 3 * 3)
    throw new Error("Invalid bounded RGB samples.");
  const bins = new Uint32Array(256);
  let red = 0,
    blue = 0,
    clipped = 0;
  const count = pixels.length / 3;
  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i]!,
      g = pixels[i + 1]!,
      b = pixels[i + 2]!;
    bins[Math.floor((54 * r + 183 * g + 19 * b + 128) / 256)]!++;
    red += r;
    blue += b;
    if (Math.min(r, g, b) <= 1 || Math.max(r, g, b) >= 254) clipped++;
  }
  const percentile = (p: number) => {
    let n = 0;
    for (let i = 0; i < 256; i++) {
      n += bins[i]!;
      if (n >= Math.ceil(count * p)) return i;
    }
    return 255;
  };
  return {
    pixelCount: count,
    p10Y: percentile(0.1),
    p50Y: percentile(0.5),
    p90Y: percentile(0.9),
    meanR: red / count,
    meanB: blue / count,
    clippedFraction: clipped / count,
  };
}
export function primaryColorMatchScore(
  target: PrimaryColorStatistics,
  reference: PrimaryColorStatistics,
): number {
  return (
    Math.abs(target.p50Y - reference.p50Y) / 255 +
    0.5 *
      Math.abs(
        Math.log((target.meanR + 1) / (target.meanB + 1)) -
          Math.log((reference.meanR + 1) / (reference.meanB + 1)),
      ) +
    (0.25 *
      Math.abs(target.p90Y - target.p10Y - reference.p90Y + reference.p10Y)) /
      255 +
    0.25 * Math.max(0, target.clippedFraction - reference.clippedFraction)
  );
}
export function suggestPrimaryColor(
  frames: readonly Uint8Array[],
  reference: PrimaryColorStatistics,
  current: PrimaryColorCorrection,
): PrimaryColorCorrection {
  if (!frames.length || frames.length > 3)
    throw new Error("Expected one to three primary color samples.");
  const pixels = Uint8Array.from(
    frames.flatMap((frame) => {
      measurePrimaryColorPixels(frame);
      return [...frame];
    }),
  );
  let best = validatePrimaryColorCorrection(current);
  const score = (recipe: PrimaryColorCorrection) => {
    const { slopes, offset } = primaryColorCoefficients(recipe),
      transformed = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i++)
      transformed[i] = Math.floor(
        Math.max(0, Math.min(255, pixels[i]! * slopes[i % 3]! + 255 * offset)) +
          0.5,
      );
    return primaryColorMatchScore(
      measurePrimaryColorPixels(transformed),
      reference,
    );
  };
  let bestScore = score(best);
  const axes = [
    { key: "temperature", min: -1, max: 1 },
    { key: "exposureEv", min: -2, max: 2 },
    { key: "contrast", min: 0.5, max: 1.5 },
  ] as const;
  for (const local of [false, true])
    for (const axis of axes) {
      const center = best[axis.key],
        lo = local ? Math.max(axis.min, center - 0.1) : axis.min,
        hi = local ? Math.min(axis.max, center + 0.1) : axis.max,
        step = local ? 0.01 : 0.1;
      for (let i = 0; i <= Math.round((hi - lo) / step); i++) {
        const value = Number((lo + i * step).toFixed(2));
        const candidate = { ...best, [axis.key]: value };
        const result = score(candidate);
        if (
          result < bestScore - 1e-12 ||
          (Math.abs(result - bestScore) <= 1e-12 &&
            (Math.abs(value - current[axis.key]) <
              Math.abs(best[axis.key] - current[axis.key]) - 1e-12 ||
              (Math.abs(
                Math.abs(value - current[axis.key]) -
                  Math.abs(best[axis.key] - current[axis.key]),
              ) <= 1e-12 &&
                value < best[axis.key])))
        ) {
          best = candidate;
          bestScore = result;
        }
      }
    }
  return best;
}

/** Trusted snapshot URI and service-generated output only; never accept request paths. */
export async function samplePrimaryColorFrame(
  asset: MediaAsset,
  sourceTime: number,
  correction: PrimaryColorCorrection = PRIMARY_COLOR_IDENTITY,
  options: { outputPath: string; signal?: AbortSignal },
): Promise<{
  pixels: Uint8Array;
  width: number;
  height: number;
  sha256: string;
}> {
  if (!Number.isFinite(sourceTime) || sourceTime < 0)
    throw new Error("Invalid source sample time.");
  const filters = [
    ...(await previewVideoFilters(asset, options.signal)),
    ...primaryColorFilters(correction),
    "scale=w='min(320,iw)':h='min(320,ih)':force_original_aspect_ratio=decrease:flags=area",
    "format=rgba",
  ];
  const path = localPath(asset.uri);
  const png = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      "1",
      ...(await localMediaInputOptions(path, options.signal)),
      "-i",
      path,
      "-ss",
      String(sourceTime),
      "-map_metadata",
      "-1",
      "-an",
      "-sn",
      "-dn",
      "-vf",
      filters.join(","),
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-f",
      "image2pipe",
      "-c:v",
      "png",
      "-",
    ],
    { signal: options.signal, timeoutMs: 60000, maxOutputBytes: 1024 * 1024 },
  );
  if (!png.stdout.length)
    throw new Error("No frame at the requested source time.");
  await writeFile(options.outputPath, png.stdout, { flag: "wx", mode: 0o600 });
  const image = await inspectMedia(
    {
      path: options.outputPath,
      name: "Color sample",
      uri: pathToFileURL(options.outputPath).href,
    },
    options.signal,
  );
  const { width, height } = image.dimensions!;
  if (width > 320 || height > 320)
    throw new Error("Color sample exceeds its dimensions.");
  const decoded = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      "1",
      "-protocol_whitelist",
      "file",
      "-f",
      "image2",
      "-pattern_type",
      "none",
      "-c:v",
      "png",
      "-i",
      options.outputPath,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-",
    ],
    { signal: options.signal, timeoutMs: 60000, maxOutputBytes: 320 * 320 * 4 },
  );
  if (decoded.stdout.length !== width * height * 4)
    throw new Error("Incomplete color sample.");
  const pixels: number[] = [],
    stride = Math.ceil((width * height) / 4096);
  for (let i = 0; i < width * height; i++) {
    if (decoded.stdout[i * 4 + 3] !== 255)
      throw new Error("Statistical color review requires opaque source media.");
    if (i % stride === 0)
      pixels.push(
        decoded.stdout[i * 4]!,
        decoded.stdout[i * 4 + 1]!,
        decoded.stdout[i * 4 + 2]!,
      );
  }
  return {
    pixels: Uint8Array.from(pixels),
    width,
    height,
    sha256: await hashFile(options.outputPath, options.signal),
  };
}
