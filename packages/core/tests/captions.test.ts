import { describe, expect, it } from "vitest";
import {
  generateCompositionCaptions,
  captionAssetState,
  validateComposition,
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
  it("captures mapper-relevant source metadata in a JSON-stable canonical state", () => {
    const asset = fixture().sources[0]!.asset;
    expect(captionAssetState(asset)).toEqual({
      name: "memory.mp4",
      mediaType: "video",
      duration: 30,
      previewBlocked: false,
      hasAudio: true,
    });
    delete asset.duration;
    const absent = captionAssetState(asset);
    expect(absent.duration).toBe("absent");
    for (const duration of [null, NaN, Infinity, "30"]) {
      asset.duration = duration as never;
      const state = captionAssetState(asset);
      expect(state.duration).toBe("invalid");
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      expect(state).not.toEqual(absent);
    }
    asset.duration = -0;
    expect(Object.is(captionAssetState(asset).duration, -0)).toBe(false);
    asset.metadata["openfilm.preview"] = { supported: false };
    asset.metadata["openfilm.ffprobe"] = { streams: [{ codec_type: "video" }] };
    expect(captionAssetState(asset)).toMatchObject({
      previewBlocked: true,
      hasAudio: false,
    });
    asset.mediaType = "audio";
    expect(captionAssetState(asset)).toMatchObject({
      previewBlocked: true,
      hasAudio: true,
    });
  });
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

  it.each([0.5, 1, 2])(
    "clamps an omitted source out to available media and leaves padded silence uncaptioned at %sx",
    (speed) => {
      const value = fixture([
        { id: "kept", start: 12, end: 14, text: "Heard words" },
        { id: "partial", start: 14, end: 16, text: "Partly beyond source" },
        { id: "outside", start: 16, end: 17, text: "Not in source audio" },
      ]);
      const clip = value.composition.tracks[0]!.clips[0]!;
      clip.timelineDuration = 8 / speed;
      clip.transform!.speed = speed;
      delete clip.sourceOut;
      value.sources[0]!.asset.duration = 15;
      const before = structuredClone(value);
      const mapped = generate(value);
      expect(mapped.cues).toEqual([
        expect.objectContaining({
          segmentId: "kept",
          startMs: (2 + 2 / speed) * 1000,
          endMs: (2 + 4 / speed) * 1000,
        }),
      ]);
      expect(mapped.issues).toEqual([
        expect.objectContaining({
          code: "PARTIAL_SEGMENT",
          segmentId: "partial",
          startMs: (2 + 4 / speed) * 1000,
          endMs: (2 + 5 / speed) * 1000,
          params: { sourceIn: 14, sourceOut: 15 },
        }),
      ]);
      expect(
        mapped.cues.every((cue) => cue.endMs <= (2 + 5 / speed) * 1000),
      ).toBe(true);
      expect(value).toEqual(before);
    },
  );

  it("keeps omitted source out nominal when it already fits or source duration is absent", () => {
    const value = fixture();
    delete value.composition.tracks[0]!.clips[0]!.sourceOut;
    const within = generate(value);
    expect(within).toMatchObject({
      cues: [expect.objectContaining({ startMs: 3000, endMs: 5000 })],
      issues: [],
    });
    delete value.sources[0]!.asset.duration;
    expect(generate(value)).toEqual(within);
  });

  it.each([0, -1, NaN, Infinity, 9, 10])(
    "does not invent an inferred source range for invalid/empty available duration %s",
    (duration) => {
      const value = fixture();
      delete value.composition.tracks[0]!.clips[0]!.sourceOut;
      value.sources[0]!.asset.duration = duration;
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

  it("keeps explicit out-of-range source bounds blocked instead of silently clamping the user's trim", () => {
    const value = fixture();
    value.sources[0]!.asset.duration = 15;
    expect(generate(value)).toMatchObject({
      cues: [],
      issues: [
        expect.objectContaining({
          code: "TIMING_UNSUPPORTED",
          params: { reason: "source-duration" },
        }),
      ],
    });
    expect(value.composition.tracks[0]!.clips[0]!.sourceOut).toBe(18);
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

  it.each(["video", "audio"] as const)(
    "respects an explicit preview block on an otherwise audible %s source",
    (mediaType) => {
      const value = fixture();
      const asset = value.sources[0]!.asset;
      asset.mediaType = mediaType;
      asset.metadata["openfilm.preview"] = {
        supported: false,
        reason: "Requires a supported source export",
      };
      const before = structuredClone(value);
      expect(generate(value)).toMatchObject({
        cues: [],
        issues: [
          expect.objectContaining({
            code: "MEDIA_UNSUPPORTED",
            params: { reason: "preview-disabled" },
            startMs: 2000,
            endMs: 6000,
          }),
        ],
      });
      expect(value).toEqual(before);
      asset.metadata["openfilm.preview"] = { supported: true };
      expect(generate(value).cues).toHaveLength(1);
    },
  );

  it.each([1.25, 2, 100])(
    "accepts project-valid non-muted volume gain %s",
    (volume) => {
      const value = fixture();
      value.composition.tracks[0]!.clips[0]!.transform!.volume = volume;
      expect(validateComposition(value.composition)).toEqual(value.composition);
      expect(generate(value)).toMatchObject({
        cues: [expect.objectContaining({ startMs: 3000, endMs: 5000 })],
        issues: [],
      });
    },
  );

  it.each([-1, NaN, Infinity])(
    "continues rejecting invalid volume %s",
    (volume) => {
      const value = fixture();
      value.composition.tracks[0]!.clips[0]!.transform!.volume = volume;
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

  it("accepts the project validator's clip-end tolerance while clamping final cues to the film", () => {
    const value = fixture([
      { id: "last", start: 12, end: 18.0000001, text: "Final words" },
    ]);
    Object.assign(value.composition.tracks[0]!.clips[0]!, {
      timelineStart: 16,
      timelineDuration: 4.00000005,
      sourceOut: 18.0000001,
    });
    expect(validateComposition(value.composition)).toEqual(value.composition);
    expect(generate(value)).toMatchObject({
      cues: [expect.objectContaining({ startMs: 17000, endMs: 20000 })],
      issues: [],
    });
    Object.assign(value.composition.tracks[0]!.clips[0]!, {
      timelineDuration: 4.0000002,
      sourceOut: 18.0000004,
    });
    value.sources[0]!.transcript!.segments[0]!.end = 18.0000004;
    expect(() => validateComposition(value.composition)).toThrow(
      "clip extends beyond",
    );
    expect(generate(value)).toMatchObject({
      cues: [],
      issues: [
        expect.objectContaining({
          code: "TIMING_UNSUPPORTED",
          severity: "error",
        }),
      ],
    });
  });

  it.each([
    { duration: 1.01, frameRate: 30, end: 1 },
    { duration: 1.02, frameRate: 30000 / 1001, end: 1.001 },
  ])(
    "omits whole and partial segments cut by the encoded frame boundary at $frameRate fps",
    ({ duration, frameRate, end }) => {
      const value = fixture([
        { id: "kept", start: 0, end, text: "Complete sentence" },
        {
          id: "partial",
          start: end - 0.05,
          end: duration,
          text: "Partially cut sentence",
        },
        { id: "tail", start: end, end: duration, text: "Outside output" },
      ]);
      value.composition.duration = duration;
      Object.assign(value.composition.tracks[0]!.clips[0]!, {
        timelineStart: 0,
        timelineDuration: duration,
        sourceIn: 0,
        sourceOut: duration,
        transform: { speed: 1 },
      });
      const before = structuredClone(value);
      const mapped = generateCompositionCaptions(
        value.composition,
        value.sources,
        { trackId: "dialogue", frameRate },
      );
      expect(mapped.cues).toEqual([
        expect.objectContaining({
          segmentId: "kept",
          startMs: 0,
          endMs: Math.round(end * 1000),
        }),
      ]);
      expect(mapped.issues).toContainEqual(
        expect.objectContaining({
          code: "PARTIAL_SEGMENT",
          segmentId: "partial",
          params: expect.objectContaining({ reason: "output-tail" }),
        }),
      );
      expect(mapped.issues).toContainEqual(
        expect.objectContaining({
          code: "ZERO_DURATION",
          segmentId: "tail",
          params: { reason: "output-tail" },
        }),
      );
      expect(mapped.issues.some((issue) => issue.severity === "error")).toBe(
        false,
      );
      expect(value).toEqual(before);
      expect(generate(value).cues).toHaveLength(3);
    },
  );

  it.each([0, -1, NaN, Infinity])(
    "reports an invalid caption frame rate: %s",
    (frameRate) => {
      const value = fixture();
      expect(
        generateCompositionCaptions(value.composition, value.sources, {
          trackId: "dialogue",
          frameRate,
        }),
      ).toMatchObject({
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

  it("rejects an output shorter than one frame without changing the nominal composition", () => {
    const value = fixture();
    value.composition.duration = 0.01;
    Object.assign(value.composition.tracks[0]!.clips[0]!, {
      timelineStart: 0,
      timelineDuration: 0.01,
      sourceIn: 0,
      sourceOut: 0.01,
      transform: { speed: 1 },
    });
    expect(
      generateCompositionCaptions(value.composition, value.sources, {
        trackId: "dialogue",
        frameRate: 30,
      }),
    ).toMatchObject({
      cues: [],
      issues: [
        expect.objectContaining({
          code: "TIMING_UNSUPPORTED",
          params: { reason: "frame-duration" },
        }),
      ],
    });
    expect(value.composition.duration).toBe(0.01);
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
