// Modified by OpenFilm contributors on 2026-10-20. See LICENSE/NOTICE.
import type { ExportProfile } from "./models.js";

export type ExportRatio = ExportProfile["ratio"];
export type ExportFormat = ExportProfile["format"];
export type ExportFraming = ExportProfile["framing"];

export const EXPORT_PROFILE_PRESETS: Readonly<
  Record<ExportRatio, { width: number; height: number }>
> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

export interface CreateExportProfileInput {
  ratio: ExportRatio;
  frameRate: number;
  width?: number;
  height?: number;
  framing?: ExportFraming;
  format?: ExportFormat;
  quality?: ExportProfile["quality"];
}

const ratios: Readonly<Record<ExportRatio, number>> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
};

export function createExportProfile(
  input: CreateExportProfileInput,
): ExportProfile {
  const preset = EXPORT_PROFILE_PRESETS[input.ratio];
  if (!preset) throw new Error("Export ratio is unsupported.");
  const framing = input.framing ?? "contain";
  return validateExportProfile({
    version: 1,
    ratio: input.ratio,
    width: input.width ?? preset.width,
    height: input.height ?? preset.height,
    frameRate: input.frameRate,
    framing,
    subtitleStrategy: framing === "crop" ? "review-crop" : "preserve",
    format: input.format ?? "mp4",
    quality: input.quality ?? "standard",
  });
}

/** Validate untrusted API/CLI profile JSON before any render job is reserved. */
export function validateExportProfile(value: unknown): ExportProfile {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new Error("Export profile must be a plain object.");
  const record = value as Record<string, unknown>;
  const keys = [
    "version",
    "ratio",
    "width",
    "height",
    "frameRate",
    "framing",
    "subtitleStrategy",
    "format",
    "quality",
  ];
  if (Object.keys(record).some((key) => !keys.includes(key)))
    throw new Error("Export profile contains an unsupported field.");
  if (record.version !== 1)
    throw new Error("Export profile version must be 1.");
  if (!(
    record.ratio === "16:9" ||
    record.ratio === "9:16" ||
    record.ratio === "1:1"
  ))
    throw new Error("Export profile ratio is unsupported.");
  for (const key of ["width", "height"] as const) {
    const dimension = record[key];
    if (
      typeof dimension !== "number" ||
      !Number.isInteger(dimension) ||
      dimension < 64 ||
      dimension > 4096 ||
      dimension % 2 !== 0
    )
      throw new Error(
        `Export profile ${key} must be an even integer from 64 to 4096.`,
      );
  }
  const width = record.width as number;
  const height = record.height as number;
  if (width * height > 8_294_400)
    throw new Error("Export profile exceeds the 8.3 megapixel output limit.");
  if (
    typeof record.frameRate !== "number" ||
    !Number.isFinite(record.frameRate) ||
    record.frameRate < 1 ||
    record.frameRate > 60
  )
    throw new Error("Export profile frameRate must be between 1 and 60 fps.");
  const ratio = ratios[record.ratio];
  if (Math.abs(width / height - ratio) > 0.00001)
    throw new Error(
      "Export profile dimensions do not match its selected ratio.",
    );
  if (!(record.framing === "contain" || record.framing === "crop"))
    throw new Error("Export profile framing must be contain or crop.");
  if (
    record.subtitleStrategy !==
    (record.framing === "crop" ? "review-crop" : "preserve")
  )
    throw new Error(
      "Export profile subtitleStrategy does not match its framing.",
    );
  if (!(
    record.format === "mp4" ||
    record.format === "png" ||
    record.format === "wav" ||
    record.format === "audio-stems"
  ))
    throw new Error("Export profile format is unsupported.");
  if (!(record.quality === "standard" || record.quality === "high-detail"))
    throw new Error("Export profile quality is unsupported.");
  if (
    record.format !== "mp4" &&
    record.format !== "png" &&
    record.quality !== "standard"
  )
    throw new Error(
      "High detail quality applies to MP4 and PNG frame output only.",
    );
  return {
    version: 1,
    ratio: record.ratio,
    width,
    height,
    frameRate: record.frameRate,
    framing: record.framing,
    subtitleStrategy:
      record.subtitleStrategy as ExportProfile["subtitleStrategy"],
    format: record.format,
    quality: record.quality,
  };
}
