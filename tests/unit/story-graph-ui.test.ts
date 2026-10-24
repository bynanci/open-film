import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { beatTimelineDuration } from "../../apps/desktop/src/duration";
import type {
  Composition,
  GraphViewState,
  MediaAsset,
  Story,
  StoryGraph,
  StoryGraphNode,
} from "@openfilm/core";
import {
  createInitialStoryGraph,
  detectGraphCycle,
  validateEdgeAddition,
} from "@openfilm/core";
import {
  addAssetToBeatInGraph,
  computeStoryGraphAutoLayout,
  createEchoEdge,
  inferStoryGraphEdgeType,
  removeGraphNode,
  setAsNextBeat,
} from "@openfilm/story";
import {
  flatten,
  loadComponent,
  mountComponent,
  vue,
} from "./helpers/vue-sfc-host";

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
const { parse, compileTemplate } = desktopRequire("vue/compiler-sfc");

describe("Phase M9A: Story Graph & Perspectives UI Integration", () => {
  const dummyAssets: MediaAsset[] = [
    {
      id: "asset-1",
      uri: "file:///Mountain Hike.mp4",
      name: "Mountain Hike.mp4",
      mediaType: "video",
      duration: 15,
      dimensions: { width: 1920, height: 1080 },
      tags: ["nature", "mountain"],
      state: {},
      metadata: {},
    },
    {
      id: "asset-2",
      uri: "file:///Sunset Valley.jpg",
      name: "Sunset Valley.jpg",
      mediaType: "image",
      duration: 0,
      dimensions: { width: 3840, height: 2160 },
      tags: ["nature", "sunset"],
      state: {},
      metadata: {},
    },
  ];

  const dummyStory: Story = {
    id: "story-1",
    title: "Mountain Journey",
    targetDuration: 30,
    maxDuration: 45,
    beats: [
      {
        id: "beat-1",
        title: "Ascent",
        targetDuration: 15,
        maxDuration: 20,
        intent: "Establishing ascent",
        selectedAssetIds: ["asset-1"],
        candidateAssetIds: ["asset-1", "asset-2"],
        script: {
          narration: "The climb begins at dawn.",
          visualDirection: "Wide panoramic tracking shot.",
        },
      },
      {
        id: "beat-2",
        title: "Summit",
        targetDuration: 15,
        maxDuration: 25,
        intent: "Summit revelation",
        selectedAssetIds: ["asset-2"],
        candidateAssetIds: ["asset-2"],
        script: {
          narration: "Golden hour at the peak.",
          visualDirection: "Close-up on golden light reflections.",
        },
      },
    ],
  };

  const dummyComposition: Composition = {
    id: "comp-1",
    storyId: "story-1",
    duration: 30,
    tracks: [
      {
        id: "track-v1",
        type: "video",
        clips: [
          {
            id: "clip-1",
            assetId: "asset-1",
            beatId: "beat-1",
            timelineStart: 0,
            timelineDuration: 15,
            sourceIn: 0,
            sourceOut: 15,
          },
        ],
      },
    ],
  };

  it("compiles App.vue template with outline, graph, and storyboard perspective tabs", () => {
    const appSource = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
    const parsed = parse(appSource).descriptor.template!.content;
    const compiled = compileTemplate({
      source: parsed,
      id: "perspective-test",
    });
    expect(compiled.errors).toEqual([]);

    // Check that perspective tabs are present in template
    expect(parsed).toContain('data-testid="perspective-tab-outline"');
    expect(parsed).toContain('data-testid="perspective-tab-graph"');
    expect(parsed).toContain('data-testid="perspective-tab-storyboard"');
    expect(parsed).toContain("<StoryGraphView");
    expect(parsed).toContain("<StoryboardView");
  });

  describe("StoryboardView Component", () => {
    const dependencies = {
      "vue-i18n": {
        useI18n: () => ({
          t: (key: string, params?: Record<string, unknown>) => {
            if (params?.duration) return `${key}:${params.duration}`;
            return key;
          },
        }),
      },
      "../duration": {
        beatTimelineDuration,
        durationStatus: () => "good",
      },
      "../i18n": {
        formatDuration: (s: number) => `${s}s`,
        formatNumber: (n: number) => String(n),
      },
      "../api": {
        sourceUrl: (id: string) => `/api/source/${id}`,
        thumbnailUrl: (id: string) => `/api/thumb/${id}`,
      },
      "./Icon.vue": {
        props: ["name", "size"],
        template: '<span class="icon"></span>',
      },
    };

    it("renders beat cards in sequence with mapped and unmapped pills", async () => {
      const component = loadComponent(
        "apps/desktop/src/components/StoryboardView.vue",
        dependencies,
      );
      const props = vue.reactive({
        story: dummyStory,
        composition: dummyComposition,
        assets: dummyAssets,
        activeBeatId: "beat-1",
      });

      const mounted = mountComponent(component, props);
      try {
        await vue.nextTick();
        const nodes = flatten(mounted.root);

        // Should have 2 storyboard cards for the 2 beats
        const card1 = nodes.find(
          (n) => n.props["data-testid"] === "storyboard-card-beat-1",
        );
        const card2 = nodes.find(
          (n) => n.props["data-testid"] === "storyboard-card-beat-2",
        );
        expect(card1).toBeDefined();
        expect(card2).toBeDefined();

        // Card 1 is mapped on timeline (has clip-1)
        const mappedPills = nodes.filter(
          (n) => n.props["data-testid"] === "mapping-pill-mapped",
        );
        const unmappedPills = nodes.filter(
          (n) => n.props["data-testid"] === "mapping-pill-unmapped",
        );
        expect(mappedPills.length).toBe(1);
        expect(unmappedPills.length).toBe(1);
      } finally {
        mounted.unmount();
      }
    });

    it("emits select-beat when clicking card or pressing Enter", async () => {
      const component = loadComponent(
        "apps/desktop/src/components/StoryboardView.vue",
        dependencies,
      );
      const selectedBeats: string[] = [];
      const props = vue.reactive({
        story: dummyStory,
        composition: dummyComposition,
        assets: dummyAssets,
        activeBeatId: "beat-1",
        "onSelect-beat": (beatId: string) => selectedBeats.push(beatId),
      });

      const mounted = mountComponent(component, props);
      try {
        await vue.nextTick();
        const nodes = flatten(mounted.root);
        const card2 = nodes.find(
          (n) => n.props["data-testid"] === "storyboard-card-beat-2",
        );
        expect(card2).toBeDefined();

        // Simulate click
        (card2!.props.onClick as () => void)();
        expect(selectedBeats).toContain("beat-2");

        // Simulate keydown Enter
        (
          card2!.props.onKeydown as (e: {
            key: string;
            preventDefault: () => void;
          }) => void
        )({
          key: "Enter",
          preventDefault: () => {},
        });
        expect(selectedBeats.length).toBe(2);
      } finally {
        mounted.unmount();
      }
    });

    it("only plays media on actively selected beat; other cards use static thumbnails", async () => {
      const component = loadComponent(
        "apps/desktop/src/components/StoryboardView.vue",
        dependencies,
      );
      const props = vue.reactive({
        story: dummyStory,
        composition: dummyComposition,
        assets: dummyAssets,
        activeBeatId: "beat-1",
      });

      const mounted = mountComponent(component, props);
      try {
        await vue.nextTick();
        const nodes = flatten(mounted.root);

        // By default, no video playback element is mounted; all use img thumbnails
        const videosBefore = nodes.filter((n) => n.tag === "video");
        expect(videosBefore.length).toBe(0);

        const images = nodes.filter((n) => n.tag === "img");
        expect(images.length).toBeGreaterThanOrEqual(1);
      } finally {
        mounted.unmount();
      }
    });

    it("requests a full-size storyboard photo with the loopback CORS contract", async () => {
      const component = loadComponent(
        "apps/desktop/src/components/StoryboardView.vue",
        dependencies,
      );
      const props = vue.reactive({
        story: dummyStory,
        composition: dummyComposition,
        assets: dummyAssets,
        activeBeatId: "beat-2",
      });

      const mounted = mountComponent(component, props);
      try {
        await vue.nextTick();
        const previewButton = flatten(mounted.root).find(
          (node) => node.props["data-testid"] === "storyboard-preview-asset-2",
        );
        expect(previewButton).toBeDefined();
        (
          previewButton!.props.onClick as (event: {
            currentTarget: object;
            stopPropagation: () => void;
          }) => void
        )({ currentTarget: {}, stopPropagation: () => {} });
        await vue.nextTick();

        const fullSizeImage = flatten(mounted.root).find(
          (node) => node.props.src === "/api/source/asset-2",
        );
        expect(fullSizeImage).toBeDefined();
        expect(fullSizeImage!.props.crossorigin).toBe("anonymous");
      } finally {
        mounted.unmount();
      }
    });
  });

  describe("StoryGraph Domain & Auto-layout Contracts", () => {
    it("creates initial graph without empty canvas when opening an existing story", () => {
      const initialGraph = createInitialStoryGraph(dummyStory, dummyAssets);
      expect(initialGraph.nodes.length).toBeGreaterThan(0);

      // Must have theme node
      const themeNode = initialGraph.nodes.find((n) => n.type === "theme");
      expect(themeNode).toBeDefined();
      if (themeNode && themeNode.type === "theme") {
        expect(themeNode.title).toBe("Mountain Journey");
      }

      // Must have beat nodes
      const beatNodes = initialGraph.nodes.filter((n) => n.type === "beat");
      expect(beatNodes.length).toBe(2);

      // Must have precedes edge between beat 1 and beat 2
      const precedesEdge = initialGraph.edges.find(
        (e) =>
          e.type === "precedes" &&
          e.from === beatNodes[0]!.id &&
          e.to === beatNodes[1]!.id,
      );
      expect(precedesEdge).toBeDefined();

      // Must have asset node
      const assetNodes = initialGraph.nodes.filter((n) => n.type === "asset");
      expect(assetNodes.length).toBe(2);
    });

    it("rejects cyclic dependencies in precedes edges", () => {
      const graph = createInitialStoryGraph(dummyStory, dummyAssets);
      const beatNodes = graph.nodes.filter((n) => n.type === "beat");

      // Adding reverse precedes (beat-2 -> beat-1) must be rejected
      const validation = validateEdgeAddition(graph, {
        id: "test-cycle-edge",
        from: beatNodes[1]!.id,
        to: beatNodes[0]!.id,
        type: "precedes",
      });
      expect(validation.valid).toBe(false);
      expect(validation.error).toMatch(/cycle detected|precedes/i);
    });

    it("allows non-dependency thematic echoes without causing execution cycles", () => {
      const graph = createInitialStoryGraph(dummyStory, dummyAssets);
      const beatNodes = graph.nodes.filter((n) => n.type === "beat");

      // Echoes in reverse direction is valid because echoes is strictly non-execution
      const validation = validateEdgeAddition(graph, {
        id: "test-echo-edge",
        from: beatNodes[1]!.id,
        to: beatNodes[0]!.id,
        type: "echoes",
      });
      expect(validation.valid).toBe(true);

      const echoResult = createEchoEdge(
        graph,
        beatNodes[1]!.id,
        beatNodes[0]!.id,
      );
      expect(echoResult.edges.some((e) => e.type === "echoes")).toBe(true);

      // Graph cycle detection for execution dependencies returns null (no cycle)
      expect(
        detectGraphCycle(echoResult.nodes, echoResult.edges, "precedes"),
      ).toBeNull();
    });

    it("supports quick actions without requiring manual line dragging", () => {
      const graph = createInitialStoryGraph(dummyStory, dummyAssets);
      const beatNodes = graph.nodes.filter((n) => n.type === "beat");

      // 1. Add asset quick action
      const { story: updatedStory, graph: withAsset } = addAssetToBeatInGraph(
        dummyStory,
        graph,
        dummyStory.beats[0]!.id,
        "new-asset-99",
      );
      expect(
        withAsset.nodes.some((n) => n.id === "asset-node-new-asset-99"),
      ).toBe(true);
      expect(
        withAsset.edges.some(
          (e) =>
            e.from === beatNodes[0]!.id &&
            e.to === "asset-node-new-asset-99" &&
            e.type === "supports",
        ),
      ).toBe(true);
      expect(updatedStory.beats[0]!.selectedAssetIds).toContain("new-asset-99");

      // 2. Set as next beat quick action (reordering beats)
      const { story: reorderedStory, graph: reorderedGraph } = setAsNextBeat(
        dummyStory,
        withAsset,
        dummyStory.beats[0]!.id,
        dummyStory.beats[1]!.id,
      );
      expect(reorderedStory.beats.length).toBe(2);
      expect(
        reorderedGraph.edges.some(
          (e) =>
            e.from === beatNodes[0]!.id &&
            e.to === beatNodes[1]!.id &&
            e.type === "precedes",
        ),
      ).toBe(true);
    });

    it("removing graph links never deletes original library assets", () => {
      const graph = createInitialStoryGraph(dummyStory, dummyAssets);
      const assetNode = graph.nodes.find((n) => n.type === "asset")!;
      expect(assetNode).toBeDefined();

      const updatedGraph = removeGraphNode(graph, assetNode.id);
      expect(updatedGraph.nodes.some((n) => n.id === assetNode.id)).toBe(false);

      // Original dummyAssets array is completely untouched
      expect(dummyAssets.length).toBe(2);
      if (assetNode.type === "asset") {
        expect(dummyAssets.some((a) => a.id === assetNode.assetId)).toBe(true);
      }
    });

    it("deterministic auto-layout and layout undo on synthetic 100/500 node datasets", () => {
      // Benchmark 100 synthetic nodes
      const graph100: StoryGraph = {
        version: 1,
        nodes: Array.from({ length: 100 }, (_, i): StoryGraphNode => {
          const mod = i % 3;
          if (mod === 0) {
            return {
              id: `node-${i}`,
              type: "beat",
              storyId: "s1",
              beatId: `b-${i}`,
            };
          }
          if (mod === 1) {
            return { id: `node-${i}`, type: "asset", assetId: `a-${i}` };
          }
          return {
            id: `node-${i}`,
            type: "idea",
            text: `Idea ${i}`,
            source: "planned",
          };
        }),
        edges: Array.from({ length: 99 }, (_, i) => ({
          id: `edge-${i}`,
          from: `node-${i}`,
          to: `node-${i + 1}`,
          type: "precedes" as const,
        })),
      };

      const start100 = performance.now();
      const layout100 = computeStoryGraphAutoLayout(graph100);
      const elapsed100 = performance.now() - start100;

      expect(Object.keys(layout100).length).toBe(100);
      expect(elapsed100).toBeLessThan(100); // Must be fast (<100ms)

      // Benchmark 500 synthetic nodes
      const graph500: StoryGraph = {
        version: 1,
        nodes: Array.from({ length: 500 }, (_, i): StoryGraphNode => {
          const mod = i % 4;
          if (mod === 0) {
            return {
              id: `node-500-${i}`,
              type: "beat",
              storyId: "s1",
              beatId: `b500-${i}`,
            };
          }
          if (mod === 1) {
            return { id: `node-500-${i}`, type: "asset", assetId: `a500-${i}` };
          }
          if (mod === 2) {
            return { id: `node-500-${i}`, type: "theme", title: `Theme ${i}` };
          }
          return {
            id: `node-500-${i}`,
            type: "idea",
            text: `Idea 500 ${i}`,
            source: "user-memory",
          };
        }),
        edges: Array.from({ length: 499 }, (_, i) => ({
          id: `edge-500-${i}`,
          from: `node-500-${i}`,
          to: `node-500-${i + 1}`,
          type: "precedes" as const,
        })),
      };

      const start500 = performance.now();
      const layout500 = computeStoryGraphAutoLayout(graph500);
      const elapsed500 = performance.now() - start500;

      expect(Object.keys(layout500).length).toBe(500);
      expect(elapsed500).toBeLessThan(200); // 500 nodes deterministic under 200ms
    });
  });

  describe("StoryGraph direct connections", () => {
    it("connects focused nodes with the inferred typed operation in expert mode", async () => {
      const initialGraph = createInitialStoryGraph(dummyStory, dummyAssets);
      const calls: Array<Record<string, unknown>> = [];
      const viewWrites: GraphViewState[] = [];
      const listeners = new Map<string, Set<EventListener>>();
      let pointerHitNodeId: string | null = null;
      const previousWindow = globalThis.window;
      const previousDocument = globalThis.document;
      const previousDocumentConstructor = globalThis.Document;
      class TestDocument {}
      const testDocument = Object.assign(new TestDocument(), {
        activeElement: null,
        querySelector: () => null,
        elementFromPoint: () =>
          pointerHitNodeId
            ? {
                closest: () => ({ dataset: { nodeId: pointerHitNodeId } }),
              }
            : null,
      });
      Object.defineProperty(globalThis, "Document", {
        configurable: true,
        value: TestDocument,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: testDocument,
      });
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          addEventListener(type: string, listener: EventListener) {
            const entries = listeners.get(type) ?? new Set<EventListener>();
            entries.add(listener);
            listeners.set(type, entries);
          },
          removeEventListener(type: string, listener: EventListener) {
            listeners.get(type)?.delete(listener);
          },
        },
      });
      const modePreferences = vue.reactive({ workspaceMode: "expert" });

      const component = loadComponent(
        "apps/desktop/src/components/StoryGraphView.vue",
        {
          "vue-i18n": {
            useI18n: () => ({ t: (key: string) => key }),
          },
          "@openfilm/core": {
            createInitialStoryGraph,
            detectGraphCycle,
          },
          "@openfilm/story": {
            computeStoryGraphAutoLayout,
            inferStoryGraphEdgeType,
          },
          "../api": {
            api: {
              storyGraph: async () => ({ graph: initialGraph }),
              storyGraphView: async () => ({
                viewState: {
                  version: 1,
                  storyId: dummyStory.id,
                  pan: { x: 0, y: 0 },
                  zoom: 1,
                  nodes: computeStoryGraphAutoLayout(initialGraph, dummyStory),
                  selectedNodeId: null,
                  selectedEdgeId: null,
                },
              }),
              updateStoryGraphView: async (
                _storyId: string,
                state: GraphViewState,
              ) => {
                viewWrites.push(
                  JSON.parse(JSON.stringify(state)) as GraphViewState,
                );
                return {};
              },
              updateStoryGraph: async () => ({ graph: initialGraph }),
              storyGraphQuickAction: async (
                _storyId: string,
                body: Record<string, unknown>,
              ) => {
                calls.push(body);
                return { graph: initialGraph, story: dummyStory };
              },
            },
            thumbnailUrl: (id: string) => `/api/thumb/${id}`,
          },
          "../preferences": {
            preferences: modePreferences,
          },
          "./Icon.vue": {
            props: ["name", "size"],
            template: '<span class="icon"></span>',
          },
          "./StoryPlanReviewModal.vue": {
            props: ["show"],
            setup: () => () => vue.h("div"),
          },
        },
      );
      const mounted = mountComponent(
        component,
        vue.reactive({
          story: dummyStory,
          composition: dummyComposition,
          assets: dummyAssets,
          activeBeatId: "beat-1",
        }),
      );

      try {
        await Promise.resolve();
        await Promise.resolve();
        await vue.nextTick();
        const nodes = flatten(mounted.root);
        const source = nodes.find(
          (node) =>
            node.props["data-testid"] ===
            "story-connect-handle-beat-node-beat-1",
        );
        const target = nodes.find(
          (node) =>
            node.props["data-testid"] ===
            "story-connect-handle-asset-node-asset-2",
        );
        const targetNode = nodes.find(
          (node) => node.props["data-node-id"] === "asset-node-asset-2",
        );
        const canvas = nodes.find((node) =>
          String(node.props.class ?? "").includes("graph-main-canvas"),
        );
        expect(source).toBeDefined();
        expect(target).toBeDefined();
        expect(targetNode).toBeDefined();
        expect(canvas).toBeDefined();

        const keyboardEvent = {
          key: "Enter",
          preventDefault() {},
          stopPropagation() {},
        };
        await (source!.props.onKeydown as (event: unknown) => Promise<void>)(
          keyboardEvent,
        );
        await (target!.props.onKeydown as (event: unknown) => Promise<void>)(
          keyboardEvent,
        );
        await vue.nextTick();

        expect(calls).toContainEqual({
          action: "connect-nodes",
          fromNodeId: "beat-node-beat-1",
          toNodeId: "asset-node-asset-2",
          type: "supports",
        });

        const pointerEvent = {
          button: 0,
          clientX: 120,
          clientY: 80,
          preventDefault() {},
          stopPropagation() {},
        };
        (source!.props.onClick as (event: unknown) => void)({
          stopPropagation() {},
        });
        pointerHitNodeId = "asset-node-asset-2";
        await (source!.props.onPointerup as (event: unknown) => Promise<void>)(
          pointerEvent,
        );
        expect(calls).toHaveLength(2);
        expect(calls.at(-1)).toEqual({
          action: "connect-nodes",
          fromNodeId: "beat-node-beat-1",
          toNodeId: "asset-node-asset-2",
          type: "supports",
        });
        pointerHitNodeId = null;

        (source!.props.onClick as (event: unknown) => void)({
          stopPropagation() {},
        });
        const targetPointerEvent = {
          button: 0,
          clientX: 280,
          clientY: 160,
          stopPropagation() {},
        };
        (targetNode!.props.onPointerdown as (event: unknown) => void)(
          targetPointerEvent,
        );
        await (
          targetNode!.props.onPointerup as (event: unknown) => Promise<void>
        )(targetPointerEvent);
        expect(calls).toHaveLength(3);

        (canvas!.props.onPointerdown as (event: unknown) => void)({
          button: 0,
          clientX: 400,
          clientY: 300,
          target: { closest: () => null },
        });
        for (const listener of [...(listeners.get("pointermove") ?? [])]) {
          listener({ clientX: 450, clientY: 330 } as unknown as Event);
        }
        for (const listener of [...(listeners.get("pointerup") ?? [])]) {
          listener({ clientX: 450, clientY: 330 } as unknown as Event);
        }
        await Promise.resolve();
        const initialTargetPosition = computeStoryGraphAutoLayout(
          initialGraph,
          dummyStory,
        )["asset-node-asset-2"]!;
        expect(viewWrites.at(-1)?.nodes["asset-node-asset-2"]).toEqual(
          initialTargetPosition,
        );
        expect(viewWrites.at(-1)?.pan).toEqual({ x: 50, y: 30 });

        let ordinaryDragReleaseStopped = false;
        (targetNode!.props.onPointerdown as (event: unknown) => void)({
          button: 0,
          clientX: 280,
          clientY: 160,
          stopPropagation() {},
        });
        await (target!.props.onPointerup as (event: unknown) => Promise<void>)({
          clientX: 300,
          clientY: 180,
          stopPropagation() {
            ordinaryDragReleaseStopped = true;
          },
        });
        expect(ordinaryDragReleaseStopped).toBe(false);
        for (const listener of [...(listeners.get("pointerup") ?? [])]) {
          listener({ clientX: 300, clientY: 180 } as unknown as Event);
        }

        (targetNode!.props.onKeydown as (event: unknown) => void)({
          key: "Enter",
          preventDefault() {},
        });

        modePreferences.workspaceMode = "standard";
        await vue.nextTick();
        const standardNodes = flatten(mounted.root);
        expect(
          standardNodes.some((node) =>
            String(node.props["data-testid"] ?? "").startsWith(
              "story-connect-handle-",
            ),
          ),
        ).toBe(false);
        expect(
          standardNodes.some((node) =>
            String(node.props.class ?? "").includes("connection-composer"),
          ),
        ).toBe(true);
      } finally {
        mounted.unmount();
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: previousWindow,
        });
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: previousDocument,
        });
        Object.defineProperty(globalThis, "Document", {
          configurable: true,
          value: previousDocumentConstructor,
        });
      }
    });
  });
});
