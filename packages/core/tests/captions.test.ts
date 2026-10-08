import { describe, expect, it } from "vitest";
import {
  generateCompositionCaptions,
  CAPTION_LIMITS,
  type CaptionSource,
  type Composition,
  type TranscriptSegment,
} from "../src/index.js";

function fixture(segments?: TranscriptSegment[]): {
  composition: Composition;
  sources: CaptionSource[];
} {
  return {
    composition: {
      id: "film",
      storyId: "story",
      duration: 20,
      tracks: [
        {
          id: "dialogue",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: "source",
              sourceIn: 10,
              sourceOut: 18,
              timelineStart: 2,
              timelineDuration: 4,
              transform: { speed: 2 },
            },
          ],
        },
      ],
    },
    sources: [
      {
        asset: {
          id: "source",
          uri: "file:///memory.mp4",
          name: "memory.mp4",
          mediaType: "video",
          duration: 30,
          contentHash: "hash",
          metadata: {
            "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] },
          },
          state: {},
          tags: [],
        },
        available: true,
        transcriptRevisionId: "revision-2",
        transcript: {
          id: "transcript",
          assetId: "source",
          provenance: {
            providerId: "whisper",
            version: "1",
            sourceHash: "hash",
            createdAt: "2026-10-08T00:00:00Z",
          },
          segments: segments ?? [
            { id: "segment", start: 12, end: 16, text: "十和田湖 — Our trip" },
          ],
        },
      },
    ],
  };
}

function generate(value = fixture()) {
  return generateCompositionCaptions(value.composition, value.sources, {
    trackId: "dialogue",
  });
}

describe("composition-aware caption mapping", () => {
  it("maps source trims and positive speed into film time, preserving provenance and input evidence", () => {
    const value = fixture();
    const before = structuredClone(value);
    const result = generate(value);
    expect(result.cues).toEqual([
      expect.objectContaining({
        startMs: 3000,
        endMs: 5000,
        text: "十和田湖 — Our trip",
        clipId: "clip",
        assetId: "source",
        transcriptId: "transcript",
        transcriptRevisionId: "revision-2",
        segmentId: "segment",
        sourceIn: 12,
        sourceOut: 16,
      }),
    ]);
    expect(result.issues).toEqual([]);
    expect(value).toEqual(before);
  });

  it("maps repeated and split clip instances separately, preserving gaps and crossfade start times", () => {
    const value = fixture();
    value.composition.tracks[0]!.clips.push({
      id: "repeat",
      assetId: "source",
      sourceIn: 12,
      sourceOut: 16,
      timelineStart: 10,
      timelineDuration: 4,
      transition: { type: "crossfade", duration: 1 },
    });
    const result = generate(value);
    expect(
      result.cues.map((cue) => [cue.clipId, cue.startMs, cue.endMs]),
    ).toEqual([
      ["clip", 3000, 5000],
      ["repeat", 10000, 14000],
    ]);
    expect(new Set(result.cues.map((cue) => cue.id)).size).toBe(2);
  });

  it("omits every partial segment without guessing retained words, even with original word timings", () => {
    const value = fixture([
      {
        id: "left",
        start: 9,
        end: 12,
        text: "cut retained",
        words: [
          { start: 9, end: 10, text: "cut" },
          { start: 10, end: 12, text: "retained" },
        ],
      },
      { id: "inside", start: 12, end: 16, text: "kept" },
      { id: "right", start: 16, end: 20, text: "retained cut" },
      { id: "outside", start: 21, end: 22, text: "not in film" },
    ]);
    const result = generate(value);
    expect(result.cues.map((cue) => cue.text)).toEqual(["kept"]);
    expect(
      result.issues
        .filter((issue) => issue.code === "PARTIAL_SEGMENT")
        .map((issue) => issue.segmentId),
    ).toEqual(["left", "right"]);
  });

  it.each(["text-edited", "unknown"])(
    "keeps segment timing but warns for %s alignment without rewriting evidence",
    (alignment) => {
      const value = fixture();
      value.sources[0]!.transcript!.segments[0]!.alignmentState =
        alignment as never;
      const result = generate(value);
      expect(result.cues[0]).toMatchObject({ startMs: 3000, endMs: 5000 });
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: "ALIGNMENT_STALE",
          segmentId: "segment",
        }),
      );
      expect(value.sources[0]!.transcript!.segments[0]!.alignmentState).toBe(
        alignment,
      );
    },
  );

  it("locates omitted partial segments after speed mapping and repeated clip gaps", () => {
    const value = fixture([
      { id: "left", start: 9, end: 12, text: "left trim" },
      { id: "right", start: 16, end: 20, text: "right trim" },
    ]);
    value.composition.tracks[0]!.clips.push({
      ...value.composition.tracks[0]!.clips[0]!,
      id: "repeat",
      timelineStart: 10,
    });
    expect(
      generate(value)
        .issues.filter((issue) => issue.code === "PARTIAL_SEGMENT")
        .map((issue) => [
          issue.clipId,
          issue.segmentId,
          issue.startMs,
          issue.endMs,
        ]),
    ).toEqual([
      ["clip", "left", 2000, 3000],
      ["clip", "right", 5000, 6000],
      ["repeat", "left", 10000, 11000],
      ["repeat", "right", 13000, 14000],
    ]);
  });

  it("rounds partial-hole positions inward and omits impossible submillisecond intervals", () => {
    const value = fixture([
      { id: "partial", start: 9, end: 10.0043, text: "part" },
    ]);
    value.composition.tracks[0]!.clips[0]!.timelineStart = 2.0002;
    expect(generate(value).issues[0]).toMatchObject({
      code: "PARTIAL_SEGMENT",
      startMs: 2001,
      endMs: 2002,
    });
    value.sources[0]!.transcript!.segments[0]!.end = 10.0004;
    const noMillisecond = generate(value).issues[0]!;
    expect(noMillisecond.code).toBe("PARTIAL_SEGMENT");
    expect(noMillisecond).not.toHaveProperty("startMs");
    expect(noMillisecond).not.toHaveProperty("endMs");
  });

  it("reveals estimated segment timing and leaves realigned timing alone", () => {
    const value = fixture();
    Object.assign(value.sources[0]!.transcript!.segments[0]!, {
      alignmentState: "realigned",
      timingSource: "estimated",
    });
    expect(generate(value).issues.map((issue) => issue.code)).toEqual([
      "TIMING_ESTIMATED",
    ]);
  });

  it("rounds inward to milliseconds, drops zero rounded intervals and caps the film boundary", () => {
    const value = fixture([
      { id: "fraction", start: 0.0002, end: 1.001, text: "one" },
      { id: "tiny", start: 1.0012, end: 1.0018, text: "tiny" },
      { id: "last", start: 1.002, end: 2.0007, text: "last" },
    ]);
    value.composition.duration = 2.0007;
    Object.assign(value.composition.tracks[0]!.clips[0]!, {
      sourceIn: 0,
      sourceOut: 2.0007,
      timelineStart: 0,
      timelineDuration: 2.0007,
      transform: { speed: 1 },
    });
    const result = generate(value);
    expect(result.cues.map((cue) => [cue.startMs, cue.endMs])).toEqual([
      [1, 1001],
      [1002, 2000],
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "ZERO_DURATION", segmentId: "tiny" }),
    );
  });

  it("normalizes zero to remain identical through JSON snapshot persistence", () => {
    const value = fixture([{ id: "zero", start: 0, end: 1, text: "start" }]);
    Object.assign(value.composition.tracks[0]!.clips[0]!, {
      sourceIn: 0,
      sourceOut: 1,
      timelineStart: 0,
      timelineDuration: 1,
      transform: { speed: 1 },
    });
    const mapped = generate(value);
    expect(Object.is(mapped.cues[0]!.startMs, -0)).toBe(false);
    expect(JSON.parse(JSON.stringify(mapped))).toEqual(mapped);
  });

  it("retains overlapping cues and reports their overlapping interval", () => {
    const result = generate(
      fixture([
        { id: "a", start: 12, end: 16, text: "first" },
        { id: "b", start: 14, end: 17, text: "second" },
      ]),
    );
    expect(result.cues).toHaveLength(2);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "OVERLAP", startMs: 4000, endMs: 5000 }),
    );
  });

  it.each([0, -1, NaN, Infinity])(
    "blocks unsupported fixed speed %s",
    (speed) => {
      const value = fixture();
      value.composition.tracks[0]!.clips[0]!.transform!.speed = speed;
      expect(generate(value)).toMatchObject({
        cues: [],
        issues: [
          expect.objectContaining({
            code: "TIMING_UNSUPPORTED",
            severity: "error",
          }),
        ],
      });
    },
  );

  it.each([
    "duration-mismatch",
    "beyond-source",
    "beyond-film",
    "negative-source",
    "overflow",
  ])("blocks invalid timing: %s", (reason) => {
    const value = fixture();
    const clip = value.composition.tracks[0]!.clips[0]!;
    if (reason === "duration-mismatch") clip.sourceOut = 17;
    if (reason === "beyond-source") value.sources[0]!.asset.duration = 15;
    if (reason === "beyond-film") value.composition.duration = 4;
    if (reason === "negative-source") clip.sourceIn = -2;
    if (reason === "overflow") value.composition.duration = Number.MAX_VALUE;
    const result = generate(value);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "TIMING_UNSUPPORTED",
        severity: "error",
      }),
    );
    for (const issue of result.issues.filter(
      (issue) => issue.code === "TIMING_UNSUPPORTED",
    )) {
      expect(issue).not.toHaveProperty("startMs");
      expect(issue).not.toHaveProperty("endMs");
    }
  });

  it.each([
    "missing",
    "unavailable",
    "missing-transcript",
    "missing-revision",
    "stale-source",
    "muted",
  ])("explains skipped material: %s", (reason) => {
    const value = fixture();
    const expected: Record<string, string> = {
      missing: "SOURCE_UNAVAILABLE",
      unavailable: "SOURCE_UNAVAILABLE",
      "missing-transcript": "TRANSCRIPT_MISSING",
      "missing-revision": "TRANSCRIPT_STALE",
      "stale-source": "TRANSCRIPT_STALE",
      muted: "MUTED_CLIP",
    };
    if (reason === "missing") value.sources = [];
    if (reason === "unavailable") value.sources[0]!.available = false;
    if (reason === "missing-transcript") delete value.sources[0]!.transcript;
    if (reason === "missing-revision")
      delete value.sources[0]!.transcriptRevisionId;
    if (reason === "stale-source")
      value.sources[0]!.transcript!.provenance.sourceHash = "old";
    if (reason === "muted")
      value.composition.tracks[0]!.clips[0]!.transform!.volume = 0;
    const result = generate(value);
    expect(result.cues).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: expected[reason],
        startMs: 2000,
        endMs: 6000,
      }),
    );
  });

  it("requires one explicit supported track and never mixes other audio tracks", () => {
    const value = fixture();
    value.composition.tracks.push({
      id: "narration",
      type: "audio",
      clips: [
        { ...value.composition.tracks[0]!.clips[0]!, id: "narration-clip" },
      ],
    });
    expect(generate(value).cues.map((cue) => cue.clipId)).toEqual(["clip"]);
    expect(
      generateCompositionCaptions(value.composition, value.sources, {
        trackId: "missing",
      }).issues[0]!.code,
    ).toBe("TRACK_UNSUPPORTED");
    value.composition.tracks[0]!.type = "music";
    expect(generate(value).issues[0]!.code).toBe("MUSIC_SOURCE");
    value.composition.tracks[0]!.type = "titles";
    expect(generate(value).issues[0]!.code).toBe("TRACK_UNSUPPORTED");
  });

  it("omits blank text, blocks invalid Unicode/control characters and reports escaping", () => {
    const result = generate(
      fixture([
        { id: "empty", start: 12, end: 13, text: " \t\n" },
        { id: "nul", start: 13, end: 14, text: "hello\u0000world" },
        { id: "surrogate", start: 14, end: 15, text: "\ud800" },
        {
          id: "markup",
          start: 15,
          end: 16,
          text: "<b>青森 & A --> B</b>\r\n\r\n日本語 😀",
        },
      ]),
    );
    expect(result.cues.map((cue) => cue.segmentId)).toEqual(["markup"]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "EMPTY_TEXT",
      "INVALID_TEXT",
      "INVALID_TEXT",
      "TEXT_ESCAPED",
    ]);
  });

  it("warns only for text requiring WebVTT, not ordinary ampersands, arrows or line breaks", () => {
    expect(
      generate(
        fixture([
          { id: "safe", start: 12, end: 14, text: "A & B --> C\r\n\r\n青森" },
        ]),
      ).issues,
    ).toEqual([]);
    expect(
      generate(
        fixture([
          {
            id: "cue-like",
            start: 12,
            end: 14,
            text: "00:00:01,000 --> 00:00:03,000",
          },
        ]),
      ).issues,
    ).toContainEqual(expect.objectContaining({ code: "TEXT_ESCAPED" }));
  });

  it("rejects ambiguous duplicate input identities and invalid segment timing", () => {
    const value = fixture();
    value.composition.tracks[0]!.clips.push({
      ...value.composition.tracks[0]!.clips[0]!,
    });
    expect(generate(value).issues).toContainEqual(
      expect.objectContaining({
        code: "TIMING_UNSUPPORTED",
        severity: "error",
      }),
    );
    const invalid = fixture([{ id: "bad", start: 13, end: 12, text: "bad" }]);
    expect(generate(invalid).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_SEGMENT", severity: "error" }),
    );
  });

  it("omits video without renderer-audible audio but supports standalone audio", () => {
    const value = fixture();
    value.sources[0]!.asset.metadata = {};
    expect(generate(value)).toMatchObject({
      cues: [],
      issues: [
        expect.objectContaining({
          code: "MEDIA_UNSUPPORTED",
          params: { reason: "no-audio-stream" },
        }),
      ],
    });
    value.sources[0]!.asset.mediaType = "audio";
    expect(generate(value).cues).toHaveLength(1);
  });

  it.each(["video", "audio", "music"] as const)(
    "does not treat an audible 360 source as renderable on a %s track",
    (trackType) => {
      const value = fixture();
      value.composition.tracks[0]!.type = trackType;
      const asset = value.sources[0]!.asset;
      asset.mediaType = "360-video";
      // Neither audio evidence nor an existing transcript bypasses the
      // renderer's unconditional requirement to import a reframed flat export.
      asset.metadata["openfilm.preview"] = { supported: true };
      const before = structuredClone(value);
      expect(generate(value)).toMatchObject({
        cues: [],
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "MEDIA_UNSUPPORTED",
            clipId: "clip",
            assetId: "source",
            startMs: 2000,
            endMs: 6000,
          }),
        ]),
      });
      expect(value).toEqual(before);
    },
  );

  it.each(["video", "audio", "music"] as const)(
    "maps an audible reframed flat export from an Insta360 source on a %s track",
    (trackType) => {
      const value = fixture();
      value.composition.tracks[0]!.type = trackType;
      Object.assign(value.sources[0]!.asset.metadata, {
        "openfilm.preview": { supported: true },
        "openfilm.insta360": {
          level: 1,
          requiresReframedExport: false,
          original360Sources: ["file:///original.insv"],
        },
      });
      const result = generate(value);
      expect(result.cues).toEqual([
        expect.objectContaining({
          startMs: 3000,
          endMs: 5000,
          transcriptRevisionId: "revision-2",
          text: "十和田湖 — Our trip",
        }),
      ]);
      expect(
        result.issues.some((issue) => issue.code === "MEDIA_UNSUPPORTED"),
      ).toBe(false);
    },
  );

  it.each([null, { streams: {} }, { streams: [null, "invalid"] }])(
    "reports malformed audio metadata without crashing the preview: %j",
    (probe) => {
      const value = fixture();
      value.sources[0]!.asset.metadata["openfilm.ffprobe"] = probe;
      expect(generate(value)).toMatchObject({
        cues: [],
        issues: [expect.objectContaining({ code: "MEDIA_UNSUPPORTED" })],
      });
    },
  );

  it("bounds clip and transcript sizes before traversing them", () => {
    const value = fixture();
    value.composition.tracks[0]!.clips = Array.from(
      { length: CAPTION_LIMITS.clips + 1 },
      (_, index) => ({
        ...value.composition.tracks[0]!.clips[0]!,
        id: `clip-${index}`,
      }),
    );
    expect(generate(value)).toMatchObject({
      cues: [],
      issues: [
        expect.objectContaining({ code: "LIMIT_EXCEEDED", severity: "error" }),
      ],
    });
    const oversized = fixture();
    oversized.sources[0]!.transcript!.segments = Array.from(
      { length: CAPTION_LIMITS.segments + 1 },
      (_, index) => ({
        id: `segment-${index}`,
        start: 12,
        end: 13,
        text: "text",
      }),
    );
    expect(generate(oversized)).toMatchObject({
      cues: [],
      issues: [
        expect.objectContaining({ code: "LIMIT_EXCEEDED", severity: "error" }),
      ],
    });
  });
});
