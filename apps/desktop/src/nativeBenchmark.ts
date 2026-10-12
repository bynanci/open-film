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
  requestFrame: (callback: FrameRequestCallback) => void;
  isVisible: () => boolean;
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
  }
  function afterFrames(
    kind: NativeCheckpointKind,
    data: CheckpointData = {},
    current: () => boolean,
    recorded?: () => void,
  ) {
    if (!dependencies.isNative()) return;
    void enabled()
      .then((active) => {
        if (!active || !dependencies.isVisible() || !current()) return;
        dependencies.requestFrame(() => {
          if (!dependencies.isVisible() || !current()) return;
          dependencies.requestFrame(() => {
            if (!dependencies.isVisible() || !current()) return;
            record(
              kind,
              data,
              () => dependencies.isVisible() && current(),
              recorded,
            );
          });
        });
      })
      .catch(() => {});
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
    requestAnimationFrame(callback);
  },
  isVisible: () => document.visibilityState === "visible",
});
