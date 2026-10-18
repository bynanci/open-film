// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; this derivative as a whole is GPL-3.0-only. See LICENSE/NOTICE.
import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import {
  FILM_LOOK_PRESETS,
  FILM_LOOK_RECIPE_VERSION,
  FILM_LOOK_MATRIX_DOMAIN,
  FILM_LOOK_RECIPE_ORIGIN,
  FILM_LOOK_RECIPE_LICENSE,
  type Composition,
  type MediaAsset,
  type FilmLook,
} from "@openfilm/core";
import { hashFile, localPath, runProcess } from "@openfilm/media";
import type { RenderSettings } from "./index.js";
import { resolveRenderQuality, type RenderQualityProfile } from "./quality.js";

export interface RenderLookEvidence {
  clipId: string;
  assetIds: string[];
  source: "export" | "clip" | "beat" | "film" | "original";
  preset: FilmLook["preset"];
  strength: number;
  matrix: readonly number[];
}
export interface RenderLookConfiguration {
  override: FilmLook | null;
  clips: RenderLookEvidence[];
}
export interface RenderCatalogColorMetadata {
  hdr: boolean | null;
  primaries: string | null;
  transfer: string | null;
  matrix: string | null;
  range: string | null;
  pixelFormat: string | null;
  bitDepth: number | null;
}
export interface RenderSourceEvidence {
  assetId: string;
  name: string;
  uri: string;
  sha256: string;
  size: number;
  modifiedAt: string;
  catalogColorMetadata: RenderCatalogColorMetadata;
}
export interface RenderFontEvidence {
  family: string;
  postscriptName: string;
  sha256: string;
}
export interface RenderProjectEvidence {
  id: string;
  schemaVersion: string;
  revision: string;
}
/** Copy only color facts already present in the catalog; never infer a transfer. */
function catalogColorMetadata(asset: MediaAsset): RenderCatalogColorMetadata {
  const value = asset.metadata["openfilm.color"];
  const color =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (field: string): string | null =>
    typeof color[field] === "string" ? color[field] : null;
  const hdr = asset.hdr ?? color.hdr;
  return {
    hdr: typeof hdr === "boolean" ? hdr : null,
    primaries: text("primaries"),
    transfer: text("transfer"),
    matrix: text("matrix"),
    range: text("range"),
    pixelFormat: text("pixelFormat"),
    bitDepth:
      typeof color.bitDepth === "number" &&
      Number.isInteger(color.bitDepth) &&
      color.bitDepth > 0
        ? color.bitDepth
        : null,
  };
}
export async function captureRenderSources(
  assets: MediaAsset[],
  signal?: AbortSignal,
): Promise<RenderSourceEvidence[]> {
  const sources: RenderSourceEvidence[] = [];
  for (const asset of assets) {
    const path = localPath(asset.uri);
    const before = await stat(path);
    const sha256 = await hashFile(path, signal);
    const after = await stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error(`Source changed while preparing render: ${asset.name}`);
    sources.push({
      assetId: asset.id,
      name: asset.name,
      uri: asset.uri,
      sha256,
      size: after.size,
      modifiedAt: after.mtime.toISOString(),
      catalogColorMetadata: catalogColorMetadata(asset),
    });
  }
  return sources;
}
export async function verifyRenderSources(
  sources: RenderSourceEvidence[],
): Promise<void> {
  for (const source of sources) {
    const current = await stat(localPath(source.uri));
    if (
      current.size !== source.size ||
      current.mtime.toISOString() !== source.modifiedAt
    )
      throw new Error(`Source changed during render: ${source.name}`);
  }
}
export async function writeRenderManifest(
  path: string,
  output: string,
  composition: Composition,
  settings: RenderSettings,
  sources: RenderSourceEvidence[],
  fonts: RenderFontEvidence[],
  warnings: string[],
  signal?: AbortSignal,
  project?: RenderProjectEvidence,
  looks: RenderLookConfiguration = { override: null, clips: [] },
  encoding: RenderQualityProfile = resolveRenderQuality(),
): Promise<void> {
  const json = JSON.stringify(composition);
  const registry = FILM_LOOK_PRESETS.map(({ id, matrix }) => ({ id, matrix }));
  // Canonical fixed-shape JSON: keys are alphabetical at every object level.
  const canonicalRegistry = JSON.stringify({
    matrixDomain: FILM_LOOK_MATRIX_DOMAIN,
    registry,
    registryVersion: FILM_LOOK_RECIPE_VERSION,
  });
  const ffmpegLines = (
    await runProcess("ffmpeg", ["-version"], { signal })
  ).stdout
    .toString("utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim());
  const manifest = {
    version: 1,
    renderer: {
      id: "openfilm.ffmpeg",
      presentationVersion: 1,
      lookVersion: FILM_LOOK_RECIPE_VERSION,
      ffmpegVersion: ffmpegLines[0],
      ffmpegConfiguration:
        ffmpegLines.find((line) => line.startsWith("configuration:")) ?? null,
      ffmpegLibraries: ffmpegLines.filter((line) => /^lib\w+\s+\d/u.test(line)),
    },
    createdAt: new Date().toISOString(),
    composition,
    project: project ?? null,
    compositionSha256: createHash("sha256").update(json).digest("hex"),
    settings,
    looks: {
      registryVersion: FILM_LOOK_RECIPE_VERSION,
      matrixSpace: FILM_LOOK_MATRIX_DOMAIN,
      recipeOrigin: FILM_LOOK_RECIPE_ORIGIN,
      recipeLicense: FILM_LOOK_RECIPE_LICENSE,
      registry,
      registrySha256: createHash("sha256")
        .update(canonicalRegistry)
        .digest("hex"),
      pipeline: {
        decodeTransfer: "retained",
        transferConversion: "none-additional",
        hdrToneMapping: {
          operator: "hable",
          output: "bt709",
          stage: "before-look-matrix",
        },
        matrixPixelFormat: "rgba8",
        rgbClamp: "after-matrix",
        rgbLift: "coefficient-times-source-alpha",
        alpha: "preserved",
        browserSourcePreview: "approximate",
        renderedOutput: "authoritative",
      },
      ...looks,
    },
    encoding: {
      ...encoding,
      pixelFormat: "yuv420p",
      audio: "aac",
      sampleRate: 48000,
    },
    sources,
    fonts,
    warnings: [...new Set(warnings)],
    outputSha256: await hashFile(output, signal),
    verification: {
      generatedRecipe: true,
      humanViewing: "manual-required",
      humanListening: "manual-required",
      realNle: "manual-required",
    },
  };
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
}
