import { describe, expect, it } from "vitest";
import {
  validateComposition,
  type Clip,
  type MediaAsset,
} from "@openfilm/core";
import {
  applyTimelineCommand,
  prepareShorteningPlan,
  type EditorDocument,
  type TimelineCommand,
} from "../src/index.js";

const assets: MediaAsset[] = [
  ["portrait", "image", undefined],
  ["landscape", "image", undefined],
  ["music", "audio", 40],
  ["voice", "audio", 8],
].map(([id, mediaType, duration]) => ({
  id: String(id),
  name: String(id),
  uri: `file:///${id}`,
  mediaType: mediaType as MediaAsset["mediaType"],
  ...(duration === undefined ? {} : { duration: Number(duration) }),
  tags: [],
  state: {},
  metadata: {},
}));

function document(): EditorDocument {
  return {
    story: {
      id: "story",
      title: "Our story",
      beats: [
        {
          id: "beat",
          title: "Together",
          candidateAssetIds: ["portrait", "landscape"],
        },
      ],
    },
    composition: {
      id: "film",
      storyId: "story",
      duration: 20,
      tracks: [
        {
          id: "visual",
          type: "video",
          clips: [
            {
              id: "first",
              assetId: "portrait",
              beatId: "beat",
              sourceIn: 0,
              sourceOut: 10,
              timelineStart: 0,
              timelineDuration: 10,
            },
            {
              id: "second",
              assetId: "landscape",
              beatId: "beat",
              sourceIn: 0,
              sourceOut: 10,
              timelineStart: 10,
              timelineDuration: 10,
            },
          ],
        },
      ],
    },
  };
}
const edit = (doc: EditorDocument, command: TimelineCommand, pool = assets) =>
  applyTimelineCommand(doc, pool, command);
const clip = (doc: EditorDocument, id: string): Clip =>
  doc.composition.tracks
    .flatMap((track) => track.clips)
    .find((item) => item.id === id)!;
const addMusic: TimelineCommand = {
  type: "audio.add",
  clipId: "soundtrack",
  assetId: "music",
  role: "music",
  timelineStart: 0,
  sourceIn: 2,
  sourceOut: 22,
  volume: 0.5,
};

it("retains complete versioned photo finishing on protected regeneration and resets it on explicit source replacement", () => {
  const layout: Clip["layout"] = {
    version: 2,
    preset: "contain",
    fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
  };
  const motion: Clip["motion"] = {
    version: 2,
    preset: "pan",
    easing: {
      version: 1,
      kind: "cubic-bezier",
      x1: 0.42,
      y1: 0,
      x2: 0.58,
      y2: 1,
    },
    from: { scale: 1.1, x: -5, y: 0 },
    to: { scale: 1.1, x: 5, y: 0 },
  };
  let before = edit(document(), {
    type: "presentation",
    clipId: "first",
    layout,
    motion,
  });
  before = edit(before, { type: "lock", clipId: "first", locked: true });
  const next = edit(before, {
    type: "regenerate-beat",
    beatId: "beat",
    mode: "more-photos",
  });
  expect(clip(next, "first")).toMatchObject({ layout, motion, locked: true });
  expect(() =>
    edit(next, { type: "presentation", clipId: "first", motion: null }),
  ).toThrow(/locked/iu);
  const unlocked = edit(next, { type: "lock", clipId: "first", locked: false });
  const replaced = edit(unlocked, {
    type: "replace",
    clipId: "first",
    assetId: "landscape",
  });
  expect(clip(replaced, "first")).not.toHaveProperty("layout");
  expect(clip(replaced, "first")).not.toHaveProperty("motion");
  expect(clip(before, "first")).toMatchObject({ layout, motion });
});

const videoSources: MediaAsset[] = [
  ["audible", 20, true],
  ["audible-next", 6, true],
  ["silent", 8, false],
].map(([id, duration, audio]) => ({
  id: String(id),
  name: String(id),
  uri: `file:///${id}.mp4`,
  mediaType: "video",
  duration: Number(duration),
  tags: [],
  state: {},
  metadata: {
    "openfilm.ffprobe": {
      streams: [
        { codec_type: "video" },
        ...(audio ? [{ codec_type: "audio" }] : []),
      ],
    },
  },
}));

describe("source-bound audio automation", () => {
  it.each(["portrait", "silent", "audible-next"])(
    "retains role-only automation on replacement %s only when it has audio",
    (assetId) => {
      const pool = [...assets, ...videoSources];
      const before = document();
      clip(before, "first").assetId = "audible";
      clip(before, "first").audioAutomation = { version: 1, role: "dialogue" };
      const next = edit(
        before,
        { type: "replace", clipId: "first", assetId },
        pool,
      );
      expect(clip(next, "first").audioAutomation).toEqual(
        assetId === "audible-next"
          ? { version: 1, role: "dialogue" }
          : undefined,
      );
    },
  );

  it.each([
    ["portrait", false, 10],
    ["silent", false, 8],
    ["audible-next", true, 6],
  ] as const)(
    "replaces an audible video with %s and retains automation only on audio-bearing sources",
    (assetId, retainsAudio, duration) => {
      const pool = [...assets, ...videoSources];
      const initial = document();
      clip(initial, "first").assetId = "audible";
      const before = edit(
        initial,
        {
          type: "audio.configure",
          clipId: "first",
          automation: {
            version: 1,
            role: "dialogue",
            fadeIn: 1,
            fadeOut: 2,
            points: [
              { time: 0, gain: 1 },
              { time: 10, gain: 0.5 },
            ],
            ducking: [{ start: 2, end: 8, gain: 0.4, attack: 1, release: 1 }],
          },
        },
        pool,
      );
      const snapshot = structuredClone(before);
      const next = edit(
        before,
        { type: "replace", clipId: "first", assetId },
        pool,
      );
      expect(clip(next, "first").assetId).toBe(assetId);
      expect(clip(next, "first").timelineDuration).toBe(duration);
      if (retainsAudio) {
        expect(clip(next, "first").audioAutomation).toMatchObject({
          version: 1,
          role: "dialogue",
          fadeIn: 1,
          fadeOut: 2,
        });
        expect(clip(next, "first").audioAutomation!.points!.at(-1)).toEqual({
          time: 6,
          gain: 0.7,
        });
      } else expect(clip(next, "first").audioAutomation).toBeUndefined();
      expect(() => validateComposition(next.composition)).not.toThrow();
      expect(before).toEqual(snapshot);
    },
  );

  it("rejects configuring a silent video without changing the document", () => {
    const before = document();
    clip(before, "first").assetId = "silent";
    const snapshot = structuredClone(before);
    expect(() =>
      edit(
        before,
        {
          type: "audio.configure",
          clipId: "first",
          automation: { version: 1, role: "dialogue", fadeIn: 1 },
        },
        [...assets, ...videoSources],
      ),
    ).toThrow(/audio/i);
    expect(before).toEqual(snapshot);
  });
});

describe("photo film audio overlays", () => {
  it("removes a dedicated overlay track only after its final clip is deleted", () => {
    let current = edit(document(), addMusic);
    current = edit(current, {
      type: "clip.split",
      clipId: "soundtrack",
      sourceTime: 12,
    });
    const overlayId = current.composition.tracks[1]!.id;
    current = edit(current, { type: "delete", clipId: "soundtrack" });
    expect(
      current.composition.tracks.find((track) => track.id === overlayId)!.clips,
    ).toHaveLength(1);
    current = edit(current, { type: "delete", clipId: "soundtrack-split-1" });
    expect(current.composition).toEqual(document().composition);
    for (let index = 0; index < 5; index++) {
      current = edit(current, addMusic);
      current = edit(current, { type: "delete", clipId: "soundtrack" });
    }
    expect(current.composition.tracks).toHaveLength(1);
  });

  it("adds soundtrack and narration without modifying visuals, story or film length", () => {
    const before = document();
    let next = edit(before, addMusic);
    next = edit(next, {
      type: "audio.add",
      clipId: "narration",
      assetId: "voice",
      role: "narration",
      timelineStart: 4,
      sourceIn: 1,
      sourceOut: 7,
    });
    expect(next.story).toEqual(before.story);
    expect(next.composition.tracks[0]).toEqual(before.composition.tracks[0]);
    expect(next.composition.duration).toBe(20);
    expect(
      next.composition.tracks
        .slice(1)
        .every((track) => track.timing === "overlay"),
    ).toBe(true);
    expect(
      next.composition.tracks
        .slice(1)
        .flatMap((track) =>
          track.clips.map((clip) => clip.audioAutomation?.role),
        ),
    ).toEqual(["music", "narration"]);
    expect(clip(next, "soundtrack")).toMatchObject({
      sourceIn: 2,
      sourceOut: 22,
      timelineDuration: 20,
      transform: { volume: 0.5 },
    });
    expect(clip(next, "narration").beatId).toBeUndefined();
    expect(before.composition.tracks).toHaveLength(1);
  });

  it("trims, moves, speeds and deletes overlay audio without rippling visuals", () => {
    const initial = edit(document(), addMusic);
    let next = edit(initial, {
      type: "trim",
      clipId: "soundtrack",
      sourceIn: 2,
      sourceOut: 12,
    });
    next = edit(next, {
      type: "audio.move",
      clipId: "soundtrack",
      timelineStart: 5,
    });
    next = edit(next, { type: "speed", clipId: "soundtrack", speed: 2 });
    expect(clip(next, "soundtrack")).toMatchObject({
      timelineStart: 5,
      timelineDuration: 5,
    });
    expect(next.composition.tracks[0]).toEqual(initial.composition.tracks[0]);
    expect(next.composition.duration).toBe(20);
    next = edit(next, { type: "delete", clipId: "soundtrack" });
    expect(next.composition.tracks.flatMap((track) => track.clips)).toEqual(
      initial.composition.tracks[0]!.clips,
    );
    expect(next.composition.duration).toBe(20);
  });

  it("anchors overlay timing during visual ripple and crops its source range at the new film end", () => {
    const before = edit(document(), addMusic);
    const next = edit(before, {
      type: "duration",
      clipId: "first",
      duration: 5,
    });
    expect(next.composition.duration).toBe(15);
    expect(clip(next, "second").timelineStart).toBe(5);
    expect(clip(next, "soundtrack")).toMatchObject({
      timelineStart: 0,
      timelineDuration: 15,
      sourceIn: 2,
      sourceOut: 17,
    });
  });

  it("refuses to destroy locked audio when shortening the visual film", () => {
    let before = edit(document(), addMusic);
    before = edit(before, { type: "lock", clipId: "soundtrack", locked: true });
    expect(() =>
      edit(before, { type: "duration", clipId: "first", duration: 5 }),
    ).toThrow(/locked/i);
    expect(before.composition.duration).toBe(20);
    expect(clip(before, "soundtrack").timelineDuration).toBe(20);
    expect(prepareShorteningPlan(before, assets, 10).commands).toEqual([]);
  });

  it("keeps overlay clips outside beat regeneration", () => {
    const before = edit(document(), addMusic);
    const next = edit(before, {
      type: "regenerate-beat",
      beatId: "beat",
      mode: "more-photos",
    });
    expect(clip(next, "soundtrack").timelineStart).toBe(0);
    expect(clip(next, "soundtrack").assetId).toBe("music");
    expect(clip(next, "soundtrack").beatId).toBeUndefined();
  });

  it.each(["role-only", "automated", "locked"])(
    "preserves %s soundtrack through transient regeneration duration changes",
    (mode) => {
      const base = document();
      base.composition.tracks[0]!.clips.splice(1);
      base.composition.tracks[0]!.clips[0]!.timelineDuration = 20;
      base.composition.tracks[0]!.clips[0]!.sourceOut = 20;
      Object.assign(base.story.beats[0]!, {
        minDuration: 20,
        targetDuration: 20,
        maxDuration: 20,
      });
      let before = edit(base, addMusic);
      if (mode !== "role-only")
        before = edit(before, {
          type: "audio.configure",
          clipId: "soundtrack",
          automation: {
            version: 1,
            role: "music",
            fadeOut: 2,
            points: [
              { time: 0, gain: 1 },
              { time: 20, gain: 0.5 },
            ],
          },
        });
      if (mode === "locked")
        before = edit(before, {
          type: "lock",
          clipId: "soundtrack",
          locked: true,
        });
      const next = edit(before, {
        type: "regenerate-beat",
        beatId: "beat",
        mode: "more-photos",
      });
      expect(next.composition.duration).toBe(20);
      expect(next.composition.tracks[0]!.clips.length).toBeGreaterThan(1);
      expect(clip(next, "soundtrack")).toEqual(clip(before, "soundtrack"));
      expect(() => validateComposition(next.composition)).not.toThrow();
    },
  );

  it("does not silently duplicate local automation when splitting audio", () => {
    let before = edit(document(), addMusic);
    before = edit(before, {
      type: "audio.configure",
      clipId: "soundtrack",
      automation: {
        version: 1,
        role: "music",
        fadeIn: 1,
        points: [
          { time: 0, gain: 1 },
          { time: 20, gain: 0.5 },
        ],
      },
    });
    expect(() =>
      edit(before, {
        type: "clip.split",
        clipId: "soundtrack",
        sourceTime: 10,
      }),
    ).toThrow(/automation/i);
    expect(clip(before, "soundtrack").timelineDuration).toBe(20);
  });

  it("keeps automation valid when shortening the film or the audio source-out", () => {
    let before = edit(document(), addMusic);
    before = edit(before, {
      type: "audio.configure",
      clipId: "soundtrack",
      automation: {
        version: 1,
        role: "music",
        fadeIn: 2,
        fadeOut: 10,
        points: [
          { time: 0, gain: 1 },
          { time: 10, gain: 0.5 },
          { time: 20, gain: 1 },
        ],
        ducking: [
          { start: 4, end: 12, gain: 0.3, attack: 2, release: 4 },
          { start: 18, end: 20, gain: 0.5, attack: 0.5, release: 0.5 },
        ],
      },
    });
    for (const command of [
      { type: "duration", clipId: "first", duration: 5 },
      { type: "trim", clipId: "soundtrack", sourceIn: 2, sourceOut: 8 },
      { type: "speed", clipId: "soundtrack", speed: 4 },
      { type: "replace", clipId: "soundtrack", assetId: "voice" },
    ] as TimelineCommand[]) {
      const next = edit(before, command);
      expect(() => validateComposition(next.composition)).not.toThrow();
      const audio = clip(next, "soundtrack");
      expect(audio.audioAutomation!.points!.at(-1)!.time).toBeLessThanOrEqual(
        audio.timelineDuration,
      );
      expect(
        audio.audioAutomation!.ducking!.every(
          (region) => region.end <= audio.timelineDuration,
        ),
      ).toBe(true);
      expect(audio.audioAutomation!.fadeOut).toBeLessThanOrEqual(
        audio.timelineDuration,
      );
    }
    const shortened = edit(before, {
      type: "duration",
      clipId: "first",
      duration: 5,
    });
    expect(
      clip(shortened, "soundtrack").audioAutomation!.points!.at(-1),
    ).toEqual({ time: 15, gain: 0.75 });
  });

  it("rejects automation beyond the clip duration and retains clip-local fade timing after a source-in trim", () => {
    let before = edit(document(), { ...addMusic, sourceIn: 0, sourceOut: 20 });
    expect(() =>
      edit(before, {
        type: "audio.configure",
        clipId: "soundtrack",
        automation: { version: 1, role: "music", fadeIn: 21 },
      }),
    ).toThrow();
    before = edit(before, {
      type: "audio.configure",
      clipId: "soundtrack",
      automation: { version: 1, role: "music", fadeIn: 2 },
    });
    const trimmed = edit(before, {
      type: "trim",
      clipId: "soundtrack",
      sourceIn: 1,
      sourceOut: 12,
    });
    expect(clip(trimmed, "soundtrack").audioAutomation!.fadeIn).toBe(2);
    expect(() => validateComposition(trimmed.composition)).not.toThrow();
  });

  it.each([
    { ...addMusic, assetId: "portrait" },
    { ...addMusic, sourceOut: 41 },
    { ...addMusic, sourceOut: 25 },
    { ...addMusic, sourceIn: -1 },
    { ...addMusic, timelineStart: 20 },
    { ...addMusic, clipId: "first" },
    { ...addMusic, volume: 2 },
  ])("rejects invalid audio placement or source: %j", (command) => {
    expect(() => edit(document(), command as TimelineCommand)).toThrow();
  });

  it("rejects rejected/unsupported sources and out-of-bounds overlay moves", () => {
    for (const patch of [
      { state: { rejected: true } },
      { metadata: { "openfilm.preview": { supported: false } } },
    ]) {
      expect(() =>
        edit(
          document(),
          addMusic,
          assets.map((asset) =>
            asset.id === "music" ? { ...asset, ...patch } : asset,
          ),
        ),
      ).toThrow();
    }
    const next = edit(document(), addMusic);
    expect(() =>
      edit(next, {
        type: "audio.move",
        clipId: "soundtrack",
        timelineStart: 1,
      }),
    ).toThrow();
    expect(() =>
      edit(next, { type: "audio.move", clipId: "first", timelineStart: 1 }),
    ).toThrow();
  });
});

describe("non-destructive photo presentation", () => {
  it("accepts the renderer title length limit and rejects longer titles before editing", () => {
    const before = document();
    const snapshot = structuredClone(before);
    expect(
      clip(
        edit(before, {
          type: "presentation",
          clipId: "first",
          title: "日".repeat(8000),
        }),
        "first",
      ).title,
    ).toHaveLength(8000);
    expect(() =>
      edit(before, {
        type: "presentation",
        clipId: "first",
        title: "日".repeat(8001),
      }),
    ).toThrow(/8000/);
    expect(before).toEqual(snapshot);
  });

  it.each(["overlay", "titles", "audio", "music"] as const)(
    "rejects full-frame photo presentation on %s tracks without changing the document",
    (trackType) => {
      const before = document();
      before.composition.tracks[0]!.type = trackType;
      const snapshot = structuredClone(before);
      for (const command of [
        {
          type: "presentation",
          clipId: "first",
          layout: { version: 1, preset: "hero" },
        },
        {
          type: "presentation",
          clipId: "first",
          motion: {
            version: 1,
            preset: "push-in",
            easing: "linear",
            from: { scale: 1, x: 0, y: 0 },
            to: { scale: 1.04, x: 0, y: 0 },
          },
        },
      ] as TimelineCommand[])
        expect(() => edit(before, command)).toThrow(/visual|picture|video/i);
      expect(before).toEqual(snapshot);
    },
  );

  it("allows styled titles on visual overlays without enabling photo canvas layout", () => {
    const before = document();
    before.composition.tracks[0]!.type = "overlay";
    const next = edit(before, {
      type: "presentation",
      clipId: "first",
      title: "Our story",
      titleStyle: { version: 1, role: "film-title" },
    });
    expect(clip(next, "first").titleStyle!.role).toBe("film-title");
    expect(clip(next, "first").layout).toBeUndefined();
  });

  it("patches layout, motion and title independently, and clears only explicit nulls", () => {
    const before = document();
    const layout = {
      version: 1,
      preset: "diptych",
      secondary: { assetId: "landscape" },
    } as const;
    const motion = {
      version: 1,
      preset: "push-in",
      easing: "linear",
      from: { scale: 1, x: 0, y: 0 },
      to: { scale: 1.04, x: 0, y: 0 },
    } as const;
    let next = edit(before, {
      type: "presentation",
      clipId: "first",
      layout,
      motion,
      title: "一起走過的每一天",
      titleStyle: { version: 1, role: "scene-statement" },
    });
    next = edit(next, {
      type: "presentation",
      clipId: "first",
      title: "明天，也一起",
    });
    expect(clip(next, "first")).toMatchObject({
      layout,
      motion,
      title: "明天，也一起",
      titleStyle: { version: 1, role: "scene-statement" },
    });
    next = edit(next, {
      type: "presentation",
      clipId: "first",
      motion: null,
      title: null,
    });
    expect(clip(next, "first").motion).toBeUndefined();
    expect(clip(next, "first").title).toBeUndefined();
    expect(clip(next, "first").layout).toEqual(layout);
    expect(next.composition.duration).toBe(20);
    expect(before.composition.tracks[0]!.clips[0]!.layout).toBeUndefined();
  });

  it("requires photo inputs and rejects locked, rejected or unsupported primary and secondary sources", () => {
    const command: TimelineCommand = {
      type: "presentation",
      clipId: "first",
      layout: {
        version: 1,
        preset: "diptych",
        secondary: { assetId: "landscape" },
      },
    };
    for (const id of ["portrait", "landscape"]) {
      for (const patch of [
        { state: { locked: true } },
        { state: { rejected: true } },
        { metadata: { "openfilm.preview": { supported: false } } },
        { mediaType: "video" as const },
      ]) {
        expect(() =>
          edit(
            document(),
            command,
            assets.map((asset) =>
              asset.id === id ? { ...asset, ...patch } : asset,
            ),
          ),
        ).toThrow();
      }
    }
  });

  it("prevents stale paired sources after replacing the primary source", () => {
    const before = edit(document(), {
      type: "presentation",
      clipId: "first",
      layout: {
        version: 1,
        preset: "diptych",
        secondary: { assetId: "landscape" },
      },
      motion: {
        version: 1,
        preset: "hold",
        easing: "linear",
        from: { scale: 1, x: 0, y: 0 },
        to: { scale: 1, x: 0, y: 0 },
      },
      title: "一起走過的日子",
      titleStyle: { version: 1, role: "scene-statement", fontSize: 42 },
    });
    const next = edit(before, {
      type: "replace",
      clipId: "first",
      assetId: "landscape",
    });
    expect(clip(next, "first").layout).toBeUndefined();
    expect(clip(next, "first").motion).toBeUndefined();
    expect(clip(next, "first").title).toBe("一起走過的日子");
    expect(clip(next, "first").titleStyle).toEqual(
      clip(before, "first").titleStyle,
    );
  });

  it.each([
    ["portrait", "landscape"],
    ["portrait", "audible"],
    ["audible", "landscape"],
  ])(
    "preserves authored title and exact typography when replacing %s with %s",
    (sourceId, replacementId) => {
      const initial = document();
      clip(initial, "first").assetId = sourceId;
      const pool = [...assets, ...videoSources];
      const before = edit(
        initial,
        {
          type: "presentation",
          clipId: "first",
          title: "我們一起，看過不同的風景",
          titleStyle: {
            version: 1,
            role: "scene-statement",
            fontFamily: "Noto Serif CJK TC",
            fontSize: 42,
            fontWeight: 500,
            lineHeight: 1.6,
            tracking: 1,
            maxWidth: 700,
            align: "left",
            background: "scrim",
            position: "bottom",
          },
        },
        pool,
      );
      const snapshot = structuredClone(before);
      const next = edit(
        before,
        { type: "replace", clipId: "first", assetId: replacementId },
        pool,
      );
      expect(clip(next, "first").assetId).toBe(replacementId);
      expect(clip(next, "first").title).toBe(clip(before, "first").title);
      expect(clip(next, "first").titleStyle).toEqual(
        clip(before, "first").titleStyle,
      );
      expect(() => validateComposition(next.composition)).not.toThrow();
      expect(before).toEqual(snapshot);
    },
  );

  it("rejects pairing a photo excluded from the beat", () => {
    const before = document();
    before.story.beats[0]!.constraints = [
      { type: "must-exclude", assetIds: ["landscape"] },
    ];
    expect(() =>
      edit(before, {
        type: "presentation",
        clipId: "first",
        layout: {
          version: 1,
          preset: "diptych",
          secondary: { assetId: "landscape" },
        },
      }),
    ).toThrow(/excluded/i);
  });

  it.each(["must-include", "selected"])(
    "retains a %s paired photo during deletion, replacement and layout removal",
    (protection) => {
      let before = edit(document(), {
        type: "presentation",
        clipId: "first",
        layout: {
          version: 1,
          preset: "diptych",
          secondary: { assetId: "landscape" },
        },
      });
      before.composition.tracks[0]!.clips.splice(1);
      before.composition.duration = 10;
      if (protection === "selected")
        before.story.beats[0]!.selectedAssetIds = ["landscape"];
      else
        before.story.beats[0]!.constraints = [
          { type: "must-include", assetIds: ["landscape"] },
        ];
      for (const command of [
        { type: "delete", clipId: "first" },
        { type: "replace", clipId: "first", assetId: "landscape" },
        { type: "presentation", clipId: "first", layout: null },
        {
          type: "presentation",
          clipId: "first",
          layout: { version: 1, preset: "contain" },
        },
      ] as TimelineCommand[])
        expect(() => edit(before, command)).toThrow(/required|selected/i);
      before = edit(before, {
        type: "presentation",
        clipId: "first",
        title: "A kept memory",
      });
      expect(clip(before, "first").layout!.secondary!.assetId).toBe(
        "landscape",
      );
      expect(prepareShorteningPlan(before, assets, 5).commands).toEqual([]);
      Object.assign(before.story.beats[0]!, {
        minDuration: 10,
        targetDuration: 10,
        maxDuration: 10,
      });
      const regenerated = edit(before, {
        type: "regenerate-beat",
        beatId: "beat",
        mode: "more-photos",
      });
      expect(regenerated.composition).toEqual(before.composition);
    },
  );
});
