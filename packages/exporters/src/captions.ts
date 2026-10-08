import {
  CAPTION_LIMITS,
  ApplicationError,
  isCaptionTextValid,
  isSrtCaptionTextSupported,
  type CaptionCue,
  type CaptionFormat,
} from "@openfilm/core";

export interface CaptionExportResult {
  extension: CaptionFormat;
  content: string;
  mediaType: string;
}

function timestamp(milliseconds: number, separator: "," | "."): string {
  const seconds = Math.floor(milliseconds / 1000);
  return (
    [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((value) => String(value).padStart(2, "0"))
      .join(":") +
    separator +
    String(milliseconds % 1000).padStart(3, "0")
  );
}

/** Text is literal, never subtitle markup; blank lines must not end the cue block. */
function payload(text: string, format: CaptionFormat): string {
  const normalized = text.replace(/\r\n?/gu, "\n");
  if (format === "srt") {
    // SubRip players do not share a portable escaping mechanism. FFmpeg
    // interprets HTML/ASS controls and recognizes timing lines even inside a
    // cue. Refuse these inputs rather than silently changing the user's text.
    if (!isSrtCaptionTextSupported(normalized)) {
      throw new ApplicationError(
        "captions.srtTextUnsupported",
        "This text contains markup, escape characters or timing-like lines that SubRip players may reinterpret. Export WebVTT to preserve literal text.",
      );
    }
    return normalized
      .split("\n")
      .map((line) => (line.trim() ? line : "\u00a0"))
      .join("\n");
  }
  return normalized
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .split("\n")
    .map((line) => (line.trim() ? line : "&nbsp;"))
    .join("\n");
}

/** Serialize already mapped cues, with independent input validation at the adapter boundary. */
export function serializeCaptions(
  format: CaptionFormat,
  cues: CaptionCue[],
): CaptionExportResult {
  if (!["srt", "vtt"].includes(format))
    throw new Error("Unsupported caption format.");
  if (!cues.length || cues.length > CAPTION_LIMITS.cues)
    throw new Error("Caption export requires a bounded, non-empty cue list.");
  let previousStart = -1;
  let textCharacters = 0;
  const blocks = cues.map((cue, index) => {
    if (
      ![cue.startMs, cue.endMs].every(Number.isSafeInteger) ||
      cue.startMs < 0 ||
      cue.startMs < previousStart ||
      cue.endMs <= cue.startMs ||
      cue.endMs > CAPTION_LIMITS.timeMs
    )
      throw new Error(
        "Caption export requires sorted, positive, bounded millisecond intervals.",
      );
    if (!isCaptionTextValid(cue.text) || !cue.text.trim())
      throw new Error("Caption export requires valid, non-empty Unicode text.");
    textCharacters += cue.text.length;
    if (textCharacters > CAPTION_LIMITS.textCharacters)
      throw new Error("Caption text exceeds the export size limit.");
    previousStart = cue.startMs;
    const separator = format === "srt" ? "," : ".";
    return `${index + 1}\n${timestamp(cue.startMs, separator)} --> ${timestamp(cue.endMs, separator)}\n${payload(cue.text, format)}\n\n`;
  });
  return {
    extension: format,
    content: (format === "vtt" ? "WEBVTT\n\n" : "") + blocks.join(""),
    mediaType:
      format === "vtt"
        ? "text/vtt; charset=utf-8"
        : "application/x-subrip; charset=utf-8",
  };
}
