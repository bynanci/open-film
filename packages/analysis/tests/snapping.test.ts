import { describe, expect, it } from "vitest";
import type { TimelineMarker, TranscriptDocument } from "@openfilm/core";
import {
  candidatesFromIntelligence,
  snapTime,
  type SnapCandidate,
} from "../src/index.js";

const candidates: SnapCandidate[] = [
  { id: "scene", time: 3, type: "scene-cut", priority: 80 },
  { id: "marker", time: 4, type: "manual", priority: 100 },
  { id: "word", time: 5, type: "word", priority: 40 },
];

describe("generic source-time snapping", () => {
  it("chooses the nearest scene, marker or word within a source-time threshold", () => {
    for (const [time, expected] of [
      [3.1, "scene"],
      [3.95, "marker"],
      [5.1, "word"],
    ] as const) {
      const result = snapTime(time, candidates, { threshold: 0.2 });
      expect(result.snapped).toBe(true);
      expect(result.candidate!.id).toBe(expected);
      expect(result.candidate!.distance).toBeCloseTo(
        Math.abs(time - result.time),
      );
    }
    expect(snapTime(2.5, candidates, { threshold: 0.2 })).toEqual({
      time: 2.5,
      snapped: false,
    });
    expect(snapTime(3, candidates, { threshold: 0 })).toMatchObject({
      time: 3,
      snapped: true,
    });
  });

  it("applies type toggles, boundary limits and threshold inclusivity", () => {
    expect(
      snapTime(4, candidates, { threshold: 1, enabledTypes: ["word"] }),
    ).toMatchObject({ time: 5, snapped: true });
    expect(snapTime(4, candidates, { threshold: 1, enabledTypes: [] })).toEqual(
      { time: 4, snapped: false },
    );
    expect(
      snapTime(3.1, candidates, { threshold: 1, min: 3.5, max: 4.5 }),
    ).toMatchObject({ time: 4, snapped: true });
    expect(snapTime(9, candidates, { threshold: 0.1, min: 0, max: 6 })).toEqual(
      { time: 6, snapped: false },
    );
  });

  it("keeps decimal timing threshold and priority ties stable despite floating-point rounding", () => {
    const candidates = [
      { id: "early", time: 0.9, type: "word", priority: 40 },
      { id: "late", time: 1.1, type: "manual", priority: 100 },
    ];
    expect(snapTime(1, candidates, { threshold: 0.1 }).candidate!.id).toBe(
      "late",
    );
    expect(
      snapTime(1, candidates.toReversed(), { threshold: 0.1 }).candidate!.id,
    ).toBe("late");
    expect(snapTime(1, candidates, { threshold: 0.09999 })).toEqual({
      time: 1,
      snapped: false,
    });
  });

  it("uses priority only to break nearest ties and is deterministic across candidate order", () => {
    const tie = [
      { id: "late", time: 5, type: "manual", priority: 100 },
      { id: "early", time: 3, type: "scene-cut", priority: 80 },
    ];
    expect(snapTime(4, tie, { threshold: 1 }).candidate!.id).toBe("late");
    expect(snapTime(3.2, tie, { threshold: 2 }).candidate!.id).toBe("early");
    const stable = [
      { id: "b", time: 5, type: "manual", priority: 100 },
      { id: "a", time: 3, type: "manual", priority: 100 },
      { id: "c", time: 3, type: "manual", priority: 100 },
    ];
    expect(snapTime(4, stable, { threshold: 1 }).candidate!.id).toBe("a");
    expect(snapTime(4, stable.toReversed(), { threshold: 1 })).toEqual(
      snapTime(4, stable, { threshold: 1 }),
    );
  });

  it("ignores invalid derived candidates but rejects invalid interaction bounds", () => {
    const malformed = [
      { time: NaN, type: "word", priority: 10 },
      { time: 4, type: "word", priority: Infinity },
    ];
    expect(snapTime(4, malformed, { threshold: 1 })).toEqual({
      time: 4,
      snapped: false,
    });
    for (const options of [
      { threshold: -1 },
      { threshold: Infinity },
      { threshold: 1, min: 5, max: 4 },
      { threshold: 1, max: NaN },
    ])
      expect(() => snapTime(4, candidates, options)).toThrow(RangeError);
    expect(() => snapTime(-1, candidates, { threshold: 1 })).toThrow(
      RangeError,
    );
  });

  it("builds generic scene, manual, speech, word and clip-edge candidates", () => {
    const markers: TimelineMarker[] = [
      { id: "scene", assetId: "video", time: 1, type: "scene-cut" },
      {
        id: "manual",
        assetId: "video",
        time: 2,
        type: "manual",
        label: "A memory",
      },
    ];
    const transcript: TranscriptDocument = {
      id: "transcript",
      assetId: "video",
      provenance: {
        providerId: "test",
        version: "1",
        sourceHash: "source",
        createdAt: "2026-10-06T00:00:00Z",
      },
      segments: [
        {
          id: "speech",
          start: 3,
          end: 4,
          text: "Our story",
          words: [{ start: 3.1, end: 3.9, text: "story" }],
        },
      ],
    };
    const result = candidatesFromIntelligence(markers, transcript, [0, 5]);
    expect(result).toHaveLength(8);
    expect(
      result
        .filter((candidate) => candidate.type === "word")
        .map((candidate) => candidate.time),
    ).toEqual([3.1, 3.9]);
    expect(
      snapTime(3.92, result, { threshold: 0.1, enabledTypes: ["word"] }),
    ).toMatchObject({ time: 3.9, candidate: { label: "story" } });
    expect(snapTime(2.01, result, { threshold: 0.1 })).toMatchObject({
      time: 2,
      candidate: { label: "A memory" },
    });
    expect(markers[0]!.time).toBe(1);
  });
});
