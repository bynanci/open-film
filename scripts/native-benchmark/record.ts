import type {
  ProcessMemorySnapshot,
  ProcessMemory,
  MemoryTotal,
} from "./process-memory";

export const CHECKPOINT_KINDS = [
  "welcome-ready",
  "library-ready",
  "edit-enter",
  "edit-ready",
  "edit-leave",
] as const;
export interface NativeEvent {
  runId: string;
  pid: number;
  kind: (typeof CHECKPOINT_KINDS)[number];
  nativeElapsedMs: number;
  unixMs: number;
  clientElapsedMs: number;
  clientTimeOriginMs: number;
  clipCount?: number;
}
export function parseNativeEvents(
  text: string,
  runId: string,
  pid: number,
): NativeEvent[] {
  // Only complete lines are evidence; a writer may be in the middle of append.
  const lines = text.split("\n").slice(0, -1).filter(Boolean);
  let previous = -1;
  return lines.map((line) => {
    const value = JSON.parse(line) as NativeEvent;
    if (!value || value.runId !== runId || value.pid !== pid)
      throw new Error("Native checkpoint identity mismatch");
    if (!CHECKPOINT_KINDS.includes(value.kind))
      throw new Error("Invalid native checkpoint kind");
    if (
      !Number.isFinite(value.nativeElapsedMs) ||
      value.nativeElapsedMs < 0 ||
      !Number.isSafeInteger(value.unixMs) ||
      value.unixMs <= 0
    )
      throw new Error("Invalid native checkpoint time");
    if (
      !Number.isFinite(value.clientElapsedMs) ||
      value.clientElapsedMs < 0 ||
      !Number.isFinite(value.clientTimeOriginMs) ||
      value.clientTimeOriginMs <= 0
    )
      throw new Error("Invalid client checkpoint time");
    if (value.nativeElapsedMs < previous)
      throw new Error("Native checkpoint clock must be monotonic");
    previous = value.nativeElapsedMs;
    if (
      value.clipCount !== undefined &&
      (!Number.isSafeInteger(value.clipCount) || value.clipCount < 0)
    )
      throw new Error("Invalid native clip count");
    if (value.kind === "edit-ready" && value.clipCount === undefined)
      throw new Error("Native Edit checkpoint needs a clip count");
    return value;
  });
}
export function summarizeNativeEvents(events: NativeEvent[]) {
  const editVisits: Array<{
    enter: NativeEvent;
    ready: NativeEvent;
    durationMs: number;
    nativeReceiptDurationMs: number;
    clipCount: number;
  }> = [];
  let pending: NativeEvent | undefined;
  let incompleteEditVisits = 0;
  let invalidEditVisits = 0;
  for (const event of events) {
    if (event.kind === "edit-enter") {
      if (pending) incompleteEditVisits++;
      pending = event;
    } else if (event.kind === "edit-leave") {
      if (pending) incompleteEditVisits++;
      pending = undefined;
    } else if (event.kind === "edit-ready" && pending) {
      if (
        event.clientTimeOriginMs !== pending.clientTimeOriginMs ||
        event.clientElapsedMs < pending.clientElapsedMs
      ) {
        invalidEditVisits++;
        pending = undefined;
        continue;
      }
      editVisits.push({
        enter: pending,
        ready: event,
        durationMs: event.clientElapsedMs - pending.clientElapsedMs,
        nativeReceiptDurationMs:
          event.nativeElapsedMs - pending.nativeElapsedMs,
        clipCount: event.clipCount!,
      });
      pending = undefined;
    }
  }
  if (pending) incompleteEditVisits++;
  return {
    firstUiReady: events.find(
      (entry) =>
        entry.kind === "welcome-ready" || entry.kind === "library-ready",
    ),
    editVisits,
    incompleteEditVisits,
    invalidEditVisits,
  };
}
export function mergeMemorySnapshots(snapshots: ProcessMemorySnapshot[]) {
  const byIdentity = new Map<string, ProcessMemory>();
  for (const snapshot of snapshots)
    for (const entry of snapshot.processes)
      byIdentity.set(entry.identity, entry);
  const processes = [...byIdentity.values()];
  const identitiesByPid = new Map<number, string>();
  let identityConflict = false;
  for (const process of processes) {
    if (
      identitiesByPid.has(process.pid) &&
      identitiesByPid.get(process.pid) !== process.identity
    )
      identityConflict = true;
    identitiesByPid.set(process.pid, process.identity);
  }
  const totals = Object.fromEntries(
    (["rssBytes", "privateBytes", "pssBytes"] as const).map((metric) => {
      const complete =
        processes.length > 0 &&
        !identityConflict &&
        snapshots.every(
          (snapshot) =>
            snapshot.rootState === "available" &&
            snapshot.totals[metric]?.coverage === "complete",
        ) &&
        processes.every(
          (entry) => Number.isSafeInteger(entry[metric]) && entry[metric]! >= 0,
        );
      const value = processes.reduce(
        (sum, entry) => sum + (entry[metric] ?? 0),
        0,
      );
      const total: MemoryTotal =
        complete && Number.isSafeInteger(value)
          ? { coverage: "complete", value }
          : {
              coverage: processes.some((entry) => entry[metric] !== undefined)
                ? "partial"
                : "unavailable",
            };
      return [metric, total];
    }),
  ) as Record<"rssBytes" | "privateBytes" | "pssBytes", MemoryTotal>;
  return { processes, totals, identityConflict };
}
