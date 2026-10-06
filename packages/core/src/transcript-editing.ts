import { ApplicationError } from "./errors.js";
import {
  validateTranscriptDocument,
  validateTranscriptSegmentId,
  type TranscriptDocument,
  type TranscriptSegment,
} from "./intelligence.js";

export type AlignmentState = "original" | "text-edited" | "realigned";
export interface TranscriptRevision {
  id: string;
  assetId: string;
  parentRevisionId?: string;
  source: "provider" | "user" | "glossary" | "review-suggestion";
  createdAt: string;
  suggestionId?: string;
}
export type TranscriptCommand =
  | { type: "replace-text"; segmentId: string; text: string }
  | {
      type: "split-segment";
      segmentId: string;
      newSegmentId: string;
      splitTime?: number;
      cursorOffset?: number;
    }
  | { type: "merge-segment"; segmentId: string; direction: "previous" | "next" }
  | { type: "delete-segment"; segmentId: string }
  | {
      type: "replace-all";
      query: string;
      replacement: string;
      caseSensitive?: boolean;
    }
  | {
      type: "replace-match";
      segmentId: string;
      start: number;
      end: number;
      expected: string;
      replacement: string;
    };

const MAX_TEXT = 20_000;
function invalid(message: string): never {
  throw new ApplicationError("transcript.invalidCommand", message);
}
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  )
    invalid("Transcript command must be a plain JSON object.");
  return value as Record<string, unknown>;
}
function unicode(value: unknown, name: string, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_TEXT ||
    (!allowEmpty && !value.trim()) ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    }) ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  )
    invalid(
      `${name} must be valid Unicode text of at most ${MAX_TEXT} characters.`,
    );
  return value;
}
function identifier(value: unknown, name: string): string {
  const text = unicode(value, name);
  if (
    text.length > 256 ||
    [...text].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    invalid(`${name} must be an identifier of at most 256 characters.`);
  return text;
}
function integer(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    invalid(`${name} must be a nonnegative integer.`);
  return value as number;
}
function boundary(text: string, offset: number): boolean {
  return (
    offset <= text.length &&
    !(
      offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/u.test(text[offset - 1]!) &&
      /[\uDC00-\uDFFF]/u.test(text[offset]!)
    )
  );
}
export function validateTranscriptCommand(value: unknown): TranscriptCommand {
  const data = object(value);
  const type = data.type;
  const allowed = ["type"];
  if (type !== "replace-all") {
    try {
      validateTranscriptSegmentId(data.segmentId);
    } catch {
      invalid("segmentId must be a nonempty string.");
    }
    allowed.push("segmentId");
  }
  switch (type) {
    case "replace-text":
      allowed.push("text");
      unicode(data.text, "text");
      break;
    case "split-segment":
      allowed.push("newSegmentId", "splitTime", "cursorOffset");
      identifier(data.newSegmentId, "newSegmentId");
      if (data.splitTime === undefined && data.cursorOffset === undefined)
        invalid("A split requires a playhead time or text cursor.");
      if (
        data.splitTime !== undefined &&
        (typeof data.splitTime !== "number" ||
          !Number.isFinite(data.splitTime) ||
          data.splitTime < 0)
      )
        invalid("splitTime must be a finite source time.");
      if (data.cursorOffset !== undefined)
        integer(data.cursorOffset, "cursorOffset");
      break;
    case "merge-segment":
      allowed.push("direction");
      if (data.direction !== "previous" && data.direction !== "next")
        invalid("Merge direction must be previous or next.");
      break;
    case "delete-segment":
      break;
    case "replace-all":
      allowed.push("query", "replacement", "caseSensitive");
      unicode(data.query, "query");
      unicode(data.replacement, "replacement", true);
      if (
        data.caseSensitive !== undefined &&
        typeof data.caseSensitive !== "boolean"
      )
        invalid("caseSensitive must be boolean.");
      break;
    case "replace-match":
      allowed.push("start", "end", "expected", "replacement");
      integer(data.start, "start");
      integer(data.end, "end");
      if (Number(data.end) <= Number(data.start))
        invalid("A replacement range must not be empty.");
      unicode(data.expected, "expected");
      unicode(data.replacement, "replacement", true);
      break;
    default:
      invalid("Unknown transcript command.");
  }
  for (const key of Object.keys(data))
    if (!allowed.includes(key))
      invalid(`Unknown transcript command field: ${key}.`);
  return structuredClone(data) as TranscriptCommand;
}

export interface TranscriptMatchRange {
  start: number;
  end: number;
}
/** Literal matching uses UTF-16 offsets, just like DOM text selection. */
export function transcriptTextMatches(
  text: string,
  query: string,
  caseSensitive = true,
): TranscriptMatchRange[] {
  return compileTranscriptTextMatcher(query, caseSensitive)(text);
}

/** Compile once for a bounded batch or streamed catalog search. */
export function compileTranscriptTextMatcher(
  query: string,
  caseSensitive = true,
): (text: string) => TranscriptMatchRange[] {
  unicode(query, "query");
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matches = new RegExp(escaped, caseSensitive ? "gu" : "giu");
  return (text) =>
    Array.from(text.matchAll(matches), (match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
}

/** Join CJK runs without injecting English word spacing. Existing punctuation stays readable. */
export function joinTranscriptText(left: string, right: string): string {
  const first = left.trimEnd();
  const second = right.trimStart();
  if (!first || !second) return first + second;
  const cjk =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const last = Array.from(first).at(-1)!;
  const next = Array.from(second)[0]!;
  if (
    (cjk.test(last) && cjk.test(next)) ||
    (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}][\p{Punctuation}]*$/u.test(
      first,
    ) &&
      /^[\p{Punctuation}]*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
        second,
      )) ||
    /^[，。！？、；：,.!?;:）\])]/u.test(next) ||
    /[（[(]$/u.test(last)
  )
    return first + second;
  return `${first} ${second}`;
}

function changed(segment: TranscriptSegment, text: string): TranscriptSegment {
  unicode(text, "text");
  return text === segment.text
    ? segment
    : { ...segment, text, alignmentState: "text-edited" };
}

/** Pure, validated and replayable. Only transcript content changes; source and composition are untouched. */
export function applyTranscriptCommand(
  value: TranscriptDocument,
  input: TranscriptCommand,
): TranscriptDocument {
  const document = validateTranscriptDocument(value);
  const command = validateTranscriptCommand(input);
  if (command.type === "replace-all") {
    const matches = compileTranscriptTextMatcher(
      command.query,
      command.caseSensitive ?? true,
    );
    document.segments = document.segments.flatMap((segment) => {
      const ranges = matches(segment.text);
      let text = segment.text;
      for (const match of ranges.reverse())
        text =
          text.slice(0, match.start) +
          command.replacement +
          text.slice(match.end);
      return text.trim() ? [changed(segment, text)] : [];
    });
    return validateTranscriptDocument(document);
  }
  const position = document.segments.findIndex(
    (segment) => segment.id === command.segmentId,
  );
  if (position < 0)
    throw new ApplicationError(
      "transcript.segmentNotFound",
      "The transcript segment no longer exists.",
      404,
      { segmentId: command.segmentId },
    );
  const segment = document.segments[position]!;
  switch (command.type) {
    case "replace-text":
      document.segments[position] = changed(segment, command.text);
      break;
    case "replace-match": {
      if (
        !boundary(segment.text, command.start) ||
        !boundary(segment.text, command.end) ||
        segment.text.slice(command.start, command.end) !== command.expected
      )
        throw new ApplicationError(
          "transcript.revisionConflict",
          "The selected text changed before replacement.",
          409,
        );
      const text =
        segment.text.slice(0, command.start) +
        command.replacement +
        segment.text.slice(command.end);
      if (text.trim()) document.segments[position] = changed(segment, text);
      else document.segments.splice(position, 1);
      break;
    }
    case "delete-segment":
      document.segments.splice(position, 1);
      break;
    case "merge-segment": {
      const otherPosition =
        position + (command.direction === "previous" ? -1 : 1);
      const other = document.segments[otherPosition];
      if (!other) invalid("There is no adjacent transcript segment to merge.");
      const first = document.segments[Math.min(position, otherPosition)]!;
      const second = document.segments[Math.max(position, otherPosition)]!;
      const merged: TranscriptSegment = {
        ...first,
        start: Math.min(first.start, second.start),
        end: Math.max(first.end, second.end),
        text: joinTranscriptText(first.text, second.text),
        alignmentState: "text-edited",
      };
      const words = [...(first.words ?? []), ...(second.words ?? [])].sort(
        (a, b) => a.start - b.start,
      );
      if (words.length) merged.words = words;
      if (
        first.timingSource === "estimated" ||
        second.timingSource === "estimated"
      )
        merged.timingSource = "estimated";
      document.segments.splice(Math.min(position, otherPosition), 2, merged);
      break;
    }
    case "split-segment": {
      if (document.segments.some((item) => item.id === command.newSegmentId))
        invalid("The new segment ID already exists.");
      if (segment.end <= segment.start)
        invalid("A zero-duration segment cannot be split.");
      let offset = command.cursorOffset;
      let time = command.splitTime;
      let timingSource: NonNullable<TranscriptSegment["timingSource"]> =
        "estimated";
      if (
        offset !== undefined &&
        (!boundary(segment.text, offset) ||
          offset === 0 ||
          offset === segment.text.length)
      )
        invalid(
          "The split cursor must be inside the text and on a Unicode boundary.",
        );
      if (time !== undefined) {
        if (time <= segment.start || time >= segment.end)
          invalid("The split playhead must be inside the segment.");
        timingSource = "playhead";
        if (offset === undefined) {
          offset = Math.round(
            (segment.text.length * (time - segment.start)) /
              (segment.end - segment.start),
          );
          offset = Math.max(1, Math.min(segment.text.length - 1, offset));
          if (!boundary(segment.text, offset)) offset++;
        }
      } else {
        time =
          segment.start +
          ((segment.end - segment.start) * offset!) / segment.text.length;
        // A cursor only maps to original words when their text exactly reproduces the segment.
        const words = segment.words;
        if (
          segment.alignmentState !== "text-edited" &&
          words?.length &&
          words.map((word) => word.text).join("") === segment.text
        ) {
          let cursor = 0;
          const candidates = words
            .slice(0, -1)
            .map((word) => {
              cursor += word.text.length;
              return { offset: cursor, time: word.end };
            })
            .filter(
              (candidate) =>
                candidate.time > segment.start && candidate.time < segment.end,
            );
          const nearest = candidates.sort(
            (a, b) =>
              Math.abs(a.offset - offset!) - Math.abs(b.offset - offset!),
          )[0];
          if (nearest) {
            offset = nearest.offset;
            time = nearest.time;
            timingSource = "word-boundary";
          }
        }
      }
      const leftText = segment.text.slice(0, offset).trimEnd();
      const rightText = segment.text.slice(offset).trimStart();
      if (!leftText || !rightText)
        invalid(
          "Splitting must leave readable text on both sides; select a text cursor if necessary.",
        );
      const left: TranscriptSegment = {
        ...segment,
        end: time,
        text: leftText,
        alignmentState: "text-edited",
        timingSource,
      };
      const right: TranscriptSegment = {
        ...segment,
        id: command.newSegmentId,
        start: time,
        text: rightText,
        alignmentState: "text-edited",
        timingSource,
      };
      // Complete original words remain in the immutable parent revision. Keep only evidence
      // wholly inside each new range, never reinterpret a crossing word as accurate alignment.
      if (segment.words) {
        left.words = segment.words.filter((word) => word.end <= time);
        right.words = segment.words.filter((word) => word.start >= time);
      }
      document.segments.splice(position, 1, left, right);
      break;
    }
  }
  return validateTranscriptDocument(document);
}
