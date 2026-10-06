import { describe, expect, it } from "vitest";
import {
  applyTranscriptCommand,
  joinTranscriptText,
  transcriptTextMatches,
  validateTranscriptCommand,
  validateTranscriptDocument,
  type TranscriptDocument,
} from "../src/index";

function transcript(): TranscriptDocument {
  return {
    id: "provider-original",
    assetId: "source",
    language: "zh",
    provenance: {
      providerId: "local",
      version: "1",
      model: "tiny",
      sourceHash: "source-hash",
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: [
      {
        id: "a",
        start: 0,
        end: 4,
        text: "十河田湖",
        words: [
          { start: 0, end: 2, text: "十河田", confidence: 0.8 },
          { start: 2, end: 4, text: "湖" },
        ],
      },
      { id: "b", start: 5, end: 7, text: "hello" },
      { id: "c", start: 7, end: 9, text: "world" },
    ],
  };
}

describe("portable transcript commands", () => {
  it("rejects blank and non-string IDs consistently at ingestion and command references", () => {
    for (const segmentId of [undefined, null, 12, "", " \n\t"]) {
      const original = transcript();
      original.segments[0]!.id = segmentId as never;
      expect(() => validateTranscriptDocument(original)).toThrow();
      expect(() =>
        validateTranscriptCommand({ type: "delete-segment", segmentId }),
      ).toThrow("segmentId");
    }
  });
  it.each(["provider-" + "x".repeat(300), "provider\u0000\nsegment"])(
    "edits opaque provider segment IDs without rewriting original identity: %j",
    (segmentId) => {
      const original = transcript();
      original.segments[0]!.id = segmentId;
      expect(validateTranscriptDocument(original).segments[0]!.id).toBe(
        segmentId,
      );
      const replaced = applyTranscriptCommand(original, {
        type: "replace-text",
        segmentId,
        text: "十和田湖",
      });
      expect(replaced.segments[0]).toMatchObject({
        id: segmentId,
        text: "十和田湖",
        alignmentState: "text-edited",
      });
      expect(
        applyTranscriptCommand(original, {
          type: "replace-match",
          segmentId,
          start: 1,
          end: 2,
          expected: "河",
          replacement: "和",
        }).segments[0]!.id,
      ).toBe(segmentId);
      const split = applyTranscriptCommand(original, {
        type: "split-segment",
        segmentId,
        newSegmentId: "new-safe-id",
        splitTime: 2,
        cursorOffset: 3,
      });
      expect(split.segments[0]!.id).toBe(segmentId);
      expect(
        applyTranscriptCommand(split, {
          type: "merge-segment",
          segmentId,
          direction: "next",
        }).segments[0]!.id,
      ).toBe(segmentId);
      expect(
        applyTranscriptCommand(original, {
          type: "delete-segment",
          segmentId,
        }).segments.map((segment) => segment.id),
      ).toEqual(["b", "c"]);
      expect(original.segments[0]!.id).toBe(segmentId);
      expect(original.segments[0]!.text).toBe("十河田湖");
      expect(() =>
        validateTranscriptCommand({
          type: "split-segment",
          segmentId,
          newSegmentId: segmentId,
          splitTime: 2,
        }),
      ).toThrow("newSegmentId");
    },
  );
  it("marks any changed text as stale, preserving original word evidence and provenance without mutating input", () => {
    const original = transcript();
    const edited = applyTranscriptCommand(original, {
      type: "replace-text",
      segmentId: "a",
      text: "十和田湖",
    });
    expect(edited.segments[0]).toMatchObject({
      text: "十和田湖",
      alignmentState: "text-edited",
      words: original.segments[0]!.words,
    });
    expect(edited.provenance).toEqual(original.provenance);
    expect(original.segments[0]!.text).toBe("十河田湖");
    edited.segments[0]!.words![0]!.text = "mutated";
    expect(original.segments[0]!.words![0]!.text).toBe("十河田");
    expect(
      applyTranscriptCommand(original, {
        type: "replace-text",
        segmentId: "b",
        text: "Hello",
      }).segments[1]!.alignmentState,
    ).toBe("text-edited");
    expect(
      applyTranscriptCommand(original, {
        type: "replace-text",
        segmentId: "b",
        text: "hello",
      }).segments[1]!.alignmentState,
    ).toBeUndefined();
  });
  it("splits using an explicit source playhead before any proportional text estimate", () => {
    const original = transcript();
    const edited = applyTranscriptCommand(original, {
      type: "split-segment",
      segmentId: "a",
      newSegmentId: "new",
      splitTime: 1.25,
      cursorOffset: 2,
    });
    expect(edited.segments.slice(0, 2)).toMatchObject([
      {
        id: "a",
        start: 0,
        end: 1.25,
        text: "十河",
        timingSource: "playhead",
        alignmentState: "text-edited",
        words: [],
      },
      {
        id: "new",
        start: 1.25,
        end: 4,
        text: "田湖",
        timingSource: "playhead",
        alignmentState: "text-edited",
        words: [{ start: 2, end: 4, text: "湖" }],
      },
    ]);
    expect(original.segments[0]!.words).toHaveLength(2);
  });
  it("uses original matching word boundaries for a cursor, but labels stale or unavailable mapping estimated", () => {
    const original = transcript();
    const boundary = applyTranscriptCommand(original, {
      type: "split-segment",
      segmentId: "a",
      newSegmentId: "new",
      cursorOffset: 2,
    });
    expect(boundary.segments[0]).toMatchObject({
      text: "十河田",
      end: 2,
      timingSource: "word-boundary",
      alignmentState: "text-edited",
    });
    const stale = applyTranscriptCommand(original, {
      type: "replace-text",
      segmentId: "a",
      text: "十和田湖",
    });
    const estimated = applyTranscriptCommand(stale, {
      type: "split-segment",
      segmentId: "a",
      newSegmentId: "new",
      cursorOffset: 2,
    });
    expect(estimated.segments[0]).toMatchObject({
      text: "十和",
      end: 2,
      timingSource: "estimated",
    });
    const latin = applyTranscriptCommand(original, {
      type: "split-segment",
      segmentId: "b",
      newSegmentId: "new",
      cursorOffset: 2,
    });
    expect(latin.segments[1]).toMatchObject({
      end: 5.8,
      timingSource: "estimated",
    });
  });
  it("merges neighboring segments with script-aware text spacing, union timing and conservative alignment", () => {
    const latin = applyTranscriptCommand(transcript(), {
      type: "merge-segment",
      segmentId: "c",
      direction: "previous",
    });
    expect(latin.segments).toHaveLength(2);
    expect(latin.segments[1]).toMatchObject({
      id: "b",
      start: 5,
      end: 9,
      text: "hello world",
      alignmentState: "text-edited",
    });
    const original = transcript();
    original.segments[1]!.text = "真美";
    const cjk = applyTranscriptCommand(original, {
      type: "merge-segment",
      segmentId: "a",
      direction: "next",
    });
    expect(cjk.segments[0]).toMatchObject({
      id: "a",
      start: 0,
      end: 7,
      text: "十河田湖真美",
      alignmentState: "text-edited",
    });
    expect(cjk.segments[0]!.words).toEqual(original.segments[0]!.words);
  });
  it("deletes only the selected transcript segment", () => {
    const original = transcript();
    const edited = applyTranscriptCommand(original, {
      type: "delete-segment",
      segmentId: "b",
    });
    expect(edited.segments.map((segment) => segment.id)).toEqual(["a", "c"]);
    expect(original.segments).toHaveLength(3);
  });
  it("applies literal replace-all deterministically across segments and preserves actual UTF-16 match offsets", () => {
    const original = transcript();
    original.segments[1]!.text = "YouTube youtube YOUTUBE";
    original.segments[2]!.text = "youtube";
    const edited = applyTranscriptCommand(original, {
      type: "replace-all",
      query: "youtube",
      replacement: "YouTube",
      caseSensitive: false,
    });
    expect(edited.segments[1]!.text).toBe("YouTube YouTube YouTube");
    expect(edited.segments[2]!.text).toBe("YouTube");
    expect(edited.segments[1]!.alignmentState).toBe("text-edited");
    expect(transcriptTextMatches("😀 a.b a.b", "a.b")).toEqual([
      { start: 3, end: 6 },
      { start: 7, end: 10 },
    ]);
    expect(
      transcriptTextMatches("ÅNGSTRÖM ångström", "ångström", false),
    ).toEqual([
      { start: 0, end: 8 },
      { start: 9, end: 17 },
    ]);
    expect(transcriptTextMatches("abc", "[a]")).toEqual([]);
  });
  it("rejects stale single-match offsets instead of applying replacement to different content", () => {
    expect(
      applyTranscriptCommand(transcript(), {
        type: "replace-match",
        segmentId: "a",
        start: 0,
        end: 3,
        expected: "十河田",
        replacement: "十和田",
      }).segments[0]!.text,
    ).toBe("十和田湖");
    expect(() =>
      applyTranscriptCommand(transcript(), {
        type: "replace-match",
        segmentId: "a",
        start: 0,
        end: 2,
        expected: "十和",
        replacement: "十河",
      }),
    ).toThrow("selected text changed");
  });
  it("rejects duplicate split IDs, invalid playheads, missing segments, empty edits, invalid Unicode and unknown command fields", () => {
    for (const command of [
      {
        type: "split-segment",
        segmentId: "a",
        newSegmentId: "b",
        splitTime: 2,
      },
      {
        type: "split-segment",
        segmentId: "a",
        newSegmentId: "new",
        splitTime: 0,
      },
      {
        type: "split-segment",
        segmentId: "a",
        newSegmentId: "new",
        splitTime: 4,
      },
      {
        type: "split-segment",
        segmentId: "a",
        newSegmentId: "new",
        cursorOffset: 4,
      },
      {
        type: "split-segment",
        segmentId: "a",
        newSegmentId: "new",
        cursorOffset: 0,
      },
      { type: "replace-text", segmentId: "missing", text: "valid" },
      { type: "replace-text", segmentId: "a", text: "" },
      { type: "replace-text", segmentId: "a", text: "\ud800" },
      {
        type: "replace-text",
        segmentId: "a",
        text: "text",
        timeline: "forbidden",
      },
      { type: "replace-all", query: "", replacement: "text" },
      { type: "merge-segment", segmentId: "a", direction: "previous" },
    ])
      expect(() =>
        applyTranscriptCommand(transcript(), command as never),
      ).toThrow();
    expect(() =>
      validateTranscriptCommand({
        type: "delete-segment",
        segmentId: "a",
        extra: true,
      }),
    ).toThrow("Unknown");
  });
  it("does not split a Unicode surrogate pair or claim invalid alignment state is portable", () => {
    const original = transcript();
    original.segments[0]!.text = "😀青森";
    delete original.segments[0]!.words;
    expect(() =>
      applyTranscriptCommand(original, {
        type: "split-segment",
        segmentId: "a",
        newSegmentId: "new",
        cursorOffset: 1,
      }),
    ).toThrow("Unicode boundary");
    original.segments[0]!.alignmentState = "accurate" as never;
    expect(() => validateTranscriptDocument(original)).toThrow(
      "alignmentState",
    );
  });
});
it.each([
  ["中文", "日本語", "中文日本語"],
  ["hello", "world", "hello world"],
  ["hello", ", world", "hello, world"],
  ["hello ", " world", "hello world"],
  ["こんにちは", "世界", "こんにちは世界"],
  ["こんにちは。", "世界", "こんにちは。世界"],
  ["我們說", "「你好」", "我們說「你好」"],
])("joins %s and %s as %s", (left, right, expected) =>
  expect(joinTranscriptText(left, right)).toBe(expected),
);
