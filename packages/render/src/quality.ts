export type RenderQuality = "preview" | "high" | "lossless";

/** Constrained choices only: never forward user-provided encoder arguments. */
export function resolveRenderQuality(quality: RenderQuality = "preview") {
  switch (quality) {
    case "preview":
      return { preset: "veryfast", crf: 23, lanczos: false } as const;
    case "high":
      return { preset: "medium", crf: 17, lanczos: true } as const;
    case "lossless":
      return { preset: "veryfast", crf: 0, lanczos: true } as const;
    default:
      throw new Error("Render quality must be preview, high or lossless.");
  }
}
