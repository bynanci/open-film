import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { applyTimelineCommand, type TimelineCommand } from "@openfilm/solver";
import { api, ApiError, type EditorState } from "../api";
import { useI18n } from "vue-i18n";
import { errorDetail, localizeError } from "../i18n";

type Batch = {
  baseRevision: string;
  requestId: string;
  commands: TimelineCommand[];
};
type Draft = {
  state: EditorState;
  pending: TimelineCommand[];
  batch: Batch | null;
  /** Pending command offsets that must each form their own history entry. */
  gestures?: number[];
};

/** Keep the command queue until acknowledgement, including across a reload. */
export function useTimelineEditor(
  projectId: string,
  compositionId: string,
  changed: (state: EditorState) => void,
  edited: () => void,
) {
  const { t } = useI18n();
  const state = shallowRef<EditorState | null>(null);
  const status = ref<"loading" | "saved" | "saving" | "failed" | "conflict">(
    "loading",
  );
  const issue = shallowRef<unknown>(null);
  const notice = ref("");
  const message = computed(() =>
    notice.value
      ? t(notice.value)
      : issue.value
        ? localizeError(issue.value)
        : "",
  );
  const messageDetail = computed(() =>
    issue.value ? errorDetail(issue.value) : "",
  );
  function reportError(cause: unknown) {
    notice.value = "";
    issue.value = cause;
  }
  function reportNotice(key: string) {
    issue.value = null;
    notice.value = key;
  }
  const pendingCount = ref(0);
  const historyBusy = ref(false);
  const gestureBusy = ref(false);
  const storageKey = `openfilm:editor:${projectId}:${compositionId}`;
  let pending: TimelineCommand[] = [];
  let gestures: number[] = [];
  let gestureRequests: {
    offset: number;
    resolve: (saved: boolean) => void;
  }[] = [];
  let batch: Batch | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<boolean> | null = null;
  let historyRequest: Promise<boolean> | null = null;
  let disposed = false;
  const hasPending = computed(() => pendingCount.value > 0);

  function publish(next: EditorState) {
    state.value = next;
    if (!disposed) changed(next);
  }
  function retainDraft() {
    pendingCount.value = pending.length;
    // Recovery owns the existing bytes until its initial snapshot/receipt is
    // available. Closing during that read must not erase the only saved draft.
    if (pending.length && !state.value) return;
    try {
      if (pending.length && state.value) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            state: state.value,
            pending,
            batch,
            ...(gestures.length ? { gestures } : {}),
          } satisfies Draft),
        );
      } else localStorage.removeItem(storageKey);
    } catch {
      // A blocked/full storage area must not interrupt the live save queue.
    }
  }
  function fail(cause: unknown) {
    status.value =
      cause instanceof ApiError && cause.status === 409 ? "conflict" : "failed";
    reportError(cause);
    retainDraft();
    // Keep failed commands and their boundaries for retry, but release callers
    // waiting for this attempt. A later receipt must never resolve a new gesture.
    for (const request of gestureRequests) request.resolve(false);
    gestureRequests = [];
    gestureBusy.value = false;
  }
  function recoveredGestures(draft: Draft): number[] {
    return Array.isArray(draft.gestures)
      ? [...new Set(draft.gestures)]
          .filter(
            (offset) =>
              Number.isInteger(offset) &&
              offset >= 0 &&
              offset < draft.pending.length,
          )
          .sort((a, b) => a - b)
      : [];
  }
  function acknowledge(count: number) {
    pending = pending.slice(count);
    gestures = gestures
      .filter((offset) => offset >= count)
      .map((offset) => offset - count);
    const completed = gestureRequests.filter(
      (request) => request.offset < count,
    );
    gestureRequests = gestureRequests
      .filter((request) => request.offset >= count)
      .map((request) => ({ ...request, offset: request.offset - count }));
    gestureBusy.value =
      gestureRequests.length > 0 || (saving !== null && gestures.length > 0);
    return () => {
      for (const request of completed) request.resolve(true);
    };
  }
  function applyTo(next: EditorState, commands: TimelineCommand[]) {
    for (const command of commands)
      next = { ...next, ...applyTimelineCommand(next, next.assets, command) };
    return next;
  }
  async function load() {
    if (disposed) return;
    status.value = "loading";
    let recovered: Draft | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const draft = JSON.parse(raw) as Draft;
        if (
          draft.state?.composition.id === compositionId &&
          Array.isArray(draft.pending) &&
          draft.pending.length
        )
          recovered = draft;
      }
    } catch {
      /* Invalid local storage never replaces the saved project. */
    }
    try {
      if (recovered) {
        pending = recovered.pending;
        gestures = recoveredGestures(recovered);
        pendingCount.value = pending.length;
        batch = recovered.batch;
        if (batch) {
          const sending = batch;
          const acknowledged = await api.edit(compositionId, sending);
          if (disposed) return;
          acknowledge(sending.commands.length)();
          batch = null;
          const saved = await api.editor(compositionId);
          if (disposed) return;
          const acknowledgedRevision =
            acknowledged.acknowledgedRevision ?? acknowledged.revision;
          if (pending.length && saved.revision !== acknowledgedRevision) {
            publish(applyTo(acknowledged, pending));
            status.value = "conflict";
            reportNotice("editor.draft.conflictRecovered");
          } else if (pending.length) {
            publish(applyTo(saved, pending));
            status.value = "failed";
            reportNotice("editor.draft.recovered");
          } else {
            publish(saved);
            status.value = "saved";
            reportNotice("");
          }
        } else {
          const saved = await api.editor(compositionId);
          if (disposed) return;
          if (recovered.state.revision === saved.revision) {
            publish(applyTo(saved, pending));
            status.value = "failed";
            reportNotice("editor.draft.recovered");
          } else {
            publish(recovered.state);
            status.value = "conflict";
            reportNotice("editor.draft.conflictRecovered");
          }
        }
        retainDraft();
        edited();
      } else {
        const saved = await api.editor(compositionId);
        if (disposed) return;
        publish(saved);
        status.value = "saved";
        reportNotice("");
      }
    } catch (cause) {
      if (disposed) return;
      if (recovered) {
        pending = recovered.pending;
        gestures = recoveredGestures(recovered);
        batch = recovered.batch;
        publish(recovered.state);
      }
      fail(cause);
    }
  }
  function command(input: TimelineCommand | TimelineCommand[]): boolean {
    if (
      !state.value ||
      historyBusy.value ||
      gestureBusy.value ||
      status.value === "loading"
    )
      return false;
    const commands = Array.isArray(input) ? input : [input];
    try {
      const next = applyTo(state.value, commands);
      pending.push(...commands);
      publish(next);
      edited();
      retainDraft();
      reportNotice("");
      if (status.value !== "conflict") {
        status.value = "saving";
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void flush();
        }, 400);
      }
      return true;
    } catch (cause) {
      reportError(cause);
      return false;
    }
  }
  function commitGesture(input: TimelineCommand): Promise<boolean> {
    if (!state.value || historyBusy.value || status.value === "loading")
      return Promise.resolve(false);
    try {
      const next = applyTo(state.value, [input]);
      const offset = pending.length;
      pending.push(input);
      gestures.push(offset);
      // Enqueue synchronously so flush, navigation and unload observe even a
      // second gesture submitted before the first save has returned.
      const result = new Promise<boolean>((resolve) => {
        gestureRequests.push({ offset, resolve });
      });
      gestureBusy.value = true;
      publish(next);
      edited();
      retainDraft();
      reportNotice("");
      void flush();
      return result.then(async (saved) => {
        // Make an explicit retry after `await commitGesture()` start a fresh
        // attempt, rather than joining the promise that just failed.
        if (!saved && saving) await saving;
        return saved;
      });
    } catch (cause) {
      reportError(cause);
      return Promise.resolve(false);
    }
  }
  function flush(): Promise<boolean> {
    if (historyRequest)
      return historyRequest.then((ok) => (ok ? flushCommands() : false));
    return flushCommands();
  }
  function flushCommands(): Promise<boolean> {
    if (timer) clearTimeout(timer);
    if (saving) return saving.then(continueFlush);
    if (status.value === "loading" || !state.value)
      return Promise.resolve(false);
    if (!pending.length) return Promise.resolve(status.value !== "conflict");
    if (gestures.length) gestureBusy.value = true;
    saving = (async () => {
      while (pending.length && state.value) {
        const firstGesture = gestures[0];
        const limit =
          firstGesture === 0 ? 1 : Math.min(firstGesture ?? 100, 100);
        if (!batch)
          batch = {
            baseRevision: state.value.revision,
            requestId: crypto.randomUUID(),
            commands: pending.slice(0, limit),
          };
        const sending = batch;
        status.value = "saving";
        retainDraft();
        try {
          const saved = await api.edit(compositionId, sending);
          const completeGestures = acknowledge(sending.commands.length);
          batch = null;
          publish(applyTo(saved, pending));
          retainDraft();
          reportNotice("");
          completeGestures();
        } catch (cause) {
          fail(cause);
          return false;
        }
      }
      status.value = "saved";
      return true;
    })().finally(() => {
      saving = null;
      if (!gestureRequests.length) gestureBusy.value = false;
    });
    return saving.then(continueFlush);
  }
  function continueFlush(saved: boolean): boolean | Promise<boolean> {
    // Vue watchers and a fulfilled gesture may enqueue another command after
    // the drain's last loop condition, before its finally callback has run.
    // Navigation/render callers must wait for that pending work as well.
    return saved && pending.length ? flushCommands() : saved;
  }
  async function reapplyDraft() {
    if (saving) await saving;
    if (!pending.length) return;
    try {
      const saved = await api.editor(compositionId);
      const next = applyTo(saved, pending);
      batch = null;
      publish(next);
      retainDraft();
      await flush();
    } catch (cause) {
      fail(cause);
    }
  }
  function history(direction: "undo" | "redo"): Promise<boolean> {
    if (historyRequest) return historyRequest;
    historyBusy.value = true;
    historyRequest = (async () => {
      try {
        if (!(await flushCommands()) || !state.value) return false;
        if (direction === "undo" ? !state.value.canUndo : !state.value.canRedo)
          return true;
        status.value = "saving";
        publish(
          await api.history(compositionId, direction, state.value.revision),
        );
        edited();
        status.value = "saved";
        reportNotice("");
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      } finally {
        historyBusy.value = false;
      }
    })().finally(() => {
      historyRequest = null;
    });
    return historyRequest;
  }
  async function discardDraft() {
    if (saving) await saving;
    if (historyRequest) await historyRequest;
    historyBusy.value = true;
    try {
      const saved = await api.editor(compositionId);
      if (timer) clearTimeout(timer);
      pending = [];
      gestures = [];
      batch = null;
      publish(saved);
      retainDraft();
      status.value = "saved";
      reportNotice("");
      edited();
    } catch (cause) {
      fail(cause);
    } finally {
      historyBusy.value = false;
    }
  }
  function downloadDraft() {
    if (!state.value || !pending.length) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { state: state.value, pending, batch, gestures },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `openfilm-unsaved-draft-${compositionId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!pending.length) return;
    retainDraft();
    void flush();
    event.preventDefault();
    event.returnValue = "";
  }
  onMounted(() => {
    void load();
    window.addEventListener("beforeunload", beforeUnload);
  });
  onBeforeUnmount(() => {
    disposed = true;
    retainDraft();
    void flush();
    window.removeEventListener("beforeunload", beforeUnload);
  });
  return {
    state,
    status,
    message,
    messageDetail,
    reportError,
    reportNotice,
    hasPending,
    historyBusy,
    gestureBusy,
    command,
    commitGesture,
    flush,
    history,
    reapplyDraft,
    discardDraft,
    downloadDraft,
    load,
  };
}
