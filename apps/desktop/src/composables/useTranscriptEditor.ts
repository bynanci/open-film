import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import {
  validateTranscriptCommand,
  type TranscriptCommand,
} from "@openfilm/core";
import { api, ApiError, type TranscriptEditorState } from "../api";

type Receipt =
  | { baseRevision: string; requestId: string; commands: TranscriptCommand[] }
  | { baseRevision: string; requestId: string; direction: "undo" | "redo" }
  | { baseRevision: string; requestId: string; revisionId: string };
type Draft = {
  state: TranscriptEditorState;
  pending: TranscriptCommand[];
  receipt: Receipt | null;
};
type LoadOperation = {
  generation: number;
  recover: boolean;
  promise: Promise<boolean>;
  superseded: Promise<void>;
  supersede: () => void;
};

/** Source-scoped durable queue. A retry always reuses its original receipt. */
export function useTranscriptEditor(
  projectId: string,
  assetId: string,
  changed: () => void,
) {
  const state = shallowRef<TranscriptEditorState | null>(null);
  const status = ref<
    "loading" | "dirty" | "saving" | "saved" | "failed" | "conflict"
  >("loading");
  const error = shallowRef<unknown>(null);
  const notice = ref("");
  const historyBusy = ref(false);
  const pendingCount = ref(0);
  const hasPending = computed(() => pendingCount.value > 0);
  const storageKey = `openfilm:transcript:${projectId}:${assetId}`;
  let pending: TranscriptCommand[] = [];
  let receipt: Receipt | null = null;
  let saving: Promise<boolean> | null = null;
  let revisionMutation: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let readGeneration = 0;
  let loading: LoadOperation | null = null;
  const view = (
    saved: TranscriptEditorState,
    commands: TranscriptCommand[],
  ) => {
    const next = structuredClone(saved);
    for (const command of commands) {
      if (command.type !== "replace-text") continue;
      const segment = next.document?.segments.find(
        (item) => item.id === command.segmentId,
      );
      if (segment) {
        segment.text = command.text;
        segment.alignmentState = "text-edited";
      }
    }
    return next;
  };
  function retain() {
    pendingCount.value = pending.length + (receipt ? 1 : 0);
    // Keep recovery bytes until a hydrated snapshot can safely replace them.
    if (!state.value) return;
    try {
      if ((pending.length || receipt) && state.value)
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            state: state.value,
            pending,
            receipt,
          } satisfies Draft),
        );
      else localStorage.removeItem(storageKey);
    } catch {
      /* A full recovery store must not interrupt live editing. */
    }
  }
  function fail(cause: unknown) {
    error.value = cause;
    status.value =
      cause instanceof ApiError && cause.status === 409 ? "conflict" : "failed";
    retain();
  }
  async function receiptSend(value: Receipt) {
    return "commands" in value
      ? api.editTranscript(assetId, value)
      : "revisionId" in value
        ? api.selectTranscriptRevision(assetId, value)
        : api.transcriptHistory(assetId, value.direction, {
            baseRevision: value.baseRevision,
            requestId: value.requestId,
          });
  }
  async function readPage(offset: number) {
    let saved = await api.transcript(assetId, offset, 100);
    // Structural edits or revision changes can remove the current last page.
    // Each reread moves backward, including if another edit shrinks it again.
    while (saved.offset > 0 && saved.offset >= saved.total) {
      const lastOffset = Math.floor(Math.max(0, saved.total - 1) / 100) * 100;
      saved = await api.transcript(assetId, lastOffset, 100);
    }
    return saved;
  }
  function load(
    offset = state.value?.offset ?? 0,
    recover = true,
  ): Promise<boolean> {
    if (
      disposed ||
      (!recover &&
        (hasPending.value || pending.length || receipt || loading?.recover))
    )
      return Promise.resolve(false);
    // Recovery owns receipt replay and pending-prefix removal as one operation.
    // Coalesce repeated recovery calls rather than replaying them concurrently.
    if (loading?.recover) return loading.promise;
    const stamp = ++readGeneration;
    let supersede!: () => void;
    const superseded = new Promise<void>((resolve) => {
      supersede = resolve;
    });
    const operation: LoadOperation = {
      generation: stamp,
      recover,
      superseded,
      supersede,
      promise: Promise.resolve().then(() => readLoad(offset, recover, stamp)),
    };
    operation.promise = operation.promise.finally(() => {
      if (loading === operation) loading = null;
    });
    const previous = loading;
    loading = operation;
    previous?.supersede();
    status.value = "loading";
    return operation.promise;
  }
  async function readLoad(offset: number, recover: boolean, stamp: number) {
    if (disposed || stamp !== readGeneration) return false;
    let draft: Draft | null = null;
    if (recover)
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const value = JSON.parse(raw) as Draft;
          if (
            value.state?.document?.assetId === assetId &&
            Array.isArray(value.pending) &&
            value.pending.every(
              (command) => !!validateTranscriptCommand(command),
            )
          )
            draft = value;
        }
      } catch {
        /* Invalid local data never replaces a saved transcript. */
      }
    try {
      if (draft) {
        pending = draft.pending;
        receipt = draft.receipt;
        let acknowledged: TranscriptEditorState | undefined;
        if (receipt) {
          const sent = receipt;
          acknowledged = await receiptSend(sent);
          if ("commands" in sent) pending = pending.slice(sent.commands.length);
          receipt = null;
        }
        const saved = await readPage(draft.state.offset);
        if (disposed || stamp !== readGeneration) return false;
        const expected =
          acknowledged?.acknowledgedRevision ??
          acknowledged?.revision ??
          draft.state.revision;
        if (pending.length && saved.revision !== expected) {
          state.value = draft.state;
          status.value = "conflict";
          notice.value = "transcript.draftConflict";
        } else {
          state.value = view(saved, pending);
          status.value = pending.length ? "failed" : "saved";
          notice.value = pending.length ? "transcript.draftRecovered" : "";
        }
        retain();
        changed();
      } else {
        const saved = await readPage(offset);
        if (disposed || stamp !== readGeneration) return false;
        state.value = saved;
        status.value = "saved";
        error.value = null;
        notice.value = "";
      }
      return true;
    } catch (cause) {
      if (disposed || stamp !== readGeneration) return false;
      if (draft) {
        pending = draft.pending;
        receipt = draft.receipt;
        state.value = draft.state;
      }
      fail(cause);
      return false;
    }
  }
  function command(input: TranscriptCommand): boolean {
    if (
      !state.value?.revision ||
      historyBusy.value ||
      status.value === "loading" ||
      status.value === "conflict"
    )
      return false;
    try {
      const value = validateTranscriptCommand(input);
      // Typing updates the visible segment. The application applies structural
      // and whole-document commands against the complete saved transcript.
      state.value = view(state.value, [value]);
      pending.push(value);
      retain();
      error.value = null;
      notice.value = "";
      status.value = "dirty";
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 400);
      return true;
    } catch (cause) {
      error.value = cause;
      return false;
    }
  }
  function flush(): Promise<boolean> {
    return revisionMutation ?? flushQueue();
  }
  function flushQueue(): Promise<boolean> {
    clearTimeout(timer);
    if (disposed) return Promise.resolve(false);
    if (loading) {
      const operation = loading;
      return Promise.race([
        operation.promise.then((result) => ({ result, superseded: false })),
        operation.superseded.then(() => ({ result: false, superseded: true })),
      ]).then((outcome) => {
        if (disposed) return false;
        if (outcome.superseded || operation.generation !== readGeneration)
          return flushQueue();
        return outcome.result ? flushQueue() : false;
      });
    }
    if (saving) return saving;
    if (status.value === "conflict") return Promise.resolve(false);
    if (!hasPending.value)
      return Promise.resolve(status.value !== "loading" && !!state.value);
    saving = (async () => {
      while ((pending.length || receipt) && state.value?.revision) {
        if (!receipt)
          receipt = {
            baseRevision: state.value.revision,
            requestId: crypto.randomUUID(),
            commands: pending.slice(0, 100),
          };
        const sending = receipt;
        status.value = "saving";
        retain();
        try {
          const acknowledged = await receiptSend(sending);
          const offset = state.value.offset;
          // A paged edit receipt can be followed by a newer revision from a
          // different editor. Never replay an unsaved suffix over that revision.
          const saved = await readPage(offset);
          if ("commands" in sending)
            pending = pending.slice(sending.commands.length);
          receipt = null;
          if (
            pending.length &&
            saved.revision !==
              (acknowledged.acknowledgedRevision ?? acknowledged.revision)
          ) {
            state.value = {
              ...state.value,
              revision:
                acknowledged.acknowledgedRevision ?? acknowledged.revision,
            };
            status.value = "conflict";
            notice.value = "transcript.draftConflict";
            retain();
            return false;
          }
          state.value = view(saved, pending);
          retain();
          changed();
          error.value = null;
          notice.value = "";
        } catch (cause) {
          fail(cause);
          return false;
        }
      }
      status.value = "saved";
      return true;
    })().finally(() => {
      saving = null;
    });
    return saving;
  }
  function history(direction: "undo" | "redo"): Promise<boolean> {
    return reserveRevisionChange((baseRevision) => ({
      baseRevision,
      requestId: crypto.randomUUID(),
      direction,
    }));
  }
  function reserveRevisionChange(
    createReceipt: (baseRevision: string) => Receipt,
  ): Promise<boolean> {
    if (disposed || historyBusy.value || revisionMutation)
      return Promise.resolve(false);
    // Reserve preparation and receipt delivery before publishing the busy state.
    // Navigation waits for this operation; its own saves use the queue directly.
    const operation = Promise.resolve()
      .then(async () => {
        if (!(await flushQueue()) || disposed || !state.value?.revision)
          return false;
        receipt = createReceipt(state.value.revision);
        retain();
        return flushQueue();
      })
      .finally(() => {
        if (revisionMutation === operation) {
          revisionMutation = null;
          historyBusy.value = false;
        }
      });
    revisionMutation = operation;
    historyBusy.value = true;
    return operation;
  }
  async function loadPage(offset: number) {
    if (!(await flush())) return false;
    return load(offset, false);
  }
  async function reconcile() {
    if (!hasPending.value) return load(state.value?.offset ?? 0, false);
    // A newer server revision may be our own commit with an acknowledgment
    // still in flight or lost. Confirm that exact receipt before comparing it
    // with an unsent draft, so reconciliation never disables receipt retry.
    if (saving || receipt) return false;
    const stamp = ++readGeneration;
    const baseRevision = state.value?.revision;
    const current = () =>
      !disposed &&
      stamp === readGeneration &&
      hasPending.value &&
      state.value?.revision === baseRevision &&
      !saving &&
      !receipt;
    try {
      const saved = await api.transcript(
        assetId,
        state.value?.offset ?? 0,
        100,
      );
      if (!current()) return false;
      if (saved.revision !== baseRevision) {
        status.value = "conflict";
        notice.value = "transcript.draftConflict";
        retain();
        return false;
      }
      return true;
    } catch (cause) {
      if (current()) fail(cause);
      return false;
    }
  }
  async function discardDraft() {
    if (saving) await saving;
    pending = [];
    receipt = null;
    retain();
    error.value = null;
    notice.value = "";
    return load(state.value?.offset ?? 0, false);
  }
  function downloadDraft() {
    const blob = new Blob(
      [JSON.stringify({ state: state.value, pending, receipt }, null, 2)],
      { type: "application/json" },
    );
    const href = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = href;
    link.download = `openfilm-transcript-draft-${assetId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  function restore(revisionId: string): Promise<boolean> {
    return reserveRevisionChange((baseRevision) => ({
      baseRevision,
      requestId: crypto.randomUUID(),
      revisionId,
    }));
  }
  onMounted(() => void load());
  onBeforeUnmount(() => {
    disposed = true;
    loading?.supersede();
    clearTimeout(timer);
    retain();
  });
  return {
    state,
    status,
    error,
    notice,
    historyBusy,
    hasPending,
    command,
    flush,
    history,
    load,
    loadPage,
    discardDraft,
    downloadDraft,
    restore,
    reconcile,
  };
}
