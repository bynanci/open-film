import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import {
  graphicNode,
  graphicScene,
} from "../../../tests/fixtures/graphic-scene.js";

const composition = (scenes?: unknown) => ({
  id: "composition",
  storyId: "story",
  duration: 6,
  tracks: [],
  ...(scenes === undefined ? {} : { graphicScenes: scenes }),
});

describe("GraphicScene admission", () => {
  it("rejects executable scene fields instead of silently preserving them", () => {
    expect(() =>
      core.validateComposition(
        composition([
          {
            ...graphicScene(),
            html: "<script>fetch('https://example.invalid')</script>",
          },
        ]),
      ),
    ).toThrow(/graphic|unknown|html/i);
  });

  it("preserves legacy compositions without adding graphics", () => {
    const legacy = composition();
    expect(core.validateComposition(legacy)).toEqual(legacy);
    expect(core.validateComposition(legacy)).not.toBe(legacy);
  });

  it("accepts and detaches the complete versioned tree", () => {
    const scene = graphicScene();
    const saved = core.validateComposition(composition([scene]));
    expect(saved.graphicScenes).toEqual([scene]);
    expect(saved.graphicScenes?.[0]).not.toBe(scene);
  });

  it("admits optional layer state and bounded rotation without migrating legacy scenes", () => {
    const scene = graphicScene({
      nodes: [graphicNode({ rotation: -17.5, hidden: true, locked: true })],
    });
    const saved = core.validateComposition(composition([scene]));
    expect(saved.graphicScenes?.[0]?.nodes[0]).toMatchObject({
      rotation: -17.5,
      hidden: true,
      locked: true,
    });
    expect(
      core.validateComposition(composition([graphicScene()])).graphicScenes?.[0]
        ?.nodes[0],
    ).not.toHaveProperty("rotation");
    for (const patch of [
      { rotation: 3601 },
      { rotation: Number.NaN },
      { hidden: "yes" },
      { locked: 1 },
    ])
      expect(() =>
        core.validateComposition(
          composition([graphicScene({ nodes: [graphicNode(patch as never)] })]),
        ),
      ).toThrow();
  });

  it.each([
    { version: 2 },
    { start: -1 },
    { start: 1 },
    { duration: 0 },
    { duration: 31 },
    { zIndex: 0.5 },
    { nodes: [graphicNode({ x: Infinity })] },
    { nodes: [graphicNode({ width: 0 })] },
    { nodes: [graphicNode({ width: 1e-300 })] },
    { nodes: [graphicNode({ opacity: 1.1 })] },
    { nodes: [graphicNode({ end: 7 })] },
    { nodes: [graphicNode({ start: 2, end: 1 })] },
    { nodes: [{ ...graphicNode(), fill: "url(https://example.invalid/a)" }] },
    { nodes: [{ ...graphicNode(), src: "file:///private/image.png" }] },
    {
      nodes: [
        { ...graphicNode(), type: "html", html: "<img onerror=alert(1)>" },
      ],
    },
    {
      nodes: [
        {
          ...graphicNode(),
          animation: {
            enter: { duration: 7, easing: "linear", from: { x: 0 } },
          },
        },
      ],
    },
    {
      nodes: [
        {
          ...graphicNode(),
          animation: {
            enter: { duration: 4, easing: "linear", from: { opacity: 0 } },
            exit: { duration: 4, easing: "linear", to: { opacity: 0 } },
          },
        },
      ],
    },
    {
      nodes: [
        {
          ...graphicNode(),
          animation: {
            enter: {
              duration: 1,
              easing: "javascript:alert(1)",
              from: { x: 0 },
            },
          },
        },
      ],
    },
    {
      nodes: [
        {
          ...graphicNode(),
          animation: {
            exit: { duration: 1, easing: "linear", to: { x: "Math.random()" } },
          },
        },
      ],
    },
  ])("rejects malformed or unsafe scene %#", (patch) => {
    expect(() =>
      core.validateComposition(composition([{ ...graphicScene(), ...patch }])),
    ).toThrow();
  });

  it("admits an empty group at the maximum supported depth", () => {
    let nodes: core.GraphicNode[] = [];
    for (let depth = 0; depth < 4; depth++)
      nodes = [
        {
          id: `group-${depth}`,
          type: "group",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          opacity: 1,
          zIndex: 0,
          start: 0,
          end: 6,
          children: nodes,
        },
      ];
    expect(
      core.validateComposition(composition([graphicScene({ nodes })]))
        .graphicScenes,
    ).toHaveLength(1);
  });
  it.each(["decorated", "symbol", "subclass"])(
    "rejects %s arrays outside plain JSON",
    (kind) => {
      const scenes = [graphicScene()];
      if (kind === "decorated")
        Object.defineProperty(scenes, "extra", { value: "untrusted" });
      if (kind === "symbol")
        Object.defineProperty(scenes, Symbol("untrusted"), {
          value: "untrusted",
        });
      if (kind === "subclass") Object.setPrototypeOf(scenes, {});
      expect(() => core.validateComposition(composition(scenes))).toThrow();
    },
  );

  it("bounds node count before traversing payloads", () => {
    const nodes = Array.from({ length: 65 }, (_, i) =>
      graphicNode({ id: `node-${i}` }),
    );
    expect(() =>
      core.validateComposition(composition([graphicScene({ nodes })])),
    ).toThrow(/limit|64|nodes/i);
  });

  it("rejects duplicate scene and nested node IDs", () => {
    expect(() =>
      core.validateComposition(composition([graphicScene(), graphicScene()])),
    ).toThrow(/duplicate/i);
    expect(() =>
      core.validateComposition(
        composition([graphicScene({ nodes: [graphicNode(), graphicNode()] })]),
      ),
    ).toThrow(/duplicate/i);
  });

  it("rejects excessive nesting and cyclic trees without stack overflow", () => {
    const leaf = graphicNode();
    let node: core.GraphicNode = leaf;
    for (let i = 0; i < 6; i++) {
      const { fill: _fill, shape: _shape, ...base } = graphicNode();
      node = { ...base, id: `group-${i}`, type: "group", children: [node] };
    }
    expect(() =>
      core.validateComposition(composition([graphicScene({ nodes: [node] })])),
    ).toThrow(/depth|nest/i);
    const cycle = { ...node, children: [] as unknown[] };
    cycle.children.push(cycle);
    expect(() =>
      core.validateComposition(
        composition([graphicScene({ nodes: [cycle as typeof node] })]),
      ),
    ).toThrow();
  });

  it("rejects getters without executing them", () => {
    let reads = 0;
    const node = graphicNode();
    Object.defineProperty(node, "x", {
      enumerable: true,
      get() {
        reads++;
        return 0;
      },
    });
    expect(() =>
      core.validateComposition(composition([graphicScene({ nodes: [node] })])),
    ).toThrow();
    expect(reads).toBe(0);
  });
});

describe("deterministic GraphicScene time evaluation", () => {
  it("evaluates explicit enter/exit values in arbitrary seek order", () => {
    const scene = graphicScene({
      nodes: [
        graphicNode({
          animation: {
            enter: {
              duration: 2,
              easing: "linear",
              from: { x: -100, opacity: 0, width: 20 },
            },
            exit: { duration: 2, easing: "linear", to: { x: 100, opacity: 0 } },
          },
        }),
      ],
    });
    const frames = [5, 1, 3, 0, 1, 5].map((time) =>
      core.evaluateGraphicSceneAtTime?.(scene, time),
    );
    expect(frames[1]?.nodes[0]).toMatchObject({
      x: -50,
      opacity: 0.5,
      width: 40,
    });
    expect(frames[0]?.nodes[0]).toMatchObject({
      x: 50,
      opacity: 0.5,
      width: 60,
    });
    expect(frames[3]?.nodes[0]).toMatchObject({ x: -100, opacity: 0 });
    expect(frames[1]).toEqual(frames[4]);
    expect(frames[0]).toEqual(frames[5]);
    expect(scene.nodes[0]?.x).toBe(0);
  });

  it("evaluates rotation deterministically and excludes hidden layers", () => {
    const scene = graphicScene({
      nodes: [
        graphicNode({
          rotation: 30,
          locked: true,
          animation: {
            enter: { duration: 2, easing: "linear", from: { rotation: -30 } },
          },
        }),
        graphicNode({ id: "hidden", hidden: true, zIndex: 1 }),
      ],
    });
    const later = core.evaluateGraphicSceneAtTime(scene, 1);
    const earlier = core.evaluateGraphicSceneAtTime(scene, 0.5);
    expect(later.nodes).toHaveLength(1);
    expect(later.nodes[0]).toMatchObject({ rotation: 0, locked: true });
    expect(earlier.nodes[0]?.rotation).toBe(-15);
    expect(core.evaluateGraphicSceneAtTime(scene, 1)).toEqual(later);
  });

  it("keeps half-open scene/node times and nested local clocks", () => {
    const scene = graphicScene({
      start: 2,
      nodes: [graphicNode({ start: 1, end: 5 })],
    });
    expect(core.evaluateGraphicSceneAtTime?.(scene, 2.9)?.nodes).toEqual([]);
    expect(core.evaluateGraphicSceneAtTime?.(scene, 3)?.nodes).toHaveLength(1);
    expect(core.evaluateGraphicSceneAtTime?.(scene, 7)?.nodes).toEqual([]);
    expect(core.evaluateGraphicSceneAtTime?.(scene, 8)?.nodes).toEqual([]);
  });

  it.each([
    ["linear", 0.5],
    ["ease-in", 0.25],
    ["ease-out", 0.75],
    ["ease-in-out", 0.5],
  ] as const)("uses explicit %s easing", (easing, expected) => {
    const scene = graphicScene({
      nodes: [
        graphicNode({
          animation: { enter: { duration: 2, easing, from: { opacity: 0 } } },
        }),
      ],
    });
    expect(core.evaluateGraphicSceneAtTime?.(scene, 1)?.nodes[0]?.opacity).toBe(
      expected,
    );
  });

  it("preserves group opacity and stable sibling z-order", () => {
    const { fill: _fill, shape: _shape, ...base } = graphicNode();
    const group = {
      ...base,
      type: "group" as const,
      id: "group",
      opacity: 0.5,
      children: [
        graphicNode({ id: "front", zIndex: 2 }),
        graphicNode({ id: "back", zIndex: 0 }),
        graphicNode({ id: "tied", zIndex: 2 }),
      ],
    };
    const frame = core.evaluateGraphicSceneAtTime?.(
      graphicScene({ nodes: [group] }),
      3,
    );
    expect(frame?.nodes[0]).toMatchObject({
      opacity: 0.5,
      children: [
        { id: "back", opacity: 1 },
        { id: "front", opacity: 1 },
        { id: "tied", opacity: 1 },
      ],
    });
  });
});
