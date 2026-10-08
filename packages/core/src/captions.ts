import type { Composition, MediaAsset } from "./models.js";
import type { TranscriptDocument } from "./intelligence.js";
import { frameAlignedDuration } from "./timing.js";

export type CaptionFormat = "srt" | "vtt";

/** Bounds keep a malformed or unusually large input from creating an unbounded export. */
export const CAPTION_LIMITS = {
  clips: 10_000,
  segments: 100_000,
  visits: 1_000_000,
  cues: 100_000,
  issues: 10_000,
  textLength: 20_000,
  textCharacters: 8_000_000,
  /** Interoperable two-digit hours, including the final millisecond. */
  timeMs: 359_999_999,
} as const;

export interface CaptionSource {
  asset: MediaAsset;
  /** The application verifies source availability/identity before mapping. */
  available: boolean;
  transcript?: TranscriptDocument;
  transcriptRevisionId?: string;
}

/** Canonical metadata used by the mapper, also bound by application snapshots. */
export interface CaptionAssetState {
  name: string;
  mediaType: MediaAsset["mediaType"];
  duration: number | "absent" | "invalid";
  previewBlocked: boolean;
  hasAudio: boolean;
}

export function captionAssetState(asset: MediaAsset): CaptionAssetState {
  const preview = asset.metadata["openfilm.preview"] as
    { supported?: boolean } | undefined;
  const probe = asset.metadata["openfilm.ffprobe"] as
    { streams?: { codec_type?: string }[] } | undefined;
  return {
    name: asset.name,
    mediaType: asset.mediaType,
    duration:
      asset.duration === undefined
        ? "absent"
        : typeof asset.duration === "number" && Number.isFinite(asset.duration)
          ? asset.duration === 0
            ? 0
            : asset.duration
          : "invalid",
    previewBlocked: preview?.supported === false,
    hasAudio:
      asset.mediaType === "audio" ||
      (Array.isArray(probe?.streams) &&
        probe.streams.some((stream) => stream?.codec_type === "audio")),
  };
}

export interface CaptionCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  clipId: string;
  assetId: string;
  assetName?: string;
  transcriptId: string;
  transcriptRevisionId: string;
  segmentId: string;
  /** Original segment range in source seconds, never invented word alignment. */
  sourceIn: number;
  sourceOut: number;
}

export type CaptionIssueCode =
  | "TRACK_UNSUPPORTED"
  | "TIMING_UNSUPPORTED"
  | "SOURCE_UNAVAILABLE"
  | "TRANSCRIPT_MISSING"
  | "TRANSCRIPT_STALE"
  | "MEDIA_UNSUPPORTED"
  | "MUTED_CLIP"
  | "PARTIAL_SEGMENT"
  | "ALIGNMENT_STALE"
  | "TIMING_ESTIMATED"
  | "INVALID_SEGMENT"
  | "INVALID_TEXT"
  | "EMPTY_TEXT"
  | "TEXT_ESCAPED"
  | "ZERO_DURATION"
  | "OVERLAP"
  | "MUSIC_SOURCE"
  | "LIMIT_EXCEEDED";

export interface CaptionIssue {
  code: CaptionIssueCode;
  severity: "warning" | "error";
  clipId?: string;
  assetId?: string;
  segmentId?: string;
  startMs?: number;
  endMs?: number;
  params?: Record<string, string | number>;
}

export interface CaptionMapping {
  version: 1;
  trackId: string;
  cues: CaptionCue[];
  issues: CaptionIssue[];
}

/** C0 controls other than line breaks/tabs, DEL and unpaired UTF-16 are not captions. */
export function isCaptionTextValid(text: string): boolean {
  return (
    typeof text === "string" &&
    text.length <= CAPTION_LIMITS.textLength &&
    ![...text].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    }) &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      text,
    )
  );
}

/** SubRip has no portable literal escaping for markup, ASS controls or cue lines. */
export function isSrtCaptionTextSupported(text: string): boolean {
  const normalized = text.replace(/\r\n?/gu, "\n");
  return (
    !/[<{}\\]/u.test(normalized) &&
    !normalized.split("\n").some((line) => {
      const arrow = line.indexOf("-->");
      // SubRip readers accept unusually permissive numeric fields (including
      // signs). A conservative time-shaped-line check avoids reproducing each
      // parser's grammar, while allowing ordinary arrows without a time prefix.
      return arrow >= 0 && line.slice(0, arrow).includes(":");
    })
  );
}

const EPSILON = 1e-9;
// Match validateComposition's accepted clip-end tolerance; output still clamps
// to the exact film boundary before the separate inward millisecond rounding.
const COMPOSITION_END_TOLERANCE = 1e-7;
// A tiny tolerance corrects binary representation at exact millisecond boundaries.
const startMs = (seconds: number): number =>
  Math.max(0, Math.ceil(seconds * 1000 - 1e-7));
const endMs = (seconds: number): number => Math.floor(seconds * 1000 + 1e-7);

/** Omit ranges with no representable millisecond instead of showing a reversed interval. */
function issueRange(
  start: number,
  end: number,
): Pick<CaptionIssue, "startMs" | "endMs"> {
  const begin = startMs(start);
  const finish = endMs(end);
  return finish >= begin ? { startMs: begin, endMs: finish } : {};
}

/**
 * Map whole transcript segments onto one explicitly selected audible track.
 * Partial segments are omitted rather than guessing which words survived a trim.
 * Crossfades extend a frozen visual frame in the renderer, never the audio clock.
 * Starts round up and ends down; no rounded cue extends outside its retained range.
 * An error issue blocks publication; warnings describe intentional partial output.
 * Supplying frameRate matches the renderer's complete-frame output boundary.
 * Without it, callers explicitly receive nominal-composition timing instead.
 */
export function generateCompositionCaptions(
  composition: Composition,
  sources: CaptionSource[],
  options: { trackId: string; frameRate?: number },
): CaptionMapping {
  const result: CaptionMapping = {
    version: 1,
    trackId: options.trackId,
    cues: [],
    issues: [],
  };
  let limitReached = false;
  const issue = (value: CaptionIssue): void => {
    if (result.issues.length >= CAPTION_LIMITS.issues) {
      result.issues[result.issues.length - 1] = {
        code: "LIMIT_EXCEEDED",
        severity: "error",
        params: { limit: "issues" },
      };
      limitReached = true;
    } else result.issues.push(value);
  };
  const selected = composition.tracks.filter(
    (track) => track.id === options.trackId,
  );
  const track = selected[0];
  if (
    selected.length !== 1 ||
    !track ||
    !["video", "audio", "music"].includes(track.type)
  ) {
    issue({ code: "TRACK_UNSUPPORTED", severity: "error" });
    return result;
  }
  if (
    !Number.isFinite(composition.duration) ||
    composition.duration <= 0 ||
    composition.duration * 1000 > CAPTION_LIMITS.timeMs
  ) {
    issue({
      code: "TIMING_UNSUPPORTED",
      severity: "error",
      params: { reason: "film-duration" },
    });
    return result;
  }
  if (
    track.clips.length > CAPTION_LIMITS.clips ||
    sources.length > CAPTION_LIMITS.clips
  ) {
    issue({
      code: "LIMIT_EXCEEDED",
      severity: "error",
      params: { limit: "clips" },
    });
    return result;
  }
  let outputDuration = composition.duration;
  if (options.frameRate !== undefined) {
    try {
      const aligned = frameAlignedDuration(
        composition.duration,
        options.frameRate,
      );
      if (!Number.isFinite(aligned) || aligned <= 0) {
        issue({
          code: "TIMING_UNSUPPORTED",
          severity: "error",
          params: { reason: "frame-duration" },
        });
        return result;
      }
      outputDuration = Math.min(composition.duration, aligned);
    } catch {
      issue({
        code: "TIMING_UNSUPPORTED",
        severity: "error",
        params: { reason: "frame-rate" },
      });
      return result;
    }
  }
  const hasOutputTail = outputDuration < composition.duration - EPSILON;
  if (track.type === "music")
    issue({ code: "MUSIC_SOURCE", severity: "warning" });
  const byAsset = new Map(sources.map((source) => [source.asset.id, source]));
  if (byAsset.size !== sources.length) {
    issue({
      code: "TRANSCRIPT_STALE",
      severity: "error",
      params: { reason: "duplicate-source" },
    });
    return result;
  }
  const clipIds = new Set<string>();
  let visits = 0;
  let textCharacters = 0;
  for (const [clipIndex, clip] of track.clips.entries()) {
    if (limitReached) break;
    const context = { clipId: clip.id, assetId: clip.assetId };
    const sourceIn = clip.sourceIn ?? 0;
    const speed = clip.transform?.speed ?? 1;
    const volume = clip.transform?.volume ?? 1;
    const sourceOut =
      clip.sourceOut ?? sourceIn + clip.timelineDuration * speed;
    const clipEnd = clip.timelineStart + clip.timelineDuration;
    if (
      !clip.id ||
      clipIds.has(clip.id) ||
      ![
        sourceIn,
        sourceOut,
        speed,
        volume,
        clip.timelineStart,
        clip.timelineDuration,
        clipEnd,
      ].every(Number.isFinite) ||
      sourceIn < 0 ||
      sourceOut <= sourceIn ||
      speed <= 0 ||
      volume < 0 ||
      clip.timelineStart < 0 ||
      clip.timelineDuration <= 0 ||
      clipEnd > composition.duration + COMPOSITION_END_TOLERANCE ||
      Math.abs((sourceOut - sourceIn) / speed - clip.timelineDuration) > 1e-6
    ) {
      issue({
        ...context,
        code: "TIMING_UNSUPPORTED",
        severity: "error",
        params: { reason: "clip-range" },
      });
      continue;
    }
    clipIds.add(clip.id);
    const clipContext = {
      ...context,
      ...issueRange(clip.timelineStart, Math.min(outputDuration, clipEnd)),
    };
    if (volume === 0) {
      issue({ ...clipContext, code: "MUTED_CLIP", severity: "warning" });
      continue;
    }
    const source = byAsset.get(clip.assetId);
    if (!source || source.available !== true) {
      issue({
        ...clipContext,
        code: "SOURCE_UNAVAILABLE",
        severity: "warning",
      });
      continue;
    }
    const assetState = captionAssetState(source.asset);
    if (!["video", "audio"].includes(assetState.mediaType)) {
      issue({ ...clipContext, code: "MEDIA_UNSUPPORTED", severity: "warning" });
      continue;
    }
    if (assetState.previewBlocked) {
      issue({
        ...clipContext,
        code: "MEDIA_UNSUPPORTED",
        severity: "warning",
        params: { reason: "preview-disabled" },
      });
      continue;
    }
    // Match FFmpegRenderer.hasAudio. A transcript does not prove that this
    // composition actually renders an audio stream from its video source.
    if (!assetState.hasAudio) {
      issue({
        ...clipContext,
        code: "MEDIA_UNSUPPORTED",
        severity: "warning",
        params: { reason: "no-audio-stream" },
      });
      continue;
    }
    if (
      assetState.duration !== "absent" &&
      (assetState.duration === "invalid" ||
        sourceOut > assetState.duration + EPSILON)
    ) {
      issue({
        ...context,
        code: "TIMING_UNSUPPORTED",
        severity: "error",
        params: { reason: "source-duration" },
      });
      continue;
    }
    const transcript = source.transcript;
    if (!transcript) {
      issue({
        ...clipContext,
        code: "TRANSCRIPT_MISSING",
        severity: "warning",
      });
      continue;
    }
    if (
      !source.transcriptRevisionId?.trim() ||
      transcript.assetId !== source.asset.id ||
      (source.asset.contentHash &&
        source.asset.contentHash !== transcript.provenance.sourceHash)
    ) {
      issue({ ...clipContext, code: "TRANSCRIPT_STALE", severity: "warning" });
      continue;
    }
    if (transcript.segments.length > CAPTION_LIMITS.segments) {
      issue({
        ...context,
        code: "LIMIT_EXCEEDED",
        severity: "error",
        params: { limit: "segments" },
      });
      continue;
    }
    const segmentIds = new Set<string>();
    for (const [segmentIndex, segment] of transcript.segments.entries()) {
      if (limitReached) break;
      if (++visits > CAPTION_LIMITS.visits) {
        issue({
          ...context,
          code: "LIMIT_EXCEEDED",
          severity: "error",
          params: { limit: "visits" },
        });
        limitReached = true;
        break;
      }
      const detail = { ...context, segmentId: segment.id };
      if (
        !segment.id?.trim() ||
        segmentIds.has(segment.id) ||
        ![segment.start, segment.end].every(Number.isFinite) ||
        segment.start < 0 ||
        segment.end < segment.start
      ) {
        issue({ ...detail, code: "INVALID_SEGMENT", severity: "error" });
        continue;
      }
      segmentIds.add(segment.id);
      if (segment.end <= sourceIn || segment.start >= sourceOut) continue;
      if (hasOutputTail) {
        const mappedStart =
          clip.timelineStart + (segment.start - sourceIn) / speed;
        const mappedEnd = clip.timelineStart + (segment.end - sourceIn) / speed;
        if (mappedStart >= outputDuration - EPSILON) {
          issue({
            ...detail,
            code: "ZERO_DURATION",
            severity: "warning",
            params: { reason: "output-tail" },
          });
          continue;
        }
        if (mappedEnd > outputDuration + EPSILON) {
          issue({
            ...detail,
            code: "PARTIAL_SEGMENT",
            severity: "warning",
            ...issueRange(
              Math.max(clip.timelineStart, mappedStart),
              Math.min(clipEnd, outputDuration),
            ),
            params: {
              reason: "output-tail",
              sourceIn: Math.max(sourceIn, segment.start),
              sourceOut: Math.min(
                sourceOut,
                sourceIn + (outputDuration - clip.timelineStart) * speed,
              ),
            },
          });
          continue;
        }
      }
      if (
        segment.start < sourceIn - EPSILON ||
        segment.end > sourceOut + EPSILON
      ) {
        issue({
          ...detail,
          code: "PARTIAL_SEGMENT",
          severity: "warning",
          ...issueRange(
            Math.max(
              clip.timelineStart,
              clip.timelineStart +
                (Math.max(sourceIn, segment.start) - sourceIn) / speed,
            ),
            Math.min(
              outputDuration,
              clipEnd,
              clip.timelineStart +
                (Math.min(sourceOut, segment.end) - sourceIn) / speed,
            ),
          ),
          params: {
            sourceIn: Math.max(sourceIn, segment.start),
            sourceOut: Math.min(sourceOut, segment.end),
          },
        });
        continue;
      }
      if (!isCaptionTextValid(segment.text)) {
        issue({ ...detail, code: "INVALID_TEXT", severity: "error" });
        continue;
      }
      if (!segment.text.trim()) {
        issue({ ...detail, code: "EMPTY_TEXT", severity: "warning" });
        continue;
      }
      const begin = startMs(
        Math.max(
          clip.timelineStart,
          clip.timelineStart + (segment.start - sourceIn) / speed,
        ),
      );
      const end = endMs(
        Math.min(
          outputDuration,
          clipEnd,
          clip.timelineStart + (segment.end - sourceIn) / speed,
        ),
      );
      if (end <= begin) {
        issue({ ...detail, code: "ZERO_DURATION", severity: "warning" });
        continue;
      }
      if (
        result.cues.length >= CAPTION_LIMITS.cues ||
        textCharacters + segment.text.length > CAPTION_LIMITS.textCharacters
      ) {
        issue({
          ...detail,
          code: "LIMIT_EXCEEDED",
          severity: "error",
          params: { limit: "output" },
        });
        limitReached = true;
        break;
      }
      const cue: CaptionCue = {
        id: `cue-${clipIndex + 1}-${segmentIndex + 1}`,
        startMs: begin,
        endMs: end,
        text: segment.text,
        ...detail,
        assetName: assetState.name,
        transcriptId: transcript.id,
        transcriptRevisionId: source.transcriptRevisionId,
        sourceIn: segment.start,
        sourceOut: segment.end,
      };
      result.cues.push(cue);
      textCharacters += cue.text.length;
      const timing = { ...detail, startMs: begin, endMs: end };
      if (
        segment.alignmentState !== undefined &&
        !["original", "realigned"].includes(segment.alignmentState)
      ) {
        issue({ ...timing, code: "ALIGNMENT_STALE", severity: "warning" });
      }
      if (segment.timingSource === "estimated")
        issue({ ...timing, code: "TIMING_ESTIMATED", severity: "warning" });
      if (!isSrtCaptionTextSupported(segment.text)) {
        issue({ ...timing, code: "TEXT_ESCAPED", severity: "warning" });
      }
    }
  }
  result.cues.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.id.localeCompare(right.id),
  );
  let furthest: CaptionCue | undefined;
  for (const cue of result.cues) {
    if (limitReached) break;
    if (furthest && cue.startMs < furthest.endMs) {
      issue({
        code: "OVERLAP",
        severity: "warning",
        clipId: cue.clipId,
        assetId: cue.assetId,
        segmentId: cue.segmentId,
        startMs: cue.startMs,
        endMs: Math.min(cue.endMs, furthest.endMs),
        params: {
          otherClipId: furthest.clipId,
          otherSegmentId: furthest.segmentId,
        },
      });
    }
    if (!furthest || cue.endMs > furthest.endMs) furthest = cue;
  }
  return result;
}
