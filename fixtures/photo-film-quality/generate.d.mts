export interface QualityFixtureFile {
  id: string;
  path: string;
  mediaType: "image" | "audio";
  width?: number;
  height?: number;
  duration?: number;
  subjects?: number[][];
  sha256: string;
  bytes: number;
}
export function generatePhotoFilmQualityMedia(directory: string): Promise<{
  root: string;
  files: QualityFixtureFile[];
  manifest: Record<string, unknown>;
}>;
