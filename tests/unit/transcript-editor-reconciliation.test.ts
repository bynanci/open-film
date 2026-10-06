import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  validateTranscriptCommand,
  type TranscriptCommand,
} from "@openfilm/core";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile } from "@openfilm/media";
import type {
  TranscriptHistoryInput,
  TranscriptMutationInput,
} from "@openfilm/catalog";
import {
  ApiError,
  type TranscriptEditorState,
} from "../../apps/desktop/src/api";

// Run the production composable with real Vue state and the real application /
// SQLite command queue. Only response delivery is delayed or interrupted.
const vue = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
)("vue") as {
  computed: unknown;
  ref: unknown;
  shallowRef: unknown;
  effectScope: () => {
    run: <T>(callback: () => T) => T | undefined;
    stop: () => void;
  };
};
type Editor = {
  load: (offset?: number, recover?: boolean) => Promise<boolean>;
  loadPage: (offset: number) => Promise<boolean>;
  history: (direction: "undo" | "redo") => Promise<boolean>;
  restore: (revisionId: string) => Promise<boolean>;
  reconcile: () => Promise<boolean>;
  command: (command: TranscriptCommand) => boolean;
  flush: () => Promise<boolean>;
  state: { value: TranscriptEditorState | null };
  status: { value: string };
  error: { value: unknown };
  notice: { value: string };
  hasPending: { value: boolean };
  historyBusy: { value: boolean };
};
let factory: (dependencies: Record<string, unknown>) => Editor;
const cleanup: (() => void | Promise<unknown>)[] = [];
beforeAll(async () => {
  const source = await readFile(
    new URL(
      "../../apps/desktop/src/composables/useTranscriptEditor.ts",
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
    const {computed,onBeforeUnmount,onMounted,ref,shallowRef,validateTranscriptCommand,api,ApiError,changed} = dependencies;
    ${code}
    return useTranscriptEditor('project', 'asset', changed);
  `,
  ) as typeof factory;
});
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
  vi.unstubAllGlobals();
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function fixture(segmentCount = 1) {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-reconciliation-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "spoken.wav");
  await writeFile(source, "Identity-only fixture, not speech recognition.");
  const sourceHash = await hashFile(source);
  let app = await OpenFilmApplication.create(
    join(directory, "film.openfilm"),
    "Reconciliation",
    {},
    { userDataDirectory: join(directory, "user-data") },
  );
  cleanup.push(() => app.close());
  app.catalog.upsertAsset({
    id: "asset",
    uri: pathToFileURL(source).href,
    name: "spoken.wav",
    mediaType: "audio",
    duration: segmentCount * 2,
    contentHash: sourceHash,
    metadata: {},
    tags: [],
    state: {},
  });
  app.catalog.intelligence.replaceTranscript({
    id: "original-provider",
    assetId: "asset",
    language: "en",
    provenance: {
      providerId: "fixture-not-asr",
      version: "1",
      sourceHash,
      createdAt: "2026-10-06T00:00:00Z",
    },
    segments: Array.from({ length: segmentCount }, (_, index) => ({
      id: index ? `segment-${index}` : "segment",
      start: index * 2,
      end: index * 2 + 2,
      text: index ? `Segment ${index}` : "Original text",
      words: [
        {
          start: index * 2,
          end: index * 2 + 2,
          text: index ? `Segment ${index}` : "Original text",
        },
      ],
    })),
  });
  const storage = new Map<string, string>();
  const storageKey = "openfilm:transcript:project:asset";
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  type HeldRead = {
    entered: ReturnType<typeof deferred<TranscriptEditorState>>;
    response: ReturnType<typeof deferred<void>>;
  };
  let nextRead: HeldRead | undefined;
  let loseNextAcknowledgment = false;
  const api = {
    transcript: vi.fn(async (assetId: string, offset = 0, limit = 100) => {
      const held = nextRead;
      nextRead = undefined;
      const saved = await app.transcriptEditor.get(assetId, { offset, limit });
      if (held) {
        held.entered.resolve(saved);
        await held.response.promise;
      }
      return saved;
    }),
    editTranscript: vi.fn(
      async (assetId: string, input: TranscriptMutationInput) => {
        const result = await app.transcriptEditor.edit(assetId, input);
        if (loseNextAcknowledgment) {
          loseNextAcknowledgment = false;
          throw new TypeError("Committed acknowledgment lost");
        }
        return result;
      },
    ),
    transcriptHistory: vi.fn(
      async (
        assetId: string,
        direction: "undo" | "redo",
        input: TranscriptHistoryInput,
      ) => app.transcriptEditor[direction](assetId, input),
    ),
    selectTranscriptRevision: vi.fn(
      async (
        assetId: string,
        input: TranscriptHistoryInput & { revisionId: string },
      ) => app.transcriptEditor.selectRevision(assetId, input),
    ),
  };
  const changed = vi.fn();
  const createEditor = () => {
    const scope = vue.effectScope();
    let unmount = () => {};
    let disposed = false;
    const editor = scope.run(() =>
      factory({
        ...vue,
        validateTranscriptCommand,
        api,
        ApiError,
        changed,
        onMounted: () => {},
        onBeforeUnmount: (callback: () => void) => {
          unmount = callback;
        },
      }),
    )!;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      unmount();
      scope.stop();
    };
    cleanup.push(dispose);
    return { editor, dispose };
  };
  const initial = createEditor();
  const editor = initial.editor;
  expect(await editor.load()).toBe(true);
  const baseRevision = editor.state.value!.revision!;
  const correction: TranscriptCommand = {
    type: "replace-text",
    segmentId: "segment",
    text: "User correction",
  };
  const holdRead = () => {
    const held = {
      entered: deferred<TranscriptEditorState>(),
      response: deferred<void>(),
    };
    nextRead = held;
    return {
      entered: held.entered.promise,
      release: () => held.response.resolve(),
      reject: held.response.reject,
    };
  };
  const newProviderRevision = () => {
    const document = structuredClone(editor.state.value!.document!);
    document.id = "new-provider";
    document.segments[0]!.text = "New provider text";
    app.catalog.intelligence.replaceTranscript(document, {
      expectedRevision: baseRevision,
    });
  };
  return {
    app,
    sourceHash,
    editor,
    api,
    changed,
    storage,
    storageKey,
    baseRevision,
    correction,
    holdRead,
    newProviderRevision,
    createEditor,
    reopenProject: async () => {
      const path = app.directory;
      app.close();
      app = await OpenFilmApplication.open(path, {
        userDataDirectory: join(directory, "user-data"),
      });
      return app;
    },
    dispose: initial.dispose,
    loseAcknowledgment: () => {
      loseNextAcknowledgment = true;
    },
  };
}

describe("transcript history operation ownership", () => {
  it.each(["undo", "redo"] as const)(
    "preserves the first Undo receipt when rapid %s overlaps its pending manual save and the committed history ACK is lost",
    async (secondDirection) => {
      const test = await fixture();
      const original = await test.app.transcriptEditor.get("asset");
      const manualAck = deferred<void>(),
        manualCommitted = deferred<void>(),
        historyAck = deferred<void>(),
        historyCommitted = deferred<void>();
      test.api.editTranscript.mockImplementationOnce(async (assetId, input) => {
        const result = await test.app.transcriptEditor.edit(assetId, input);
        manualCommitted.resolve();
        await manualAck.promise;
        return result;
      });
      test.api.transcriptHistory.mockImplementationOnce(
        async (assetId, direction, input) => {
          const result = await test.app.transcriptEditor[direction](
            assetId,
            input,
          );
          historyCommitted.resolve();
          await historyAck.promise;
          throw new TypeError(`Committed ${result.revision} history ACK lost`);
        },
      );
      expect(test.editor.command(test.correction)).toBe(true);
      const first = test.editor.history("undo"),
        second = test.editor.history(secondDirection);
      let navigationSettled = false;
      const navigation = test.editor.flush().then((result) => {
        navigationSettled = true;
        return result;
      });
      await manualCommitted.promise;
      const reservedBeforePreparation = test.editor.historyBusy.value;
      manualAck.resolve();
      await historyCommitted.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const navigationSettledBeforeHistoryAck = navigationSettled;
      const retained = JSON.parse(test.storage.get(test.storageKey)!);
      const [assetId, direction, sent] =
        test.api.transcriptHistory.mock.calls[0]!;
      historyAck.resolve();
      const results = await Promise.all([first, second, navigation]);
      expect(retained.receipt).toEqual({ ...sent, direction });
      expect(reservedBeforePreparation).toBe(true);
      expect(navigationSettledBeforeHistoryAck).toBe(false);
      expect(results).toEqual([false, false, false]);
      expect(test.editor.historyBusy.value).toBe(false);
      expect(test.editor.hasPending.value).toBe(true);
      expect(test.api.transcriptHistory).toHaveBeenCalledTimes(1);
      expect(JSON.parse(test.storage.get(test.storageKey)!).receipt).toEqual(
        retained.receipt,
      );
      test.dispose();
      const reopenedApp = await test.reopenProject();
      const reopened = test.createEditor();
      expect(await reopened.editor.load()).toBe(true);
      expect(reopened.editor.status.value).toBe("saved");
      expect(reopened.editor.hasPending.value).toBe(false);
      expect(reopened.editor.state.value?.document?.segments).toEqual(
        original.document?.segments,
      );
      expect(reopened.editor.state.value?.canRedo).toBe(true);
      expect(test.api.transcriptHistory.mock.calls).toEqual([
        [assetId, direction, sent],
        [assetId, direction, sent],
      ]);
      expect(
        (await reopenedApp.transcriptEditor.revisions("asset")).total,
      ).toBe(3);
      expect(test.storage.has(test.storageKey)).toBe(false);
      expect(await reopened.editor.flush()).toBe(true);
      expect(
        reopenedApp.catalog.transcripts.getFull(
          "asset",
          test.sourceHash,
          original.revision,
        )?.document,
      ).toEqual(original.document);
    },
  );

  it("releases a failed preparatory save without dispatching or replacing its exact pending receipt", async () => {
    const test = await fixture();
    test.api.editTranscript.mockRejectedValue(
      new ApiError("Save unavailable", 503, { code: "operation.failed" }),
    );
    expect(test.editor.command(test.correction)).toBe(true);
    expect(await test.editor.history("undo")).toBe(false);
    const retained = test.storage.get(test.storageKey);
    expect(test.editor.historyBusy.value).toBe(false);
    expect(test.editor.hasPending.value).toBe(true);
    expect(test.api.transcriptHistory).not.toHaveBeenCalled();
    expect(await test.editor.history("redo")).toBe(false);
    expect(test.storage.get(test.storageKey)).toBe(retained);
    expect(test.api.editTranscript.mock.calls[1]).toEqual(
      test.api.editTranscript.mock.calls[0],
    );
  });

  it("does not dispatch history after disposal during its preparatory save", async () => {
    const test = await fixture();
    const ack = deferred<void>(),
      committed = deferred<void>();
    test.api.editTranscript.mockImplementationOnce(async (assetId, input) => {
      const result = await test.app.transcriptEditor.edit(assetId, input);
      committed.resolve();
      await ack.promise;
      return result;
    });
    expect(test.editor.command(test.correction)).toBe(true);
    const changing = test.editor.history("undo");
    await committed.promise;
    test.dispose();
    ack.resolve();
    expect(await changing).toBe(false);
    expect(test.editor.historyBusy.value).toBe(false);
    expect(test.api.transcriptHistory).not.toHaveBeenCalled();
    expect((await test.app.transcriptEditor.revisions("asset")).total).toBe(2);
  });
});

describe("transcript reconciliation ownership", () => {
  it.each(["old-snapshot", "read-error"])(
    "discards a delayed %s after autosave acknowledged a newer manual revision",
    async (outcome) => {
      const test = await fixture();
      expect(test.editor.command(test.correction)).toBe(true);
      const read = test.holdRead();
      const reconciliation = test.editor.reconcile();
      expect((await read.entered).revision).toBe(test.baseRevision);
      expect(await test.editor.flush()).toBe(true);
      const saved = await test.app.transcriptEditor.get("asset");
      expect(saved.revision).not.toBe(test.baseRevision);
      expect(test.editor.status.value).toBe("saved");
      expect(test.editor.hasPending.value).toBe(false);
      if (outcome === "old-snapshot") read.release();
      else
        read.reject(
          new ApiError("Delayed read failed", 503, {
            code: "operation.failed",
          }),
        );
      expect(await reconciliation).toBe(false);
      expect(test.editor.status.value).toBe("saved");
      expect(test.editor.error.value).toBeNull();
      expect(test.editor.notice.value).toBe("");
      expect(test.editor.state.value?.revision).toBe(saved.revision);
      expect(test.editor.state.value?.document?.segments[0]?.text).toBe(
        "User correction",
      );
      expect(test.storage.has(test.storageKey)).toBe(false);
      expect(await test.editor.flush()).toBe(true);
    },
  );

  it("leaves a committed edit with lost acknowledgment retryable, then replays its exact receipt once", async () => {
    const test = await fixture();
    test.editor.command(test.correction);
    test.loseAcknowledgment();
    expect(await test.editor.flush()).toBe(false);
    const committed = await test.app.transcriptEditor.get("asset");
    expect(committed.revision).not.toBe(test.baseRevision);
    const pending = test.storage.get(test.storageKey)!;
    expect(test.editor.status.value).toBe("failed");
    expect(test.editor.hasPending.value).toBe(true);
    const reads = test.api.transcript.mock.calls.length;
    expect(await test.editor.reconcile()).toBe(false);
    expect(test.editor.status.value).toBe("failed");
    expect(test.api.transcript.mock.calls).toHaveLength(reads);
    expect(test.storage.get(test.storageKey)).toBe(pending);
    expect(await test.editor.flush()).toBe(true);
    expect(test.api.editTranscript.mock.calls[1]).toEqual(
      test.api.editTranscript.mock.calls[0],
    );
    expect((await test.app.transcriptEditor.revisions("asset")).total).toBe(2);
    expect(test.editor.state.value?.revision).toBe(committed.revision);
    expect(test.editor.status.value).toBe("saved");
    expect(test.editor.hasPending.value).toBe(false);
    expect(test.storage.has(test.storageKey)).toBe(false);
  });

  it("preserves a genuine new-provider conflict and all same-base manual edits", async () => {
    const test = await fixture();
    test.editor.command(test.correction);
    test.newProviderRevision();
    const read = test.holdRead();
    const reconciliation = test.editor.reconcile();
    const provider = await read.entered;
    expect(provider.revision).not.toBe(test.baseRevision);
    const second: TranscriptCommand = {
      ...test.correction,
      text: "Second user correction",
    };
    expect(test.editor.command(second)).toBe(true);
    read.release();
    expect(await reconciliation).toBe(false);
    expect(test.editor.status.value).toBe("conflict");
    expect(test.editor.notice.value).toBe("transcript.draftConflict");
    expect(test.editor.state.value?.revision).toBe(test.baseRevision);
    expect(test.editor.state.value?.document?.segments[0]?.text).toBe(
      "Second user correction",
    );
    expect(JSON.parse(test.storage.get(test.storageKey)!).pending).toEqual([
      test.correction,
      second,
    ]);
    expect(await test.editor.flush()).toBe(false);
    expect(test.api.editTranscript).not.toHaveBeenCalled();
    expect(
      (await test.app.transcriptEditor.get("asset")).document?.segments[0]
        ?.text,
    ).toBe("New provider text");
  });

  it("retains a current unsent draft on read failure and permits normal command retry", async () => {
    const test = await fixture();
    test.editor.command(test.correction);
    const read = test.holdRead();
    const reconciliation = test.editor.reconcile();
    await read.entered;
    const failure = new TypeError("Read connection lost");
    read.reject(failure);
    expect(await reconciliation).toBe(false);
    expect(test.editor.status.value).toBe("failed");
    expect(test.editor.error.value).toBe(failure);
    expect(test.editor.hasPending.value).toBe(true);
    expect(await test.editor.flush()).toBe(true);
    expect(
      (await test.app.transcriptEditor.get("asset")).document?.segments[0]
        ?.text,
    ).toBe("User correction");
  });
});

describe("accepted transcript load ownership", () => {
  const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

  it("waits for a clean provider refresh before permitting a single project-switch flush", async () => {
    const test = await fixture();
    test.newProviderRevision();
    const read = test.holdRead();
    const loading = test.editor.load(0, false);
    const latest = await read.entered;
    let settled = false;
    const switching = test.editor.flush().then((result) => {
      settled = true;
      return result;
    });
    await drain();
    expect(settled).toBe(false);
    expect(test.editor.status.value).toBe("loading");
    read.release();
    expect(await loading).toBe(true);
    expect(await switching).toBe(true);
    expect(test.editor.state.value?.revision).toBe(latest.revision);
    expect(test.editor.state.value?.document?.segments[0]?.text).toBe(
      "New provider text",
    );
    expect(test.api.editTranscript).not.toHaveBeenCalled();
  });

  it("waits for recovery before refusing a genuine draft conflict without sending its commands", async () => {
    const test = await fixture();
    test.editor.command(test.correction);
    test.newProviderRevision();
    const retained = test.storage.get(test.storageKey)!;
    const read = test.holdRead();
    const loading = test.editor.load();
    await read.entered;
    let settled = false;
    const switching = test.editor.flush().then((result) => {
      settled = true;
      return result;
    });
    await drain();
    expect(settled).toBe(false);
    expect(test.api.editTranscript).not.toHaveBeenCalled();
    read.release();
    expect(await loading).toBe(true);
    expect(await switching).toBe(false);
    expect(test.editor.status.value).toBe("conflict");
    expect(test.editor.state.value?.revision).toBe(test.baseRevision);
    expect(test.editor.state.value?.document?.segments[0]?.text).toBe(
      "User correction",
    );
    expect(test.storage.get(test.storageKey)).toBe(retained);
    expect(test.api.editTranscript).not.toHaveBeenCalled();
  });

  it("returns a failed owned read without closing or mutating and releases ownership for retry", async () => {
    const test = await fixture();
    const original = structuredClone(test.editor.state.value);
    const read = test.holdRead();
    const loading = test.editor.load(0, false);
    await read.entered;
    let settled = false;
    const switching = test.editor.flush().then((result) => {
      settled = true;
      return result;
    });
    await drain();
    expect(settled).toBe(false);
    const failure = new TypeError("Provider refresh connection lost");
    read.reject(failure);
    expect(await loading).toBe(false);
    expect(await switching).toBe(false);
    expect(test.editor.state.value).toEqual(original);
    expect(test.editor.error.value).toBe(failure);
    expect(test.api.editTranscript).not.toHaveBeenCalled();
    // The failed refresh blocked its waiting transition. A new explicit leave
    // remains safe for this clean project, including when the source is offline.
    expect(test.editor.hasPending.value).toBe(false);
    expect(test.storage.size).toBe(0);
    expect(await test.editor.flush()).toBe(true);
    expect(test.editor.status.value).toBe("failed");
    expect(test.editor.error.value).toBe(failure);
    expect(test.editor.state.value).toEqual(original);
    expect(test.storage.size).toBe(0);
    expect(test.api.editTranscript).not.toHaveBeenCalled();
    expect(await test.editor.load(0, false)).toBe(true);
    expect(test.editor.status.value).toBe("saved");
    expect(test.editor.error.value).toBeNull();
    expect(await test.editor.flush()).toBe(true);
  });

  it("does not treat a failed pending save as a clean read failure on repeated navigation", async () => {
    const test = await fixture();
    const failure = new ApiError("Save destination unavailable", 503, {
      code: "operation.failed",
    });
    test.api.editTranscript.mockRejectedValue(failure);
    expect(test.editor.command(test.correction)).toBe(true);
    expect(await test.editor.flush()).toBe(false);
    const draft = test.storage.get(test.storageKey)!;
    expect(test.editor.hasPending.value).toBe(true);
    expect(await test.editor.flush()).toBe(false);
    expect(test.editor.status.value).toBe("failed");
    expect(test.editor.error.value).toBe(failure);
    expect(test.editor.state.value?.revision).toBe(test.baseRevision);
    expect(test.editor.state.value?.document?.segments[0]?.text).toBe(
      "User correction",
    );
    expect(test.storage.get(test.storageKey)).toBe(draft);
    expect(test.api.editTranscript.mock.calls[1]).toEqual(
      test.api.editTranscript.mock.calls[0],
    );
    expect((await test.app.transcriptEditor.revisions("asset")).total).toBe(1);
    expect(
      (await test.app.transcriptEditor.get("asset")).document?.segments[0]
        ?.text,
    ).toBe("Original text");
  });

  it("follows a newer accepted refresh without waiting for an obsolete held response", async () => {
    const test = await fixture();
    const oldRead = test.holdRead();
    const oldLoad = test.editor.load(0, false);
    await oldRead.entered;
    let settled = false;
    const switching = test.editor.flush().then((result) => {
      settled = true;
      return result;
    });
    test.newProviderRevision();
    const newRead = test.holdRead();
    const newLoad = test.editor.load(0, false);
    const latest = await newRead.entered;
    await drain();
    expect(settled).toBe(false);
    newRead.release();
    expect(await newLoad).toBe(true);
    await vi.waitFor(() => expect(settled).toBe(true));
    expect(await switching).toBe(true);
    expect(test.editor.state.value?.revision).toBe(latest.revision);
    oldRead.release();
    expect(await oldLoad).toBe(false);
    expect(test.editor.state.value?.revision).toBe(latest.revision);
    expect(test.editor.status.value).toBe("saved");
  });

  it("retains the active recovery barrier when a clean read is refused because a draft is pending", async () => {
    const test = await fixture();
    test.editor.command(test.correction);
    const read = test.holdRead();
    const recovering = test.editor.load();
    await read.entered;
    expect(await test.editor.load(0, false)).toBe(false);
    let settled = false;
    const switching = test.editor.flush().then((result) => {
      settled = true;
      return result;
    });
    await drain();
    expect(settled).toBe(false);
    expect(test.api.editTranscript).not.toHaveBeenCalled();
    read.release();
    expect(await recovering).toBe(true);
    expect(await switching).toBe(true);
    expect(test.api.editTranscript).toHaveBeenCalledOnce();
    expect(test.editor.hasPending.value).toBe(false);
    expect(
      (await test.app.transcriptEditor.get("asset")).document?.segments[0]
        ?.text,
    ).toBe("User correction");
  });

  it("resolves a waiting flush as false on disposal and ignores the later read response", async () => {
    const test = await fixture();
    const original = structuredClone(test.editor.state.value);
    test.newProviderRevision();
    const read = test.holdRead();
    const loading = test.editor.load(0, false);
    await read.entered;
    let settled = false;
    const switching = test.editor.flush().then((result) => {
      settled = true;
      return result;
    });
    await drain();
    expect(settled).toBe(false);
    test.dispose();
    await vi.waitFor(() => expect(settled).toBe(true));
    expect(await switching).toBe(false);
    read.release();
    expect(await loading).toBe(false);
    expect(test.editor.state.value).toEqual(original);
    expect(test.api.editTranscript).not.toHaveBeenCalled();
  });
});

describe("startup transcript recovery retention", () => {
  it("keeps exact validated draft bytes when disposed before the initial recovery read completes", async () => {
    const test = await fixture();
    test.editor.command(test.correction);
    test.dispose();
    const original = test.storage.get(test.storageKey)!;
    const recovering = test.createEditor();
    const read = test.holdRead();
    const loading = recovering.editor.load();
    await read.entered;
    expect(recovering.editor.state.value).toBeNull();
    expect(recovering.editor.status.value).toBe("loading");
    recovering.dispose();
    expect(test.storage.get(test.storageKey)).toBe(original);
    expect(test.api.editTranscript).not.toHaveBeenCalled();
    read.release();
    expect(await loading).toBe(false);
    expect(test.storage.get(test.storageKey)).toBe(original);
    const reopened = test.createEditor();
    expect(await reopened.editor.load()).toBe(true);
    expect(reopened.editor.hasPending.value).toBe(true);
    expect(reopened.editor.state.value?.document?.segments[0]?.text).toBe(
      "User correction",
    );
    expect(await reopened.editor.flush()).toBe(true);
    expect((await test.app.transcriptEditor.revisions("asset")).total).toBe(2);
    expect(test.storage.has(test.storageKey)).toBe(false);
  });

  it("keeps an uncertain startup receipt unchanged through disposal and safely replays it on the next reopen", async () => {
    const test = await fixture();
    test.editor.command(test.correction);
    test.loseAcknowledgment();
    expect(await test.editor.flush()).toBe(false);
    test.dispose();
    const original = test.storage.get(test.storageKey)!;
    const ack = deferred<void>(),
      entered = deferred<void>();
    test.api.editTranscript.mockImplementationOnce(async (assetId, input) => {
      const result = await test.app.transcriptEditor.edit(assetId, input);
      entered.resolve();
      await ack.promise;
      return result;
    });
    const recovering = test.createEditor();
    const loading = recovering.editor.load();
    await entered.promise;
    expect(recovering.editor.state.value).toBeNull();
    recovering.dispose();
    expect(test.storage.get(test.storageKey)).toBe(original);
    ack.resolve();
    expect(await loading).toBe(false);
    expect(test.storage.get(test.storageKey)).toBe(original);
    const reopened = test.createEditor();
    expect(await reopened.editor.load()).toBe(true);
    expect(reopened.editor.status.value).toBe("saved");
    expect(reopened.editor.hasPending.value).toBe(false);
    expect(reopened.editor.state.value?.document?.segments[0]?.text).toBe(
      "User correction",
    );
    expect(test.api.editTranscript.mock.calls).toHaveLength(3);
    expect(test.api.editTranscript.mock.calls[1]).toEqual(
      test.api.editTranscript.mock.calls[0],
    );
    expect(test.api.editTranscript.mock.calls[2]).toEqual(
      test.api.editTranscript.mock.calls[0],
    );
    expect((await test.app.transcriptEditor.revisions("asset")).total).toBe(2);
    expect(test.storage.has(test.storageKey)).toBe(false);
  });
});

describe("transcript page recovery after structural edits", () => {
  const expectLastExistingPage = (editor: Editor) => {
    expect(editor.state.value?.total).toBe(100);
    expect(editor.state.value?.offset).toBe(0);
    expect(editor.state.value?.document?.segments).toHaveLength(100);
    expect(editor.state.value?.document?.segments[0]?.id).toBe("segment");
    expect(editor.state.value?.document?.segments[99]?.id).toBe("segment-99");
    expect(editor.status.value).toBe("saved");
    expect(editor.hasPending.value).toBe(false);
  };
  it.each(["delete", "merge"])(
    "returns to a valid page after %s, undo/redo and revision selection",
    async (action) => {
      const test = await fixture(101);
      expect(await test.editor.loadPage(100)).toBe(true);
      expect(test.editor.state.value?.document?.segments[0]?.id).toBe(
        "segment-100",
      );
      const command: TranscriptCommand =
        action === "delete"
          ? { type: "delete-segment", segmentId: "segment-100" }
          : {
              type: "merge-segment",
              segmentId: "segment-100",
              direction: "previous",
            };
      expect(test.editor.command(command)).toBe(true);
      expect(await test.editor.flush()).toBe(true);
      expectLastExistingPage(test.editor);
      const shortenedRevision = test.editor.state.value!.revision!;
      expect(await test.editor.history("undo")).toBe(true);
      expect(test.editor.state.value?.total).toBe(101);
      expect(await test.editor.loadPage(100)).toBe(true);
      expect(await test.editor.history("redo")).toBe(true);
      expectLastExistingPage(test.editor);
      expect(await test.editor.restore(test.baseRevision)).toBe(true);
      expect(test.editor.state.value?.total).toBe(101);
      expect(await test.editor.loadPage(100)).toBe(true);
      expect(await test.editor.restore(shortenedRevision)).toBe(true);
      expectLastExistingPage(test.editor);
      expect(test.storage.has(test.storageKey)).toBe(false);
      expect(
        test.api.transcript.mock.calls.every(([, , limit]) => limit === 100),
      ).toBe(true);
    },
  );

  it("clamps a clean reload when a successful provider revision shortens the document", async () => {
    const test = await fixture(101);
    await test.editor.loadPage(100);
    const document = test.app.catalog.transcripts.getFull(
      "asset",
      test.sourceHash,
    )!.document;
    test.app.catalog.intelligence.replaceTranscript(
      {
        ...document,
        id: "shorter-provider",
        segments: document.segments.slice(0, 100),
      },
      { expectedRevision: test.baseRevision },
    );
    expect(await test.editor.reconcile()).toBe(true);
    expectLastExistingPage(test.editor);
    expect(test.editor.state.value?.revision).not.toBe(test.baseRevision);
    expect(test.api.editTranscript).not.toHaveBeenCalled();
  });

  it("clamps recovery after a structural edit committed with its acknowledgment lost", async () => {
    const test = await fixture(101);
    await test.editor.loadPage(100);
    test.editor.command({ type: "delete-segment", segmentId: "segment-100" });
    test.loseAcknowledgment();
    expect(await test.editor.flush()).toBe(false);
    const pending = JSON.parse(test.storage.get(test.storageKey)!);
    expect(pending.state.offset).toBe(100);
    expect(pending.receipt.commands).toEqual([
      { type: "delete-segment", segmentId: "segment-100" },
    ]);
    expect(await test.editor.load()).toBe(true);
    expectLastExistingPage(test.editor);
    expect(test.api.editTranscript.mock.calls[1]).toEqual(
      test.api.editTranscript.mock.calls[0],
    );
    expect((await test.app.transcriptEditor.revisions("asset")).total).toBe(2);
    expect(test.storage.has(test.storageKey)).toBe(false);
  });

  it("preserves the exact committed receipt if the clamped-page read fails, then retries without duplicate deletion", async () => {
    const test = await fixture(101);
    await test.editor.loadPage(100);
    test.editor.command({ type: "delete-segment", segmentId: "segment-100" });
    test.api.transcript
      .mockImplementationOnce((assetId, offset, limit) =>
        test.app.transcriptEditor.get(assetId, { offset, limit }),
      )
      .mockImplementationOnce(async () => {
        throw new TypeError("Clamped page response lost");
      });
    expect(await test.editor.flush()).toBe(false);
    expect(test.editor.status.value).toBe("failed");
    expect(test.editor.hasPending.value).toBe(true);
    expect(
      JSON.parse(test.storage.get(test.storageKey)!).receipt.commands,
    ).toEqual([{ type: "delete-segment", segmentId: "segment-100" }]);
    expect(await test.editor.flush()).toBe(true);
    expectLastExistingPage(test.editor);
    expect(test.api.editTranscript.mock.calls[1]).toEqual(
      test.api.editTranscript.mock.calls[0],
    );
    expect((await test.app.transcriptEditor.revisions("asset")).total).toBe(2);
  });
});
