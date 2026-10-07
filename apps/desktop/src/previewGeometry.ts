import { resolveClipGeometry, type ClipTransform } from "@openfilm/core";

/** Draft inputs may temporarily contain strings. Keep committed geometry visible. */
export function previewDraftGeometry(
  draft: { scale?: unknown; rotation?: unknown; x?: unknown; y?: unknown },
  committed?: ClipTransform,
) {
  const result = resolveClipGeometry(committed);
  for (const key of ["scale", "rotation", "x", "y"] as const) {
    const value = draft[key];
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (key !== "scale" || value > 0)
    )
      result[key] = value;
  }
  return result;
}
