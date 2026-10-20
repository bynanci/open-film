import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { graphicScene } from "../../../tests/fixtures/graphic-scene.js";

const sha = (letter: string) => letter.repeat(64);
const recipe = (
  patch: Record<string, unknown> = {},
): Record<string, unknown> => ({
  version: 1,
  id: "depth-recipe",
  nodeId: "photo-node",
  mode: "parallax",
  duration: 6,
  sourceAssetId: "original",
  sourceSha256: sha("a"),
  maskAssetId: "foreground-mask",
  maskSha256: sha("b"),
  background: {
    kind: "asset",
    assetId: "background-fill",
    sha256: sha("c"),
  },
  protectedRegion: { x: 0.3, y: 0.15, width: 0.4, height: 0.7 },
  foregroundDepth: 1.2,
  backgroundDepth: 0.25,
  amplitude: 0.5,
  camera: {
    from: { x: -0.02, y: 0.01, scale: 1 },
    to: { x: 0.02, y: -0.01, scale: 1.08 },
  },
  easing: "ease-in-out",
  ...patch,
});

const depthScene = (depth: Record<string, unknown> = recipe()) => ({
  ...graphicScene({
    nodes: [
      {
        id: "photo-node",
        type: "image",
        assetId: "original",
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        opacity: 1,
        zIndex: 0,
        start: 0,
        end: 6,
      },
    ],
  }),
  photoDepth: depth,
});

const composition = (scene: unknown) => ({
  id: "composition",
  storyId: "story",
  duration: 6,
  tracks: [],
  graphicScenes: [scene],
});

describe("PhotoDepth v1 admission and frame evaluation", () => {
  it("admits a bounded local recipe attached to its source image node", () => {
    const saved = core.validateComposition(composition(depthScene()), {
      assetIds: ["original", "foreground-mask", "background-fill"],
    });
    expect(saved.graphicScenes?.[0]).toMatchObject({
      photoDepth: { version: 1, mode: "parallax", nodeId: "photo-node" },
    });
  });

  it.each([
    recipe({ version: 2 }),
    recipe({ sourceSha256: "not-a-sha" }),
    recipe({ maskAssetId: "missing-mask" }),
    recipe({ duration: 2.9 }),
    recipe({ amplitude: 1.01 }),
    recipe({
      camera: { from: { x: 0, y: 0, scale: 1 }, to: { x: 1, y: 0, scale: 1 } },
    }),
    recipe({ protectedRegion: { x: 0.8, y: 0, width: 0.4, height: 0.5 } }),
    recipe({
      background: {
        kind: "asset",
        assetId: "background-fill",
        sha256: sha("c"),
        uri: "https://example.invalid/a.png",
      },
    }),
    recipe({ html: "<img src=x onerror=alert(1)>" }),
  ])("rejects malformed or unsafe recipe data %#", (depth) => {
    expect(() =>
      core.validateComposition(composition(depthScene(depth)), {
        assetIds: ["original", "foreground-mask", "background-fill"],
      }),
    ).toThrow();
  });

  it("keeps explicit fallback recipes source-only and requires a reason", () => {
    const fallback = {
      version: 1,
      id: "depth-fallback",
      nodeId: "photo-node",
      mode: "fallback",
      duration: 6,
      sourceAssetId: "original",
      sourceSha256: sha("a"),
      fallbackReason: "mask-not-available",
    };
    const accepted = core.validateComposition(
      composition(depthScene(fallback)),
      { assetIds: ["original"] },
    );
    expect(accepted.graphicScenes?.[0]?.photoDepth).toMatchObject({
      mode: "fallback",
      fallbackReason: "mask-not-available",
    });
    expect(() =>
      core.validateComposition(
        composition(depthScene({ ...fallback, fallbackReason: "" })),
        { assetIds: ["original"] },
      ),
    ).toThrow();
  });

  it.each([
    ["maskAssetId", "foreground-mask"],
    ["maskSha256", sha("b")],
    ["background", { kind: "source" }],
    ["protectedRegion", { x: 0.3, y: 0.2, width: 0.4, height: 0.5 }],
    ["foregroundDepth", 1.2],
    ["backgroundDepth", 0.25],
    ["amplitude", 0.5],
    [
      "camera",
      { from: { x: 0, y: 0, scale: 1 }, to: { x: 0, y: 0, scale: 1 } },
    ],
    ["easing", "linear"],
  ])("rejects parallax-only field %s on a fallback", (field, value) => {
    const fallback = {
      version: 1,
      id: "depth-fallback",
      nodeId: "photo-node",
      mode: "fallback",
      duration: 6,
      sourceAssetId: "original",
      sourceSha256: sha("a"),
      fallbackReason: "mask-not-available",
      [field]: value,
    };
    expect(() =>
      core.validateComposition(composition(depthScene(fallback)), {
        assetIds: ["original", "foreground-mask", "background-fill"],
      }),
    ).toThrow();
  });

  it("includes parallax mask and background assets in project references", () => {
    const scenes = core.validateGraphicScenes([depthScene()], 6);
    expect(core.graphicSceneAssetIds(scenes).sort()).toEqual([
      "background-fill",
      "foreground-mask",
      "original",
    ]);

    const fallback = depthScene({
      version: 1,
      id: "depth-fallback",
      nodeId: "photo-node",
      mode: "fallback",
      duration: 6,
      sourceAssetId: "original",
      sourceSha256: sha("a"),
      fallbackReason: "mask-not-available",
    });
    expect(
      core.graphicSceneAssetIds(core.validateGraphicScenes([fallback], 6)),
    ).toEqual(["original"]);
  });

  it("evaluates motion deterministically for shuffled arbitrary frame times", () => {
    const evaluate = core.evaluatePhotoDepthAtTime;
    const scene = core.validateGraphicScenes([depthScene()], 6)[0]!;
    const times = [0, 1.25, 3, 5.99, 2.5];
    const forward = times.map((time) => evaluate(scene, time));
    const shuffled = [...times]
      .reverse()
      .map((time) => evaluate(scene, time))
      .reverse();
    expect(shuffled).toEqual(forward);
    expect(forward[2]).toMatchObject({
      progress: 0.5,
      camera: { x: 0, y: 0, scale: 1.02 },
    });
    expect(forward[0]?.progress).toBe(0);
    expect(forward[3]?.progress).toBeLessThan(1);
  });
});
