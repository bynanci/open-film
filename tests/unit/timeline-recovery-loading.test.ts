import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTimelineCommand, type TimelineCommand } from "@openfilm/solver";
import { ApiError, type EditorState } from "../../apps/desktop/src/api";

// Exercise the production composable with Vue refs and the real timeline
// command implementation. Delay only HTTP delivery and replace browser storage.
const vue = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
)("vue") as { computed: unknown; ref: unknown; shallowRef: unknown };
type Editor = {
  state: { value: EditorState | null };
  status: { value: string };
  hasPending: { value: boolean };
  flush: () => Promise<boolean>;
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function initialState(): EditorState {
  return {
    revision: "revision-before",
    canUndo: false,
    canRedo: false,
    story: {
      id: "story",
      title: "Memories",
      targetDuration: 4,
      maxDuration: 8,
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

describe("timeline recovery while the initial snapshot is pending", () => {
  for (const kind of ["queued draft", "in-flight receipt"] as const) {
    it(`keeps ${kind} pending and preserves its bytes through flush and beforeunload`, async () => {
      const state = initialState();
      const command: TimelineCommand = {
        type: "duration",
        clipId: "clip",
        duration: 5,
      };
      const saved: EditorState = {
        ...state,
        ...applyTimelineCommand(state, state.assets, command),
        revision: "revision-after",
        canUndo: true,
      };
      const bytes = JSON.stringify({
        state,
        pending: [command],
        batch:
          kind === "queued draft"
            ? null
            : {
                baseRevision: state.revision,
                requestId: "11111111-1111-4111-8111-111111111111",
                commands: [command],
              },
      });
      const key = "openfilm:editor:project:cut";
      const store = new Map([[key, bytes]]);
      vi.stubGlobal("localStorage", {
        getItem: (name: string) => store.get(name) ?? null,
        setItem: (name: string, value: string) => store.set(name, value),
        removeItem: (name: string) => store.delete(name),
      });
      const browser = new EventTarget();
      vi.stubGlobal("window", browser);
      const snapshot = deferred<EditorState>();
      const receipt = deferred<EditorState>();
      const api = {
        editor: vi.fn(() => snapshot.promise),
        edit: vi.fn(() =>
          kind === "queued draft" ? Promise.resolve(saved) : receipt.promise,
        ),
      };
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
      expect.soft(editor.hasPending.value).toBe(true);
      expect.soft(await editor.flush()).toBe(false);
      expect.soft(editor.status.value).toBe("loading");
      browser.dispatchEvent(new Event("beforeunload", { cancelable: true }));
      expect.soft(store.get(key)).toBe(bytes);
      expect.soft(editor.state.value).toBeNull();
      expect
        .soft(api.edit)
        .toHaveBeenCalledTimes(kind === "queued draft" ? 0 : 1);

      if (kind === "in-flight receipt") {
        receipt.resolve(saved);
        await vi.waitFor(() => expect(api.editor).toHaveBeenCalledTimes(1));
      }
      snapshot.resolve(kind === "queued draft" ? state : saved);
      await vi.waitFor(() =>
        expect(editor.state.value?.composition.duration).toBe(5),
      );
      await expect(editor.flush()).resolves.toBe(true);
      expect(store.has(key)).toBe(false);
      expect(api.edit).toHaveBeenCalledTimes(1);
    });
  }

  it.each(["success", "failure"] as const)(
    "keeps a newer recovery draft when a disposed editor's read ends in %s",
    async (outcome) => {
      const state = initialState();
      const command: TimelineCommand = {
        type: "duration",
        clipId: "clip",
        duration: 5,
      };
      const bytes = JSON.stringify({ state, pending: [command], batch: null });
      const key = "openfilm:editor:project:cut";
      const store = new Map([[key, bytes]]);
      vi.stubGlobal("localStorage", {
        getItem: (name: string) => store.get(name) ?? null,
        setItem: (name: string, value: string) => store.set(name, value),
        removeItem: (name: string) => store.delete(name),
      });
      vi.stubGlobal("window", new EventTarget());
      const snapshot = deferred<EditorState>();
      let unmount!: () => void;
      const edit = vi.fn();
      const editor = factory({
        ...vue,
        onMounted: (callback: () => void) => callback(),
        onBeforeUnmount: (callback: () => void) => {
          unmount = callback;
        },
        applyTimelineCommand,
        api: { editor: () => snapshot.promise, edit },
        ApiError,
        useI18n: () => ({ t: (key: string) => key }),
        errorDetail: () => "",
        localizeError: () => "error",
      });
      unmount();
      expect.soft(store.get(key)).toBe(bytes);
      expect.soft(edit).not.toHaveBeenCalled();
      // A replacement editor may already own a newer local draft when this old
      // request finally returns. Its recovery bytes must remain authoritative.
      const newerBytes = JSON.stringify({
        state: { ...state, revision: "newer-revision" },
        pending: [{ ...command, duration: 7 }],
        batch: null,
      });
      store.set(key, newerBytes);
      if (outcome === "success") snapshot.resolve(state);
      else snapshot.reject(new Error("Late disconnected read"));
      await snapshot.promise.catch(() => undefined);
      expect(store.get(key)).toBe(newerBytes);
      expect(editor.state.value).toBeNull();
    },
  );

  it("does not start another project read or replace newer bytes after a disposed recovery receipt is acknowledged", async () => {
    const state = initialState();
    const command: TimelineCommand = {
      type: "duration",
      clipId: "clip",
      duration: 5,
    };
    const bytes = JSON.stringify({
      state,
      pending: [command],
      batch: {
        baseRevision: state.revision,
        requestId: "11111111-1111-4111-8111-111111111111",
        commands: [command],
      },
    });
    const key = "openfilm:editor:project:cut";
    const store = new Map([[key, bytes]]);
    vi.stubGlobal("localStorage", {
      getItem: (name: string) => store.get(name) ?? null,
      setItem: (name: string, value: string) => store.set(name, value),
      removeItem: (name: string) => store.delete(name),
    });
    vi.stubGlobal("window", new EventTarget());
    const receipt = deferred<EditorState>();
    const read = vi.fn(async () => state);
    let unmount!: () => void;
    const editor = factory({
      ...vue,
      onMounted: (callback: () => void) => callback(),
      onBeforeUnmount: (callback: () => void) => {
        unmount = callback;
      },
      applyTimelineCommand,
      api: { editor: read, edit: () => receipt.promise },
      ApiError,
      useI18n: () => ({ t: (key: string) => key }),
      errorDetail: () => "",
      localizeError: () => "error",
    });
    unmount();
    expect(store.get(key)).toBe(bytes);
    const newerBytes = JSON.stringify({
      state: { ...state, revision: "newer-revision" },
      pending: [{ ...command, duration: 7 }],
      batch: null,
    });
    store.set(key, newerBytes);
    receipt.resolve({ ...state, revision: "acknowledged-revision" });
    await receipt.promise;
    expect(read).not.toHaveBeenCalled();
    expect(store.get(key)).toBe(newerBytes);
    expect(editor.state.value).toBeNull();
  });
});
