import { describe, expect, it } from "vitest";
import { validateComposition, type Composition } from "../src/index.js";

const cue = {
  version: 1,
  id: "cue-1",
  startMs: 1_000,
  endMs: 2_500,
  text: "你好，世界\n下一行",
  source: { kind: "manual" },
  manualRevision: 0,
};

function composition(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "film",
    storyId: "story",
    duration: 10,
    tracks: [],
    captionTracks: [
      {
        version: 1,
        id: "captions-zh-tw",
        name: "繁體中文字幕",
        language: "zh-TW",
        style: {
          version: 1,
          role: "subtitle",
          fontFamily: "Noto Sans CJK TC",
          fontSize: 48,
          safeArea: { left: 0.08, right: 0.08, top: 0.08, bottom: 0.12 },
        },
        cues: [cue],
      },
    ],
    ...overrides,
  };
}

describe("versioned composition caption tracks", () => {
  it("persists a manual Traditional Chinese cue and its editable safe area", () => {
    const validated = validateComposition(composition()) as Composition;
    expect(validated.captionTracks?.[0]).toMatchObject({
      version: 1,
      id: "captions-zh-tw",
      language: "zh-TW",
      style: { safeArea: { left: 0.08, right: 0.08, top: 0.08, bottom: 0.12 } },
      cues: [cue],
    });
  });

  it("keeps legacy compositions valid without adding an empty native track", () => {
    const legacy = validateComposition({
      id: "film",
      storyId: "story",
      duration: 10,
      tracks: [],
    });
    expect(legacy).not.toHaveProperty("captionTracks");
  });

  it.each([
    ["unsupported cue version", { ...cue, version: 2 }],
    ["negative start", { ...cue, startMs: -1 }],
    ["cue outside composition", { ...cue, endMs: 10_001 }],
    ["zero duration", { ...cue, endMs: 1_000 }],
    ["invalid control text", { ...cue, text: "bad\u0001text" }],
    ["unknown provenance", { ...cue, source: { kind: "words" } }],
  ])("rejects %s", (_label, invalidCue) => {
    expect(() =>
      validateComposition(
        composition({
          captionTracks: [
            {
              version: 1,
              id: "captions-zh-tw",
              name: "繁體中文字幕",
              language: "zh-TW",
              style: { version: 1, role: "subtitle" },
              cues: [invalidCue],
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("rejects duplicate stable IDs across native caption cues", () => {
    const duplicate = { ...cue, text: "第二句" };
    expect(() =>
      validateComposition(
        composition({
          captionTracks: [
            {
              version: 1,
              id: "captions-zh-tw",
              name: "繁體中文字幕",
              style: { version: 1, role: "subtitle" },
              cues: [cue, duplicate],
            },
          ],
        }),
      ),
    ).toThrow(/duplicate/i);
  });
});
