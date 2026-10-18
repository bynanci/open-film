// SPDX-License-Identifier: GPL-3.0-only
import { lstat, open } from "node:fs/promises";

/**
 * Demuxers for the self-contained photo, video and audio formats accepted by
 * FilesystemSource. JPEG/TIFF also cover INSP/DNG; MOV covers MP4, HEIC/AVIF and
 * INSV/360; Matroska and Ogg cover WebM/Opus. Unknown installed demuxers are not
 * admitted implicitly. In particular, playlists and image2 file sequences can
 * read bytes that are not represented by the imported asset's source hash.
 */
export const LOCAL_MEDIA_DEMUXERS: readonly string[] = Object.freeze([
  "mov",
  "matroska",
  "avi",
  "mpegts",
  "mp3",
  "wav",
  "aac",
  "flac",
  "ogg",
  "jpeg_pipe",
  "png_pipe",
  "webp_pipe",
  "bmp_pipe",
  "tiff_pipe",
  "gif",
  "gif_pipe",
  "apng",
]);

/**
 * Apply to each imported input, before its -i (or FFprobe's input path).
 * Output pipes and application-generated lavfi inputs keep their own policy.
 * MOV external data references remain disabled by FFmpeg's default; callers
 * must not enable drefs or absolute external-reference paths.
 */
export async function localMediaInputOptions(
  path: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const aborted = () => {
    if (signal?.aborted)
      throw new DOMException("Operation cancelled", "AbortError");
  };
  aborted();
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(
      "Source media must be a regular local file, not a directory or symlink.",
    );
  aborted();
  const file = await open(path, "r");
  let format: string | undefined;
  try {
    const signature = Buffer.alloc(16);
    const { bytesRead } = await file.read(signature, 0, signature.length, 0);
    aborted();
    const bytes = signature.subarray(0, bytesRead);
    if (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    )
      format = "jpeg_pipe";
    else if (
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      format = "png_pipe";
    else if (
      ["II*\0", "MM\0*", "II+\0", "MM\0+"].includes(
        bytes.subarray(0, 4).toString("latin1"),
      )
    )
      format = "tiff_pipe";
    else if (bytes.subarray(0, 2).toString("ascii") === "BM")
      format = "bmp_pipe";
    else if (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    )
      format = "webp_pipe";
    else if (
      ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
    )
      format = "gif_pipe";
  } finally {
    await file.close();
  }
  return [
    "-protocol_whitelist",
    "file",
    "-format_whitelist",
    LOCAL_MEDIA_DEMUXERS.join(","),
    // Some EXIF-tagged images probe as image2. Force a verified single-file
    // image demuxer instead of admitting filename patterns or file sequences.
    ...(format ? ["-f", format] : []),
  ];
}
