// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import {
  resolvePrimaryColor,
  primaryColorCoefficients,
  FILM_LOOK_PRESETS,
  FILM_LOOK_RECIPE_VERSION,
  FILM_LOOK_MATRIX_DOMAIN,
  FILM_LOOK_RECIPE_ORIGIN,
  FILM_LOOK_RECIPE_LICENSE,
  type Composition,
  type MediaAsset,
  type FilmLook,
  type ExportProfile,
  type AudioAutomation,
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
export type RenderFontUsage =
  | readonly ["title", trackId: string, clipId: string]
  | readonly ["caption", trackId: string, cueId: string]
  | readonly ["graphic", sceneId: string, nodeId: string];
export interface RenderFontBinding extends RenderFontEvidence {
  usage: RenderFontUsage;
}
/** Stable identities for the actual file and face, without local font paths. */
export function canonicalRenderFonts(
  fonts: ReadonlyArray<RenderFontEvidence>,
): RenderFontEvidence[] {
  const identities = new Map(
    fonts.map(({ family, postscriptName, sha256 }) => [
      JSON.stringify([sha256, postscriptName, family]),
      { family, postscriptName, sha256 },
    ]),
  );
  return [...identities.keys()].sort().map((key) => identities.get(key)!);
}
/** Bind each rendered use to its actual file/face without coupling local paths. */
export function canonicalRenderFontBindings(
  bindings: ReadonlyArray<RenderFontBinding>,
): RenderFontBinding[] {
  const uses = new Map<string, RenderFontBinding>();
  for (const binding of bindings) {
    if (
      !binding ||
      typeof binding.family !== "string" ||
      typeof binding.postscriptName !== "string" ||
      typeof binding.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(binding.sha256) ||
      !Array.isArray(binding.usage) ||
      binding.usage.length !== 3 ||
      !["title", "caption", "graphic"].includes(binding.usage[0]) ||
      binding.usage.slice(1).some((id) => typeof id !== "string" || !id)
    )
      throw new Error("Render receipt has an invalid font usage binding.");
    const { family, postscriptName, sha256 } = binding;
    const key = JSON.stringify(binding.usage);
    const value: RenderFontBinding = {
      usage: [binding.usage[0], binding.usage[1], binding.usage[2]],
      family,
      postscriptName,
      sha256,
    };
    const previous = uses.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(value))
      throw new Error("Render receipt has conflicting font usage bindings.");
    uses.set(key, value);
  }
  return [...uses.keys()].sort().map((key) => uses.get(key)!);
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
  outputConfig: {
    format: "mp4" | "wav";
    fontBindings?: ReadonlyArray<RenderFontBinding>;
    videoOnly?: boolean;
    exportProfile?: ExportProfile;
    audioRole?: AudioAutomation["role"];
  } = { format: "mp4" },
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
    primaryColor: {
      version: 1,
      domain: "encoded-sdr-rgb",
      formula: "encoded-sdr-affine-v1",
      precision: 12,
      clamp: "primary-then-look",
      clips: looks.clips.map(({ clipId, assetIds }) => {
        const clip = composition.tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.id === clipId)!;
        const effective = resolvePrimaryColor(composition, clip);
        return {
          clipId,
          assetIds,
          ...effective,
          coefficients: primaryColorCoefficients(effective.correction),
        };
      }),
    },
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
    exportProfile: outputConfig.exportProfile ?? null,
    output: {
      format: outputConfig.format,
      codec: outputConfig.format === "wav" ? "pcm_s24le" : encoding.video,
      width:
        outputConfig.format === "mp4"
          ? (outputConfig.exportProfile?.width ?? settings.width)
          : null,
      height:
        outputConfig.format === "mp4"
          ? (outputConfig.exportProfile?.height ?? settings.height)
          : null,
      frameRate:
        outputConfig.format === "mp4"
          ? (outputConfig.exportProfile?.frameRate ?? settings.frameRate)
          : null,
      audioRole: outputConfig.audioRole ?? null,
    },
    encoding:
      outputConfig.format === "wav"
        ? {
            quality: "standard",
            video: null,
            preset: null,
            crf: null,
            pixelFormat: null,
            audio: "pcm_s24le",
            sampleRate: 48000,
          }
        : {
            ...encoding,
            pixelFormat: "yuv420p",
            audio: outputConfig.videoOnly ? null : "aac",
            sampleRate: outputConfig.videoOnly ? null : 48000,
          },
    sources,
    fonts,
    fontBindings: canonicalRenderFontBindings(outputConfig.fontBindings ?? []),
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
