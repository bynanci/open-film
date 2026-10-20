import { describe, expect, it } from "vitest";
import type { Composition } from "@openfilm/core";
import { createHandoffPlan } from "@openfilm/exporters";
const cut: Composition = {
  id: "cut",
  storyId: "story",
  duration: 4,
  tracks: [
    {
      id: "v",
      type: "video",
      clips: [
        { id: "a", assetId: "image", timelineStart: 0, timelineDuration: 4 },
      ],
    },
  ],
};
describe("HandoffPlan", () => {
  it("defaults to editability and reports graphics as metadata", () => {
    const c = structuredClone(cut);
    c.graphicScenes = [
      {
        version: 1,
        id: "scene",
        name: "Scene",
        start: 1,
        duration: 1,
        zIndex: 0,
        nodes: [],
      },
    ];
    const p = createHandoffPlan(c, 24);
    expect(p.mode).toBe("preserve-editability");
    expect(p.items.find((i) => i.feature === "graphicScene")).toMatchObject({
      disposition: "metadata-only",
      startFrame: 24,
      endFrame: 48,
    });
    expect(p.visualRanges).toEqual([]);
  });
  it("merges opaque bake intervals while retaining native source identities", () => {
    const c = structuredClone(cut);
    c.graphicScenes = [
      {
        version: 1,
        id: "scene",
        name: "Scene",
        start: 1,
        duration: 1,
        zIndex: 0,
        nodes: [],
      },
    ];
    const p = createHandoffPlan(c, 24, { mode: "preserve-visual-fidelity" });
    expect(p.visualRanges).toEqual([{ startFrame: 24, endFrame: 48 }]);
    expect(p.items.find((i) => i.feature === "graphicScene")?.disposition).toBe(
      "baked",
    );
    expect(
      p.items.find((i) => i.feature === "sourceIdentity")?.disposition,
    ).toBe("native-editable");
    expect(p.transparentOverlay.supported).toBe(false);
  });
  it("rejects unknown effects and refuses off-grid visual baking", () => {
    expect(() =>
      createHandoffPlan({ ...cut, futureEffect: {} } as Composition, 24),
    ).toThrow(/unsupported/i);
    const c = structuredClone(cut);
    c.tracks[0]!.clips[0]!.title = "Title";
    c.tracks[0]!.clips[0]!.timelineStart = 0.01;
    c.tracks[0]!.clips[0]!.timelineDuration = 3.99;
    expect(() =>
      createHandoffPlan(c, 24, { mode: "preserve-visual-fidelity" }),
    ).toThrow(/frame/i);
  });
});

it("records native and replaced cut/source ranges independently", () => {
  const c = structuredClone(cut);
  c.graphicScenes = [
    {
      version: 1,
      id: "g",
      name: "Synthetic",
      start: 1,
      duration: 1,
      zIndex: 0,
      nodes: [],
    },
  ];
  const p = createHandoffPlan(c, 24, { mode: "preserve-visual-fidelity" });
  expect(
    p.items
      .filter((i) => i.feature === "cut")
      .map((i) => [i.startFrame, i.endFrame, i.disposition]),
  ).toEqual([
    [0, 24, "native-editable"],
    [24, 48, "baked"],
    [48, 96, "native-editable"],
  ]);
  expect(
    p.items.filter((i) => i.feature === "sourceIdentity")[1]?.disposition,
  ).toBe("metadata-only");
});
it("preserves rational frame rate and metadata-only fractional boundaries", () => {
  const c = structuredClone(cut);
  c.duration = (120 * 1001) / 30000;
  c.tracks[0]!.clips[0]!.timelineDuration = c.duration;
  const p = createHandoffPlan(c, 30000 / 1001);
  expect(p.rate).toEqual({ numerator: 30000, denominator: 1001 });
  expect(p.durationFrames).toBeCloseTo(120, 10);
  c.tracks[0]!.clips[0]!.timelineStart = 0.01;
  c.tracks[0]!.clips[0]!.timelineDuration -= 0.01;
  expect(
    createHandoffPlan(c, 30000 / 1001).items.find((i) => i.feature === "cut")
      ?.startFrame,
  ).toBeCloseTo((0.01 * 30000) / 1001, 10);
});
it("keeps audio automation manual unless explicitly mixed", () => {
  const c = structuredClone(cut);
  c.tracks[0]!.type = "audio";
  c.tracks[0]!.clips[0]!.audioAutomation = {
    version: 1,
    role: "dialogue",
    fadeIn: 1,
  };
  expect(
    createHandoffPlan(c, 24).items.find((i) => i.feature === "audioAutomation")
      ?.disposition,
  ).toBe("metadata-only");
  const p = createHandoffPlan(c, 24, { bakeAudio: true });
  expect(p.visualRanges).toEqual([]);
  expect(
    p.items.find((i) => i.feature === "audioAutomation")?.disposition,
  ).toBe("baked");
});

it("allows native fractional audio and picture edges around an aligned graphic precomp", () => {
  const c = structuredClone(cut);
  c.duration = 4.01;
  c.tracks[0]!.clips[0]!.timelineStart = 0.01;
  c.tracks[0]!.clips[0]!.timelineDuration = 4;
  c.tracks.push({
    id: "sound",
    type: "audio",
    clips: [
      {
        id: "sound",
        assetId: "audio",
        timelineStart: 0.01,
        timelineDuration: 2,
      },
    ],
  });
  c.graphicScenes = [
    {
      version: 1,
      id: "graphic",
      name: "Synthetic",
      start: 1,
      duration: 1,
      zIndex: 0,
      nodes: [],
    },
  ];
  const plan = createHandoffPlan(c, 24, { mode: "preserve-visual-fidelity" });
  expect(plan.visualRanges).toEqual([{ startFrame: 24, endFrame: 48 }]);
  expect(
    plan.items.find(
      (item) => item.ownerId === "sound" && item.feature === "cut",
    )?.startFrame,
  ).toBeCloseTo(0.24, 10);
  expect(
    plan.items.filter(
      (item) => item.ownerId === "a" && item.feature === "cut",
    )[0]?.startFrame,
  ).toBeCloseTo(0.24, 10);
});

it.each([29.97, 23.976, 30000 / 1001])(
  "uses the configured renderer grid for %s fps",
  (rate) => {
    const c = structuredClone(cut);
    c.duration = 120 / rate;
    c.tracks[0]!.clips[0]!.timelineDuration = c.duration;
    c.graphicScenes = [
      {
        version: 1,
        id: "g",
        name: "Synthetic",
        start: 20 / rate,
        duration: 80 / rate,
        zIndex: 0,
        nodes: [],
      },
    ];
    const p = createHandoffPlan(c, rate, { mode: "preserve-visual-fidelity" });
    expect(p.visualRanges).toEqual([{ startFrame: 20, endFrame: 100 }]);
    expect(p.rate.numerator / p.rate.denominator).toBe(rate);
  },
);
it("marks replaced audio track timing baked and bounds disjoint render work", () => {
  const c = structuredClone(cut);
  c.tracks[0]!.type = "audio";
  expect(
    createHandoffPlan(c, 24, { bakeAudio: true }).items.find(
      (i) => i.feature === "layerTiming",
    )?.disposition,
  ).toBe("baked");
});

it("rejects unbounded disjoint visual work before rendering", () => {
  const c = structuredClone(cut);
  c.captionTracks = [
    {
      version: 1,
      id: "captions",
      name: "Synthetic",
      style: { version: 1, role: "subtitle" },
      cues: Array.from({ length: 129 }, (_, i) => ({
        version: 1 as const,
        id: `cue-${i}`,
        startMs: i * 20,
        endMs: i * 20 + 10,
        text: "字",
        source: { kind: "manual" as const },
        manualRevision: 0,
      })),
    },
  ];
  expect(() =>
    createHandoffPlan(c, 100, { mode: "preserve-visual-fidelity" }),
  ).toThrow(/128 disjoint/i);
});
