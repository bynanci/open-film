import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidatesFromIntelligence, snapTime } from "@openfilm/analysis";
import type { TranscriptSegment } from "@openfilm/core";
import { waveformPath } from "../../apps/desktop/src/waveform";

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
interface HostNode {
  tag: string;
  text: string;
  props: Record<string, unknown>;
  children: HostNode[];
  parent: HostNode | null;
  currentTime: number;
  pause: () => void;
  addEventListener: () => void;
  getBoundingClientRect: () => { left: number; width: number };
}
interface HostApp {
  mount: (root: HostNode) => void;
  unmount: () => void;
}
const vue = desktopRequire("vue") as Record<string, unknown> & {
  createRenderer: (host: object) => {
    createApp: (component: object, props: object) => HostApp;
  };
  nextTick: () => Promise<void>;
  ref: <T>(value: T) => { value: T };
};
const compiler = desktopRequire("@vue/compiler-sfc") as {
  parse: (source: string, options: object) => { descriptor: unknown };
  compileScript: (descriptor: unknown, options: object) => { content: string };
};

function node(tag: string, text = ""): HostNode {
  return {
    tag,
    text,
    props: {},
    children: [],
    parent: null,
    currentTime: 0,
    pause: () => undefined,
    addEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, width: 800 }),
  };
}
function flatten(root: HostNode): HostNode[] {
  return [root, ...root.children.flatMap(flatten)];
}

// Compile the actual SFC script and template; only media/network/DOM I/O is
// supplied by the host. Translation calls count word-button render work without
// production instrumentation or an environment-sensitive millisecond budget.
function component(
  path: string,
  dependencies: Record<string, unknown>,
): object {
  const { descriptor } = compiler.parse(readFileSync(path, "utf8"), {
    filename: path,
  });
  const compiled = compiler.compileScript(descriptor, {
    id: path,
    inlineTemplate: true,
  });
  const code = transformSync(compiled.content, {
    loader: "ts",
    format: "cjs",
  }).code;
  const module = { exports: {} as { default?: object } };
  new Function("require", "module", "exports", code)(
    (name: string): unknown => {
      if (name.endsWith(".vue"))
        return {
          __esModule: true,
          default: component(resolve(dirname(path), name), dependencies),
        };
      if (!(name in dependencies))
        throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports,
  );
  return module.exports.default!;
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
});

async function mountPrecision(
  segments: TranscriptSegment[],
  total = segments.length,
) {
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("document", { activeElement: null });
  const wordLabels = vi.fn();
  const locale = vue.ref("en-US");
  const api = {
    intelligence: vi.fn(async () => ({
      sourceHash: "synthetic-source",
      transcript: {
        id: "synthetic-transcript",
        assetId: "asset",
        provenance: { providerId: "test", createdAt: "2026-10-08T00:00:00Z" },
        segments,
      },
      transcriptTotal: total,
      transcriptOffset: 0,
      markers: [],
    })),
    intelligenceProviders: vi.fn(async () => ({
      transcription: { available: false },
    })),
  };
  const request = vi.fn(async () => ({ jobs: [] }));
  const parent = component(
    resolve("apps/desktop/src/components/PrecisionEditor.vue"),
    {
      vue,
      "vue-i18n": {
        useI18n: () => ({
          t: (key: string, values?: Record<string, unknown>) => {
            if (key === "precision.word") wordLabels(values);
            return `${locale.value}:${key}:${JSON.stringify(values ?? {})}`;
          },
          te: () => true,
        }),
      },
      "@openfilm/analysis": { candidatesFromIntelligence, snapTime },
      "../api": { api, request, sourceUrl: () => "fixture.mp4" },
      "../i18n": {
        errorDetail: String,
        formatNumber: String,
        localizeError: String,
      },
      "../waveform": { waveformPath },
    },
  );
  const renderer = vue.createRenderer({
    createElement: (tag: string) => node(tag),
    createText: (text: string) => node("text", text),
    createComment: (text: string) => node("comment", text),
    setText: (element: HostNode, text: string) => {
      element.text = text;
    },
    setElementText: (element: HostNode, text: string) => {
      element.text = text;
    },
    patchProp: (
      element: HostNode,
      key: string,
      _old: unknown,
      value: unknown,
    ) => {
      element.props[key] = value;
    },
    insert: (element: HostNode, parent: HostNode, anchor?: HostNode) => {
      if (element.parent) {
        const at = element.parent.children.indexOf(element);
        if (at >= 0) element.parent.children.splice(at, 1);
      }
      element.parent = parent;
      const at = anchor ? parent.children.indexOf(anchor) : -1;
      if (at >= 0) parent.children.splice(at, 0, element);
      else parent.children.push(element);
    },
    remove: (element: HostNode) => {
      const parent = element.parent;
      if (!parent) return;
      const at = parent.children.indexOf(element);
      if (at >= 0) parent.children.splice(at, 1);
      element.parent = null;
    },
    parentNode: (element: HostNode) => element.parent,
    nextSibling: (element: HostNode) =>
      element.parent?.children[element.parent.children.indexOf(element) + 1] ??
      null,
  });
  const root = node("root");
  const app = renderer.createApp(parent, {
    projectId: "project",
    active: true,
    busy: false,
    asset: {
      id: "asset",
      uri: "fixture.mp4",
      mediaType: "video",
      duration: 4000,
      state: {},
    },
    clip: { id: "clip", assetId: "asset", sourceIn: 0, sourceOut: 4000 },
    clips: [{ id: "clip", label: "Synthetic recording" }],
    submit: vi.fn(() => true),
  });
  app.mount(root);
  cleanup.push(() => app.unmount());
  await vue.nextTick();
  await vue.nextTick();
  return { root, wordLabels, api, request, locale };
}

function wordButtons(root: HostNode) {
  return flatten(root).filter(
    (element) =>
      element.tag === "button" &&
      element.parent?.props.class === "precision-words",
  );
}

describe("Precision transcript render boundary", () => {
  it("does not rebuild a dense transcript page while hovering the waveform", async () => {
    const segments = Array.from({ length: 100 }, (_, index) => ({
      id: `segment-${index}`,
      start: index * 40,
      end: (index + 1) * 40,
      text: `Synthetic segment ${index}`,
      words: Array.from({ length: 40 }, (_, word) => ({
        start: index * 40 + word,
        end: index * 40 + word + 1,
        text: `word-${word}`,
      })),
    }));
    const { root, wordLabels, api, request } = await mountPrecision(segments);
    const surface = flatten(root).find(
      (element) => element.props.class === "precision-waveform",
    )!;
    expect(wordLabels).toHaveBeenCalledTimes(4000);
    wordLabels.mockClear();
    const reads = api.intelligence.mock.calls.length;
    const jobReads = request.mock.calls.length;
    for (let frame = 1; frame <= 20; frame++) {
      (surface.props.onPointermove as (event: object) => void)({
        clientX: frame * 10,
      });
      await vue.nextTick();
    }
    expect(wordLabels.mock.calls.length).toBe(0);
    expect(api.intelligence).toHaveBeenCalledTimes(reads);
    expect(request).toHaveBeenCalledTimes(jobReads);
  });

  it("keeps every overlapping word active and respects exclusive end boundaries while seeking", async () => {
    const { root } = await mountPrecision([
      {
        id: "overlap",
        start: 0,
        end: 4,
        text: "Overlapping provider word evidence",
        words: [
          { text: "first", start: 0, end: 3 },
          { text: "second", start: 1, end: 2 },
          { text: "third", start: 3, end: 4 },
        ],
      },
    ]);
    const player = flatten(root).find((element) => element.tag === "video")!;
    player.currentTime = 1.5;
    (player.props.onTimeupdate as () => void)();
    await vue.nextTick();
    expect(wordButtons(root).map((element) => element.props.class)).toEqual([
      "current",
      "current",
      "",
    ]);
    (wordButtons(root)[2]!.props.onClick as () => void)();
    await vue.nextTick();
    expect(player.currentTime).toBe(3);
    expect(wordButtons(root).map((element) => element.props.class)).toEqual([
      "",
      "",
      "current",
    ]);
  });

  it("hides stale word evidence while preserving segment seek and updates labels with the UI locale", async () => {
    const { root, locale, api } = await mountPrecision([
      {
        id: "original",
        start: 0,
        end: 2,
        text: "Original",
        words: [{ text: "Original", start: 0, end: 2 }],
      },
      {
        id: "corrected",
        start: 2,
        end: 4,
        text: "Corrected text",
        alignmentState: "text-edited",
        words: [{ text: "Historical evidence", start: 2, end: 4 }],
      },
    ]);
    expect(wordButtons(root)).toHaveLength(1);
    expect(
      flatten(root).filter(
        (element) => element.props["data-testid"] === "stale-alignment",
      ),
    ).toHaveLength(1);
    const corrected = flatten(root).filter(
      (element) => element.props.class === "precision-segment-seek",
    )[1]!;
    (corrected.props.onClick as () => void)();
    await vue.nextTick();
    expect(
      flatten(root).find((element) => element.tag === "video")!.currentTime,
    ).toBe(2);
    const reads = api.intelligence.mock.calls.length;
    locale.value = "ja-JP";
    await vue.nextTick();
    expect(wordButtons(root)[0]!.props["aria-label"]).toContain(
      "ja-JP:precision.word",
    );
    expect(api.intelligence).toHaveBeenCalledTimes(reads);
  });

  it("replaces the rendered page and emits source timing from the newest evidence", async () => {
    const { root, api } = await mountPrecision(
      [
        {
          id: "previous-page",
          start: 0,
          end: 2,
          text: "Previous page",
          words: [{ text: "Previous", start: 0, end: 2 }],
        },
      ],
      101,
    );
    const original = await api.intelligence.mock.results[0]!.value;
    api.intelligence.mockResolvedValueOnce({
      ...original,
      transcriptOffset: 100,
      transcript: {
        ...original.transcript,
        segments: [
          {
            id: "next-page",
            start: 301,
            end: 304,
            text: "Next page",
            words: [{ text: "Next", start: 301, end: 304 }],
          },
        ],
      },
    });
    const next = flatten(root).find(
      (element) =>
        element.tag === "button" &&
        element.text.includes(":precision.nextPage:"),
    )!;
    await (next.props.onClick as () => Promise<void>)();
    await vue.nextTick();
    expect(wordButtons(root)).toHaveLength(1);
    expect(wordButtons(root)[0]!.text).toBe("Next");
    (wordButtons(root)[0]!.props.onClick as () => void)();
    await vue.nextTick();
    expect(
      flatten(root).find((element) => element.tag === "video")!.currentTime,
    ).toBe(301);
    expect(original.transcript.segments[0]?.text).toBe("Previous page");
  });
});
