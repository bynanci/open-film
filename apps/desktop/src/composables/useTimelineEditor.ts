import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { applyTimelineCommand, type TimelineCommand } from "@openfilm/solver";
import { api, ApiError, type EditorState } from "../api";

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
  const state = shallowRef<EditorState | null>(null);
  const status = ref<"loading" | "saved" | "saving" | "failed" | "conflict">(
    "loading",
  );
  const message = ref("");
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
    message.value = cause instanceof Error ? cause.message : String(cause);
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
      const saved = await api.editor(compositionId);
      if (recovered) {
        pending = recovered.pending;
        batch = recovered.batch;
        if (recovered.state.revision === saved.revision) {
          publish(applyTo(saved, pending));
          status.value = "failed";
          message.value =
            "Your unsaved edits were recovered. Retry saving to keep them in your project.";
        } else {
          publish(recovered.state);
          status.value = "conflict";
          message.value =
            "Your unsaved draft was recovered, and the saved cut has changed. Review the draft before applying it to the latest cut.";
        }
        retainDraft();
        edited();
      } else {
        publish(saved);
        status.value = "saved";
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
      message.value = "";
      if (status.value !== "conflict") {
        status.value = "saving";
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void flush();
        }, 400);
      }
      return true;
    } catch (cause) {
      message.value = cause instanceof Error ? cause.message : String(cause);
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
          message.value = "";
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
        message.value = "";
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
      message.value = "";
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
