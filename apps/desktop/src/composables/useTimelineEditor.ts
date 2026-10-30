import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toRaw,
} from "vue";
import { applyTimelineCommand, type TimelineCommand } from "@openfilm/solver";
import type { MediaAsset } from "@openfilm/core";
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
  /** A professional batch rolls back on rejection instead of being rebased. */
  transactionBase?: EditorState;
};
export type CommitTransactionResult =
  | { status: "accepted"; revision: string }
  | { status: "conflict" | "cancelled" | "failed" };
export interface CommitTransactionOptions {
  expectedBaseRevision?: string;
}

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
  const transactionPreparing = ref(false);
  const transactionSending = ref(false);
  const transactionBusy = computed(
    () => transactionPreparing.value || transactionSending.value,
  );
  const storageKey = `openfilm:editor:${projectId}:${compositionId}`;
  let pending: TimelineCommand[] = [];
  let batch: Batch | null = null;
  let transactionBase: EditorState | null = null;
  let transactionNeedsReapply = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<boolean> | null = null;
  let historyRequest: Promise<boolean> | null = null;
  let reapplying = false;
  let discarding = false;
  let disposed = false;
  const hasPending = computed(() => pendingCount.value > 0);

  function publish(next: EditorState) {
    if (disposed) return;
    state.value = next;
    changed(next);
  }
  function retainDraft(snapshot = state.value): boolean {
    pendingCount.value = pending.length;
    // Recovery owns the existing bytes until its initial snapshot/receipt is
    // available. Closing during that read must not erase the only saved draft.
    if (pending.length && !snapshot) return false;
    try {
      if (pending.length && snapshot) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            state: snapshot,
            pending,
            batch,
            ...(transactionBase ? { transactionBase } : {}),
          } satisfies Draft),
        );
      } else localStorage.removeItem(storageKey);
      return true;
    } catch {
      // A blocked/full storage area must not interrupt the live save queue.
      return false;
    }
  }
  function fail(cause: unknown) {
    if (disposed) return;
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
  function assertComposition(next: EditorState) {
    if (next.composition.id !== compositionId)
      throw new ApiError("The edit belongs to another composition.", 409);
  }
  function definitiveRejection(cause: unknown) {
    return (
      cause instanceof ApiError && cause.status >= 400 && cause.status < 500
    );
  }
  async function rejectTransaction(cause: unknown) {
    if (disposed || !transactionBase) return;
    const before = transactionBase;
    pending = [];
    batch = null;
    transactionBase = null;
    publish(before);
    fail(cause);
    try {
      const saved = await api.editor(compositionId);
      if (disposed) return;
      assertComposition(saved);
      publish(saved);
      edited();
    } catch {
      /* Keep the original rejection and the non-optimistic baseline. */
    }
  }
  async function load() {
    if (
      disposed ||
      discarding ||
      transactionBusy.value ||
      saving ||
      historyRequest
    )
      return;
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
        pendingCount.value = pending.length;
        batch = recovered.batch;
        transactionBase = recovered.transactionBase ?? null;
        transactionNeedsReapply = !!transactionBase;
        transactionSending.value = !!transactionBase;
        if (transactionBase) {
          // Generic receipts are server-session-only. Mount cannot establish
          // continuity, even when the saved digest matches the original base.
          // Show authoritative content and keep the exact request for Reapply.
          const saved = await api.editor(compositionId);
          if (disposed) return;
          assertComposition(saved);
          publish(saved);
          status.value = "conflict";
          reportNotice("editor.draft.conflictRecovered");
          edited();
          return;
        }
        if (batch) {
          const sending = batch;
          const acknowledged = await api.edit(compositionId, sending);
          if (disposed) return;
          pending = pending.slice(sending.commands.length);
          batch = null;
          const saved = await api.editor(compositionId);
          if (disposed) return;
          assertComposition(saved);
          transactionBase = null;
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
        batch = recovered.batch;
        transactionBase = recovered.transactionBase ?? null;
        publish(recovered.state);
      }
      fail(cause);
      // The existing conflict recovery surface exposes explicit Reapply even
      // when its initial read failed; generic Retry must remain send-free.
      if (transactionNeedsReapply) status.value = "conflict";
    } finally {
      transactionSending.value = false;
    }
  }
  function command(
    input: TimelineCommand | TimelineCommand[],
    referencedAssets: readonly MediaAsset[] = [],
  ): boolean {
    if (
      disposed ||
      discarding ||
      !state.value ||
      historyBusy.value ||
      transactionBusy.value ||
      transactionBase ||
      status.value === "loading"
    )
      return false;
    const commands = Array.isArray(input) ? input : [input];
    try {
      const knownIds = new Set(state.value.assets.map((asset) => asset.id));
      const additions = referencedAssets.flatMap((asset) => {
        if (knownIds.has(asset.id)) return [];
        knownIds.add(asset.id);
        return [structuredClone(toRaw(asset))];
      });
      const base = additions.length
        ? { ...state.value, assets: [...state.value.assets, ...additions] }
        : state.value;
      const next = applyTo(base, commands);
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
    if (
      disposed ||
      discarding ||
      transactionNeedsReapply ||
      transactionPreparing.value
    )
      return Promise.resolve(false);
    if (historyRequest)
      return historyRequest.then((ok) => (ok ? flushCommands() : false));
    return flushCommands();
  }
  function flushCommands(signal?: AbortSignal): Promise<boolean> {
    if (timer) clearTimeout(timer);
    if (disposed || transactionNeedsReapply) return Promise.resolve(false);
    if (saving) return saving;
    if (status.value === "loading" || !state.value)
      return Promise.resolve(false);
    if (!pending.length) return Promise.resolve(status.value !== "conflict");
    transactionSending.value = !!transactionBase;
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
          const saved = await api.edit(compositionId, sending, signal);
          if (disposed) return false;
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          assertComposition(saved);
          pending = pending.slice(sending.commands.length);
          batch = null;
          transactionBase = null;
          publish(applyTo(saved, pending));
          retainDraft();
          reportNotice("");
        } catch (cause) {
          if (disposed) return false;
          if (transactionBase && !signal?.aborted && definitiveRejection(cause))
            await rejectTransaction(cause);
          else fail(cause);
          return false;
        }
      }
      status.value = "saved";
      return true;
    })().finally(() => {
      saving = null;
      transactionSending.value = false;
    });
    return saving;
  }
  async function commitTransaction(
    input: TimelineCommand | TimelineCommand[],
    referencedAssets: readonly MediaAsset[] = [],
    signal?: AbortSignal,
    options?: CommitTransactionOptions,
  ): Promise<CommitTransactionResult> {
    if (disposed || signal?.aborted) return { status: "cancelled" };
    if (
      transactionBusy.value ||
      discarding ||
      reapplying ||
      (historyBusy.value && !historyRequest)
    )
      return { status: "failed" };
    transactionPreparing.value = true;
    try {
      const commands = structuredClone(
        toRaw(Array.isArray(input) ? input : [input]),
      );
      const assets = referencedAssets.map((asset) =>
        structuredClone(toRaw(asset)),
      );
      if (!commands.length || commands.length > 100)
        throw new Error(
          "A transaction must contain between 1 and 100 commands.",
        );
      const historyAcknowledged = historyRequest ? await historyRequest : true;
      if (disposed || signal?.aborted) return { status: "cancelled" };
      const acknowledged = historyAcknowledged && (await flushCommands());
      if (disposed || signal?.aborted) return { status: "cancelled" };
      if (!acknowledged || !state.value)
        return { status: status.value === "conflict" ? "conflict" : "failed" };
      const before = state.value;
      assertComposition(before);
      if (
        options?.expectedBaseRevision !== undefined &&
        before.revision !== options.expectedBaseRevision
      ) {
        status.value = "conflict";
        reportError(
          new ApiError(
            "Timeline changed since this gesture began. Review the current photo and try again.",
            409,
            { code: "timeline.conflict" },
          ),
        );
        return { status: "conflict" };
      }
      const knownIds = new Set(before.assets.map((asset) => asset.id));
      const additions = assets.filter((asset) => {
        if (knownIds.has(asset.id)) return false;
        knownIds.add(asset.id);
        return true;
      });
      const next = applyTo(
        additions.length
          ? { ...before, assets: [...before.assets, ...additions] }
          : before,
        commands,
      );
      pending = commands;
      batch = {
        baseRevision: before.revision,
        requestId: crypto.randomUUID(),
        commands,
      };
      transactionBase = before;
      // Store the exact request before optimistic publication or transport.
      if (!retainDraft(next)) {
        pending = [];
        batch = null;
        transactionBase = null;
        retainDraft();
        throw new Error("The edit recovery draft could not be saved.");
      }
      publish(next);
      edited();
      reportNotice("");
      const accepted = await flushCommands(signal);
      if (disposed || signal?.aborted) return { status: "cancelled" };
      return accepted
        ? {
            status: "accepted",
            revision: state.value.acknowledgedRevision ?? state.value.revision,
          }
        : { status: status.value === "conflict" ? "conflict" : "failed" };
    } catch (cause) {
      if (disposed || signal?.aborted) return { status: "cancelled" };
      reportError(cause);
      return { status: "failed" };
    } finally {
      transactionPreparing.value = false;
    }
  }
  async function reapplyDraft() {
    if (disposed || discarding || transactionBusy.value || reapplying) return;
    if (transactionBase) {
      transactionNeedsReapply = false;
      await flush();
      return;
    }
    reapplying = true;
    try {
      if (saving) await saving;
      if (disposed || !pending.length) return;
      const saved = await api.editor(compositionId);
      if (disposed) return;
      const next = applyTo(saved, pending);
      batch = null;
      publish(next);
      retainDraft();
      await flush();
    } catch (cause) {
      fail(cause);
    } finally {
      reapplying = false;
    }
  }
  async function addNativeCaptionTrack(
    input: {
      projectId: string;
      snapshotId: string;
      name: string;
      language?: string;
      trackId: string;
      requestId: string;
    },
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (historyRequest) await historyRequest;
    if (
      disposed ||
      discarding ||
      !state.value ||
      historyBusy.value ||
      transactionBusy.value
    )
      return false;
    historyBusy.value = true;
    try {
      if (!(await flushCommands()) || !state.value) return false;
      if (state.value.composition.id !== compositionId) return false;
      status.value = "saving";
      reportNotice("");
      const saved = await api.addNativeCaptionTrack(input, signal);
      if (disposed) return false;
      if (saved.composition.id !== compositionId)
        throw new ApiError("The caption track belongs to another edit.", 409, {
          code: "captions.stale",
        });
      if (timer) clearTimeout(timer);
      pending = [];
      batch = null;
      publish(saved);
      retainDraft();
      edited();
      status.value = "saved";
      reportNotice("");
      return true;
    } catch (cause) {
      if (!disposed) {
        fail(cause);
        // A network response may be lost after the server has committed. Reload
        // the Composition so retrying never duplicates or hides the saved track.
        try {
          const saved = await api.editor(compositionId);
          if (!disposed && saved.composition.id === compositionId)
            publish(saved);
        } catch {
          /* Keep the original error and its recovery draft. */
        }
      }
      return false;
    } finally {
      historyBusy.value = false;
    }
  }
  function history(direction: "undo" | "redo"): Promise<boolean> {
    if (disposed || discarding || transactionBusy.value)
      return Promise.resolve(false);
    if (historyRequest) return historyRequest;
    historyBusy.value = true;
    historyRequest = (async () => {
      try {
        if (!(await flushCommands()) || disposed || !state.value) return false;
        if (direction === "undo" ? !state.value.canUndo : !state.value.canRedo)
          return true;
        status.value = "saving";
        const saved = await api.history(
          compositionId,
          direction,
          state.value.revision,
        );
        if (disposed) return false;
        publish(saved);
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
    if (
      disposed ||
      discarding ||
      reapplying ||
      transactionBusy.value ||
      (historyBusy.value && !historyRequest)
    )
      return;
    // Own admission before waiting for older work, so no newer batch can be
    // published or cleared by this Discard's later authoritative reload.
    discarding = true;
    try {
      if (transactionBase && !transactionNeedsReapply) {
        const acknowledged = await flushCommands();
        if (disposed || !acknowledged) return;
      }
      if (saving) {
        await saving;
        if (disposed) return;
      }
      if (historyRequest) {
        await historyRequest;
        if (disposed) return;
      }
      const saved = await api.editor(compositionId);
      if (disposed) return;
      assertComposition(saved);
      if (timer) clearTimeout(timer);
      pending = [];
      batch = null;
      transactionBase = null;
      transactionNeedsReapply = false;
      publish(saved);
      if (disposed) return;
      retainDraft();
      status.value = "saved";
      reportNotice("");
      edited();
    } catch (cause) {
      fail(cause);
    } finally {
      discarding = false;
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
    retainDraft();
    if (!transactionBase) void flush();
    disposed = true;
    if (timer) clearTimeout(timer);
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
    transactionBusy,
    commitTransaction,
    command,
    flush,
    history,
    reapplyDraft,
    addNativeCaptionTrack,
    discardDraft,
    downloadDraft,
    load,
  };
}
