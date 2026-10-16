import { describe, expect, it } from "vitest";
import {
  createProject,
  validateProject,
  validateStory,
  type MediaAsset,
} from "@openfilm/core";
import { compose } from "@openfilm/solver";
import { createSceneStory, localizeProjectContent } from "../src/index.js";

const asset = (id: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  name: `${id}.jpg`,
  uri: `file:///${id}.jpg`,
  mediaType: "image",
  tags: [],
  state: {},
  metadata: {},
  ...patch,
});
const options = {
  groupBy: "category" as const,
  targetDuration: 30,
  maxDuration: 40,
};

describe("evidence-based scene planning", () => {
  it("assigns each visual candidate to its first category in deterministic capture order", () => {
    const assets = [
      asset("late", { tags: ["Trip", "Family"], capturedAt: "2025-02-01" }),
      asset("early", { tags: ["Family"], capturedAt: "2024-01-01" }),
      asset("blank", { tags: [" ", "Trip"], capturedAt: "2025-01-01" }),
      asset("unknown"),
      asset("rejected", { tags: ["Excluded"], state: { rejected: true } }),
      asset("audio", { mediaType: "audio", duration: 30 }),
      asset("360", { mediaType: "360-video", duration: 30 }),
    ];
    const before = structuredClone(assets);
    const story = createSceneStory("Film", assets, options);
    expect(story.beats.map((beat) => beat.title)).toEqual([
      "Family",
      "Trip",
      "Unclassified memories",
    ]);
    expect(story.beats.map((beat) => beat.candidateAssetIds)).toEqual([
      ["early"],
      ["blank", "late"],
      ["unknown"],
    ]);
    expect(story.beats.every((beat) => !beat.selectedAssetIds)).toBe(true);
    expect(
      story.beats.every(
        (beat) => beat.constraints?.[0]?.type === "chronological",
      ),
    ).toBe(true);
    const reordered = createSceneStory("Film", [...assets].reverse(), options);
    expect(reordered.beats.map(({ id: _id, ...beat }) => beat)).toEqual(
      story.beats.map(({ id: _id, ...beat }) => beat),
    );
    expect(assets).toEqual(before);
  });

  it("keeps an explicitly named fallback category distinct from unclassified media", () => {
    const story = createSceneStory(
      "Film",
      [asset("a", { tags: ["Unclassified memories"] }), asset("b")],
      options,
    );
    expect(story.beats).toHaveLength(2);
    expect(story.beats.flatMap((beat) => beat.candidateAssetIds)).toEqual([
      "a",
      "b",
    ]);
  });

  it.each([1, 2, 3, 17])(
    "partitions %i chronological candidates into at most three scenes",
    (count) => {
      const assets = Array.from({ length: count }, (_, index) =>
        asset(String(index).padStart(2, "0")),
      );
      const story = createSceneStory("Film", assets, {
        ...options,
        groupBy: "chronology",
      });
      expect(story.beats).toHaveLength(Math.min(count, 3));
      expect(story.beats.flatMap((beat) => beat.candidateAssetIds)).toEqual(
        assets.map((item) => item.id),
      );
      expect(
        story.beats.every((beat) => beat.candidateAssetIds!.length > 0),
      ).toBe(true);
      expect(
        story.beats.reduce((sum, beat) => sum + beat.targetDuration!, 0),
      ).toBe(options.targetDuration);
    },
  );

  it.each(["en-US", "zh-TW", "ja-JP"] as const)(
    "preserves category, brief, script edits and locale-independent IDs in %s",
    (locale) => {
      const category = " 青森 # Family & 2026 ";
      const brief = "自分の言葉。\n  I want to keep this exactly. ";
      const story = createSceneStory(
        "  Our Film  ",
        [asset("photo", { tags: [category] })],
        {
          ...options,
          brief,
          contentLocale: locale,
        },
      );
      expect(story.title).toBe("  Our Film  ");
      expect(story.beats[0]!.title).toBe(category);
      expect(story.beats[0]!.script!.narration).toContain(brief);
      expect(story.beats[0]!.script!.narration).toContain(category);
      expect(story.beats[0]!.script!.visualDirection).toBeTruthy();
      const project = createProject("Film");
      story.beats[0]!.script = {
        narration: "User revised text",
        visualDirection: "",
      };
      project.stories = [story];
      const localized = localizeProjectContent(
        project,
        locale === "ja-JP" ? "en-US" : "ja-JP",
      );
      expect(localized.stories).toEqual(project.stories);
      expect(
        validateProject(JSON.parse(JSON.stringify(project))).stories,
      ).toEqual(project.stories);
    },
  );

  it("composes within the hard limit while retaining locked media without requiring every photo", () => {
    const assets = Array.from({ length: 30 }, (_, index) =>
      asset(String(index).padStart(2, "0"), {
        tags: [index < 15 ? "One" : "Two"],
        state: index === 29 ? { locked: true } : {},
      }),
    );
    const story = createSceneStory("Film", assets, {
      ...options,
      targetDuration: 8,
      maxDuration: 9,
    });
    const composition = compose(story, assets);
    const clips = composition.tracks.flatMap((track) => track.clips);
    expect(composition.duration).toBeLessThanOrEqual(9);
    expect(clips.some((clip) => clip.assetId === "29")).toBe(true);
    expect(clips.length).toBeLessThan(assets.length);
    expect(new Set(clips.map((clip) => clip.assetId)).size).toBe(clips.length);
  });

  it("keeps short source ranges and reports a soft target honestly", () => {
    const assets = [asset("video", { mediaType: "video", duration: 2 })];
    const story = createSceneStory("Film", assets, options);
    const composition = compose(story, assets);
    expect(composition.duration).toBe(2);
    expect(composition.tracks[0]!.clips[0]!.sourceOut).toBe(2);
    expect(story.targetDuration).toBe(30);
  });

  it("keeps every planned category playable and rejects a total shorter than its minimum", () => {
    const assets = Array.from({ length: 4 }, (_, index) =>
      asset(String(index), { tags: [`Category ${index}`] }),
    );
    expect(() =>
      createSceneStory("Film", assets, {
        ...options,
        targetDuration: 3,
        maxDuration: 3,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "story.sceneTooShort",
        params: { minimum: 4 },
      }),
    );
    const story = createSceneStory("Film", assets, {
      ...options,
      targetDuration: 4,
      maxDuration: 4,
    });
    expect(story.beats.map((beat) => beat.targetDuration)).toEqual([
      1, 1, 1, 1,
    ]);
    const composition = compose(story, assets);
    expect(composition.duration).toBe(4);
    for (const beat of story.beats)
      expect(
        composition.tracks
          .flatMap((track) => track.clips)
          .some((clip) => clip.beatId === beat.id),
      ).toBe(true);
  });

  it("uses real source capacity for exclusively short-video scenes without dropping them", () => {
    const assets = [
      asset("a", { mediaType: "video", duration: 0.2, tags: ["One"] }),
      asset("b", { mediaType: "video", duration: 0.4, tags: ["One"] }),
      asset("c", { mediaType: "video", duration: 0.3, tags: ["Two"] }),
    ];
    const story = createSceneStory("Film", assets, {
      ...options,
      targetDuration: 1,
      maxDuration: 1,
    });
    expect(story.beats.map((beat) => beat.minDuration)).toEqual([0.4, 0.3]);
    const composition = compose(story, assets);
    expect(composition.duration).toBeLessThanOrEqual(1);
    expect(
      new Set(
        composition.tracks
          .flatMap((track) => track.clips)
          .map((clip) => clip.beatId),
      ).size,
    ).toBe(2);
    const minimumStory = createSceneStory("Film", assets, {
      ...options,
      targetDuration: 0.7,
      maxDuration: 0.7,
    });
    expect(minimumStory.beats.map((beat) => beat.targetDuration)).toEqual([
      0.4, 0.3,
    ]);
    expect(compose(minimumStory, assets).duration).toBeLessThanOrEqual(0.7);
    expect(() =>
      createSceneStory(
        "Film",
        [asset("unknown", { mediaType: "video" })],
        options,
      ),
    ).toThrow(/no usable video duration/);
  });

  it("reports a positive localized minimum even for sub-millisecond source timing", () => {
    expect(() =>
      createSceneStory(
        "Film",
        [asset("short", { mediaType: "video", duration: 0.0001 })],
        { ...options, targetDuration: 0.00005, maxDuration: 1 },
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "story.sceneTooShort",
        params: { minimum: 0.001 },
      }),
    );
  });

  it("rounds the recommended minimum up so following the recommendation succeeds", () => {
    const assets = [
      asset("one", { mediaType: "video", duration: 0.6172, tags: ["One"] }),
      asset("two", { mediaType: "video", duration: 0.6172, tags: ["Two"] }),
    ];
    expect(() =>
      createSceneStory("Film", assets, {
        ...options,
        targetDuration: 1.234,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "story.sceneTooShort",
        params: { minimum: 1.235 },
      }),
    );
    const story = createSceneStory("Film", assets, {
      ...options,
      targetDuration: 1.235,
      maxDuration: 1.235,
    });
    const composition = compose(story, assets);
    expect(composition.duration).toBeLessThanOrEqual(1.235);
    expect(composition.tracks.flatMap((track) => track.clips)).toHaveLength(2);
  });

  it.each([6, 30])(
    "accepts the exact decimal minimum for %i short-video categories without dropping a scene",
    (count) => {
      const assets = Array.from({ length: count }, (_, index) =>
        asset(String(index), {
          mediaType: "video",
          duration: 0.1,
          tags: [`Category ${index}`],
        }),
      );
      const targetDuration = count / 10;
      const story = createSceneStory("Film", assets, {
        ...options,
        targetDuration,
        maxDuration: targetDuration,
      });
      expect(story.beats).toHaveLength(count);
      expect(
        story.beats.every((beat) => beat.targetDuration! >= beat.minDuration!),
      ).toBe(true);
      const composition = compose(story, assets);
      expect(composition.duration).toBeCloseTo(targetDuration, 12);
      expect(
        new Set(
          composition.tracks
            .flatMap((track) => track.clips)
            .map((clip) => clip.beatId),
        ).size,
      ).toBe(count);
      expect(() =>
        createSceneStory("Film", assets, {
          ...options,
          targetDuration: targetDuration - 0.000001,
          maxDuration: targetDuration,
        }),
      ).toThrowError(expect.objectContaining({ code: "story.sceneTooShort" }));
    },
  );

  it("does not apply an absolute timing tolerance to tiny valid sources", () => {
    expect(() =>
      createSceneStory(
        "Film",
        [
          asset("tiny", {
            mediaType: "video",
            duration: 1e-20,
          }),
        ],
        { ...options, targetDuration: 1e-21, maxDuration: 1e-20 },
      ),
    ).toThrowError(expect.objectContaining({ code: "story.sceneTooShort" }));
  });

  it.each([
    { targetDuration: 0 },
    { targetDuration: NaN },
    { targetDuration: Infinity },
    { maxDuration: -1 },
    { maxDuration: 20 },
    { groupBy: "unknown" },
    { brief: 3 },
    { contentLocale: "de-DE" },
  ])("rejects invalid scene settings %j", (patch) => {
    expect(() =>
      createSceneStory("Film", [asset("a")], {
        ...options,
        ...patch,
      } as Parameters<typeof createSceneStory>[2]),
    ).toThrow();
  });

  it("rejects conflicting locks, duplicate IDs, empty scope and excessive group/input counts", () => {
    expect(() =>
      createSceneStory(
        "Film",
        [asset("a", { state: { locked: true, rejected: true } })],
        options,
      ),
    ).toThrow(/locked.*rejected/i);
    expect(() =>
      createSceneStory("Film", [asset("a"), asset("a")], options),
    ).toThrow(/duplicate/i);
    expect(() =>
      createSceneStory(
        "Film",
        [asset("audio", { mediaType: "audio" })],
        options,
      ),
    ).toThrow(/photo|video/i);
    expect(() =>
      createSceneStory(
        "Film",
        Array.from({ length: 31 }, (_, index) =>
          asset(String(index), { tags: [String(index)] }),
        ),
        options,
      ),
    ).toThrow(/30/);
    expect(() =>
      createSceneStory(
        "Film",
        Array.from({ length: 2001 }, (_, index) => asset(String(index))),
        options,
      ),
    ).toThrow(/2000/);
    expect(() =>
      createSceneStory(
        "Film",
        [asset("a", { tags: ["x".repeat(8000)] })],
        options,
      ),
    ).toThrow(/8000/);
    expect(() =>
      createSceneStory("Film", [asset("a")], {
        ...options,
        brief: "x".repeat(8001),
      }),
    ).toThrow(/8000/);
  });
});

describe("portable scene script validation", () => {
  const story = (script?: unknown) => ({
    id: "story",
    title: "Film",
    beats: [
      {
        id: "scene",
        title: "Scene",
        ...(script === undefined ? {} : { script }),
      },
    ],
  });

  it("preserves legacy stories, empty drafts and Unicode strings within the schema limit", () => {
    expect(validateStory(story())).toEqual(story());
    expect(
      validateStory(story({ narration: "", visualDirection: "" })),
    ).toEqual(story({ narration: "", visualDirection: "" }));
    const full = { narration: "🌅".repeat(8000), visualDirection: "\n  " };
    expect(validateStory(story(full)).beats[0]!.script).toEqual(full);
  });

  it.each([
    null,
    "script",
    [],
    {},
    { narration: "Words" },
    { narration: 7, visualDirection: "Direction" },
    { narration: "x".repeat(8001), visualDirection: "" },
    { narration: "", visualDirection: "🌅".repeat(8001) },
  ])("rejects malformed script case %#", (script) => {
    expect(() => validateStory(story(script))).toThrow(/script/);
  });
});
