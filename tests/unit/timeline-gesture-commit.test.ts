import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTimelineCommand, type TimelineCommand } from "@openfilm/solver";
import { ApiError, type EditorState } from "../../apps/desktop/src/api";

const vue = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
)("vue") as {
  computed: unknown;
  ref: unknown;
  shallowRef: unknown;
  watch: (source: Editor["state"], callback: () => void) => () => void;
};
type Batch = {
  baseRevision: string;
  requestId: string;
  commands: TimelineCommand[];
};
type Editor = {
  state: { value: EditorState | null };
  status: { value: string };
  hasPending: { value: boolean };
  gestureBusy: { value: boolean };
  command: (input: TimelineCommand) => boolean;
  commitGesture: (input: TimelineCommand) => Promise<boolean>;
  flush: () => Promise<boolean>;
  history: (direction: "undo" | "redo") => Promise<boolean>;
};
let factory: (dependencies: Record<string, unknown>) => Editor;
beforeAll(async () => {
  const source = await readFile(
    new URL(
      "../../apps/desktop/src/composables/useTimelineEditor.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const transformed = await transform(source, { loader: "ts", format: "esm" });
  const code = transformed.code
    .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "")
    .replace(/\nexport\s*\{[\s\S]*?\};\s*$/, "");
  factory = new Function(
    "dependencies",
    `
    const {computed,ref,shallowRef,onMounted,onBeforeUnmount,applyTimelineCommand,api,ApiError,useI18n,errorDetail,localizeError} = dependencies;
    ${code}
    return useTimelineEditor('project', 'cut', () => {}, () => {});
  `,
  ) as typeof factory;
});
afterEach(() => vi.unstubAllGlobals());

function initialState(): EditorState {
  return {
    revision: "revision-0",
    canUndo: false,
    canRedo: false,
    story: {
      id: "story",
      title: "Memories",
      targetDuration: 4,
      maxDuration: 20,
      beats: [{ id: "beat", title: "Beginning", candidateAssetIds: ["photo"] }],
    },
    composition: {
      id: "cut",
      storyId: "story",
      duration: 4,
      tracks: [
        {
          id: "track",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: "photo",
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 4,
            },
          ],
        },
      ],
    },
    assets: [
      {
        id: "photo",
        uri: "file:///synthetic.png",
        name: "Synthetic",
        mediaType: "image",
        tags: [],
        state: {},
        metadata: {},
      },
    ],
  };
}
function duration(value: number): TimelineCommand {
  return { type: "duration", clipId: "clip", duration: value };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function harness() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => store.get(name) ?? null,
    setItem: (name: string, value: string) => store.set(name, value),
    removeItem: (name: string) => store.delete(name),
  });
  vi.stubGlobal("window", new EventTarget());
  let saved = initialState();
  let revision = 0;
  function accept(batch: Batch) {
    expect(batch.baseRevision).toBe(saved.revision);
    for (const command of batch.commands)
      saved = {
        ...saved,
        ...applyTimelineCommand(saved, saved.assets, command),
      };
    saved = { ...saved, revision: `revision-${++revision}`, canUndo: true };
    return saved;
  }
  const api = {
    editor: vi.fn(async () => saved),
    edit: vi.fn(async (_compositionId: string, batch: Batch) => accept(batch)),
    history: vi.fn(async () => saved),
  };
  async function create() {
    const editor = factory({
      ...vue,
      onMounted: (callback: () => void) => callback(),
      onBeforeUnmount: () => {},
      applyTimelineCommand,
      api,
      ApiError,
      useI18n: () => ({ t: (key: string) => key }),
      errorDetail: () => "",
      localizeError: () => "error",
    });
    await vi.waitFor(() => expect(editor.status.value).not.toBe("loading"));
    return editor;
  }
  return { store, api, accept, create };
}
const storageKey = "openfilm:editor:project:cut";

describe("timeline gesture transaction boundaries", () => {
  it("saves the preceding numeric edit and two rapid gestures as three undo steps", async () => {
    const { api, create, store } = harness();
    const editor = await create();
    expect(editor.command(duration(5))).toBe(true);
    const first = editor.commitGesture(duration(6));
    const second = editor.commitGesture(duration(7));
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    await expect(editor.flush()).resolves.toBe(true);
    expect(api.edit.mock.calls.map(([, batch]) => batch.commands)).toEqual([
      [duration(5)],
      [duration(6)],
      [duration(7)],
    ]);
    expect(
      new Set(api.edit.mock.calls.map(([, batch]) => batch.requestId)).size,
    ).toBe(3);
    expect(editor.state.value?.composition.duration).toBe(7);
    expect(editor.gestureBusy.value).toBe(false);
    expect(editor.hasPending.value).toBe(false);
    expect(store.has(storageKey)).toBe(false);
  });

  it("blocks ordinary edits and keeps flush pending until all submitted gestures save", async () => {
    const { api, accept, create } = harness();
    const editor = await create();
    const firstReceipt = deferred<EditorState>();
    const secondReceipt = deferred<EditorState>();
    api.edit.mockImplementationOnce(() => firstReceipt.promise);
    api.edit.mockImplementationOnce(() => secondReceipt.promise);
    const first = editor.commitGesture(duration(6));
    const second = editor.commitGesture(duration(7));
    expect(editor.gestureBusy.value).toBe(true);
    expect(editor.command(duration(9))).toBe(false);
    expect(editor.hasPending.value).toBe(true);
    let flushed = false;
    const flushing = editor.flush().then((ok) => {
      flushed = true;
      return ok;
    });
    firstReceipt.resolve(accept(api.edit.mock.calls[0]![1]));
    await expect(first).resolves.toBe(true);
    await vi.waitFor(() => expect(api.edit).toHaveBeenCalledTimes(2));
    expect(flushed).toBe(false);
    expect(editor.hasPending.value).toBe(true);
    expect(editor.gestureBusy.value).toBe(true);
    secondReceipt.resolve(accept(api.edit.mock.calls[1]![1]));
    await expect(second).resolves.toBe(true);
    await expect(flushing).resolves.toBe(true);
    expect(editor.state.value?.composition.duration).toBe(7);
    expect(editor.gestureBusy.value).toBe(false);
  });

  it("retains both gesture boundaries and the original receipt when the preceding save fails", async () => {
    const { api, create, store } = harness();
    const editor = await create();
    const failure = deferred<EditorState>();
    api.edit.mockImplementationOnce(() => failure.promise);
    editor.command(duration(5));
    const first = editor.commitGesture(duration(6));
    const second = editor.commitGesture(duration(7));
    failure.reject(new Error("Disconnected"));
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    const draft = JSON.parse(store.get(storageKey)!);
    expect(draft.pending).toEqual([duration(5), duration(6), duration(7)]);
    expect(draft.gestures).toEqual([1, 2]);
    expect(editor.hasPending.value).toBe(true);
    expect(editor.gestureBusy.value).toBe(false);
    const request = api.edit.mock.calls[0]![1];
    await expect(editor.flush()).resolves.toBe(true);
    expect(api.edit.mock.calls[1]![1]).toEqual(request);
    expect(
      api.edit.mock.calls.slice(1).map(([, batch]) => batch.commands),
    ).toEqual([[duration(5)], [duration(6)], [duration(7)]]);
    expect(store.has(storageKey)).toBe(false);
  });

  it("reports the first gesture's success independently from a later gesture's failure", async () => {
    const { api, accept, create, store } = harness();
    const editor = await create();
    const firstReceipt = deferred<EditorState>();
    api.edit.mockImplementationOnce(() => firstReceipt.promise);
    api.edit.mockRejectedValueOnce(new Error("Second gesture disconnected"));
    const first = editor.commitGesture(duration(6));
    const second = editor.commitGesture(duration(7));
    firstReceipt.resolve(accept(api.edit.mock.calls[0]![1]));
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(JSON.parse(store.get(storageKey)!).pending).toEqual([duration(7)]);
    const request = api.edit.mock.calls[1]![1];
    await expect(editor.flush()).resolves.toBe(true);
    expect(api.edit.mock.calls[2]![1]).toEqual(request);
    expect(editor.state.value?.composition.duration).toBe(7);
  });

  it("allows an immediate explicit retry after a failed gesture result", async () => {
    const { api, create } = harness();
    const editor = await create();
    api.edit.mockRejectedValueOnce(new Error("Disconnected"));
    expect(await editor.commitGesture(duration(6))).toBe(false);
    await expect(editor.flush()).resolves.toBe(true);
    expect(api.edit).toHaveBeenCalledTimes(2);
  });

  it("drains a gesture submitted immediately after the previous gesture resolves", async () => {
    const { api, create } = harness();
    const editor = await create();
    const first = editor.commitGesture(duration(6));
    const second = first.then(() => editor.commitGesture(duration(7)));
    await vi.waitFor(() => expect(api.edit).toHaveBeenCalledTimes(2));
    await expect(second).resolves.toBe(true);
    expect(editor.hasPending.value).toBe(false);
  });

  it("keeps navigation flush waiting when Vue queues a gesture during save completion", async () => {
    const { api, accept, create } = harness();
    const editor = await create();
    const receipt = deferred<EditorState>();
    const acceptFirst = api.edit.getMockImplementation()!;
    api.edit.mockImplementationOnce(acceptFirst);
    api.edit.mockImplementationOnce(() => receipt.promise);
    let second: Promise<boolean> | undefined;
    const stop = vue.watch(editor.state, () => {
      if (editor.state.value?.revision === "revision-1" && !second)
        second = editor.commitGesture(duration(7));
    });
    try {
      const first = editor.commitGesture(duration(6));
      let navigated = false;
      const navigating = editor.flush().then((saved) => {
        navigated = true;
        return saved;
      });
      await vi.waitFor(() => expect(api.edit).toHaveBeenCalledTimes(2));
      expect(navigated).toBe(false);
      receipt.resolve(accept(api.edit.mock.calls[1]![1]));
      await expect(first).resolves.toBe(true);
      await expect(second).resolves.toBe(true);
      await expect(navigating).resolves.toBe(true);
    } finally {
      stop();
    }
  });

  it("recovers an in-flight gesture and preserves the next gesture as another undo step", async () => {
    const { api, create, store } = harness();
    const snapshot = initialState();
    store.set(
      storageKey,
      JSON.stringify({
        state: {
          ...snapshot,
          ...applyTimelineCommand(snapshot, snapshot.assets, duration(7)),
        },
        pending: [duration(6), duration(7)],
        gestures: [0, 1],
        batch: {
          baseRevision: snapshot.revision,
          requestId: "11111111-1111-4111-8111-111111111111",
          commands: [duration(6)],
        },
      }),
    );
    const editor = await create();
    expect(editor.hasPending.value).toBe(true);
    const receipt = deferred<EditorState>();
    const accepted = api.edit.getMockImplementation()!;
    api.edit.mockImplementationOnce(() => receipt.promise);
    const flushing = editor.flush();
    expect(editor.gestureBusy.value).toBe(true);
    expect(editor.command(duration(9))).toBe(false);
    receipt.resolve(await accepted("cut", api.edit.mock.calls[1]![1]));
    await expect(flushing).resolves.toBe(true);
    expect(api.edit.mock.calls.map(([, batch]) => batch.commands)).toEqual([
      [duration(6)],
      [duration(7)],
    ]);
    expect(api.edit.mock.calls[1]![1].baseRevision).toBe("revision-1");
    expect(editor.state.value?.composition.duration).toBe(7);
    expect(store.has(storageKey)).toBe(false);
  });

  it("waits for submitted gestures before requesting undo", async () => {
    const { api, accept, create } = harness();
    const editor = await create();
    const receipt = deferred<EditorState>();
    api.edit.mockImplementationOnce(() => receipt.promise);
    const gesture = editor.commitGesture(duration(6));
    const undo = editor.history("undo");
    expect(api.history).not.toHaveBeenCalled();
    receipt.resolve(accept(api.edit.mock.calls[0]![1]));
    await expect(gesture).resolves.toBe(true);
    await expect(undo).resolves.toBe(true);
    expect(api.history).toHaveBeenCalledWith("cut", "undo", "revision-1");
  });
});
