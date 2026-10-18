import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import type { Composition, MediaAsset } from "@openfilm/core";
import { hashFile, localPath, runProcess } from "@openfilm/media";
import type { RenderSettings } from "./index.js";

export interface RenderSourceEvidence {
  assetId: string;
  name: string;
  uri: string;
  sha256: string;
  size: number;
  modifiedAt: string;
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
): Promise<void> {
  const json = JSON.stringify(composition);
  const manifest = {
    version: 1,
    renderer: {
      id: "openfilm.ffmpeg",
      presentationVersion: 1,
      ffmpegVersion: (
        await runProcess("ffmpeg", ["-version"], { signal })
      ).stdout
        .toString("utf8")
        .split("\n")[0],
    },
    createdAt: new Date().toISOString(),
    composition,
    project: project ?? null,
    compositionSha256: createHash("sha256").update(json).digest("hex"),
    settings,
    encoding: {
      video: "libx264",
      preset: "veryfast",
      crf: 23,
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
