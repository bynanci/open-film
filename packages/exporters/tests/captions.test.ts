import { describe, expect, it } from "vitest";
import type { CaptionCue } from "@openfilm/core";
import { serializeCaptions } from "../src/index.js";

function cue(overrides: Partial<CaptionCue> = {}): CaptionCue {
  return {
    id: "cue",
    startMs: 1234,
    endMs: 5678,
    text: "十和田湖\nOur trip 😀",
    clipId: "clip",
    assetId: "source",
    transcriptId: "transcript",
    transcriptRevisionId: "revision",
    segmentId: "segment",
    sourceIn: 1.234,
    sourceOut: 5.678,
    ...overrides,
  };
}

describe("caption serializers", () => {
  it("serializes millisecond SRT with sequential identifiers and Unicode", () => {
    expect(serializeCaptions("srt", [cue()])).toEqual({
      extension: "srt",
      mediaType: "application/x-subrip; charset=utf-8",
      content: "1\n00:00:01,234 --> 00:00:05,678\n十和田湖\nOur trip 😀\n\n",
    });
  });
  it("serializes WebVTT with a required header and exact non-wrapping hour times", () => {
    expect(
      serializeCaptions("vtt", [cue({ startMs: 3600000, endMs: 3600001 })])
        .content,
    ).toBe(
      "WEBVTT\n\n1\n01:00:00.000 --> 01:00:00.001\n十和田湖\nOur trip 😀\n\n",
    );
  });
  it("WebVTT preserves plain text meaning without injecting markup or cue blocks", () => {
    const text =
      "<b>A & B</b> --> C\r\n\r\n2\r\n00:00:10.000 --> 00:00:20.000\n日本語";
    const content = serializeCaptions("vtt", [cue({ text })]).content;
    expect(content).toContain(
      "&lt;b&gt;A &amp; B&lt;/b&gt; --&gt; C\n&nbsp;\n2\n00:00:10.000 --&gt; 00:00:20.000\n日本語",
    );
    expect(content).not.toContain("<b>");
    expect(content).not.toContain("\r");
  });
  it("preserves literal ampersands and ordinary arrows in SubRip", () => {
    expect(
      serializeCaptions("srt", [cue({ text: "A & B --> C\r\n\r\n青森" })])
        .content,
    ).toContain("A & B --> C\n\u00a0\n青森");
  });
  it.each([
    "<b>bold</b>",
    "<literal>",
    "{\\an8}",
    "C:\\Media",
    "literal {braces}",
    "before\n00:00:10,000 --> 00:00:20,000\nafter",
    "before\n\n00:00:10.000 --> 00:00:20.000\nafter",
    "+00:00:05,000 --> 00:00:06,000",
    "00:+00:05,000 --> 00:00:06,000",
    "00:00:+05,000 --> 00:00:06,000",
    "00:00:05,+000 --> 00:00:06,000",
  ])(
    "rejects SubRip-interpreted text with an actionable WebVTT fallback: %j",
    (text) => {
      expect(() => serializeCaptions("srt", [cue({ text })])).toThrow(
        expect.objectContaining({ code: "captions.srtTextUnsupported" }),
      );
      expect(serializeCaptions("vtt", [cue({ text })]).content).toContain(
        "WEBVTT",
      );
    },
  );
  it("retains overlapping cues in stable input order", () => {
    const content = serializeCaptions("srt", [
      cue(),
      cue({ id: "second", text: "overlap", startMs: 2000, endMs: 4000 }),
    ]).content;
    expect(content).toContain("2\n00:00:02,000 --> 00:00:04,000\noverlap\n\n");
  });
  it.each([NaN, -1, 1.5, Number.MAX_VALUE])(
    "rejects unsafe serializer timestamps: %s",
    (startMs) => {
      expect(() => serializeCaptions("srt", [cue({ startMs })])).toThrow();
    },
  );
  it.each(["", " \n", "bad\u0000text", "\udfff"])(
    "rejects unsafe text rather than silently producing corrupt output: %j",
    (text) => {
      expect(() => serializeCaptions("vtt", [cue({ text })])).toThrow();
    },
  );
  it("refuses empty, zero-duration, reversed, unsorted and unknown-format output", () => {
    expect(() => serializeCaptions("srt", [])).toThrow();
    expect(() => serializeCaptions("vtt", [cue({ endMs: 1234 })])).toThrow();
    expect(() => serializeCaptions("vtt", [cue({ endMs: 1233 })])).toThrow();
    expect(() =>
      serializeCaptions("vtt", [cue(), cue({ startMs: 0 })]),
    ).toThrow();
    expect(() => serializeCaptions("ass" as never, [cue()])).toThrow();
  });
});
