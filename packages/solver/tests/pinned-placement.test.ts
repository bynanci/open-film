import { describe, expect, it } from "vitest";
import {
  applyTimelineCommand,
  solveIncremental,
  prepareShorteningPlan,
  shorteningCommands,
  placeDirectEdit,
  type EditorDocument,
  type TimelineCommand,
} from "../src/index.js";
import {
  resolveProjectTimebase,
  resolveClipFrameRange,
  type MediaAsset,
} from "@openfilm/core";
const clock = resolveProjectTimebase({
  width: 1920,
  height: 1080,
  frameRate: 30,
});
const pin = {
  version: 1 as const,
  isUserPinned: true,
  lockedAttributes: ["timing" as const],
};
const assets: MediaAsset[] = ["a", "b", "c", "next"].map((id) => ({
  id,
  name: id,
  uri: `file:///${id}`,
  mediaType: "image",
  state: {},
  tags: [],
  metadata: {},
}));
function doc(): EditorDocument {
  return {
    story: {
      id: "story",
      title: "Story",
      beats: [
        {
          id: "beat",
          title: "Beat",
          candidateAssetIds: ["a", "b", "c", "next"],
        },
      ],
    },
    composition: {
      id: "cut",
      storyId: "story",
      duration: 8,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "a",
              assetId: "a",
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 3,
            },
            {
              id: "b",
              assetId: "b",
              beatId: "beat",
              timelineStart: 3,
              timelineDuration: 2,
              userOverrides: pin,
            },
            {
              id: "c",
              assetId: "c",
              beatId: "beat",
              timelineStart: 5,
              timelineDuration: 3,
            },
          ],
        },
      ],
    },
  };
}
const get = (d: EditorDocument, id: string) =>
  d.composition.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
describe("bounded pinned placement", () => {
  it("retains the candidate's replacement source window and released metadata", () => {
    const d = doc(),
      sources = structuredClone(assets);
    sources[0]!.mediaType = "video";
    sources[0]!.duration = 4;
    sources[3]!.mediaType = "video";
    sources[3]!.duration = 2;
    Object.assign(get(d, "a"), {
      sourceIn: 1,
      sourceOut: 4,
      userOverrides: { version: 1, isUserPinned: false, lockedAttributes: [] },
    });
    const original = structuredClone(d);
    const result = solveIncremental({
      baseline: d,
      assets: sources,
      timebase: clock,
      scope: { kind: "beat", beatId: "beat" },
      mode: "replace-similar",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.conflicts));
    expect(get(result.document, "a")).toEqual({
      ...get(d, "a"),
      assetId: "next",
      sourceIn: 0,
      sourceOut: 2,
      timelineDuration: 2,
    });
    expect(get(result.document, "b")).toEqual(get(d, "b"));
    expect(d).toEqual(original);
  });
  it.each(["trim", "speed", "delete", "replace"] as const)(
    "stages the %s ripple before validating retained tail graphics",
    (type) => {
      const d = doc(),
        sources = structuredClone(assets);
      sources[0]!.mediaType = "video";
      sources[0]!.duration = 3;
      sources[3]!.mediaType = "video";
      sources[3]!.duration = 2;
      Object.assign(get(d, "a"), { sourceIn: 0, sourceOut: 3 });
      d.composition.graphicScenes = [
        {
          version: 1,
          id: "tail",
          name: "Tail",
          start: 7,
          duration: 1,
          zIndex: 0,
          nodes: [],
        },
      ];
      const command: TimelineCommand =
        type === "trim"
          ? { type, clipId: "a", sourceIn: 0, sourceOut: 2 }
          : type === "speed"
            ? { type, clipId: "a", speed: 1.5 }
            : type === "replace"
              ? { type, clipId: "a", assetId: "next" }
              : { type, clipId: "a" };
      const after = applyTimelineCommand(d, sources, command, {
        timebase: clock,
        origin: "direct",
      });
      expect(after.composition.duration).toBe(8);
      expect(get(after, "b")).toEqual(get(d, "b"));
      expect(after.composition.graphicScenes).toEqual(
        d.composition.graphicScenes,
      );
      if (type === "delete")
        expect(
          after.composition.tracks[0]!.clips.some((clip) => clip.id === "a"),
        ).toBe(false);
      else expect(get(after, "a").timelineDuration).toBe(2);
    },
  );
  it.each(["replace-similar", "shorten"] as const)(
    "retains the mutable same-ID %s proposal around an exact anchor",
    (mode) => {
      const d = doc(),
        before = structuredClone(d);
      get(d, "a").transform = { volume: 0.6 };
      get(d, "a").title = "Authored title";
      const result = solveIncremental({
        baseline: d,
        assets,
        timebase: clock,
        scope: { kind: "beat", beatId: "beat" },
        mode,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result.conflicts));
      const changed = get(result.document, "a");
      expect(changed.id).toBe("a");
      expect(changed.assetId).toBe(mode === "replace-similar" ? "next" : "a");
      expect(changed.timelineDuration).toBeCloseTo(
        mode === "shorten" ? 1.4 : 3,
        9,
      );
      expect(changed.sourceOut).toBeCloseTo(mode === "shorten" ? 1.4 : 3, 9);
      expect(changed.transform).toEqual({ volume: 0.6 });
      expect(changed.title).toBe("Authored title");
      expect(changed.timelineStart).toBe(0);
      expect(changed.userOverrides).toBeUndefined();
      expect(get(result.document, "b")).toEqual(get(d, "b"));
      expect(get(result.document, "c").timelineStart).toBe(5);
      expect(before.composition.tracks[0]!.clips[0]!.assetId).toBe("a");
      expect(get(d, "a").timelineDuration).toBe(3);
    },
  );
  it.each([
    "clip",
    "source",
    "selection",
    "required",
    "paired-source",
  ] as const)(
    "retains actual %s protection when placing same-ID candidates",
    (protection) => {
      const d = doc(),
        sources = structuredClone(assets);
      if (protection === "clip") get(d, "a").locked = true;
      if (protection === "source") sources[0]!.state.locked = true;
      if (protection === "selection")
        d.story.beats[0]!.selectedAssetIds = ["a"];
      if (protection === "required")
        d.story.beats[0]!.constraints = [
          { type: "must-include", assetIds: ["a"] },
        ];
      if (protection === "paired-source") {
        get(d, "a").layout = {
          version: 1,
          preset: "diptych",
          secondary: { assetId: "next" },
        };
        sources[3]!.state.locked = true;
      }
      const original = structuredClone(get(d, "a"));
      for (const mode of ["replace-similar", "shorten"] as const) {
        const result = solveIncremental({
          baseline: d,
          assets: sources,
          timebase: clock,
          scope: { kind: "beat", beatId: "beat" },
          mode,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(JSON.stringify(result.conflicts));
        expect(get(result.document, "a")).toEqual(original);
        expect(get(result.document, "b")).toEqual(get(d, "b"));
      }
    },
  );
  it.each(["graphic", "caption", "locked-audio"] as const)(
    "validates the retained tail %s against final anchored duration",
    (kind) => {
      const d = doc();
      if (kind === "graphic")
        d.composition.graphicScenes = [
          {
            version: 1,
            id: "tail",
            name: "Tail",
            start: 7,
            duration: 1,
            zIndex: 0,
            nodes: [],
          },
        ];
      if (kind === "caption")
        d.composition.captionTracks = [
          {
            version: 1,
            id: "captions",
            name: "Captions",
            language: "en",
            style: { version: 1, role: "subtitle" },
            cues: [
              {
                version: 1,
                id: "tail",
                startMs: 7000,
                endMs: 8000,
                text: "Tail",
                source: { kind: "manual" },
                manualRevision: 0,
              },
            ],
          },
        ];
      if (kind === "locked-audio")
        d.composition.tracks.push({
          id: "sound",
          type: "audio",
          timing: "overlay",
          clips: [
            {
              id: "tail",
              assetId: "a",
              timelineStart: 7,
              timelineDuration: 1,
              locked: true,
            },
          ],
        });
      const original = structuredClone(d);
      const next = applyTimelineCommand(
        d,
        assets,
        { type: "duration", clipId: "a", duration: 2 },
        { timebase: clock, origin: "direct" },
      );
      expect(next.composition.duration).toBe(8);
      expect(get(next, "a").timelineDuration).toBe(2);
      expect(get(next, "b")).toEqual(get(d, "b"));
      expect(next.composition.graphicScenes).toEqual(
        d.composition.graphicScenes,
      );
      expect(next.composition.captionTracks).toEqual(
        d.composition.captionTracks,
      );
      if (kind === "locked-audio")
        expect(get(next, "tail")).toEqual(get(d, "tail"));
      expect(d).toEqual(original);
      expect(() =>
        applyTimelineCommand(
          d,
          assets,
          { type: "duration", clipId: "c", duration: 1 },
          { timebase: clock, origin: "direct" },
        ),
      ).toThrow();
      expect(d).toEqual(original);
    },
  );
  it("anchor_at_frames_90_150_survives_shortening", () => {
    const d = doc(),
      before = structuredClone(get(d, "b"));
    const after = applyTimelineCommand(
      d,
      assets,
      { type: "duration", clipId: "a", duration: 2 },
      { timebase: clock, origin: "direct" },
    );
    expect(get(after, "b")).toEqual(before);
    expect(resolveClipFrameRange(get(after, "b"), clock)).toEqual({
      startFrame: 90,
      endFrame: 150,
    });
    expect(get(after, "c").timelineStart).toBe(5);
  });
  it("extension_over_anchor_is_atomic_conflict", () => {
    const d = doc(),
      copy = structuredClone(d);
    expect(() =>
      applyTimelineCommand(
        d,
        assets,
        { type: "duration", clipId: "a", duration: 4 },
        { timebase: clock, origin: "direct" },
      ),
    ).toThrow(/pin/iu);
    expect(d).toEqual(copy);
  });
  it("pin conflicts expose bounded owner identities without source paths", () => {
    try {
      applyTimelineCommand(
        doc(),
        assets,
        { type: "duration", clipId: "a", duration: 4 },
        { timebase: clock, origin: "direct" },
      );
      throw new Error("Expected pin conflict");
    } catch (error) {
      const conflict = error as {
        code: string;
        params?: { pinTargets?: string };
      };
      expect(conflict.code).toBe("timeline.pinConflict");
      expect(JSON.parse(conflict.params?.pinTargets ?? "[]")).toContainEqual({
        kind: "clip",
        clipId: "b",
      });
      expect(conflict.params?.pinTargets).not.toContain("file:");
    }
  });
  it("regenerate_fills_only_mutable_intervals", () => {
    const d = doc();
    const result = solveIncremental({
      baseline: d,
      assets,
      timebase: clock,
      scope: { kind: "beat", beatId: "beat" },
      mode: "regenerate",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(get(result.document, "b")).toEqual(get(d, "b"));
    expect(
      result.document.composition.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.id !== "b")
        .every(
          (c) =>
            c.timelineStart + c.timelineDuration <= 3 || c.timelineStart >= 5,
        ),
    ).toBe(true);
  });
  it("required_order_across_anchor_is_not_dropped", () => {
    const d = doc();
    d.story.beats[0]!.constraints = [
      { type: "asset-order", assetIds: ["c", "b", "a"] },
    ];
    const result = solveIncremental({
      baseline: d,
      assets,
      timebase: clock,
      scope: { kind: "composition" },
      mode: "regenerate",
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        result.document.composition.tracks
          .flatMap((t) => t.clips)
          .sort((a, b) => a.timelineStart - b.timelineStart)
          .map((c) => c.assetId),
      ).toEqual(["c", "b", "a"]);
  });
  it("backtracks independent required orders across multiple anchors", () => {
    const d = doc();
    d.composition.duration = 13;
    d.composition.tracks[0]!.clips.push(
      {
        id: "d",
        assetId: "d",
        beatId: "beat",
        timelineStart: 8,
        timelineDuration: 2,
        userOverrides: pin,
      },
      {
        id: "e",
        assetId: "e",
        beatId: "beat",
        timelineStart: 10,
        timelineDuration: 3,
      },
    );
    d.story.beats[0]!.candidateAssetIds = ["a", "b", "c", "d", "e"];
    d.story.beats[0]!.constraints = [
      { type: "asset-order", assetIds: ["e", "d"] },
      { type: "asset-order", assetIds: ["a", "b"] },
    ];
    const more = [
      ...assets,
      ...["d", "e"].map((id) => ({ ...assets[0]!, id })),
    ];
    const result = solveIncremental({
      baseline: d,
      assets: more,
      timebase: clock,
      scope: { kind: "composition" },
      mode: "regenerate",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(get(result.document, "b")).toEqual(get(d, "b"));
      expect(get(result.document, "d")).toEqual(get(d, "d"));
      const order = result.document.composition.tracks
        .flatMap((t) => t.clips)
        .sort((a, b) => a.timelineStart - b.timelineStart)
        .map((c) => c.assetId);
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
      expect(order.indexOf("e")).toBeLessThan(order.indexOf("d"));
    }
  });
  it("allocates integer frame budgets across gaps to meet a hard beat minimum", () => {
    const d = doc();
    Object.assign(d.story.beats[0]!, {
      minDuration: 8,
      targetDuration: 8,
      maxDuration: 8,
    });
    const result = solveIncremental({
      baseline: d,
      assets,
      timebase: clock,
      scope: { kind: "beat", beatId: "beat" },
      mode: "regenerate",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(get(result.document, "b")).toEqual(get(d, "b"));
      expect(
        result.document.composition.tracks
          .flatMap((t) => t.clips)
          .reduce((sum, c) => sum + c.timelineDuration, 0),
      ).toBeCloseTo(8, 9);
    }
  });
  it("fractional off-grid anchors retain exact bytes while new clips fit both clocks", () => {
    const d = doc();
    const fractional = {
      version: 1 as const,
      rateNumerator: 30000,
      rateDenominator: 1001,
      dropFrame: false,
    };
    Object.assign(get(d, "b"), {
      timelineStart: 3.001,
      timelineDuration: 1.998,
      sourceIn: 0.00013,
      sourceOut: 1.99813,
    });
    Object.assign(d.story.beats[0]!, {
      minDuration: 7.9,
      targetDuration: 8,
      maxDuration: 8,
    });
    const result = solveIncremental({
      baseline: d,
      assets,
      timebase: fractional,
      scope: { kind: "composition" },
      mode: "regenerate",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(get(result.document, "b")).toEqual(get(d, "b"));
      expect(
        resolveClipFrameRange(get(result.document, "b"), fractional),
      ).toEqual(resolveClipFrameRange(get(d, "b"), fractional));
    }
  });
  it("shortening previews use the shared authoritative clock and never target pins", () => {
    const d = doc();
    const context = { timebase: clock, origin: "automatic" as const };
    const plan = prepareShorteningPlan(d, assets, 7, [], context);
    expect(plan.secondsSaved).toBeGreaterThan(0);
    const commands = shorteningCommands(d, assets, 7, plan, [], context);
    expect(
      commands.every(
        (command) => !("clipId" in command) || command.clipId !== "b",
      ),
    ).toBe(true);
    let after = d;
    for (const command of commands)
      after = applyTimelineCommand(after, assets, command, context);
    expect(get(after, "b")).toEqual(get(d, "b"));
  });
  it("outside beat is unchanged", () => {
    const d = doc();
    get(d, "c").beatId = "outside";
    d.story.beats.push({ id: "outside", title: "Outside" });
    const result = solveIncremental({
      baseline: d,
      assets,
      timebase: clock,
      scope: { kind: "beat", beatId: "beat" },
      mode: "regenerate",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(get(result.document, "c")).toEqual(get(d, "c"));
  });
  it("off-grid fractional anchors and source numbers survive exactly", () => {
    const d = doc(),
      fractional = {
        version: 1 as const,
        rateNumerator: 30000,
        rateDenominator: 1001,
        dropFrame: false,
      };
    get(d, "b").timelineStart = 3.001;
    get(d, "b").timelineDuration = 1.998;
    get(d, "b").sourceIn = 0.00013;
    get(d, "b").sourceOut = 1.99813;
    const proposal = structuredClone(d);
    get(proposal, "a").timelineDuration = 2;
    const result = placeDirectEdit(d, proposal, assets, fractional, [
      { kind: "clip", clipId: "a" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(get(result.document, "b")).toEqual(get(d, "b"));
      expect(
        resolveClipFrameRange(get(result.document, "b"), fractional),
      ).toEqual(resolveClipFrameRange(get(d, "b"), fractional));
    }
  });
  it("overlapping spine fails closed", () => {
    const d = doc();
    get(d, "c").timelineStart = 4;
    const result = solveIncremental({
      baseline: d,
      assets,
      timebase: clock,
      scope: { kind: "composition" },
      mode: "regenerate",
    });
    expect(result).toMatchObject({
      ok: false,
      conflicts: [{ code: "unsupported-topology" }],
    });
  });
  it("missing sources and resource bounds fail before mutation", () => {
    const d = doc();
    expect(
      solveIncremental({
        baseline: d,
        assets: [],
        timebase: clock,
        scope: { kind: "composition" },
        mode: "regenerate",
      }),
    ).toMatchObject({ ok: false, conflicts: [{ code: "missing-owner" }] });
    d.composition.tracks[0]!.clips = Array.from({ length: 2001 }, (_, i) => ({
      ...get(doc(), "a"),
      id: String(i),
      timelineStart: i * 3,
    }));
    expect(
      solveIncremental({
        baseline: d,
        assets,
        timebase: clock,
        scope: { kind: "composition" },
        mode: "regenerate",
      }),
    ).toMatchObject({ ok: false, conflicts: [{ code: "search-limit" }] });
  });
  it("locked clips may move while pinned clips remain exact", () => {
    const d = doc();
    get(d, "a").locked = true;
    const proposed = structuredClone(d);
    get(proposed, "c").timelineStart = 6;
    const result = placeDirectEdit(d, proposed, assets, clock, [
      { kind: "clip", clipId: "c" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(get(result.document, "a").locked).toBe(true);
      expect(get(result.document, "b")).toEqual(get(d, "b"));
    }
  });
  it("rounded frame fit cannot hide an exact-seconds overlap", () => {
    const d = doc(),
      proposed = structuredClone(d);
    get(proposed, "a").timelineDuration = 3.000001;
    expect(
      placeDirectEdit(d, proposed, assets, clock, [
        { kind: "clip", clipId: "a" },
      ]),
    ).toMatchObject({ ok: false, conflicts: [{ code: "capacity" }] });
  });
  it("a pinned overlay cannot be truncated past the film end", () => {
    const d = doc();
    delete get(d, "b").userOverrides;
    d.composition.tracks.push({
      id: "overlay",
      type: "video",
      timing: "overlay",
      clips: [
        {
          id: "overlay",
          assetId: "a",
          timelineStart: 6,
          timelineDuration: 2,
          userOverrides: pin,
        },
      ],
    });
    const proposed = structuredClone(d);
    get(proposed, "c").timelineDuration = 1;
    expect(
      placeDirectEdit(d, proposed, assets, clock, [
        { kind: "clip", clipId: "c" },
      ]),
    ).toMatchObject({ ok: false, conflicts: [{ code: "capacity" }] });
  });
  it("contradictory complete hard ordering is rejected", () => {
    const d = doc();
    d.story.beats[0]!.constraints = [
      { type: "asset-order", assetIds: ["c", "b", "a"] },
      { type: "asset-order", assetIds: ["a", "c"] },
    ];
    expect(
      solveIncremental({
        baseline: d,
        assets,
        timebase: clock,
        scope: { kind: "composition" },
        mode: "regenerate",
      }).ok,
    ).toBe(false);
  });
  it("seeded feasible shortening preserves every pin byte and frame", () => {
    let seed = 42;
    for (let i = 0; i < 30; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const d = doc(),
        proposal = structuredClone(d);
      get(proposal, "a").timelineDuration = 1 + (seed % 60) / 30;
      const result = placeDirectEdit(d, proposal, assets, clock, [
        { kind: "clip", clipId: "a" },
      ]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(get(result.document, "b")).toEqual(get(d, "b"));
    }
  });
});
