import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { createNativeBenchmark } from "../../apps/desktop/src/nativeBenchmark";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function turn() {
  for (let index = 0; index < 15; index++) await Promise.resolve();
}
function harness(native = true, enabled = true, now?: () => number) {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const frames: Array<(timestamp: number) => void> = [];
  const handles = new Map<number, (timestamp: number) => void>();
  let nextHandle = 0;
  const visibilityListeners = new Set<() => void>();
  let visible = true;
  const invoke = vi.fn(
    async (
      command: string,
      args?: Record<string, unknown>,
    ): Promise<unknown> => {
      calls.push({ command, args });
      return command === "native_benchmark_enabled" ? enabled : undefined;
    },
  );
  const subscribe = vi.fn((callback: () => void) => {
    visibilityListeners.add(callback);
    return () => visibilityListeners.delete(callback);
  });
  const benchmark = createNativeBenchmark({
    isNative: () => native,
    invoke,
    requestFrame: (callback) => {
      const handle = ++nextHandle;
      handles.set(handle, callback);
      frames.push(callback);
      return handle;
    },
    cancelFrame: (handle) => {
      const callback = handles.get(handle);
      if (callback) {
        const index = frames.indexOf(callback);
        if (index >= 0) frames.splice(index, 1);
      }
      handles.delete(handle);
    },
    isVisible: () => visible,
    now,
    onVisibilityChange: subscribe,
  });
  return {
    benchmark,
    invoke,
    calls,
    frames,
    visibilityListeners,
    subscribe,
    hidden: () => {
      visible = false;
      for (const listener of [...visibilityListeners]) listener();
    },
    visible: () => {
      visible = true;
      for (const listener of [...visibilityListeners]) listener();
    },
    frame: () => {
      const callback = frames.shift();
      for (const [handle, pending] of handles) {
        if (pending === callback) handles.delete(handle);
      }
      callback?.(0);
    },
  };
}

describe("optional native readiness checkpoints", () => {
  it("performs no IPC or animation frame work in an ordinary browser", async () => {
    const h = harness(false);
    h.benchmark.record("edit-enter", { clipCount: 500 });
    h.benchmark.afterFrames("edit-ready", { clipCount: 500 }, () => true);
    await turn();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.frames).toHaveLength(0);
    expect(h.visibilityListeners.size).toBe(0);
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it("memoizes disabled configuration and performs no checkpoint or frame work", async () => {
    const h = harness(true, false);
    h.benchmark.record("edit-enter", { clipCount: 500 });
    h.benchmark.afterFrames("edit-ready", { clipCount: 500 }, () => true);
    h.benchmark.record("edit-leave");
    await turn();
    expect(h.calls).toEqual([
      { command: "native_benchmark_enabled", args: undefined },
    ]);
    expect(h.frames).toHaveLength(0);
    expect(h.visibilityListeners.size).toBe(0);
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it.each(["configuration", "first-frame", "second-frame"])(
    "resumes hidden %s readiness through two visible frames exactly once",
    async (phase) => {
      const h = harness();
      const configuration = deferred<unknown>();
      const recorded = vi.fn();
      h.invoke.mockImplementation(async (command, args) => {
        h.calls.push({ command, args });
        if (command === "native_benchmark_enabled")
          return configuration.promise;
        return undefined;
      });
      const guard = vi.fn(() => true);
      h.benchmark.afterFrames(
        "edit-ready",
        { clipCount: 500 },
        guard,
        recorded,
      );
      if (phase === "configuration") h.hidden();
      configuration.resolve(true);
      await turn();
      if (phase === "first-frame") {
        h.hidden();
        h.frame();
      } else if (phase === "second-frame") {
        h.frame();
        h.hidden();
        h.frame();
      }
      await turn();
      expect(
        h.calls.filter((call) => call.command === "native_checkpoint"),
      ).toHaveLength(0);
      expect(h.visibilityListeners.size).toBe(1);
      const checksWhileHidden = guard.mock.calls.length;
      h.visible();
      h.visible();
      expect(h.frames).toHaveLength(1);
      expect(guard.mock.calls.length).toBeGreaterThan(checksWhileHidden);
      h.frame();
      expect(h.frames).toHaveLength(1);
      h.frame();
      await turn();
      expect(
        h.calls.filter((call) => call.command === "native_checkpoint"),
      ).toHaveLength(1);
      expect(recorded).toHaveBeenCalledTimes(1);
      expect(h.visibilityListeners.size).toBe(0);
      h.visible();
      expect(h.frames).toHaveLength(0);
    },
  );

  it("restarts visibility frames when a ready write waits behind another receipt", async () => {
    let clock = 10;
    const h = harness(true, true, () => clock);
    const enter = deferred<unknown>();
    const recorded = vi.fn();
    h.invoke.mockImplementation(async (command, args) => {
      h.calls.push({ command, args });
      if (command === "native_benchmark_enabled") return true;
      if (args?.kind === "edit-enter") return enter.promise;
      return undefined;
    });
    h.benchmark.record("edit-enter", { clipCount: 500 });
    h.benchmark.afterFrames(
      "edit-ready",
      { clipCount: 500 },
      () => true,
      recorded,
    );
    await turn();
    h.frame();
    h.frame();
    await turn();
    h.hidden();
    enter.resolve(undefined);
    await turn();
    expect(
      h.calls.filter((call) => call.args?.kind === "edit-ready"),
    ).toHaveLength(0);
    expect(h.visibilityListeners.size).toBe(1);
    clock = 200;
    h.visible();
    h.frame();
    h.frame();
    await turn();
    expect(
      h.calls.filter((call) => call.args?.kind === "edit-ready"),
    ).toHaveLength(1);
    expect(
      h.calls.find((call) => call.args?.kind === "edit-ready")?.args,
    ).toMatchObject({ clientElapsedMs: 200 });
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(h.visibilityListeners.size).toBe(0);
  });

  it("restarts both visible frames when minimizing suspends an outstanding frame", async () => {
    const h = harness();
    h.benchmark.afterFrames("edit-ready", { clipCount: 500 }, () => true);
    await turn();
    h.frame();
    expect(h.frames).toHaveLength(1);
    // A real minimized WebView may never call this outstanding frame while
    // hidden. Visibility must invalidate it without relying on that callback.
    h.hidden();
    expect(h.frames).toHaveLength(0);
    h.visible();
    expect(h.frames).toHaveLength(1);
    h.frame();
    await turn();
    expect(
      h.calls.filter((call) => call.command === "native_checkpoint"),
    ).toHaveLength(0);
    h.frame();
    await turn();
    expect(
      h.calls.filter((call) => call.command === "native_checkpoint"),
    ).toHaveLength(1);
    expect(h.visibilityListeners.size).toBe(0);
  });

  it("keeps current frame ownership when an obsolete frame callback arrives", async () => {
    const h = harness();
    h.benchmark.afterFrames("edit-ready", {}, () => true);
    await turn();
    const obsolete = h.frames[0]!;
    h.hidden();
    h.visible();
    expect(h.frames).toHaveLength(1);
    obsolete(0);
    expect(h.frames).toHaveLength(1);
    h.hidden();
    expect(h.frames).toHaveLength(0);
    h.visible();
    h.frame();
    h.frame();
    await turn();
    expect(
      h.calls.filter((call) => call.command === "native_checkpoint"),
    ).toHaveLength(1);
  });

  it("discards an obsolete queued write when restored frames finish before the earlier receipt", async () => {
    const h = harness();
    const enter = deferred<unknown>();
    const recorded = vi.fn();
    h.invoke.mockImplementation(async (command, args) => {
      h.calls.push({ command, args });
      if (command === "native_benchmark_enabled") return true;
      if (args?.kind === "edit-enter") return enter.promise;
      return undefined;
    });
    h.benchmark.record("edit-enter");
    h.benchmark.afterFrames("edit-ready", {}, () => true, recorded);
    await turn();
    h.frame();
    h.frame();
    h.hidden();
    h.visible();
    h.frame();
    h.frame();
    await turn();
    expect(
      h.calls.filter((call) => call.args?.kind === "edit-ready"),
    ).toHaveLength(0);
    enter.resolve(undefined);
    await turn();
    expect(
      h.calls.filter((call) => call.args?.kind === "edit-ready"),
    ).toHaveLength(1);
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(h.visibilityListeners.size).toBe(0);
  });

  it("cancels hidden subscriptions before unmount or superseding the visit", async () => {
    const h = harness();
    h.hidden();
    const stop = h.benchmark.afterFrames(
      "edit-ready",
      { clipCount: 500 },
      () => true,
    );
    await turn();
    expect(h.visibilityListeners.size).toBe(1);
    expect(stop).toBeTypeOf("function");
    stop!();
    expect(h.visibilityListeners.size).toBe(0);
    h.visible();
    expect(h.frames).toHaveLength(0);
    expect(
      h.calls.filter((call) => call.command === "native_checkpoint"),
    ).toHaveLength(0);
  });

  it("removes a hidden retry when its editor snapshot is stale on restore", async () => {
    const h = harness();
    let current = true;
    h.hidden();
    h.benchmark.afterFrames("edit-ready", { clipCount: 500 }, () => current);
    await turn();
    expect(h.visibilityListeners.size).toBe(1);
    current = false;
    h.visible();
    expect(h.frames).toHaveLength(0);
    expect(h.visibilityListeners.size).toBe(0);
    expect(
      h.calls.filter((call) => call.command === "native_checkpoint"),
    ).toHaveLength(0);
  });

  it("cancels readiness before its configuration promise or either frame resumes", async () => {
    for (const phase of ["configuration", "first-frame", "second-frame"]) {
      const h = harness();
      const configuration = deferred<unknown>();
      h.invoke.mockImplementation(async (command, args) => {
        h.calls.push({ command, args });
        return command === "native_benchmark_enabled"
          ? configuration.promise
          : undefined;
      });
      const stop = h.benchmark.afterFrames("edit-ready", {}, () => true);
      if (phase !== "configuration") {
        configuration.resolve(true);
        await turn();
        if (phase === "second-frame") h.frame();
      }
      stop();
      configuration.resolve(true);
      h.frame();
      await turn();
      expect(h.frames).toHaveLength(0);
      expect(h.visibilityListeners.size).toBe(0);
      expect(
        h.calls.filter((call) => call.command === "native_checkpoint"),
      ).toHaveLength(0);
    }
  });

  it("does not retry a sent checkpoint when the window hides before its receipt", async () => {
    const h = harness();
    const receipt = deferred<unknown>();
    const recorded = vi.fn();
    h.invoke.mockImplementation(async (command, args) => {
      h.calls.push({ command, args });
      return command === "native_benchmark_enabled" ? true : receipt.promise;
    });
    h.benchmark.afterFrames(
      "edit-ready",
      { clipCount: 500 },
      () => true,
      recorded,
    );
    await turn();
    h.frame();
    h.frame();
    await turn();
    h.hidden();
    h.visible();
    receipt.resolve(undefined);
    await turn();
    expect(
      h.calls.filter((call) => call.command === "native_checkpoint"),
    ).toHaveLength(1);
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(h.frames).toHaveLength(0);
    expect(h.visibilityListeners.size).toBe(0);
  });

  it("serializes asynchronous enter, ready and leave receipts", async () => {
    const h = harness();
    const enter = deferred<unknown>();
    h.invoke.mockImplementation(async (command, args) => {
      h.calls.push({ command, args });
      if (command === "native_benchmark_enabled") return true;
      if (args?.kind === "edit-enter") return enter.promise;
      return undefined;
    });
    h.benchmark.record("edit-enter", { clipCount: 500 });
    h.benchmark.afterFrames("edit-ready", { clipCount: 500 }, () => true);
    await turn();
    expect(h.frames).toHaveLength(1);
    h.frame();
    expect(h.frames).toHaveLength(1);
    h.frame();
    await turn();
    h.benchmark.record("edit-leave");
    expect(
      h.calls.filter((call) => call.command === "native_checkpoint"),
    ).toHaveLength(1);
    enter.resolve(undefined);
    await turn();
    expect(
      h.calls
        .filter((call) => call.command === "native_checkpoint")
        .map((call) => call.args?.kind),
    ).toEqual(["edit-enter", "edit-ready", "edit-leave"]);
  });

  it("includes the initial Vue render in synchronous client-clock Edit timing", async () => {
    const h = harness();
    // Exercise a real Vue scheduled render after the enabled probe is cached.
    // The authored 80 ms work exposes a clock-boundary defect, not a speed goal.
    const vue = createRequire(resolve("apps/desktop/package.json"))("vue") as {
      ref: <T>(value: T) => { value: T };
      watch: (value: { value: string }, callback: () => void) => () => void;
      nextTick: () => Promise<void>;
    };
    h.benchmark.record("welcome-ready");
    await turn();
    h.calls.length = 0;
    const tab = vue.ref("library");
    const stop = vue.watch(tab, () => {
      const start = performance.now();
      while (performance.now() - start < 80) {
        // Deliberate bounded synchronous rendering work.
      }
    });
    try {
      h.benchmark.record("edit-enter", { clipCount: 500 });
      tab.value = "edit";
      await vue.nextTick();
      await turn();
      h.benchmark.afterFrames("edit-ready", { clipCount: 500 }, () => true);
      await turn();
      h.frame();
      h.frame();
      await turn();
      const events = h.calls.filter(
        (call) => call.command === "native_checkpoint",
      );
      expect(events).toHaveLength(2);
      const enter = events[0]!.args!;
      const ready = events[1]!.args!;
      expect(enter.clientElapsedMs).toBeTypeOf("number");
      expect(
        Number(ready.clientElapsedMs) - Number(enter.clientElapsedMs),
      ).toBeGreaterThanOrEqual(75);
      expect(ready.clientTimeOriginMs).toBe(enter.clientTimeOriginMs);
      expect(Number(enter.clientTimeOriginMs)).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });

  it.each(["hidden", "stale"])(
    "does not publish %s readiness after frame scheduling",
    async (reason) => {
      const h = harness();
      let current = true;
      h.benchmark.afterFrames("edit-ready", { clipCount: 500 }, () => current);
      await turn();
      h.frame();
      if (reason === "hidden") h.hidden();
      else current = false;
      h.frame();
      await turn();
      expect(
        h.calls.filter((call) => call.command === "native_checkpoint"),
      ).toHaveLength(0);
    },
  );

  it("keeps normal UX independent of unavailable or failed diagnostic IPC", async () => {
    const h = harness();
    h.invoke.mockRejectedValue(new Error("Native diagnostics unavailable"));
    h.benchmark.record("welcome-ready");
    h.benchmark.afterFrames("edit-ready", { clipCount: 500 }, () => true);
    await turn();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.frames).toHaveLength(0);
  });

  it("does not claim a queued ready checkpoint before its native receipt succeeds", async () => {
    const h = harness();
    const receipt = deferred<unknown>();
    const recorded = vi.fn();
    h.invoke.mockImplementation(async (command, args) => {
      h.calls.push({ command, args });
      return command === "native_benchmark_enabled" ? true : receipt.promise;
    });
    h.benchmark.afterFrames(
      "edit-ready",
      { clipCount: 500 },
      () => true,
      recorded,
    );
    await turn();
    h.frame();
    h.frame();
    await turn();
    expect(recorded).not.toHaveBeenCalled();
    receipt.reject(new Error("Event file is unavailable"));
    await turn();
    expect(recorded).not.toHaveBeenCalled();
    h.invoke.mockImplementation(async () => undefined);
    h.benchmark.record("edit-leave");
    await turn();
    expect(h.invoke).toHaveBeenLastCalledWith("native_checkpoint", {
      kind: "edit-leave",
      clientElapsedMs: expect.any(Number),
      clientTimeOriginMs: expect.any(Number),
    });
  });
});

const { ref } = createRequire(resolve("apps/desktop/package.json"))("vue") as {
  ref: <T>(value: T) => { value: T };
};
function actualFunction(
  file: string,
  name: string,
  dependencies: Record<string, unknown>,
) {
  const source = readFileSync(resolve(file), "utf8");
  if (name === "onBeforeUnmount" || name === "onUnmounted") {
    const start = source.indexOf(`${name}(() => {`);
    const end = source.indexOf("\n});", start) + 4;
    if (start < 0 || end < 4) throw new Error(`Missing actual ${name} hook`);
    const code = transformSync(source.slice(start, end), {
      loader: "ts",
      format: "esm",
    }).code;
    return new Function(
      "dependencies",
      `let {${Object.keys(dependencies).join(",")}} = dependencies;\nlet cleanup; const ${name} = (callback) => cleanup = callback;\n${code}\nreturn cleanup;`,
    )(dependencies) as () => void;
  }
  let start = source.indexOf(`function ${name}(`);
  if (source.slice(start - 6, start) === "async ") start -= 6;
  const end = source.indexOf("\n}", start) + 2;
  if (start < 0 || end < 2)
    throw new Error(`Missing actual ${name} implementation`);
  const code = transformSync(source.slice(start, end), {
    loader: "ts",
    format: "esm",
  }).code;
  return new Function(
    "dependencies",
    `let {${Object.keys(dependencies).join(",")}} = dependencies;\n${code}\nreturn ${name};`,
  )(dependencies) as (...args: unknown[]) => unknown;
}

describe("actual workspace readiness guards", () => {
  it.each(["boot", "editor"])(
    "releases a hidden pending %s checkpoint in its actual unmount hook",
    async (workspace) => {
      const h = harness();
      h.hidden();
      const cancel = h.benchmark.afterFrames(
        workspace === "boot" ? "welcome-ready" : "edit-ready",
        {},
        () => true,
      );
      await turn();
      expect(h.visibilityListeners.size).toBe(1);
      const cleanup = actualFunction(
        workspace === "boot"
          ? "apps/desktop/src/App.vue"
          : "apps/desktop/src/components/TimelineEditor.vue",
        workspace === "boot" ? "onUnmounted" : "onBeforeUnmount",
        {
          cancelNativeBootReady: cancel,
          cancelNativeEditReady: cancel,
          nativeDisposed: false,
          nativeEditDisposed: false,
          nativeBootGeneration: 1,
          nativeEditGeneration: 1,
          poll: undefined,
          window: { removeEventListener: vi.fn() },
          handleKeyboard: () => {},
          keyboard: () => {},
          measureWorkspace: () => {},
          layoutObserver: undefined,
          layoutFrame: 0,
          cancelAnimationFrame: vi.fn(),
        },
      );
      cleanup();
      expect(h.visibilityListeners.size).toBe(0);
      h.visible();
      expect(h.frames).toHaveLength(0);
      expect(
        h.calls.filter((call) => call.command === "native_checkpoint"),
      ).toHaveLength(0);
    },
  );
  it("performs no readiness DOM queries when native diagnostics are disabled", async () => {
    const h = harness(true, false);
    const getClientRects = vi.fn(() => [1]);
    const querySelectorAll = vi.fn(() => [1]);
    const check = actualFunction(
      "apps/desktop/src/components/TimelineEditor.vue",
      "checkpointNativeEditReady",
      {
        nativeBenchmark: h.benchmark,
        props: { active: true },
        state: ref({ revision: "saved" }),
        status: ref("saved"),
        hasPending: ref(false),
        editMode: ref("story"),
        editorElement: ref({ getClientRects, querySelectorAll }),
        allClips: ref([{ id: "clip" }]),
        cancelNativeEditReady: undefined,
        nativeEditGeneration: 1,
        nativeEditReadyForVisit: false,
        nativeEditDisposed: false,
        window: { __TAURI_INTERNALS__: {} },
      },
    );
    check(1);
    await turn();
    expect(getClientRects).not.toHaveBeenCalled();
    expect(querySelectorAll).not.toHaveBeenCalled();
    expect(h.frames).toHaveLength(0);
  });
  it.each([
    "success",
    "failed",
    "disconnected",
    "error",
    "unmounted",
    "unmounted-next-tick",
    "superseded-next-tick",
  ])("only reports a usable %s boot", async (condition) => {
    const queued: Array<{ kind: string; guard: () => boolean }> = [];
    const disposed = condition === "unmounted";
    const dependencies = {
      native: true,
      nativeBenchmark: {
        afterFrames: (kind: string, _data: unknown, guard: () => boolean) => {
          queued.push({ kind, guard });
          return stopReady;
        },
      },
      cancelNativeBootReady: undefined,
      nativeBootGeneration: 0,
      nativeDisposed: disposed,
      connected: ref(condition !== "disconnected"),
      error: ref(condition === "error" ? "Connection failed" : ""),
      mediaStatusError: ref(""),
      project: ref(null),
      tab: ref("library"),
      loading: ref(true),
      busy: ref(""),
      workspaceInfo: ref(null),
      api: { workspace: async () => ({ systemLocale: "en-US" }) },
      initializeLocale: async () => {},
      nextTick: async () => {},
      run: async (_label: string, action: () => Promise<void>) => {
        if (condition === "failed") return false;
        await action();
        return true;
      },
      refreshProject: async () => {},
      refreshRecents: async () => {},
      document: { querySelector: () => ({ getClientRects: () => [1] }) },
    };
    const stopReady = vi.fn();
    const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
    const start = source.indexOf("async function boot(");
    const end = source.indexOf("\n}", start) + 2;
    const code = transformSync(source.slice(start, end), {
      loader: "ts",
      format: "esm",
    }).code;
    const boot = new Function(
      "dependencies",
      `let {${Object.keys(dependencies).join(",")}} = dependencies;\n${code}\n${
        condition === "unmounted-next-tick"
          ? "nextTick = async () => { nativeDisposed = true; };"
          : condition === "superseded-next-tick"
            ? "nextTick = async () => { nativeBootGeneration++; };"
            : ""
      }\nreturn boot;`,
    )(dependencies) as () => Promise<void>;
    await boot();
    if (condition.endsWith("next-tick")) expect(queued).toHaveLength(0);
    const accepted = queued.filter((entry) => entry.guard());
    expect(accepted.map((entry) => entry.kind)).toEqual(
      condition === "success" ? ["welcome-ready"] : [],
    );
    if (condition === "success") {
      await boot();
      expect(stopReady).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    "ready",
    "loading",
    "failed",
    "inactive",
    "missing-dom",
    "wrong-count",
    "unmounted",
  ])("requires current visible loaded Edit state: %s", (condition) => {
    const queued: Array<{ kind: string; guard: () => boolean }> = [];
    const state = ref({
      revision: "revision",
      composition: {
        tracks: [
          {
            clips: Array.from({ length: 500 }, (_, index) => ({
              id: `clip-${index}`,
            })),
          },
        ],
      },
    });
    const root = {
      getClientRects: () => (condition === "missing-dom" ? [] : [1]),
      querySelectorAll: (selector: string) =>
        selector.includes("aria-pressed")
          ? [1]
          : Array.from({ length: condition === "wrong-count" ? 499 : 500 }),
    };
    const check = actualFunction(
      "apps/desktop/src/components/TimelineEditor.vue",
      "checkpointNativeEditReady",
      {
        nativeBenchmark: {
          afterFrames: (kind: string, _data: unknown, guard: () => boolean) => {
            queued.push({ kind, guard });
            return stopReady;
          },
        },
        cancelNativeEditReady: undefined,
        props: { active: condition !== "inactive" },
        state,
        status: ref(
          condition === "loading"
            ? "loading"
            : condition === "failed"
              ? "failed"
              : "saved",
        ),
        hasPending: ref(false),
        editMode: ref("story"),
        editorElement: ref(root),
        allClips: ref(state.value.composition.tracks[0]!.clips),
        nativeEditGeneration: 1,
        nativeEditReadyForVisit: false,
        nativeEditDisposed: condition === "unmounted",
        window: { __TAURI_INTERNALS__: {} },
      },
    );
    const stopReady = vi.fn();
    check(1);
    expect(
      queued.filter((entry) => entry.guard()).map((entry) => entry.kind),
    ).toEqual(condition === "ready" ? ["edit-ready"] : []);
    if (condition === "ready") {
      check(1);
      expect(stopReady).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["new-snapshot", "reload", "left-edit", "hidden-dom"])(
    "rejects %s after the actual editor schedules readiness",
    (condition) => {
      const queued: Array<() => boolean> = [];
      const snapshot = { revision: "old" };
      const state = ref(snapshot);
      const status = ref("saved");
      const props = { active: true };
      let shown = true;
      const root = {
        getClientRects: () => (shown ? [1] : []),
        querySelectorAll: () => [1],
      };
      const check = actualFunction(
        "apps/desktop/src/components/TimelineEditor.vue",
        "checkpointNativeEditReady",
        {
          nativeBenchmark: {
            afterFrames: (
              _kind: string,
              _data: unknown,
              guard: () => boolean,
            ) => queued.push(guard),
          },
          props,
          state,
          status,
          hasPending: ref(false),
          editMode: ref("story"),
          editorElement: ref(root),
          allClips: ref([{ id: "clip" }]),
          cancelNativeEditReady: undefined,
          nativeEditGeneration: 1,
          nativeEditReadyForVisit: false,
          nativeEditDisposed: false,
          window: { __TAURI_INTERNALS__: {} },
        },
      );
      check(1);
      expect(queued).toHaveLength(1);
      expect(queued[0]!()).toBe(true);
      if (condition === "new-snapshot") state.value = { revision: "new" };
      else if (condition === "reload") status.value = "loading";
      else if (condition === "left-edit") props.active = false;
      else shown = false;
      expect(queued[0]!()).toBe(false);
    },
  );

  it("records Edit enter before activation and omits checkpoints for rejected navigation", async () => {
    const calls: Array<{ kind: string; tab: string }> = [];
    const tab = ref("library");
    const busy = ref("");
    const beatDirty = ref(false);
    let beatSaved = true;
    let editorSaved = true;
    const changeTab = actualFunction("apps/desktop/src/App.vue", "changeTab", {
      tab,
      relinkBusy: ref(false),
      busy,
      beatDirty,
      saveBeat: async () => beatSaved,
      flushEditor: async () => editorSaved,
      activeComposition: ref({ id: "film" }),
      clipCount: ref(500),
      editorMountRequested: ref(false),
      timelineEditor: ref(null),
      nativeBenchmark: {
        record: (kind: string) => calls.push({ kind, tab: tab.value }),
      },
      window: { __TAURI_INTERNALS__: {} },
      checkMediaStatus: async () => {},
      hydrateBeat: () => {},
    });
    busy.value = "saving";
    await changeTab("edit");
    expect(calls).toEqual([]);
    busy.value = "";
    beatDirty.value = true;
    beatSaved = false;
    await changeTab("edit");
    expect(calls).toEqual([]);
    beatSaved = true;
    await changeTab("edit");
    expect(calls).toEqual([{ kind: "edit-enter", tab: "library" }]);
    expect(tab.value).toBe("edit");
    editorSaved = false;
    await changeTab("library");
    expect(calls).toHaveLength(1);
    editorSaved = true;
    await changeTab("library");
    expect(calls[1]).toEqual({ kind: "edit-leave", tab: "edit" });
  });
});
