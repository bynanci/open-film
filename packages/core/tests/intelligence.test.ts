import { describe, expect, it } from "vitest";
import {
  validateAnalysisProvenance,
  validateTranscriptDocument,
  validateWaveformData,
  validateTimelineMarker,
  validateSceneAnalysis,
  type TranscriptDocument,
  type TimelineMarker,
} from "../src/index.js";

const provenance = {
  providerId: "local-test",
  version: "1",
  sourceHash: "sha256:source",
  createdAt: "2026-10-06T00:00:00Z",
};

function transcript(): TranscriptDocument {
  return {
    id: "transcript",
    assetId: "video",
    language: "ja",
    provenance: {
      ...provenance,
      model: "tiny",
      providerVersion: "faster-whisper-1.2.0",
    },
    segments: [
      {
        id: "one",
        start: 0.2,
        end: 1.4,
        text: "私たちの物語",
        words: [
          { start: 0.2, end: 0.6, text: "私たち", confidence: 0.92 },
          { start: 0.6, end: 1.4, text: "の物語" },
        ],
      },
      { id: "two", start: 2, end: 3.1, text: "Next memory" },
    ],
  };
}

const marker: TimelineMarker = {
  id: "scene-1",
  assetId: "video",
  type: "scene-cut",
  time: 1.4,
  confidence: 0.8,
  metadata: { score: 0.42, notes: ["Generated fixture"] },
};

describe("portable media intelligence validation", () => {
  it("retains timed words, provenance and silence across JSON serialization without aliasing", () => {
    const input = transcript();
    const saved = validateTranscriptDocument(input, { duration: 4 });
    expect(
      validateTranscriptDocument(JSON.parse(JSON.stringify(saved))),
    ).toEqual(input);
    saved.segments[0]!.words![0]!.text = "Edited";
    saved.provenance.model = "different-model";
    expect(input.segments[0]!.words![0]!.text).toBe("私たち");
    expect(input.provenance.model).toBe("tiny");
    expect(
      validateTranscriptDocument({ ...input, segments: [] }),
    ).toMatchObject({ segments: [] });
  });

  it.each([-1, Infinity, NaN])("rejects invalid source seconds %s", (start) => {
    const input = transcript();
    input.segments[0]!.start = start;
    expect(() => validateTranscriptDocument(input)).toThrow(
      "segments[0].start",
    );
  });

  it("checks source duration, segment identity/order and word containment/confidence", () => {
    expect(() =>
      validateTranscriptDocument(transcript(), { duration: 3 }),
    ).toThrow("segments[1].end");
    const duplicate = transcript();
    duplicate.segments[1]!.id = "one";
    expect(() => validateTranscriptDocument(duplicate)).toThrow("unique");
    const unordered = transcript();
    unordered.segments.reverse();
    expect(() => validateTranscriptDocument(unordered)).toThrow(
      "segments[1].start",
    );
    const word = transcript();
    word.segments[0]!.words![0]!.start = 0;
    expect(() => validateTranscriptDocument(word)).toThrow("words[0].start");
    word.segments[0]!.words![0]!.start = 0.2;
    word.segments[0]!.words![0]!.end = 2;
    expect(() => validateTranscriptDocument(word)).toThrow("words[0].end");
    word.segments[0]!.words![0]!.end = 0.6;
    word.segments[0]!.words![0]!.confidence = 1.1;
    expect(() => validateTranscriptDocument(word)).toThrow("confidence");
    expect(() =>
      validateTranscriptDocument(transcript(), { duration: NaN }),
    ).toThrow("source.duration");
  });

  it("accepts zero-length timed punctuation, preserves whitespace and rejects sparse words", () => {
    const input = transcript();
    input.segments[0]!.words![1] = { start: 0.6, end: 0.6, text: " 物語" };
    expect(validateTranscriptDocument(input).segments[0]!.words![1]!.text).toBe(
      " 物語",
    );
    delete input.segments[0]!.words![0];
    expect(() => validateTranscriptDocument(input)).toThrow("sparse");
  });

  it("requires source identity, version and unambiguous valid provenance dates", () => {
    expect(
      validateAnalysisProvenance({
        ...provenance,
        createdAt: "2024-02-29T10:00:00+09:00",
      }),
    ).toMatchObject({ version: "1" });
    for (const patch of [
      { sourceHash: "" },
      { version: "" },
      { providerVersion: "" },
      { createdAt: "2026-10-06" },
      { createdAt: "2026-02-30T00:00:00Z" },
      { createdAt: "2026-10-06T25:00:00Z" },
    ])
      expect(() =>
        validateAnalysisProvenance({ ...provenance, ...patch }),
      ).toThrow();
  });

  it("validates normalized cached waveform bins and detached snapshots", () => {
    const input = {
      assetId: "audio",
      duration: 2,
      sampleRate: 2.5,
      peaks: [0, 0.5, 1],
      provenance,
    };
    const saved = validateWaveformData(input);
    saved.peaks[0] = 0.5;
    expect(input.peaks[0]).toBe(0);
    for (const patch of [
      { duration: 0 },
      { sampleRate: -1 },
      { peaks: [] },
      { peaks: [1.1] },
      { peaks: [NaN] },
    ])
      expect(() => validateWaveformData({ ...input, ...patch })).toThrow();
  });

  it("validates source-specific scene markers and safely copies marker metadata", () => {
    const saved = validateTimelineMarker(marker, {
      duration: 2,
      assetId: "video",
    });
    (saved.metadata!.notes as string[]).push("Edited note");
    expect(marker.metadata!.notes).toEqual(["Generated fixture"]);
    expect(() => validateTimelineMarker(marker, { duration: 1 })).toThrow(
      "marker.time",
    );
    expect(() => validateTimelineMarker(marker, { assetId: "other" })).toThrow(
      "assetId",
    );
    const scene = { assetId: "video", markers: [marker], provenance };
    expect(validateSceneAnalysis(scene, { duration: 2 }).markers).toHaveLength(
      1,
    );
    expect(validateSceneAnalysis({ ...scene, markers: [] }).markers).toEqual(
      [],
    );
    expect(() =>
      validateSceneAnalysis({ ...scene, markers: [marker, marker] }),
    ).toThrow("unique");
    expect(() =>
      validateSceneAnalysis({
        ...scene,
        markers: [{ ...marker, type: "manual" }],
      }),
    ).toThrow("scene-cut");
  });

  it("rejects cyclic, non-JSON, non-finite and class-backed marker metadata", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const metadata of [
      cyclic,
      { confidence: Infinity },
      { run: () => 0 },
      { binary: new Uint8Array([1]) },
    ])
      expect(() => validateTimelineMarker({ ...marker, metadata })).toThrow();
    expect(() =>
      validateTimelineMarker({ ...marker, type: "subtitle" }),
    ).toThrow("type");
  });
});
