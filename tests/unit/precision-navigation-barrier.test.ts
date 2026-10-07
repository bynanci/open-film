import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clip, Job, MediaAsset, TimelineMarker } from "@openfilm/core";
import type { IntelligenceState } from "../../apps/desktop/src/api";

const vue = createRequire(resolve("apps/desktop/package.json"))("vue");
const reactivity = Object.fromEntries(
  ["ref", "shallowRef", "computed", "nextTick", "watch"].map((key) => [
    key,
    vue[key],
  ]),
);
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
});
type Ref<T> = { value: T };
type Barrier = { hasPending: Ref<boolean>; flush: () => Promise<boolean> };
function component<T>(name: string, names: string[]) {
  const source = readFileSync(
    resolve(`apps/desktop/src/components/${name}.vue`),
    "utf8",
  );
  const code = transformSync(
    source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]!,
    { loader: "ts", format: "esm" },
  ).code.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "");
  return (dependencies: Record<string, unknown>): T =>
    new Function(
      "dependencies",
      `const {${Object.keys(dependencies).join(",")}}=dependencies;\n${code}\nreturn {${names.map((name) => `${name}: typeof ${name} === "undefined" ? undefined : ${name}`).join(",")}};`,
    )(dependencies) as T;
}
// Run the real SFC scripts with Vue reactive state. Only network I/O and DOM
// lifecycle registration are supplied by the host; mutation logic is unchanged.
const precisionFactory = component<{
  addMarker: (time?: number) => Promise<void>;
  removeMarker: (marker: TimelineMarker) => Promise<void>;
  analyze: (operation: "transcribe" | "waveform" | "scenes") => Promise<void>;
  sourceVerified: Ref<boolean>;
  pending: Ref<boolean>;
}>("PrecisionEditor", [
  "addMarker",
  "removeMarker",
  "analyze",
  "sourceVerified",
  "pending",
]);
const timelineFactory = component<{
  precisionEditor?: Ref<unknown>;
  transcriptEditor: Ref<unknown>;
  editMode: Ref<"story" | "precision" | "transcript">;
  selectedClipId: Ref<string>;
  chooseClip: (clip: Clip) => void;
  setEditMode: (mode: "story" | "precision" | "transcript") => Promise<void>;
}>("TimelineEditor", [
  "precisionEditor",
  "transcriptEditor",
  "editMode",
  "selectedClipId",
  "chooseClip",
  "setEditMode",
]);
function deferred<T>() {
  let release!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  return { promise, release, reject };
}
const asset: MediaAsset = {
  id: "source",
  uri: "/media/memory.mp4",
  name: "memory.mp4",
  mediaType: "video",
  duration: 10,
  tags: [],
  state: {},
  metadata: {},
};
const clip: Clip = {
  id: "clip",
  assetId: asset.id,
  sourceIn: 0,
  sourceOut: 10,
  timelineStart: 0,
  timelineDuration: 10,
};
async function precision(activeJobs: Job[] = []) {
  const response = deferred<unknown>();
  const state: IntelligenceState = {
    sourceHash: "hash",
    transcriptTotal: 0,
    transcriptOffset: 0,
    markers: [],
  };
  const props = vue.reactive({
    projectId: "project",
    asset: { ...asset },
    clip: { ...clip },
    active: true,
    busy: false,
    sourceVersion: 0,
    clips: [],
    submit: vi.fn(),
  });
  let exposed: Partial<Barrier> = {};
  const emit = vi.fn();
  const request = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/jobs" && !options?.method)
      return Promise.resolve({ jobs: activeJobs });
    return response.promise;
  });
  const scope = vue.effectScope();
  const instance = scope.run(() =>
    precisionFactory({
      ...reactivity,
      defineProps: () => props,
      defineEmits: () => emit,
      defineExpose: (value: Barrier) => {
        exposed = value;
      },
      useI18n: () => ({ t: String, te: () => false }),
      onMounted: () => {},
      onBeforeUnmount: (stop: () => void) => cleanup.push(stop),
      cancelAnimationFrame: () => {},
      window: { removeEventListener: () => {} },
      api: {
        intelligence: vi.fn(async () => state),
        intelligenceProviders: vi.fn(async () => ({
          transcription: { available: true },
        })),
      },
      request,
    }),
  )!;
  cleanup.push(() => scope.stop());
  await vi.waitFor(() => expect(instance.sourceVerified.value).toBe(true));
  await vue.nextTick();
  return { instance, props, exposed, response, request, emit };
}
function timeline(child: Partial<Barrier>) {
  const calls: string[] = [];
  let compositionResult = true;
  let transcriptResult = true;
  let exposed!: Barrier;
  const compositionPending = vue.ref(false);
  const compositionFlush = vi.fn(async () => {
    calls.push("composition");
    return compositionResult;
  });
  const transcriptFlush = vi.fn(async () => {
    calls.push("transcript");
    return transcriptResult;
  });
  const instance = timelineFactory({
    ...reactivity,
    defineProps: () => ({ projectId: "project", compositionId: "film" }),
    defineEmits: () => vi.fn(),
    defineExpose: (value: Barrier) => {
      exposed = value;
    },
    useI18n: () => ({ t: String }),
    onMounted: () => {},
    onBeforeUnmount: () => {},
    watch: () => {},
    useTimelineEditor: () => ({
      state: vue.ref(null),
      status: vue.ref("saved"),
      hasPending: compositionPending,
      historyBusy: vue.ref(false),
      flush: compositionFlush,
    }),
  });
  if (instance.precisionEditor)
    instance.precisionEditor.value = vue.proxyRefs(child);
  instance.transcriptEditor.value = {
    hasPending: false,
    flush: transcriptFlush,
  };
  return {
    instance,
    exposed,
    calls,
    compositionPending,
    compositionFlush,
    transcriptFlush,
    compositionFails: () => {
      compositionResult = false;
    },
    transcriptFails: () => {
      transcriptResult = false;
    },
  };
}

describe("Precision navigation retains in-flight mutation submissions", () => {
  it.each(["add", "remove", "analyze"] as const)(
    "blocks navigation until the %s request settles",
    async (operation) => {
      const h = await precision();
      const mutation =
        operation === "add"
          ? h.instance.addMarker(3)
          : operation === "remove"
            ? h.instance.removeMarker({
                id: "marker",
                assetId: asset.id,
                time: 3,
                type: "manual",
              })
            : h.instance.analyze("waveform");
      expect(h.exposed.hasPending?.value).toBe(true);
      expect(await h.exposed.flush?.()).toBe(false);
      h.response.release({
        job: {
          id: "new-job",
          assetId: asset.id,
          type: "waveform",
          status: "queued",
        },
      });
      await mutation;
      expect(h.exposed.hasPending?.value).toBe(false);
      expect(await h.exposed.flush?.()).toBe(true);
    },
  );
  it("does not block read-only observation of an analysis owned elsewhere", async () => {
    const h = await precision([
      {
        id: "foreign-job",
        assetId: asset.id,
        type: "transcribe",
        status: "running",
      },
    ]);
    expect(h.exposed.hasPending?.value).toBe(false);
    expect(await h.exposed.flush?.()).toBe(true);
    await h.instance.analyze("waveform");
    expect(
      h.request.mock.calls.filter(([, options]) => options?.method),
    ).toHaveLength(0);
    // Manual markers remain editable while observing that foreign analysis.
    const mutation = h.instance.addMarker(2);
    expect(h.exposed.hasPending?.value).toBe(true);
    h.response.release({});
    await mutation;
    expect(await h.exposed.flush?.()).toBe(true);
  });
  it("retains the outstanding request barrier after source generation changes", async () => {
    const h = await precision();
    const mutation = h.instance.addMarker(4);
    h.props.sourceVersion++;
    await vue.nextTick();
    expect(h.instance.pending.value).toBe(false);
    expect(h.exposed.hasPending?.value).toBe(true);
    expect(await h.exposed.flush?.()).toBe(false);
    h.response.release({});
    await mutation;
    expect(await h.exposed.flush?.()).toBe(true);
  });
  it("releases the barrier after a failed mutation rather than trapping navigation", async () => {
    const h = await precision();
    const mutation = h.instance.addMarker(4);
    expect(h.exposed.hasPending?.value).toBe(true);
    h.response.reject({ code: "operation.failed" });
    await mutation;
    expect(h.exposed.hasPending?.value).toBe(false);
    expect(await h.exposed.flush?.()).toBe(true);
  });
  it("Timeline delegates Precision pending state and guards mode and source selection", async () => {
    const child = await precision();
    const h = timeline(child.exposed);
    h.instance.editMode.value = "precision";
    h.instance.selectedClipId.value = clip.id;
    const mutation = child.instance.addMarker(3);
    expect(h.exposed.hasPending.value).toBe(true);
    expect(await h.exposed.flush()).toBe(false);
    await h.instance.setEditMode("story");
    expect(h.instance.editMode.value).toBe("precision");
    h.instance.chooseClip({
      ...clip,
      id: "other-clip",
      assetId: "other-asset",
    });
    expect(h.instance.selectedClipId.value).toBe(clip.id);
    child.response.release({});
    await mutation;
    expect(h.exposed.hasPending.value).toBe(false);
    expect(await h.exposed.flush()).toBe(true);
    h.instance.chooseClip({ ...clip, id: "other-clip" });
    expect(h.instance.selectedClipId.value).toBe("other-clip");
    await h.instance.setEditMode("story");
    expect(h.instance.editMode.value).toBe("story");
  });
  it.each(["composition", "transcript"] as const)(
    "preserves failed %s draft barriers and their existing flush order",
    async (failed) => {
      const precisionFlush = vi.fn(async () => true);
      const h = timeline({ hasPending: vue.ref(false), flush: precisionFlush });
      if (failed === "composition") h.compositionFails();
      else h.transcriptFails();
      expect(await h.exposed.flush()).toBe(false);
      expect(h.calls).toEqual(
        failed === "composition"
          ? ["composition"]
          : ["composition", "transcript"],
      );
      expect(precisionFlush).not.toHaveBeenCalled();
    },
  );
});
