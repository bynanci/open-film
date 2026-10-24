import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { createStoryArc } from "../src/story-arcs.js";

const asset = (
  id: string,
  capturedAt?: string,
  mediaType: "image" | "video" = "image",
): MediaAsset => ({
  id,
  uri: `file:///${id}.png`,
  name: id,
  mediaType,
  ...(capturedAt ? { capturedAt } : {}),
  tags: [],
  state: {},
  metadata: {},
});

const assets = [
  asset("late", "2026-01-04T00:00:00Z"),
  asset("first", "2026-01-01T00:00:00Z"),
  asset("third", "2026-01-03T00:00:00Z"),
  asset("second", "2026-01-02T00:00:00Z"),
];

describe("localized story arc starters", () => {
  it.each([
    ["journey", ["出發", "沿途", "抵達"]],
    ["event-recap", ["準備", "相聚", "高潮", "餘韻"]],
    ["then-now", ["當時", "轉變", "現在"]],
    ["portrait", ["背景", "細節", "回望"]],
    ["day-in-life", ["清晨", "日常", "轉折", "夜晚"]],
    ["letters", ["開場", "想說的話", "記得這一刻", "留給以後"]],
    ["collection", ["片刻", "彼此呼應", "留下的事"]],
  ] as const)("creates %s in canonical localized beat order", (arc, titles) => {
    const story = createStoryArc("Film", assets, {
      arc,
      targetDuration: 40,
      maxDuration: 60,
      contentLocale: "zh-TW",
    });

    expect(story.beats.map((beat) => beat.title)).toEqual(titles);
    expect(story.template).toBe(arc);
    expect(story.beats.every((beat) => beat.intent?.trim())).toBe(true);
    expect(story.beats.flatMap((beat) => beat.candidateAssetIds)).toEqual([
      "first",
      "second",
      "third",
      "late",
    ]);
  });

  it("keeps a custom outline in the user's order and allows future beats without media", () => {
    const outline = ["先從那封信開始", "再回到那一天", "最後留給以後"];
    const story = createStoryArc("Film", [asset("one")], {
      arc: "custom-outline",
      customOutline: outline,
      targetDuration: 24,
      maxDuration: 30,
      contentLocale: "zh-TW",
    });

    expect(story.template).toBe("custom-outline");
    expect(story.beats.map((beat) => beat.title)).toEqual(outline);
    expect(story.beats.map((beat) => beat.titleSource)).toEqual([
      "user",
      "user",
      "user",
    ]);
    expect(story.beats.map((beat) => beat.candidateAssetIds)).toEqual([
      ["one"],
      [],
      [],
    ]);
  });

  it("distributes available sources deterministically without reuse and leaves inputs untouched", () => {
    const candidates = assets.map((item) => ({
      ...item,
      state: { ...item.state },
    }));
    const before = structuredClone(candidates);
    const first = createStoryArc("Film", candidates, {
      arc: "journey",
      targetDuration: 30,
      maxDuration: 30,
    });
    const second = createStoryArc("Film", candidates, {
      arc: "journey",
      targetDuration: 30,
      maxDuration: 30,
    });
    const assigned = first.beats.flatMap(
      (beat) => beat.candidateAssetIds ?? [],
    );

    expect(assigned).toEqual(["first", "second", "third", "late"]);
    expect(new Set(assigned).size).toBe(candidates.length);
    expect(first.beats.map((beat) => beat.title)).toEqual(
      second.beats.map((beat) => beat.title),
    );
    expect(candidates).toEqual(before);
  });

  it.each(["en-US", "zh-TW", "ja-JP"] as const)(
    "provides localized prompt text in %s",
    (contentLocale) => {
      const story = createStoryArc("Film", assets, {
        arc: "then-now",
        targetDuration: 30,
        maxDuration: 30,
        contentLocale,
      });
      expect(story.beats).toHaveLength(3);
      expect(story.beats.every((beat) => beat.title && beat.intent)).toBe(true);
      expect(story.beats.map((beat) => beat.targetDuration)).toEqual([
        10, 10, 10,
      ]);
    },
  );
});

describe("custom outline validation", () => {
  const options = {
    arc: "custom-outline" as const,
    targetDuration: 30,
    maxDuration: 30,
  };

  it.each([
    { label: "missing", customOutline: undefined },
    { label: "empty", customOutline: [] },
    { label: "blank heading", customOutline: ["  "] },
    { label: "overlong Unicode heading", customOutline: ["故".repeat(301)] },
    {
      label: "more than 30 beats",
      customOutline: Array.from(
        { length: 31 },
        (_, index) => `Scene ${index + 1}`,
      ),
    },
  ])("rejects $label outline", ({ customOutline }) => {
    expect(() =>
      createStoryArc("Film", assets, { ...options, customOutline }),
    ).toThrow(expect.objectContaining({ code: "story.invalid" }));
  });

  it("rejects custom headings on a built-in arc", () => {
    expect(() =>
      createStoryArc("Film", assets, {
        ...options,
        arc: "journey",
        customOutline: ["Unexpected replacement"],
      } as never),
    ).toThrow(expect.objectContaining({ code: "story.invalid" }));
  });

  it("rejects non-positive and inverted duration bounds", () => {
    expect(() =>
      createStoryArc("Film", assets, { ...options, targetDuration: 0 }),
    ).toThrow(expect.objectContaining({ code: "story.invalid" }));
    expect(() =>
      createStoryArc("Film", assets, {
        ...options,
        targetDuration: 31,
        maxDuration: 30,
      }),
    ).toThrow(expect.objectContaining({ code: "story.invalid" }));
  });
});
