/** Optional local diagnostics. No browser work or media/text leaves the app. */
export type NativeCheckpointKind =
  | "welcome-ready"
  | "library-ready"
  | "edit-enter"
  | "edit-ready"
  | "edit-leave";
type CheckpointData = { clipCount?: number };
type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export function createNativeBenchmark(dependencies: {
  isNative: () => boolean;
  invoke: Invoke;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  isVisible: () => boolean;
  onVisibilityChange: (callback: () => void) => () => void;
  now?: () => number;
  timeOrigin?: () => number;
}) {
  let configuration: Promise<boolean> | undefined;
  let writes = Promise.resolve();
  function enabled() {
    if (!dependencies.isNative()) return Promise.resolve(false);
    configuration ??= dependencies
      .invoke("native_benchmark_enabled")
      .then((value) => value === true)
      .catch(() => false);
    return configuration;
  }
  function record(
    kind: NativeCheckpointKind,
    data: CheckpointData = {},
    current: () => boolean = () => true,
    recorded?: () => void,
  ) {
    if (!dependencies.isNative()) return;
    // Capture before any Promise yields to Vue's scheduled initial render.
    // Native receipt timestamps are a separate IPC/scheduling observation.
    const clientElapsedMs = dependencies.now?.() ?? performance.now();
    const clientTimeOriginMs =
      dependencies.timeOrigin?.() ?? performance.timeOrigin;
    writes = writes
      .then(async () => {
        if (!(await enabled()) || !current()) return;
        await dependencies.invoke("native_checkpoint", {
          kind,
          ...data,
          clientElapsedMs,
          clientTimeOriginMs,
        });
        recorded?.();
      })
      .catch(() => {});
    return writes;
  }
  function afterFrames(
    kind: NativeCheckpointKind,
    data: CheckpointData = {},
    current: () => boolean,
    recorded?: () => void,
  ) {
    if (!dependencies.isNative()) return () => {};
    let cancelled = false;
    let sent = false;
    let waitingForVisibility = false;
    let attempt = 0;
    let frame: number | undefined;
    let unsubscribe: (() => void) | undefined;
    function cancelFrame() {
      if (frame !== undefined) dependencies.cancelFrame(frame);
      frame = undefined;
    }
    function cancel() {
      cancelled = true;
      attempt++;
      cancelFrame();
      unsubscribe?.();
      unsubscribe = undefined;
    }
    function waitForVisibility() {
      waitingForVisibility = true;
      attempt++;
      cancelFrame();
    }
    function visibleAndCurrent(version: number) {
      if (cancelled || sent || version !== attempt) return false;
      if (!dependencies.isVisible()) {
        // A minimized native window can suspend either frame and queued IPC.
        // Wait without querying visibility-dependent DOM until it is restored.
        waitForVisibility();
        return false;
      }
      if (!current()) {
        cancel();
        return false;
      }
      return true;
    }
    function startFrames() {
      if (cancelled || sent) return;
      if (!dependencies.isVisible()) {
        waitForVisibility();
        return;
      }
      if (!current()) {
        cancel();
        return;
      }
      waitingForVisibility = false;
      const version = ++attempt;
      frame = dependencies.requestFrame(() => {
        if (!visibleAndCurrent(version)) return;
        frame = undefined;
        frame = dependencies.requestFrame(() => {
          if (!visibleAndCurrent(version)) return;
          frame = undefined;
          const write = record(
            kind,
            data,
            () => {
              if (!visibleAndCurrent(version)) return false;
              // Once dispatched, this evidence cannot be unsent or replayed.
              sent = true;
              unsubscribe?.();
              unsubscribe = undefined;
              return true;
            },
            () => {
              cancel();
              recorded?.();
            },
          );
          void write?.then(() => {
            // Failed diagnostic IPC ends this attempt too; no automatic loop.
            if (sent && version === attempt) cancel();
          });
        });
      });
    }
    void enabled()
      .then((active) => {
        if (!active || cancelled) return;
        unsubscribe = dependencies.onVisibilityChange(() => {
          if (cancelled || sent) return;
          if (!dependencies.isVisible()) waitForVisibility();
          else if (waitingForVisibility) startFrames();
        });
        startFrames();
      })
      .catch(() => {});
    return cancel;
  }
  return { record, afterFrames };
}

export const nativeBenchmark = createNativeBenchmark({
  isNative: () =>
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
  invoke: async (command, args) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args);
  },
  requestFrame: (callback) => {
    return requestAnimationFrame(callback);
  },
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  isVisible: () => document.visibilityState === "visible",
  onVisibilityChange: (callback) => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
});
