import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTimelineCommand, type TimelineCommand } from "@openfilm/solver";
import type { MediaAsset } from "@openfilm/core";
import {
  OpenFilmApplication,
  TimelineEditor,
  type TimelineEditInput,
} from "@openfilm/application";
import { ApiError, type EditorState } from "../../apps/desktop/src/api";
import type { CommitTransactionResult } from "../../apps/desktop/src/composables/useTimelineEditor";

// Exercise the production command/autosave path rather than a second UI store.
const vue = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
)("vue") as { computed: unknown; ref: unknown; shallowRef: unknown };

type Editor = {
  state: { value: EditorState | null };
  status: { value: string };
  hasPending: { value: boolean };
  transactionBusy: { readonly value: boolean };
  historyBusy: { value: boolean };
  command: (input: TimelineCommand) => boolean;
  commitTransaction: (
    input: TimelineCommand | TimelineCommand[],
    referencedAssets?: readonly MediaAsset[],
    signal?: AbortSignal,
  ) => Promise<CommitTransactionResult>;
  flush: () => Promise<boolean>;
  history: (direction: "undo" | "redo") => Promise<boolean>;
  load: () => Promise<void>;
  reapplyDraft: () => Promise<void>;
  discardDraft: () => Promise<void>;
};
let factory: (dependencies: Record<string, unknown>) => Editor;
const disposals: Array<() => void> = [];

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
    const {computed,ref,shallowRef,toRaw,onMounted,onBeforeUnmount,applyTimelineCommand,api,ApiError,useI18n,errorDetail,localizeError} = dependencies;
    ${code}
    return useTimelineEditor('project', 'cut', dependencies.changed, dependencies.edited);
    `,
  ) as typeof factory;
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function initialState(): EditorState {
  return {
    revision: "r1",
    canUndo: false,
    canRedo: false,
    story: {
      id: "story",
      title: "Fixture",
      beats: [{ id: "beat", title: "Opening", candidateAssetIds: ["photo"] }],
    },
    composition: {
      id: "cut",
      storyId: "story",
      duration: 4,
      tracks: [
        {
          id: "video",
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
        name: "Fixture",
        mediaType: "image",
        tags: [],
        state: {},
        metadata: {},
      },
    ],
  };
}

async function mountEditor(
  api: {
    editor: ReturnType<typeof vi.fn>;
    edit: ReturnType<typeof vi.fn>;
    history?: ReturnType<typeof vi.fn>;
  },
  storage = new Map<string, string>(),
) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
  let unmount!: () => void;
  const changed = vi.fn();
  const edited = vi.fn();
  const editor = factory({
    ...vue,
    onMounted: (fn: () => void) => fn(),
    onBeforeUnmount: (callback: () => void) => (unmount = callback),
    applyTimelineCommand,
    api,
    ApiError,
    useI18n: () => ({ t: (key: string) => key }),
    errorDetail: () => "",
    localizeError: () => "error",
    changed,
    edited,
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unmount();
  };
  disposals.push(dispose);
  await vi.waitFor(() => expect(editor.state.value).not.toBeNull());
  return { editor, storage, dispose, changed, edited };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function savedState(x: number, revision: string): EditorState {
  const initial = initialState();
  return {
    ...initial,
    ...applyTimelineCommand(initial, initial.assets, {
      type: "transform",
      clipId: "clip",
      x,
    }),
    revision,
    canUndo: true,
  };
}

const storageKey = "openfilm:editor:project:cut";
const gesture: TimelineCommand[] = [
  { type: "transform", clipId: "clip", x: 11 },
  { type: "duration", clipId: "clip", duration: 6 },
];

describe("P0 Inspector / Timeline command-state contract", () => {
  it("routes inspector transform and timeline lock through one optimistic command queue", async () => {
    const initial = initialState();
    let saved = initial;
    const api = {
      editor: vi.fn(async () => saved),
      edit: vi.fn(
        async (_id: string, batch: { commands: TimelineCommand[] }) => {
          for (const command of batch.commands) {
            saved = {
              ...saved,
              ...applyTimelineCommand(saved, saved.assets, command),
            };
          }
          saved = { ...saved, revision: "r2", canUndo: true };
          return saved;
        },
      ),
    };
    const { editor, storage } = await mountEditor(api);
    const transform: TimelineCommand = {
      type: "transform",
      clipId: "clip",
      x: 24,
      y: -12,
    };
    expect(editor.command(transform)).toBe(true);
    expect(
      editor.state.value?.composition.tracks[0]?.clips[0]?.transform?.x,
    ).toBe(24);
    expect(editor.status.value).toBe("saving");
    expect(editor.hasPending.value).toBe(true);
    expect(editor.command({ type: "lock", clipId: "clip", locked: true })).toBe(
      true,
    );
    expect(editor.state.value?.composition.tracks[0]?.clips[0]?.locked).toBe(
      true,
    );
    expect(await editor.flush()).toBe(true);
    expect(api.edit).toHaveBeenCalledTimes(1);
    expect(api.edit.mock.calls[0]?.[1]?.commands).toEqual([
      transform,
      { type: "lock", clipId: "clip", locked: true },
    ]);
    expect(editor.status.value).toBe("saved");
    expect(editor.hasPending.value).toBe(false);
    expect(storage.has("openfilm:editor:project:cut")).toBe(false);
    // A locked clip cannot be modified via Inspector, even if the UI fails to disable it.
    expect(editor.command({ type: "transform", clipId: "clip", x: 30 })).toBe(
      false,
    );
    expect(
      editor.state.value?.composition.tracks[0]?.clips[0]?.transform?.x,
    ).toBe(24);
  });

  it("flushes pending edits before invoking server Undo", async () => {
    const initial = initialState();
    let saved = initial;
    const order: string[] = [];
    const api = {
      editor: vi.fn(async () => initial),
      edit: vi.fn(
        async (_id: string, batch: { commands: TimelineCommand[] }) => {
          order.push("edit");
          saved = {
            ...saved,
            ...applyTimelineCommand(saved, saved.assets, batch.commands[0]!),
            revision: "r2",
            canUndo: true,
          };
          return saved;
        },
      ),
      history: vi.fn(
        async (_id: string, direction: string, revision: string) => {
          order.push(direction);
          expect(revision).toBe("r2");
          return { ...initial, revision: "r3", canRedo: true };
        },
      ),
    };
    const { editor } = await mountEditor(api);
    expect(editor.command({ type: "transform", clipId: "clip", x: 7 })).toBe(
      true,
    );
    expect(await editor.history("undo")).toBe(true);
    expect(order).toEqual(["edit", "undo"]);
    expect(
      editor.state.value?.composition.tracks[0]?.clips[0]?.transform?.x,
    ).toBeUndefined();
    expect(editor.status.value).toBe("saved");
  });

  it("retains the draft and reports conflict rather than false Saved", async () => {
    const initial = initialState();
    const api = {
      editor: vi.fn(async () => initial),
      edit: vi.fn(async () => {
        throw new ApiError("Revision changed", 409);
      }),
    };
    const { editor, storage } = await mountEditor(api);
    expect(editor.command({ type: "transform", clipId: "clip", x: 11 })).toBe(
      true,
    );
    expect(await editor.flush()).toBe(false);
    expect(editor.status.value).toBe("conflict");
    expect(editor.hasPending.value).toBe(true);
    expect(storage.has("openfilm:editor:project:cut")).toBe(true);
  });
});

describe("acknowledged professional edit transactions", () => {
  it("acknowledges the older queue before sending one fresh batch and Undo restores its exact baseline", async () => {
    const older = deferred<EditorState>();
    const acknowledgement = deferred<EditorState>();
    const baseline = savedState(7, "r2");
    const api = {
      editor: vi.fn(async () => initialState()),
      edit: vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(acknowledgement.promise),
      history: vi.fn(async () => ({
        ...baseline,
        revision: "r4",
        canRedo: true,
      })),
    };
    const { editor, storage, changed } = await mountEditor(api);
    expect(editor.command({ type: "transform", clipId: "clip", x: 7 })).toBe(
      true,
    );
    const committing = editor.commitTransaction(gesture);
    expect(editor.transactionBusy.value).toBe(true);
    expect(editor.historyBusy.value).toBe(false);
    await vi.waitFor(() => expect(api.edit).toHaveBeenCalledTimes(1));
    expect(
      editor.state.value?.composition.tracks[0]?.clips[0]?.transform?.x,
    ).toBe(7);
    expect(await editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    expect(
      editor.command({ type: "duration", clipId: "clip", duration: 9 }),
    ).toBe(false);
    expect(await editor.history("undo")).toBe(false);
    older.resolve(baseline);
    await vi.waitFor(() => expect(api.edit).toHaveBeenCalledTimes(2));
    const priorRequest = api.edit.mock.calls[0]![1];
    const transaction = api.edit.mock.calls[1]![1];
    expect(transaction).toEqual({
      baseRevision: "r2",
      requestId: expect.any(String),
      commands: gesture,
    });
    expect(transaction.requestId).not.toBe(priorRequest.requestId);
    expect(JSON.parse(storage.get(storageKey)!).batch).toEqual(transaction);
    expect(editor.state.value?.composition.duration).toBe(6);
    expect(
      editor.state.value?.composition.tracks[0]?.clips[0]?.transform?.x,
    ).toBe(11);
    expect(editor.historyBusy.value).toBe(false);
    const optimistic = editor.state.value!;
    expect(
      changed.mock.calls.filter(([state]) => state.composition.duration === 6),
    ).toHaveLength(1);
    acknowledgement.resolve({ ...optimistic, revision: "r3", canUndo: true });
    expect(await committing).toEqual({ status: "accepted", revision: "r3" });
    expect(editor.transactionBusy.value).toBe(false);
    expect(editor.hasPending.value).toBe(false);
    expect(storage.has(storageKey)).toBe(false);
    expect(await editor.history("undo")).toBe(true);
    expect(api.history).toHaveBeenCalledWith("cut", "undo", "r3");
    expect(editor.state.value?.composition).toEqual(baseline.composition);
    expect(api.edit).toHaveBeenCalledTimes(2);
  });

  it("waits for already-running history acknowledgement before choosing its base", async () => {
    const undo = deferred<EditorState>();
    const api = {
      editor: vi.fn(async () => ({ ...initialState(), canUndo: true })),
      edit: vi.fn<
        (id: string, batch: { baseRevision: string }) => Promise<EditorState>
      >(async () => savedState(11, "r3")),
      history: vi.fn(() => undo.promise),
    };
    const { editor } = await mountEditor(api);
    const undoing = editor.history("undo");
    await vi.waitFor(() => expect(api.history).toHaveBeenCalledTimes(1));
    const committing = editor.commitTransaction(gesture);
    expect(api.edit).not.toHaveBeenCalled();
    undo.resolve({ ...initialState(), revision: "r2" });
    expect(await undoing).toBe(true);
    expect(await committing).toEqual({ status: "accepted", revision: "r3" });
    expect(api.edit.mock.calls[0]![1].baseRevision).toBe("r2");
  });

  it("validates every command before publishing any part of a batch", async () => {
    const api = { editor: vi.fn(async () => initialState()), edit: vi.fn() };
    const { editor, changed, storage } = await mountEditor(api);
    const before = editor.state.value;
    expect(
      await editor.commitTransaction([
        { type: "lock", clipId: "clip", locked: true },
        { type: "transform", clipId: "clip", x: 11 },
      ]),
    ).toEqual({ status: "failed" });
    expect(editor.state.value).toBe(before);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(api.edit).not.toHaveBeenCalled();
    expect(storage.has(storageKey)).toBe(false);
    expect(editor.hasPending.value).toBe(false);
  });

  it("fences late history callbacks when disposed during the transaction's history barrier", async () => {
    const undo = deferred<EditorState>();
    const api = {
      editor: vi.fn(async () => ({ ...initialState(), canUndo: true })),
      edit: vi.fn(),
      history: vi.fn(() => undo.promise),
    };
    const { editor, changed, edited, dispose } = await mountEditor(api);
    const undoing = editor.history("undo");
    await vi.waitFor(() => expect(api.history).toHaveBeenCalledTimes(1));
    const committing = editor.commitTransaction(gesture);
    dispose();
    const atDisposal = editor.state.value;
    undo.resolve({ ...initialState(), revision: "r2" });
    expect(await undoing).toBe(false);
    expect(await committing).toEqual({ status: "cancelled" });
    expect(editor.state.value).toBe(atDisposal);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(edited).not.toHaveBeenCalled();
    expect(api.edit).not.toHaveBeenCalled();
  });

  it.each([409, 0])(
    "preserves an older failed queue without enqueueing the professional gesture after HTTP %s",
    async (status) => {
      const api = {
        editor: vi.fn(async () => initialState()),
        edit: vi.fn(async () => {
          throw new ApiError("Older request failed", status);
        }),
      };
      const { editor, storage } = await mountEditor(api);
      const older: TimelineCommand = {
        type: "transform",
        clipId: "clip",
        x: 7,
      };
      editor.command(older);
      expect(await editor.commitTransaction(gesture)).toEqual({
        status: status === 409 ? "conflict" : "failed",
      });
      const draft = JSON.parse(storage.get(storageKey)!);
      expect(draft.pending).toEqual([older]);
      expect(draft.batch.commands).toEqual([older]);
      expect(draft.transactionBase).toBeUndefined();
      expect(editor.state.value?.composition.duration).toBe(4);
      expect(api.edit).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects empty and oversized gestures instead of creating multiple API batches", async () => {
    const api = { editor: vi.fn(async () => initialState()), edit: vi.fn() };
    const { editor } = await mountEditor(api);
    for (const commands of [[], Array.from({ length: 101 }, () => gesture[0]!)])
      expect(await editor.commitTransaction(commands)).toEqual({
        status: "failed",
      });
    expect(api.edit).not.toHaveBeenCalled();
    expect(editor.state.value?.composition.duration).toBe(4);
  });

  it("validates referenced source locks without publishing their assets", async () => {
    const api = { editor: vi.fn(async () => initialState()), edit: vi.fn() };
    const { editor } = await mountEditor(api);
    const source: MediaAsset = {
      ...initialState().assets[0]!,
      id: "locked-source",
      state: { locked: true },
    };
    expect(
      await editor.commitTransaction(
        [
          { type: "replace", clipId: "clip", assetId: source.id },
          { type: "delete", clipId: "clip" },
        ],
        [source],
      ),
    ).toEqual({ status: "failed" });
    expect(editor.state.value?.assets).toHaveLength(1);
    expect(editor.state.value?.composition.tracks[0]?.clips[0]?.assetId).toBe(
      "photo",
    );
    expect(api.edit).not.toHaveBeenCalled();
  });

  it.each([
    [409, "conflict"],
    [400, "failed"],
  ] as const)(
    "reloads authoritative state after HTTP %s without leaving a queued ghost",
    async (status, result) => {
      const authoritative = savedState(6, "remote");
      const api = {
        editor: vi
          .fn()
          .mockResolvedValueOnce(initialState())
          .mockResolvedValue(authoritative),
        edit: vi.fn(async () => {
          throw new ApiError("Rejected", status);
        }),
      };
      const { editor, storage } = await mountEditor(api);
      expect(await editor.commitTransaction(gesture)).toEqual({
        status: result,
      });
      expect(editor.state.value).toEqual(authoritative);
      expect(editor.status.value).toBe(result);
      expect(editor.hasPending.value).toBe(false);
      expect(storage.has(storageKey)).toBe(false);
      await editor.flush();
      expect(api.edit).toHaveBeenCalledTimes(1);
    },
  );

  it("rolls back the optimistic transaction even if its conflict reload fails", async () => {
    const initial = initialState();
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockRejectedValue(new TypeError("Offline")),
      edit: vi.fn(async () => {
        throw new ApiError("Stale base", 409);
      }),
    };
    const { editor, storage } = await mountEditor(api);
    expect(await editor.commitTransaction(gesture)).toEqual({
      status: "conflict",
    });
    expect(editor.state.value?.composition).toEqual(initial.composition);
    expect(editor.hasPending.value).toBe(false);
    expect(storage.has(storageKey)).toBe(false);
  });

  it("retains the exact request on remount until explicit Reapply resolves the lost response", async () => {
    const acknowledgement = deferred<EditorState>();
    const saved = { ...savedState(11, "r2"), acknowledgedRevision: "r2" };
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initialState())
        .mockResolvedValue(saved),
      edit: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("ACK lost"))
        .mockReturnValueOnce(acknowledgement.promise),
    };
    const first = await mountEditor(api);
    expect(await first.editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    const bytes = first.storage.get(storageKey)!;
    const request = JSON.parse(bytes).batch;
    first.dispose();
    expect(first.storage.get(storageKey)).toBe(bytes);
    const second = await mountEditor(api, first.storage);
    expect(api.edit).toHaveBeenCalledTimes(1);
    expect(second.editor.state.value?.revision).toBe("r2");
    expect(second.editor.hasPending.value).toBe(true);
    expect(JSON.parse(second.storage.get(storageKey)!).batch).toEqual(request);
    const reapplying = second.editor.reapplyDraft();
    await vi.waitFor(() => expect(api.edit).toHaveBeenCalledTimes(2));
    expect(api.edit.mock.calls[1]![1]).toEqual(request);
    acknowledgement.resolve(saved);
    await reapplying;
    expect(second.editor.state.value?.revision).toBe("r2");
    expect(second.editor.hasPending.value).toBe(false);
    expect(second.storage.has(storageKey)).toBe(false);
  });

  it("reapply resolves an ambiguous transaction with its original request instead of rebasing it", async () => {
    const api = {
      editor: vi.fn(async () => initialState()),
      edit: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("ACK lost"))
        .mockResolvedValue(savedState(11, "r2")),
    };
    const { editor } = await mountEditor(api);
    expect(await editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    await editor.reapplyDraft();
    expect(api.edit.mock.calls[1]![1]).toEqual(api.edit.mock.calls[0]![1]);
    expect(editor.hasPending.value).toBe(false);
  });

  it("rejects a transaction while an older ordinary Reapply owns its delayed read", async () => {
    const snapshot = deferred<EditorState>();
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initialState())
        .mockReturnValueOnce(snapshot.promise),
      edit: vi
        .fn()
        .mockRejectedValueOnce(new ApiError("Stale ordinary draft", 409))
        .mockResolvedValue(savedState(7, "r3")),
    };
    const { editor } = await mountEditor(api);
    const older: TimelineCommand = { type: "transform", clipId: "clip", x: 7 };
    editor.command(older);
    expect(await editor.flush()).toBe(false);
    const reapplying = editor.reapplyDraft();
    expect(api.editor).toHaveBeenCalledTimes(2);
    const result = await editor.commitTransaction(gesture);
    const requestsDuringRead = api.edit.mock.calls.length;
    snapshot.resolve(savedState(3, "remote"));
    await reapplying;
    expect(result).toEqual({ status: "failed" });
    expect(requestsDuringRead).toBe(1);
    expect(api.edit).toHaveBeenCalledTimes(2);
    expect(api.edit.mock.calls[1]![1]).toEqual({
      baseRevision: "remote",
      requestId: expect.any(String),
      commands: [older],
    });
    expect(api.edit.mock.calls[1]![1].requestId).not.toBe(
      api.edit.mock.calls[0]![1].requestId,
    );
    expect(
      editor.state.value?.composition.tracks[0]?.clips[0]?.transform?.x,
    ).toBe(7);
    expect(editor.hasPending.value).toBe(false);
  });

  it("fences a late ordinary Reapply read after disposal without overwriting the replacement draft", async () => {
    const snapshot = deferred<EditorState>();
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initialState())
        .mockReturnValueOnce(snapshot.promise),
      edit: vi.fn(async () => {
        throw new ApiError("Stale ordinary draft", 409);
      }),
    };
    const { editor, storage, changed, dispose } = await mountEditor(api);
    editor.command({ type: "transform", clipId: "clip", x: 7 });
    expect(await editor.flush()).toBe(false);
    const reapplying = editor.reapplyDraft();
    expect(api.editor).toHaveBeenCalledTimes(2);
    dispose();
    const atDisposal = editor.state.value;
    const changedCount = changed.mock.calls.length;
    const requestCount = api.edit.mock.calls.length;
    const replacement = JSON.stringify({
      owner: "replacement",
      requestId: "newer-draft",
    });
    storage.set(storageKey, replacement);
    snapshot.resolve(savedState(3, "remote"));
    await reapplying;
    expect(storage.get(storageKey)).toBe(replacement);
    expect(editor.state.value).toBe(atDisposal);
    expect(changed).toHaveBeenCalledTimes(changedCount);
    expect(api.edit).toHaveBeenCalledTimes(requestCount);
  });

  it("keeps a possibly accepted transaction when discard cannot resolve its receipt", async () => {
    const api = {
      editor: vi.fn(async () => initialState()),
      edit: vi.fn<
        (id: string, batch: { baseRevision: string }) => Promise<EditorState>
      >(async () => {
        throw new TypeError("ACK lost");
      }),
    };
    const { editor, storage } = await mountEditor(api);
    expect(await editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    const bytes = storage.get(storageKey);
    await editor.discardDraft();
    expect(storage.get(storageKey)).toBe(bytes);
    expect(editor.hasPending.value).toBe(true);
    expect(api.edit.mock.calls[1]![1]).toEqual(api.edit.mock.calls[0]![1]);
  });

  it("keeps replacement-owner bytes and callbacks untouched when disposed after Discard resolves a professional receipt", async () => {
    const reload = deferred<EditorState>();
    const saved = savedState(11, "r2");
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initialState())
        .mockReturnValueOnce(reload.promise),
      edit: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("ACK lost"))
        .mockResolvedValue(saved),
    };
    const { editor, storage, dispose, changed, edited } =
      await mountEditor(api);
    expect(await editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    const request = JSON.parse(storage.get(storageKey)!).batch;
    const discarding = editor.discardDraft();
    await vi.waitFor(() => expect(api.editor).toHaveBeenCalledTimes(2));
    expect(api.edit.mock.calls[1]![1]).toEqual(request);
    dispose();
    const atDisposal = editor.state.value;
    const changedCount = changed.mock.calls.length;
    const editedCount = edited.mock.calls.length;
    const replacement = JSON.stringify({
      owner: "replacement",
      requestId: "keep-this-draft",
    });
    storage.set(storageKey, replacement);
    reload.resolve(saved);
    await discarding;
    expect(storage.get(storageKey)).toBe(replacement);
    expect(editor.state.value).toBe(atDisposal);
    expect(changed).toHaveBeenCalledTimes(changedCount);
    expect(edited).toHaveBeenCalledTimes(editedCount);
  });

  it("reserves Discard before an older save ACK and preserves the next transaction's lost-ACK recovery", async () => {
    const older = deferred<EditorState>();
    const reload = deferred<EditorState>();
    const lostResponse = deferred<void>();
    const baseline = savedState(7, "r2");
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initialState())
        .mockReturnValueOnce(reload.promise),
      edit: vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockImplementation(async () => {
          await lostResponse.promise;
          throw new TypeError("Professional ACK lost");
        }),
    };
    const { editor, storage } = await mountEditor(api);
    editor.command({ type: "transform", clipId: "clip", x: 7 });
    const saving = editor.flush();
    const discarding = editor.discardDraft();
    const overlapping = editor.commitTransaction(gesture);
    older.resolve(baseline);
    expect(await saving).toBe(true);
    await vi.waitFor(() => expect(api.editor).toHaveBeenCalledTimes(2));
    const requestsDuringDiscard = api.edit.mock.calls.length;
    reload.resolve(baseline);
    await discarding;
    lostResponse.resolve();
    expect(await overlapping).toEqual({ status: "failed" });
    expect(requestsDuringDiscard).toBe(1);
    expect(api.edit).toHaveBeenCalledTimes(1);
    expect(await editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    const retained = JSON.parse(storage.get(storageKey)!);
    expect(api.edit).toHaveBeenCalledTimes(2);
    expect(retained.batch).toEqual(api.edit.mock.calls[1]![1]);
    expect(retained.batch.baseRevision).toBe("r2");
    expect(retained.pending).toEqual(gesture);
    expect(editor.hasPending.value).toBe(true);
  });

  it("refuses ordinary commands and new history while Discard is waiting for an older save", async () => {
    const older = deferred<EditorState>();
    const baseline = savedState(7, "r2");
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initialState())
        .mockResolvedValue(baseline),
      edit: vi.fn(() => older.promise),
      history: vi.fn(async () => initialState()),
    };
    const { editor } = await mountEditor(api);
    editor.command({ type: "transform", clipId: "clip", x: 7 });
    const saving = editor.flush();
    const discarding = editor.discardDraft();
    const ordinaryAccepted = editor.command({
      type: "duration",
      clipId: "clip",
      duration: 9,
    });
    const undoing = editor.history("undo");
    older.resolve(baseline);
    await saving;
    await discarding;
    const undone = await undoing;
    expect(ordinaryAccepted).toBe(false);
    expect(undone).toBe(false);
    expect(api.history).not.toHaveBeenCalled();
    expect(api.edit).toHaveBeenCalledTimes(1);
  });

  it.each(["save", "history"] as const)(
    "does not reload or touch a replacement draft after disposal during Discard's %s wait",
    async (barrier) => {
      const acknowledged = deferred<EditorState>();
      const api = {
        editor: vi.fn(async () => ({ ...initialState(), canUndo: true })),
        edit: vi.fn(() => acknowledged.promise),
        history: vi.fn(() => acknowledged.promise),
      };
      const { editor, storage, dispose, edited } = await mountEditor(api);
      if (barrier === "save")
        editor.command({ type: "transform", clipId: "clip", x: 7 });
      const older =
        barrier === "save" ? editor.flush() : editor.history("undo");
      await vi.waitFor(() =>
        expect(
          barrier === "save" ? api.edit : api.history,
        ).toHaveBeenCalledTimes(1),
      );
      const discarding = editor.discardDraft();
      dispose();
      const editedCount = edited.mock.calls.length;
      const replacement = JSON.stringify({
        owner: "replacement",
        requestId: "preserve",
      });
      storage.set(storageKey, replacement);
      acknowledged.resolve(initialState());
      await older;
      await discarding;
      expect(api.editor).toHaveBeenCalledTimes(1);
      expect(storage.get(storageKey)).toBe(replacement);
      expect(edited).toHaveBeenCalledTimes(editedCount);
    },
  );

  it("does not resurrect an undone professional edit on mount after real application reconstruction", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-transaction-reconstruction-"),
    );
    let app: OpenFilmApplication | undefined;
    let first: Awaited<ReturnType<typeof mountEditor>> | undefined;
    let second: Awaited<ReturnType<typeof mountEditor>> | undefined;
    try {
      const directory = join(root, "film.openfilm");
      app = await OpenFilmApplication.create(directory, "Recovery boundary");
      const initial = initialState();
      for (const asset of initial.assets) app.catalog.upsertAsset(asset);
      app.project.stories.push(initial.story);
      app.project.timelines.push(initial.composition);
      await app.save();
      let server = new TimelineEditor(app);
      let loseAcknowledgement = true;
      const api = {
        editor: vi.fn(async () => server.get("cut")),
        edit: vi.fn(async (_id: string, request: TimelineEditInput) => {
          const saved = await server.edit("cut", request);
          if (loseAcknowledgement) {
            loseAcknowledgement = false;
            throw new TypeError("Accepted response lost");
          }
          return saved;
        }),
      };
      first = await mountEditor(api);
      const base = server.get("cut");
      expect(await first.editor.commitTransaction(gesture)).toEqual({
        status: "failed",
      });
      const request = JSON.parse(first.storage.get(storageKey)!).batch;
      const undone = await server.undo("cut", server.get("cut").revision);
      expect(undone.revision).toBe(base.revision);
      first.dispose();
      app.close();
      app = await OpenFilmApplication.open(directory);
      server = new TimelineEditor(app);
      expect(server.get("cut")).toMatchObject({
        canUndo: false,
        canRedo: false,
      });
      const path = join(directory, "project.json");
      const beforeMount = await readFile(path);
      second = await mountEditor(api, first.storage);
      expect(api.edit).toHaveBeenCalledTimes(1);
      expect(server.get("cut")).toMatchObject({
        canUndo: false,
        canRedo: false,
      });
      expect(server.get("cut").composition).toEqual(base.composition);
      expect(second.editor.state.value?.composition).toEqual(base.composition);
      expect(await readFile(path)).toEqual(beforeMount);
      expect(second.editor.hasPending.value).toBe(true);
      expect(second.editor.status.value).toBe("conflict");
      expect(JSON.parse(second.storage.get(storageKey)!).batch).toEqual(
        request,
      );
      window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
      expect(await second.editor.flush()).toBe(false);
      expect(await second.editor.history("undo")).toBe(false);
      expect(await second.editor.commitTransaction(gesture)).toEqual({
        status: "conflict",
      });
      expect(api.edit).toHaveBeenCalledTimes(1);
      await second.editor.reapplyDraft();
      expect(api.edit).toHaveBeenCalledTimes(2);
      expect(api.edit.mock.calls[1]![1]).toEqual(request);
      expect(server.get("cut")).toMatchObject({
        canUndo: true,
        canRedo: false,
      });
      expect(server.get("cut").composition.duration).toBe(6);
      expect(second.editor.hasPending.value).toBe(false);
      expect(second.storage.has(storageKey)).toBe(false);
    } finally {
      second?.dispose();
      first?.dispose();
      app?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retains reconstructed work until explicit Reapply gets a stale-base rejection", async () => {
    const saved = { ...savedState(11, "r2"), canUndo: false };
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initialState())
        .mockResolvedValue(saved),
      edit: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("ACK lost"))
        .mockRejectedValueOnce(
          new ApiError("Receipt expired; stale base", 409),
        ),
    };
    const first = await mountEditor(api);
    expect(await first.editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    const request = JSON.parse(first.storage.get(storageKey)!).batch;
    first.dispose();
    const second = await mountEditor(api, first.storage);
    await vi.waitFor(() =>
      expect(second.editor.transactionBusy.value).toBe(false),
    );
    expect(api.edit).toHaveBeenCalledTimes(1);
    expect(second.editor.state.value).toEqual(saved);
    expect(second.editor.state.value?.canUndo).toBe(false);
    expect(second.editor.hasPending.value).toBe(true);
    expect(JSON.parse(second.storage.get(storageKey)!).batch).toEqual(request);
    await second.editor.reapplyDraft();
    expect(api.edit.mock.calls[1]![1]).toEqual(request);
    expect(second.editor.hasPending.value).toBe(false);
    expect(second.storage.has(storageKey)).toBe(false);
  });

  it("discards reconstructed professional recovery without editing the reopened authoritative project or history", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-recovered-discard-"));
    let app: OpenFilmApplication | undefined;
    let first: Awaited<ReturnType<typeof mountEditor>> | undefined;
    let recovered: Awaited<ReturnType<typeof mountEditor>> | undefined;
    try {
      const directory = join(root, "film.openfilm");
      app = await OpenFilmApplication.create(directory, "Discard recovery");
      const initial = initialState();
      for (const asset of initial.assets) app.catalog.upsertAsset(asset);
      app.project.stories.push(initial.story);
      app.project.timelines.push(initial.composition);
      await app.save();
      let server = new TimelineEditor(app);
      const api = {
        editor: vi.fn(async () => server.get("cut")),
        edit: vi.fn(async (_id: string, request: TimelineEditInput) => {
          await server.edit("cut", request);
          throw new TypeError("Accepted response lost");
        }),
      };
      first = await mountEditor(api);
      expect(await first.editor.commitTransaction(gesture)).toEqual({
        status: "failed",
      });
      first.dispose();
      app.close();
      app = await OpenFilmApplication.open(directory);
      server = new TimelineEditor(app);
      const path = join(directory, "project.json");
      const bytes = await readFile(path);
      const authoritative = server.get("cut");
      recovered = await mountEditor(api, first.storage);
      expect(recovered.editor.status.value).toBe("conflict");
      api.edit.mockClear();
      await recovered.editor.discardDraft();
      expect(recovered.editor.status.value).toBe("saved");
      expect(recovered.editor.hasPending.value).toBe(false);
      expect(recovered.storage.has(storageKey)).toBe(false);
      expect(recovered.editor.state.value).toEqual(authoritative);
      expect(server.get("cut")).toEqual(authoritative);
      expect(authoritative).toMatchObject({ canUndo: false, canRedo: false });
      expect(await readFile(path)).toEqual(bytes);
      expect(api.edit).not.toHaveBeenCalled();
      expect(await recovered.editor.flush()).toBe(true);
    } finally {
      recovered?.dispose();
      first?.dispose();
      app?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reserves reconstructed Discard and fences its delayed reload after disposal and replacement", async () => {
    const initial = initialState();
    const storage = new Map([
      [
        storageKey,
        JSON.stringify({
          state: savedState(11, "r1"),
          pending: gesture,
          batch: {
            baseRevision: "r1",
            requestId: "recovered",
            commands: gesture,
          },
          transactionBase: initial,
        }),
      ],
    ]);
    const reload = deferred<EditorState>();
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initial)
        .mockReturnValueOnce(reload.promise),
      edit: vi.fn(),
      history: vi.fn(),
    };
    const { editor, dispose, changed, edited } = await mountEditor(
      api,
      storage,
    );
    const discarding = editor.discardDraft();
    expect(api.editor).toHaveBeenCalledTimes(2);
    expect(editor.command({ type: "transform", clipId: "clip", x: 7 })).toBe(
      false,
    );
    expect(await editor.history("undo")).toBe(false);
    expect(await editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    dispose();
    const atDisposal = editor.state.value;
    const changedCount = changed.mock.calls.length;
    const editedCount = edited.mock.calls.length;
    const replacement = JSON.stringify({
      owner: "replacement",
      requestId: "preserve",
    });
    storage.set(storageKey, replacement);
    reload.resolve(savedState(3, "r2"));
    await discarding;
    expect(editor.state.value).toBe(atDisposal);
    expect(storage.get(storageKey)).toBe(replacement);
    expect(changed).toHaveBeenCalledTimes(changedCount);
    expect(edited).toHaveBeenCalledTimes(editedCount);
    expect(api.edit).not.toHaveBeenCalled();
    expect(api.history).not.toHaveBeenCalled();
  });

  it("keeps explicit Reapply available when the recovered professional snapshot read fails", async () => {
    const api = {
      editor: vi
        .fn()
        .mockResolvedValueOnce(initialState())
        .mockRejectedValueOnce(new TypeError("Snapshot unavailable")),
      edit: vi
        .fn()
        .mockRejectedValueOnce(new TypeError("ACK lost"))
        .mockResolvedValue(savedState(11, "r2")),
    };
    const first = await mountEditor(api);
    expect(await first.editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    const request = JSON.parse(first.storage.get(storageKey)!).batch;
    first.dispose();
    const second = await mountEditor(api, first.storage);
    expect(api.edit).toHaveBeenCalledTimes(1);
    expect(second.editor.status.value).toBe("conflict");
    expect(second.editor.hasPending.value).toBe(true);
    expect(JSON.parse(second.storage.get(storageKey)!).batch).toEqual(request);
    expect(await second.editor.flush()).toBe(false);
    await second.editor.reapplyDraft();
    expect(api.edit.mock.calls[1]![1]).toEqual(request);
    expect(second.editor.status.value).toBe("saved");
    expect(second.editor.hasPending.value).toBe(false);
  });

  it("sends nothing when already aborted", async () => {
    const api = { editor: vi.fn(async () => initialState()), edit: vi.fn() };
    const { editor, storage, changed } = await mountEditor(api);
    const controller = new AbortController();
    controller.abort();
    expect(
      await editor.commitTransaction(gesture, [], controller.signal),
    ).toEqual({ status: "cancelled" });
    expect(api.edit).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(storage.has(storageKey)).toBe(false);
    expect(editor.transactionBusy.value).toBe(false);
  });

  it.each(["abort", "dispose"] as const)(
    "does not send the transaction after %s during its older queue barrier",
    async (cancellation) => {
      const older = deferred<EditorState>();
      const api = {
        editor: vi.fn(async () => initialState()),
        edit: vi.fn(() => older.promise),
      };
      const { editor, dispose } = await mountEditor(api);
      editor.command({ type: "transform", clipId: "clip", x: 7 });
      const controller = new AbortController();
      const committing = editor.commitTransaction(
        gesture,
        [],
        controller.signal,
      );
      await vi.waitFor(() => expect(api.edit).toHaveBeenCalledTimes(1));
      if (cancellation === "abort") controller.abort();
      else dispose();
      older.resolve(savedState(7, "r2"));
      expect(await committing).toEqual({ status: "cancelled" });
      expect(api.edit).toHaveBeenCalledTimes(1);
      expect(editor.state.value?.composition.duration).toBe(4);
    },
  );

  it.each(["success", "failure"] as const)(
    "retains a request aborted after send when its late response is %s, then resolves it idempotently",
    async (outcome) => {
      const response = deferred<void>();
      const saved = savedState(11, "r2");
      const api = {
        editor: vi
          .fn()
          .mockResolvedValueOnce(initialState())
          .mockResolvedValue(saved),
        edit: vi
          .fn()
          .mockImplementationOnce(async () => {
            await response.promise;
            if (outcome === "failure")
              throw new DOMException("Aborted", "AbortError");
            return saved;
          })
          .mockResolvedValue(saved),
      };
      const { editor, storage } = await mountEditor(api);
      const controller = new AbortController();
      const committing = editor.commitTransaction(
        gesture,
        [],
        controller.signal,
      );
      await vi.waitFor(() => expect(api.edit).toHaveBeenCalledTimes(1));
      expect(api.edit.mock.calls[0]![2]).toBe(controller.signal);
      const bytes = storage.get(storageKey)!;
      controller.abort();
      response.resolve();
      expect(await committing).toEqual({ status: "cancelled" });
      expect(storage.get(storageKey)).toBe(bytes);
      expect(editor.hasPending.value).toBe(true);
      await editor.load();
      expect(api.edit).toHaveBeenCalledTimes(1);
      expect(editor.hasPending.value).toBe(true);
      await editor.reapplyDraft();
      expect(api.edit.mock.calls[1]![1]).toEqual(JSON.parse(bytes).batch);
      expect(storage.has(storageKey)).toBe(false);
    },
  );

  it.each(["success", "failure"] as const)(
    "fences a disposed owner's late %s and preserves the replacement owner's draft",
    async (outcome) => {
      const response = deferred<void>();
      const api = {
        editor: vi.fn(async () => initialState()),
        edit: vi.fn(async () => {
          await response.promise;
          if (outcome === "failure")
            throw new TypeError("Late disconnected response");
          return savedState(11, "r2");
        }),
      };
      const { editor, storage, changed, edited, dispose } =
        await mountEditor(api);
      const committing = editor.commitTransaction(gesture);
      await vi.waitFor(() => expect(api.edit).toHaveBeenCalledTimes(1));
      dispose();
      const stateAtDisposal = editor.state.value;
      const changedCount = changed.mock.calls.length;
      const editedCount = edited.mock.calls.length;
      const newerBytes = JSON.stringify({
        owner: "replacement",
        requestId: "newer",
      });
      storage.set(storageKey, newerBytes);
      response.resolve();
      expect(await committing).toEqual({ status: "cancelled" });
      expect(editor.state.value).toBe(stateAtDisposal);
      expect(changed).toHaveBeenCalledTimes(changedCount);
      expect(edited).toHaveBeenCalledTimes(editedCount);
      expect(storage.get(storageKey)).toBe(newerBytes);
      expect(api.editor).toHaveBeenCalledTimes(1);
      expect(editor.command(gesture[0]!)).toBe(false);
    },
  );

  it("fails closed before publication if the recovery envelope cannot be persisted", async () => {
    const api = { editor: vi.fn(async () => initialState()), edit: vi.fn() };
    const { editor, changed } = await mountEditor(api);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error("Storage full");
      },
    });
    expect(await editor.commitTransaction(gesture)).toEqual({
      status: "failed",
    });
    expect(api.edit).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(editor.state.value?.composition.duration).toBe(4);
    expect(editor.hasPending.value).toBe(false);
  });
});
