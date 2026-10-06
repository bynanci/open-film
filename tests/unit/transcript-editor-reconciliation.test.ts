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
import type { TranscriptMutationInput } from "@openfilm/catalog";
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
  load: () => Promise<boolean>;
  reconcile: () => Promise<boolean>;
  command: (command: TranscriptCommand) => boolean;
  flush: () => Promise<boolean>;
  state: { value: TranscriptEditorState | null };
  status: { value: string };
  error: { value: unknown };
  notice: { value: string };
  hasPending: { value: boolean };
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
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-reconciliation-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "spoken.wav");
  await writeFile(source, "Identity-only fixture, not speech recognition.");
  const sourceHash = await hashFile(source);
  const app = await OpenFilmApplication.create(
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
    duration: 2,
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
    segments: [
      {
        id: "segment",
        start: 0,
        end: 2,
        text: "Original text",
        words: [{ start: 0, end: 2, text: "Original text" }],
      },
    ],
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
  };
  const scope = vue.effectScope();
  let dispose = () => {};
  const changed = vi.fn();
  const editor = scope.run(() =>
    factory({
      ...vue,
      validateTranscriptCommand,
      api,
      ApiError,
      changed,
      onMounted: () => {},
      onBeforeUnmount: (callback: () => void) => {
        dispose = callback;
      },
    }),
  )!;
  cleanup.push(() => {
    dispose();
    scope.stop();
  });
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
    editor,
    api,
    changed,
    storage,
    storageKey,
    baseRevision,
    correction,
    holdRead,
    newProviderRevision,
    loseAcknowledgment: () => {
      loseNextAcknowledgment = true;
    },
  };
}

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
