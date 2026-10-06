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
  const storageKey = `openfilm:editor:${projectId}:${compositionId}`;
  let pending: TimelineCommand[] = [];
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
    try {
      if (pending.length && state.value) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            state: state.value,
            pending,
            batch,
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
  }
  function applyTo(next: EditorState, commands: TimelineCommand[]) {
    for (const command of commands)
      next = { ...next, ...applyTimelineCommand(next, next.assets, command) };
    return next;
  }
  async function load() {
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
        batch = recovered.batch;
        if (batch) {
          const sending = batch;
          const acknowledged = await api.edit(compositionId, sending);
          pending = pending.slice(sending.commands.length);
          batch = null;
          const saved = await api.editor(compositionId);
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
        publish(saved);
        status.value = "saved";
        reportNotice("");
      }
    } catch (cause) {
      if (recovered) {
        pending = recovered.pending;
        batch = recovered.batch;
        publish(recovered.state);
      }
      fail(cause);
    }
  }
  function command(input: TimelineCommand | TimelineCommand[]): boolean {
    if (!state.value || historyBusy.value || status.value === "loading")
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
  function flush(): Promise<boolean> {
    if (historyRequest)
      return historyRequest.then((ok) => (ok ? flushCommands() : false));
    return flushCommands();
  }
  function flushCommands(): Promise<boolean> {
    if (timer) clearTimeout(timer);
    if (saving) return saving;
    if (!pending.length)
      return Promise.resolve(
        status.value !== "loading" &&
          status.value !== "conflict" &&
          !!state.value,
      );
    saving = (async () => {
      while (pending.length && state.value) {
        if (!batch)
          batch = {
            baseRevision: state.value.revision,
            requestId: crypto.randomUUID(),
            commands: pending.slice(0, 100),
          };
        const sending = batch;
        status.value = "saving";
        retainDraft();
        try {
          const saved = await api.edit(compositionId, sending);
          pending = pending.slice(sending.commands.length);
          batch = null;
          publish(applyTo(saved, pending));
          retainDraft();
          reportNotice("");
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
      [JSON.stringify({ state: state.value, pending, batch }, null, 2)],
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
    command,
    flush,
    history,
    reapplyDraft,
    discardDraft,
    downloadDraft,
    load,
  };
}
