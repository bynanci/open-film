// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import {
  createInitialStoryGraph,
  validatePresetPackage,
  type PresetSnapshot,
  type Story,
  type MediaAsset,
} from "@openfilm/core";
import * as storyModule from "../src/index.js";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
function fixture() {
  const source: Story = {
    id: "authored",
    title: "Original",
    targetDuration: 6,
    maxDuration: 12,
    beats: ["a", "b", "c"].map((id, i) => ({
      id,
      title: id,
      targetDuration: 2,
      minDuration: 1,
      maxDuration: 4,
      selectedAssetIds: [id],
      candidateAssetIds: [id],
      constraints: [{ type: "must-include", assetIds: [id] }],
      ...(i === 1
        ? { script: { narration: "", visualDirection: "Original direction" } }
        : {}),
    })),
  };
  const assets: MediaAsset[] = ["a", "b", "c"].map((id) => ({
    id,
    name: id,
    uri: `file:///synthetic/${id}.png`,
    mediaType: "image",
    tags: [],
    state: {},
    metadata: {},
  }));
  const p = validatePresetPackage(presetPackage()),
    entry = p.entries.find((e) => e.kind === "story")!;
  const snapshot = {
    version: 1,
    canonicalId: "local:test.studio@1.0.0/story/three",
    packageId: p.id,
    packageVersion: p.version,
    packageSha256: "a".repeat(64),
    entryId: entry.id,
    kind: "story",
    name: entry.name,
    license: p.license,
    provenance: p.provenance,
    recipe: entry.recipe,
    recipeSha256: "b".repeat(64),
    snapshotSha256: "c".repeat(64),
  } as PresetSnapshot<"story">;
  const plan = storyModule.generateStoryPlanFromGraph(
    source,
    createInitialStoryGraph(source, assets),
    assets,
    { targetDuration: 6, maxDuration: 12 },
  );
  const bindings = ["begin", "middle", "end"].map((recipeBeatKey, i) => ({
    recipeBeatKey,
    beatId: source.beats[i]!.id,
  }));
  return { source, plan, snapshot, bindings };
}
it("maps only explicit authored beats and preserves source order, assets and nature", () => {
  const { source, plan, snapshot, bindings } = fixture(),
    before = structuredClone(plan);
  const result = storyModule.compilePresetStoryPlan(
    plan,
    source,
    snapshot,
    bindings,
    "zh-TW",
  );
  expect(result.scenes.map((s) => s.targetDuration)).toEqual([1.5, 3, 1.5]);
  expect(result.scenes[0]!.title).toBe("begin 記憶");
  expect(result.scenes.map((s) => s.assets)).toEqual(
    plan.scenes.map((s) => s.assets),
  );
  expect(result.scenes.map((s) => s.sourceNature)).toEqual(
    plan.scenes.map((s) => s.sourceNature),
  );
  expect(plan).toEqual(before);
});
it("rejects missing, repeated, reordered or unbacked bindings and cannot drop required media", () => {
  const { source, plan, snapshot, bindings } = fixture();
  for (const b of [
    bindings.slice(1),
    [bindings[1]!, bindings[0]!, bindings[2]!],
    [bindings[0]!, bindings[0]!, bindings[2]!],
  ])
    expect(() =>
      storyModule.compilePresetStoryPlan(plan, source, snapshot, b, "en-US"),
    ).toThrow();
  const missing = structuredClone(plan);
  missing.scenes[0]!.assets = [];
  expect(() =>
    storyModule.compilePresetStoryPlan(
      missing,
      source,
      snapshot,
      bindings,
      "en-US",
    ),
  ).toThrow(/required|selected|media/i);
  source.beats[1]!.maxDuration = 2;
  expect(() =>
    storyModule.compilePresetStoryPlan(
      plan,
      source,
      snapshot,
      bindings,
      "en-US",
    ),
  ).toThrow(/duration|bound/i);
});

it.each([
  "missing-node",
  "ambiguous-beat",
  "repeated-scene",
  "repeated-occurrence",
] as const)("rejects %s without guessing occurrence identities", (kind) => {
  const { source, plan, snapshot, bindings } = fixture();
  source.graph = createInitialStoryGraph(
    source,
    ["a", "b", "c"].map((id) => ({
      id,
      name: id,
      uri: `file:///${id}`,
      mediaType: "image",
      tags: [],
      state: {},
      metadata: {},
    })),
  );
  if (kind === "missing-node")
    source.graph.nodes = source.graph.nodes.filter(
      (n) => n.id !== "asset-node-a",
    );
  if (kind === "ambiguous-beat")
    source.graph.nodes.push({
      id: "another-a",
      type: "beat",
      beatId: "a",
      storyId: source.id,
    });
  if (kind === "repeated-scene")
    plan.scenes[1]!.sceneId = plan.scenes[0]!.sceneId;
  if (kind === "repeated-occurrence")
    plan.scenes[0]!.assets.push({
      ...plan.scenes[0]!.assets[0]!,
      isEcho: true,
    });
  expect(() =>
    storyModule.compilePresetStoryPlan(
      plan,
      source,
      snapshot,
      bindings,
      "en-US",
    ),
  ).toThrow();
});
it("checks solved occurrences using explicit scene-to-beat mapping", () => {
  const { source, plan } = fixture();
  const clips = plan.scenes.flatMap((scene, i) =>
    scene.assets.map((a) => ({
      id: `clip-${i}`,
      assetId: a.assetId,
      beatId: source.beats[i]!.id,
      timelineStart: i * 2,
      timelineDuration: 2,
    })),
  );
  const composition = {
    id: "cut",
    storyId: source.id,
    duration: 6,
    tracks: [{ id: "v", type: "video" as const, clips }],
  };
  expect(() =>
    storyModule.assertPresetPlanComposition(plan, source, composition),
  ).not.toThrow();
  for (const changed of [
    clips.slice(1),
    [...clips, { ...clips[0]!, id: "extra" }],
    clips.map((c) => ({ ...c, beatId: "unmapped" })),
  ])
    expect(() =>
      storyModule.assertPresetPlanComposition(plan, source, {
        ...composition,
        tracks: [{ ...composition.tracks[0]!, clips: changed }],
      }),
    ).toThrow();
});
