import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  validateTranscriptCommand,
  type Job,
  type TranscriptCommand,
  type TranscriptSegment,
} from "@openfilm/core";
import {
  ApiError,
  type TranscriptEditorState,
} from "../../apps/desktop/src/api";

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
const vue = desktopRequire("vue") as Record<string, unknown> & {
  nextTick: () => Promise<void>;
};
type Ref<T> = { value: T };
interface Editor {
  state: Ref<TranscriptEditorState | null>;
  status: Ref<string>;
  hasPending: Ref<boolean>;
  jobs: Ref<Job[]>;
  transcriptionPending: Ref<boolean>;
  localError: Ref<unknown>;
  corrections: Ref<{
    before: string;
    after: string;
    segmentId?: string;
  } | null>;
  text: Ref<string>;
  selectedId: Ref<string>;
  queueText: () => void;
  remember: () => Promise<boolean>;
  undo: (direction: "undo" | "redo") => Promise<void>;
  restore: (revision: string) => Promise<boolean>;
  structural: (command: TranscriptCommand) => Promise<void>;
  select: (segment: TranscriptSegment) => Promise<void>;
  command: (command: TranscriptCommand) => boolean;
  load: () => Promise<boolean>;
  flush: () => Promise<boolean>;
  transcription: () => Promise<boolean | undefined>;
  updateAncillary: () => Promise<void>;
  poll: () => Promise<void>;
}

// Execute the real component script and its real command queue. Only external
// I/O and lifecycle registration are supplied by this headless component host.
function compile<T>(source: string, names: string[]) {
  const code = transformSync(source, { loader: "ts", format: "esm" })
    .code.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "")
    .replace(/^export\s*\{[\s\S]*?\};\n?/gm, "");
  return (dependencies: Record<string, unknown>): T =>
    new Function(
      "dependencies",
      `const {${Object.keys(dependencies).join(",")}} = dependencies;\n${code}\nreturn {${names.join(",")}};`,
    )(dependencies) as T;
}
const queueFactory = compile<{
  useTranscriptEditor: (...args: unknown[]) => Record<string, unknown>;
}>(
  readFileSync(
    resolve("apps/desktop/src/composables/useTranscriptEditor.ts"),
    "utf8",
  ),
  ["useTranscriptEditor"],
);
const source = readFileSync(
  resolve("apps/desktop/src/components/TranscriptEditor.vue"),
  "utf8",
).match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]!;
const editorFactory = compile<Editor>(source, [
  "state",
  "status",
  "hasPending",
  "jobs",
  "transcriptionPending",
  "localError",
  "corrections",
  "text",
  "selectedId",
  "queueText",
  "remember",
  "undo",
  "restore",
  "structural",
  "select",
  "command",
  "load",
  "flush",
  "transcription",
  "updateAncillary",
  "poll",
]);
const cleanup: (() => void)[] = [];

function document(text: string, revision: string): TranscriptEditorState {
  return {
    document: {
      id: `document-${revision}`,
      assetId: "asset",
      provenance: {
        providerId: "fixture",
        version: "1",
        sourceHash: "source-hash",
        createdAt: "2026-10-06T00:00:00Z",
      },
      segments: [{ id: "segment", start: 0, end: 2, text }],
    },
    revision,
    revisionInfo: {
      id: revision,
      assetId: "asset",
      source: "provider",
      createdAt: "2026-10-06T00:00:00Z",
    },
    total: 1,
    offset: 0,
    limit: 100,
    canUndo: false,
    canRedo: false,
  };
}
function job(id: string, status: Job["status"] = "completed"): Job {
  return { id, type: "transcribe", assetId: "asset", status };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture(initial?: TranscriptEditorState, initialize = true) {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  let saved = initial ?? {
    total: 0,
    offset: 0,
    limit: 100,
    canUndo: false,
    canRedo: false,
  };
  let savedJobs: Job[] = [];
  const api = {
    transcript: vi.fn(async () => structuredClone(saved)),
    intelligenceProviders: vi.fn(async () => ({
      transcription: { available: true, providerId: "fixture" },
    })),
    jobs: vi.fn(async () => ({ jobs: structuredClone(savedJobs) })),
    transcriptRevisions: vi.fn(async () => ({
      revisions: saved.revisionInfo ? [saved.revisionInfo] : [],
      total: saved.revisionInfo ? 1 : 0,
    })),
    analyzeIntelligence: vi.fn(async () => ({
      job: job("submitted", "queued"),
    })),
    editTranscript: vi.fn(async (): Promise<TranscriptEditorState> => {
      throw new ApiError("Revision changed", 409, {
        code: "transcript.revisionConflict",
      });
    }),
    transcriptHistory: vi.fn(async () => structuredClone(saved)),
    selectTranscriptRevision: vi.fn(async () => structuredClone(saved)),
    saveGlossary: vi.fn(async () => undefined),
  };
  const lifecycle = {
    onMounted: () => undefined,
    onBeforeUnmount: (callback: () => void) => cleanup.push(callback),
  };
  const queue = queueFactory({
    ...vue,
    ...lifecycle,
    validateTranscriptCommand,
    api,
    ApiError,
  });
  const editor = editorFactory({
    ...vue,
    ...lifecycle,
    ...queue,
    api,
    defineProps: () => ({
      projectId: "project",
      asset: { id: "asset", mediaType: "video", uri: "fixture.mp4" },
      active: true,
      clips: [],
    }),
    defineEmits: () => vi.fn(),
    defineExpose: () => undefined,
    useI18n: () => ({ t: (key: string) => key }),
    post: vi.fn(),
    sourceUrl: () => "fixture.mp4",
    errorDetail: () => "",
    formatNumber: String,
    formatDate: String,
    localizeError: String,
    GlossaryPanel: {},
    ReviewPanel: {},
  });
  if (initialize) {
    await editor.load();
    await editor.updateAncillary();
    await vue.nextTick();
  }
  return {
    editor,
    api,
    storage,
    publish: (next: TranscriptEditorState, jobs: Job[]) => {
      saved = next;
      savedJobs = jobs;
    },
  };
}

afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Remembered correction ownership", () => {
  async function correctionFixture() {
    const view = await fixture(document("foo", "original"));
    const corrected = document("bar", "corrected");
    corrected.revisionInfo!.source = "user";
    view.api.editTranscript.mockImplementation(async () => {
      view.publish(corrected, []);
      return structuredClone(corrected);
    });
    view.editor.text.value = "bar";
    view.editor.queueText();
    await view.editor.flush();
    await vue.nextTick();
    expect(view.editor.corrections.value).toMatchObject({
      before: "foo",
      after: "bar",
    });
    return view;
  }

  it("drops a reverted correction after Undo and does not resurrect its intent on Redo", async () => {
    const { editor, api, publish } = await correctionFixture();
    api.transcriptHistory.mockImplementationOnce(async () => {
      const restored = document("foo", "undone");
      publish(restored, []);
      return restored;
    });
    await editor.undo("undo");
    expect(await editor.remember()).toBe(false);
    expect(api.saveGlossary).not.toHaveBeenCalled();
    expect(editor.corrections.value).toBeNull();
    api.transcriptHistory.mockImplementationOnce(async () => {
      const redone = document("bar", "redone");
      publish(redone, []);
      return redone;
    });
    await editor.undo("redo");
    expect(editor.corrections.value).toBeNull();
    expect(editor.state.value?.document?.segments[0]?.text).toBe("bar");
  });

  it("clears correction intent when restoring a revision even when the restored words match", async () => {
    const { editor, api, publish } = await correctionFixture();
    api.selectTranscriptRevision.mockImplementationOnce(async () => {
      const restored = document("bar", "restored");
      publish(restored, []);
      return restored;
    });
    expect(await editor.restore("historical")).toBe(true);
    expect(await editor.remember()).toBe(false);
    expect(api.saveGlossary).not.toHaveBeenCalled();
    expect(editor.corrections.value).toBeNull();
  });

  it("keeps one correction across ordinary keystrokes and autosave acknowledgments", async () => {
    const { editor, api, publish } = await fixture(document("foo", "original"));
    for (const value of ["b", "ba", "bar"]) {
      editor.text.value = value;
      editor.queueText();
      await vue.nextTick();
    }
    api.editTranscript.mockImplementationOnce(async () => {
      const saved = document("bar", "saved");
      saved.revisionInfo!.source = "user";
      publish(saved, []);
      return saved;
    });
    await editor.flush();
    expect(editor.corrections.value).toMatchObject({
      before: "foo",
      after: "bar",
    });
    expect(await editor.remember()).toBe(true);
    expect(api.saveGlossary).toHaveBeenCalledWith({
      scope: "project",
      source: "foo",
      replacement: "bar",
      caseSensitive: true,
      enabled: true,
    });
  });

  it("does not offer an earlier segment's correction after selecting another segment", async () => {
    const { editor, api, publish } = await correctionFixture();
    const expanded = document("bar", "expanded");
    const other = { id: "other", start: 2, end: 3, text: "bar" };
    expanded.document!.segments.push(other);
    expanded.total = 2;
    publish(expanded, []);
    await editor.load();
    await editor.select(other);
    expect(editor.selectedId.value).toBe("other");
    expect(await editor.remember()).toBe(false);
    expect(api.saveGlossary).not.toHaveBeenCalled();
    expect(editor.corrections.value).toBeNull();
  });

  it.each<TranscriptCommand>([
    { type: "delete-segment", segmentId: "segment" },
    {
      type: "split-segment",
      segmentId: "segment",
      cursorOffset: 1,
      newSegmentId: "split-child",
    },
    { type: "merge-segment", segmentId: "segment", direction: "next" },
    { type: "replace-all", query: "bar", replacement: "replacement" },
  ])(
    "discards the remembered intent after structural mutation $type",
    async (command) => {
      const { editor, api, publish } = await correctionFixture();
      api.editTranscript.mockImplementationOnce(async () => {
        const modified = document("replacement", "structural");
        if (command.type === "delete-segment") {
          modified.document!.segments = [];
          modified.total = 0;
        }
        publish(modified, []);
        return modified;
      });
      await editor.structural(command);
      expect(await editor.remember()).toBe(false);
      expect(api.saveGlossary).not.toHaveBeenCalled();
      expect(editor.corrections.value).toBeNull();
    },
  );

  it("invalidates a pair after successful retranscription even when recognized words match", async () => {
    const { editor, api, publish } = await correctionFixture();
    publish(document("bar", "new-provider"), [job("retranscribed")]);
    await editor.updateAncillary();
    expect(editor.state.value?.revision).toBe("new-provider");
    expect(await editor.remember()).toBe(false);
    expect(api.saveGlossary).not.toHaveBeenCalled();
    expect(editor.corrections.value).toBeNull();
  });
});

describe("Transcript workspace completed transcription jobs", () => {
  it("lets initial recovery preserve a draft before refreshing historical completed jobs", async () => {
    const fresh = document("New provider words", "new");
    const { editor, api, storage, publish } = await fixture(fresh, false);
    const draft = document("My recovered manual correction", "old");
    storage.set(
      "openfilm:transcript:project:asset",
      JSON.stringify({
        state: draft,
        pending: [
          {
            type: "replace-text",
            segmentId: "segment",
            text: "My recovered manual correction",
          },
        ],
        receipt: null,
      }),
    );
    const initialRead = deferred<TranscriptEditorState>();
    api.transcript.mockImplementationOnce(() => initialRead.promise);
    const recovery = editor.load();
    publish(fresh, [job("historical-completed")]);
    await editor.updateAncillary();
    initialRead.resolve(fresh);
    await recovery;
    await editor.poll();
    expect(editor.state.value?.revision).toBe("old");
    expect(editor.state.value?.document?.segments[0]?.text).toBe(
      "My recovered manual correction",
    );
    expect(editor.status.value).toBe("conflict");
    expect(editor.hasPending.value).toBe(true);
    expect([...storage.values()].join()).toContain(
      "My recovered manual correction",
    );
    expect(api.editTranscript).not.toHaveBeenCalled();
  });

  it("loads the first transcript when transcription completes before any running poll", async () => {
    const { editor, api, publish } = await fixture();
    api.analyzeIntelligence.mockImplementation(async () => {
      publish(document("First spoken memories", "first"), [job("fast")]);
      return { job: job("fast", "queued") };
    });
    await editor.transcription();
    expect(editor.state.value?.revision).toBe("first");
    expect(editor.state.value?.document?.segments[0]?.text).toBe(
      "First spoken memories",
    );
    const reads = api.transcript.mock.calls.length;
    await editor.poll();
    await editor.poll();
    expect(api.transcript).toHaveBeenCalledTimes(reads);
  });

  it("loads a fast retranscription's new provider revision without reopening", async () => {
    const { editor, api, publish } = await fixture(
      document("Old words", "old"),
    );
    api.analyzeIntelligence.mockImplementation(async () => {
      publish(document("Correct new words", "new"), [job("fast-retry")]);
      return { job: job("fast-retry", "queued") };
    });
    await editor.transcription();
    expect(editor.state.value?.revision).toBe("new");
    expect(editor.state.value?.document?.segments[0]?.text).toBe(
      "Correct new words",
    );
  });

  it("retains a pending manual draft and exposes its conflict when a completed job first appears", async () => {
    const { editor, api, storage, publish } = await fixture(
      document("Provider words", "old"),
    );
    expect(
      editor.command({
        type: "replace-text",
        segmentId: "segment",
        text: "My manual correction",
      }),
    ).toBe(true);
    publish(document("New provider words", "new"), [job("fast-after-edit")]);
    await editor.poll();
    expect(editor.state.value?.revision).toBe("old");
    expect(editor.state.value?.document?.segments[0]?.text).toBe(
      "My manual correction",
    );
    expect(editor.status.value).toBe("conflict");
    expect(editor.hasPending.value).toBe(true);
    expect([...storage.values()].join()).toContain("My manual correction");
    expect(api.editTranscript).not.toHaveBeenCalled();
    expect(await editor.flush()).toBe(false);
  });

  it("ignores an older ancillary response arriving after a completed job was observed", async () => {
    const { editor, api, publish } = await fixture(
      document("Old words", "old"),
    );
    const old = deferred<{ jobs: Job[] }>();
    api.jobs.mockImplementationOnce(() => old.promise);
    const outdated = editor.updateAncillary();
    publish(document("Newest words", "new"), [job("newest")]);
    await editor.updateAncillary();
    old.resolve({ jobs: [job("older", "running")] });
    await outdated;
    expect(editor.jobs.value.map((value) => value.id)).toEqual(["newest"]);
    expect(editor.state.value?.revision).toBe("new");
  });

  it("continues protecting project ownership through fast completion and its refresh", async () => {
    const { editor, api, publish } = await fixture();
    const ack = deferred<{ job: Job }>();
    api.analyzeIntelligence.mockImplementation(() => ack.promise);
    const submitted = editor.transcription();
    await vi.waitFor(() => expect(api.analyzeIntelligence).toHaveBeenCalled());
    expect(editor.hasPending.value).toBe(true);
    let switched = false;
    const switching = editor.flush().then((saved) => {
      switched = saved;
    });
    await vue.nextTick();
    expect(switched).toBe(false);
    publish(document("Completed in original project", "new"), [job("owned")]);
    ack.resolve({ job: job("owned", "queued") });
    await Promise.all([submitted, switching]);
    expect(editor.hasPending.value).toBe(false);
    expect(switched).toBe(true);
    expect(editor.state.value?.revision).toBe("new");
  });

  it("preserves the current revision when transcription fails or is cancelled", async () => {
    const { editor, api, publish } = await fixture(
      document("Keep my text", "old"),
    );
    const reads = api.transcript.mock.calls.length;
    publish(document("Keep my text", "old"), [
      job("failure", "failed"),
      job("cancelled", "cancelled"),
    ]);
    await editor.poll();
    expect(editor.state.value?.revision).toBe("old");
    expect(api.transcript).toHaveBeenCalledTimes(reads);
  });
});
