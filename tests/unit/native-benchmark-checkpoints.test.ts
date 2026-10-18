// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; this derivative as a whole is GPL-3.0-only. See LICENSE/NOTICE.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { createNativeBenchmark } from "../../apps/desktop/src/nativeBenchmark";
import { ApiError } from "../../apps/desktop/src/api";
import {
  summarizeNativeEvents,
  type NativeEvent,
} from "../../scripts/native-benchmark/record";

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

const { ref, watch, nextTick, computed } = createRequire(
  resolve("apps/desktop/package.json"),
)("vue") as {
  ref: <T>(value: T) => { value: T };
  watch: (value: { value: string }, callback: () => void) => () => void;
  nextTick: () => Promise<void>;
  computed: <T>(get: () => T) => { readonly value: T };
};
const watchSources = createRequire(resolve("apps/desktop/package.json"))("vue")
  .watch as (
  source: unknown,
  callback: () => void,
  options?: { flush: "sync" },
) => () => void;
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

function categoryNavigationFixture(busy = ref(""), error = ref<unknown>("")) {
  const categoryDirty = ref(false);
  const notice = ref<unknown>(null);
  const asset = { id: "memory", tags: ["Original"] };
  const assetCache = ref<Record<string, typeof asset>>({ memory: asset });
  const assetMutations = new Map<string, number>();
  const patch = vi.fn(async (_path: string, body: { tags: string[] }) => ({
    asset: { ...asset, tags: body.tags },
  }));
  const saveCategories = actualFunction(
    "apps/desktop/src/App.vue",
    "saveCategories",
    {
      categoryDirty,
      busy,
      error,
      notice,
      selectedAsset: ref(asset),
      selectedAssetId: ref(asset.id),
      categoryDraft: ref(["New category"]),
      relinkBusy: ref(false),
      project: ref({ id: "project" }),
      assets: ref([asset]),
      patch,
      cacheAssets: actualFunction("apps/desktop/src/App.vue", "cacheAssets", {
        assetCache,
        assetMutations,
      }),
      run: actualFunction("apps/desktop/src/App.vue", "run", {
        busy,
        error,
        notice,
      }),
    },
  );
  return { categoryDirty, saveCategories, patch };
}

describe("actual workspace readiness guards", () => {
  function bootFixture(
    options: { hidden?: boolean; native?: boolean; enabled?: boolean } = {},
  ) {
    const h = harness(options.native ?? true, options.enabled ?? true);
    if (options.hidden) h.hidden();
    const probe = deferred<unknown>();
    const receipt = deferred<unknown>();
    let holdReceipt = false;
    h.invoke.mockImplementation(async (command, args) => {
      h.calls.push({ command, args });
      if (command === "native_benchmark_enabled") return probe.promise;
      return holdReceipt ? receipt.promise : undefined;
    });
    const tab = ref("library");
    const project = ref<{ id: string; title: string } | null>({
      id: "original",
      title: "Memories",
    });
    const loading = ref(true);
    const busy = ref("");
    const error = ref<unknown>("");
    const mediaStatusError = ref<unknown>("");
    const connected = ref(true);
    const stops: (() => void)[] = [];
    let unmount = () => {};
    const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
    const head = source.slice(
      source.indexOf("const native = !!window.__TAURI_INTERNALS__;"),
      source.indexOf("let poll:"),
    );
    const bootStart = source.indexOf("async function boot(");
    const boot = source.slice(bootStart, source.indexOf("\n}", bootStart) + 2);
    const unmountStart = source.indexOf("onUnmounted(() => {");
    const cleanup = source.slice(
      unmountStart,
      source.indexOf("\n});", unmountStart) + 4,
    );
    const deps = {
      nativeBenchmark: h.benchmark,
      window:
        options.native === false
          ? { removeEventListener: vi.fn() }
          : { __TAURI_INTERNALS__: {}, removeEventListener: vi.fn() },
      watch: (
        sources: unknown,
        callback: () => void,
        opts: { flush: "sync" },
      ) => {
        const stop = watchSources(sources, callback, opts);
        stops.push(stop);
        return stop;
      },
      tab,
      project,
      loading,
      busy,
      error,
      mediaStatusError,
      connected,
      run: actualFunction("apps/desktop/src/App.vue", "run", {
        busy,
        error,
        notice: ref(null),
      }),
      workspaceInfo: ref(null),
      api: { workspace: async () => ({ systemLocale: "en-US" }) },
      initializeLocale: async () => {},
      refreshProject: async () => {},
      refreshRecents: async () => {},
      restoreScriptReviewTarget: () => {},
      storyTitle: ref(""),
      storyTemplate: ref(""),
      targetDuration: ref(0),
      maxDuration: ref(0),
      rememberProject: () => {},
      reloadAssets: async () => {},
      refreshJobs: async () => {},
      checkMediaStatus: async () => {},
      nextTick,
      document: { querySelector: vi.fn(() => ({ getClientRects: () => [1] })) },
      handleKeyboard: () => {},
      protectDrafts: actualFunction(
        "apps/desktop/src/App.vue",
        "protectDrafts",
        {
          categoryDirty: ref(false),
          scenePlanDraftPresent: ref(false),
          beatDirty: ref(false),
          storyReviewBusy: ref(false),
          storyReviewPending: ref(false),
        },
      ),
      poll: undefined,
      onUnmounted: (callback: () => void) => {
        unmount = callback;
      },
    };
    const code = transformSync(`${head}\n${boot}\n${cleanup}`, {
      loader: "ts",
      format: "esm",
    }).code;
    const actual = new Function(
      "dependencies",
      `let {${Object.keys(deps).join(",")}} = dependencies;\n${code}\nreturn {boot};`,
    )(deps) as { boot: () => Promise<void> };
    return {
      h,
      probe,
      receipt,
      actual,
      tab,
      project,
      loading,
      busy,
      error,
      mediaStatusError,
      connected,
      document: deps.document,
      holdReceipt: () => {
        holdReceipt = true;
      },
      dispose: () => {
        unmount();
        for (const stop of stops.splice(0)) stop();
      },
    };
  }

  it.each(
    ["busy", "error", "loading", "media-status", "connection"].flatMap(
      (flag) => [
        [flag, "configuration"],
        [flag, "hidden"],
      ],
    ),
  )(
    "rearms original Library boot after transient %s during %s",
    async (flag, phase) => {
      const view = bootFixture({ hidden: phase === "hidden" });
      try {
        await view.actual.boot();
        await turn();
        if (phase === "hidden") {
          view.probe.resolve(true);
          await turn();
        }
        const state =
          flag === "busy"
            ? view.busy
            : flag === "error"
              ? view.error
              : flag === "loading"
                ? view.loading
                : flag === "media-status"
                  ? view.mediaStatusError
                  : view.connected;
        state.value =
          flag === "connection"
            ? false
            : flag === "loading"
              ? true
              : "Temporary work";
        await turn();
        expect(view.h.frames).toHaveLength(0);
        state.value =
          flag === "connection" ? true : flag === "loading" ? false : "";
        if (phase === "configuration") view.probe.resolve(true);
        await turn();
        view.h.visible();
        expect(view.h.frames).toHaveLength(1);
        view.h.frame();
        view.h.frame();
        await turn();
        expect(
          view.h.calls.filter((call) => call.command === "native_checkpoint"),
        ).toMatchObject([
          {
            args: {
              kind: "library-ready",
              clientTimeOriginMs: performance.timeOrigin,
            },
          },
        ]);
        expect(
          view.h.calls.filter(
            (call) => call.command === "native_benchmark_enabled",
          ),
        ).toHaveLength(1);
        expect(view.h.visibilityListeners.size).toBe(0);
        view.busy.value = "Another action";
        view.busy.value = "";
        await turn();
        expect(view.h.frames).toHaveLength(0);
        expect(
          view.h.calls.filter((call) => call.command === "native_checkpoint"),
        ).toHaveLength(1);
      } finally {
        view.dispose();
      }
    },
  );

  it.each(["project", "view", "unmount"])(
    "does not rearm an expired original %s boot",
    async (expiry) => {
      const view = bootFixture({ hidden: true });
      try {
        await view.actual.boot();
        await turn();
        if (expiry === "project") {
          view.project.value = { id: "different", title: "Other" };
          view.project.value = { id: "original", title: "Memories" };
        } else if (expiry === "view") {
          view.tab.value = "story";
          view.tab.value = "library";
        } else view.dispose();
        view.busy.value = "Transient";
        view.busy.value = "";
        view.probe.resolve(true);
        await turn();
        view.h.visible();
        expect(view.h.frames).toHaveLength(0);
        expect(view.h.visibilityListeners.size).toBe(0);
        expect(
          view.h.calls.filter((call) => call.command === "native_checkpoint"),
        ).toHaveLength(0);
      } finally {
        view.dispose();
      }
    },
  );

  it("acknowledges one boot receipt and cancels its rearmed queued attempt", async () => {
    const view = bootFixture();
    try {
      view.holdReceipt();
      await view.actual.boot();
      view.probe.resolve(true);
      await turn();
      view.h.frame();
      view.h.frame();
      await turn();
      view.busy.value = "Transient";
      view.busy.value = "";
      await turn();
      view.h.frame();
      view.h.frame();
      await turn();
      view.receipt.resolve(undefined);
      await turn();
      expect(
        view.h.calls.filter((call) => call.command === "native_checkpoint"),
      ).toHaveLength(1);
      expect(view.h.frames).toHaveLength(0);
      expect(view.h.visibilityListeners.size).toBe(0);
    } finally {
      view.dispose();
    }
  });

  it("lets only the latest boot generation finish a delayed enabled probe", async () => {
    const view = bootFixture({ hidden: true });
    try {
      await view.actual.boot();
      await view.actual.boot();
      view.probe.resolve(true);
      await turn();
      view.h.visible();
      view.h.frame();
      view.h.frame();
      await turn();
      expect(
        view.h.calls.filter((call) => call.command === "native_checkpoint"),
      ).toHaveLength(1);
      expect(view.h.visibilityListeners.size).toBe(0);
    } finally {
      view.dispose();
    }
  });

  it("does not let an earlier dispatched receipt cancel a new boot's attempt", async () => {
    const view = bootFixture();
    try {
      view.holdReceipt();
      await view.actual.boot();
      view.probe.resolve(true);
      await turn();
      view.h.frame();
      view.h.frame();
      await turn();
      await view.actual.boot();
      await turn();
      view.h.frame();
      view.h.frame();
      await turn();
      view.receipt.resolve(undefined);
      await turn();
      expect(
        view.h.calls.filter((call) => call.command === "native_checkpoint"),
      ).toHaveLength(2);
      expect(view.h.frames).toHaveLength(0);
      expect(view.h.visibilityListeners.size).toBe(0);
    } finally {
      view.dispose();
    }
  });

  it.each(["browser", "disabled"])(
    "keeps boot rearming inactive for %s diagnostics",
    async (mode) => {
      const view = bootFixture({ native: mode !== "browser" });
      try {
        await view.actual.boot();
        view.busy.value = "Transient";
        view.busy.value = "";
        view.probe.resolve(false);
        await turn();
        expect(view.h.frames).toHaveLength(0);
        expect(view.h.subscribe).not.toHaveBeenCalled();
        expect(view.document.querySelector).not.toHaveBeenCalled();
        expect(
          view.h.calls.filter((call) => call.command === "native_checkpoint"),
        ).toHaveLength(0);
        if (mode === "browser") expect(view.h.invoke).not.toHaveBeenCalled();
      } finally {
        view.dispose();
      }
    },
  );

  function composeFixture(
    options: {
      now?: () => number;
      initialTab?: string;
      flushFails?: boolean;
      dirty?: boolean;
      lateDirty?: boolean;
      relinking?: boolean;
      failed?: boolean;
      preloadFails?: boolean;
      refreshFails?: boolean;
    } = {},
  ) {
    const h = harness(true, true, options.now);
    const tab = ref(options.initialTab ?? "story");
    const busy = ref("");
    const error = ref<unknown>("");
    const beatDirty = ref(!!options.dirty);
    const activeCompositionId = ref("old-film");
    const project = ref({
      id: "project",
      title: "User film",
      projectContentLocale: "zh-TW",
      timelines: [
        {
          id: "unrelated-film",
          tracks: [{ clips: [{ assetId: "locked-memory" }] }],
        },
        {
          id: "old-film",
          tracks: [
            {
              clips: Array.from({ length: 42 }, () => ({
                assetId: "old-memory",
              })),
            },
          ],
        },
      ],
    });
    const unrelated = JSON.stringify(project.value.timelines[0]);
    const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
    const selection = source.slice(
      source.indexOf("const activeComposition = computed("),
      source.indexOf("\nconst compositionTitle ="),
    );
    const count = source.slice(
      source.indexOf("const clipCount = computed("),
      source.indexOf("\nconst previewVersion ="),
    );
    const code = transformSync(`${selection}\n${count}`, {
      loader: "ts",
      format: "esm",
    }).code;
    const { activeComposition, clipCount } = new Function(
      "dependencies",
      `const {project,activeCompositionId,computed,ref} = dependencies;\n${code}\nreturn {activeComposition,clipCount};`,
    )({ project, activeCompositionId, computed, ref }) as {
      activeComposition: { readonly value: { id: string } };
      clipCount: { readonly value: number };
    };
    const editorMountRequested = ref(false);
    const composition = {
      id: "new-film",
      tracks: [
        {
          clips: Array.from({ length: 500 }, (_, index) => ({
            assetId: `asset-${index % 5}`,
          })),
        },
      ],
    };
    const flushEditor = vi.fn(async () => !options.flushFails);
    const timelineEditor = ref(null);
    const run = actualFunction("apps/desktop/src/App.vue", "run", {
      busy,
      error,
      notice: ref(null),
    });
    const categories = categoryNavigationFixture(busy, error);
    const changeTab = actualFunction("apps/desktop/src/App.vue", "changeTab", {
      ...categories,
      storyScriptReview: ref(null),
      tab,
      relinkBusy: ref(!!options.relinking),
      busy,
      beatDirty,
      saveBeat: async () => false,
      flushEditor,
      activeComposition,
      clipCount,
      editorMountRequested,
      timelineEditor,
      nativeBenchmark: h.benchmark,
      window: { __TAURI_INTERNALS__: {} },
      checkMediaStatus: async () => {},
      hydrateBeat: () => {},
    });
    const apiCompose = vi.fn(async () => {
      if (options.failed) throw new Error("Composition generation failed");
      return { composition };
    });
    const preloadError = new ApiError("Cache hydration failed", 0, {
      code: "workspace.unavailable",
    });
    const refreshError = new ApiError("Project refresh failed", 0, {
      code: "workspace.unavailable",
    });
    const loadAssetIds = vi.fn(async () => {
      if (options.lateDirty) beatDirty.value = true;
      if (options.preloadFails) throw preloadError;
    });
    const refreshProject = actualFunction(
      "apps/desktop/src/App.vue",
      "refreshProject",
      {
        api: {
          project: async () => {
            if (options.refreshFails) throw refreshError;
            return {
              project: {
                ...project.value,
                timelines: [
                  ...project.value.timelines.filter(
                    (film) => film.id !== composition.id,
                  ),
                  composition,
                ],
              },
              path: "/qa/project.openfilm",
            };
          },
        },
        project,
        projectPath: ref(null),
        connected: ref(true),
        projectMutationVersion: 0,
      },
    );
    const compose = actualFunction("apps/desktop/src/App.vue", "compose", {
      storyScriptReview: ref(null),
      flushEditor,
      activeStory: ref({ id: "story" }),
      beatDirty,
      error,
      message: (key: string) => key,
      run,
      api: { compose: apiCompose },
      activeCompositionId,
      project,
      clearExport: () => {},
      refreshProject,
      previewVersion: ref(1),
      editorMountRequested,
      tab,
      loadAssetIds,
      changeTab,
    });
    return {
      h,
      tab,
      busy,
      compose,
      apiCompose,
      loadAssetIds,
      editorMountRequested,
      project,
      activeComposition,
      activeCompositionId,
      clipCount,
      error,
      preloadError,
      refreshError,
      unrelated,
    };
  }

  it.each([
    ["story", "preload"],
    ["story", "refresh"],
    ["story", "both"],
    ["edit", "preload"],
    ["edit", "refresh"],
    ["edit", "both"],
  ])(
    "keeps the committed composition usable from %s after %s reads fail",
    async (initialTab, failure) => {
      const view = composeFixture({
        initialTab,
        preloadFails: failure !== "refresh",
        refreshFails: failure !== "preload",
      });
      await view.compose();
      await turn();
      expect(view.apiCompose).toHaveBeenCalledTimes(1);
      expect(view.loadAssetIds).toHaveBeenCalledTimes(1);
      expect(view.tab.value).toBe("edit");
      expect(view.busy.value).toBe("");
      expect(view.editorMountRequested.value).toBe(true);
      expect(view.activeCompositionId.value).toBe("new-film");
      expect(view.activeComposition.value.id).toBe("new-film");
      expect(view.clipCount.value).toBe(500);
      expect(
        view.project.value.timelines.filter((film) => film.id === "new-film"),
      ).toHaveLength(1);
      expect(JSON.stringify(view.project.value.timelines[0])).toBe(
        view.unrelated,
      );
      expect(view.project.value).toMatchObject({
        title: "User film",
        projectContentLocale: "zh-TW",
      });
      expect(view.error.value).toBe(
        failure === "refresh" ? view.refreshError : view.preloadError,
      );
      expect(view.error.value).toMatchObject({ code: "workspace.unavailable" });
      if (initialTab === "story") {
        expect(
          view.h.calls.filter((call) => call.args?.kind === "edit-enter"),
        ).toMatchObject([{ args: { kind: "edit-enter", clipCount: 500 } }]);
      } else expect(view.h.invoke).not.toHaveBeenCalled();
    },
  );

  it("pairs Compose's actual first Edit readiness with entry before the initial render", async () => {
    let clock = 10;
    const view = composeFixture({ now: () => clock });
    const initialRender = vi.fn(() => {
      clock += 80;
    });
    const stop = watch(view.tab, initialRender);
    try {
      await view.compose();
      await nextTick();
      await turn();
      expect(view.tab.value).toBe("edit");
      expect(view.busy.value).toBe("");
      expect(view.editorMountRequested.value).toBe(true);
      expect(view.loadAssetIds).toHaveBeenCalledWith([
        "asset-0",
        "asset-1",
        "asset-2",
        "asset-3",
        "asset-4",
      ]);
      expect(initialRender).toHaveBeenCalledTimes(1);
      view.h.benchmark.afterFrames(
        "edit-ready",
        { clipCount: 500 },
        () => true,
      );
      await turn();
      view.h.frame();
      view.h.frame();
      await turn();
      const events = view.h.calls
        .filter((call) => call.command === "native_checkpoint")
        .map((call, index): NativeEvent => ({
          runId: "compose-native-flow",
          pid: 1,
          kind: call.args!.kind as NativeEvent["kind"],
          nativeElapsedMs: index,
          unixMs: index + 1,
          clientElapsedMs: Number(call.args!.clientElapsedMs),
          clientTimeOriginMs: Number(call.args!.clientTimeOriginMs),
          clipCount: call.args!.clipCount as number | undefined,
        }));
      const summary = summarizeNativeEvents(events);
      expect(summary.editVisits).toHaveLength(1);
      expect(summary.editVisits[0]).toMatchObject({
        clipCount: 500,
        durationMs: 80,
        enter: { kind: "edit-enter", clientElapsedMs: 10, clipCount: 500 },
        ready: { kind: "edit-ready", clientElapsedMs: 90 },
      });
      expect(summary.incompleteEditVisits).toBe(0);
    } finally {
      stop();
    }
  });

  it.each(["flush-failed", "dirty", "failed", "late-dirty", "relinking"])(
    "does not enter Edit or emit an intent when Compose is blocked by %s",
    async (condition) => {
      const view = composeFixture({
        flushFails: condition === "flush-failed",
        dirty: condition === "dirty",
        failed: condition === "failed",
        lateDirty: condition === "late-dirty",
        relinking: condition === "relinking",
      });
      await view.compose();
      await turn();
      expect(view.tab.value).toBe("story");
      expect(view.h.invoke).not.toHaveBeenCalled();
      expect(view.h.frames).toHaveLength(0);
      expect(view.h.subscribe).not.toHaveBeenCalled();
      expect(view.busy.value).toBe("");
    },
  );

  it("does not duplicate Edit entry when composing in an already active Edit visit", async () => {
    const view = composeFixture({ initialTab: "edit" });
    await view.compose();
    await turn();
    expect(view.tab.value).toBe("edit");
    expect(view.apiCompose).toHaveBeenCalledTimes(1);
    expect(view.editorMountRequested.value).toBe(true);
    expect(view.h.invoke).not.toHaveBeenCalled();
  });

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
          retryNativeBootReady: undefined,
          cancelNativeEditReady: cancel,
          nativeDisposed: false,
          nativeEditDisposed: false,
          nativeBootGeneration: 1,
          nativeEditGeneration: 1,
          poll: undefined,
          window: { removeEventListener: vi.fn() },
          handleKeyboard: () => {},
          protectDrafts: actualFunction(
            "apps/desktop/src/App.vue",
            "protectDrafts",
            {
              categoryDirty: ref(false),
              scenePlanDraftPresent: ref(false),
              beatDirty: ref(false),
              storyReviewBusy: ref(false),
              storyReviewPending: ref(false),
            },
          ),
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
      retryNativeBootReady: undefined,
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
      restoreScriptReviewTarget: () => {},
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
    const categoryError = ref<unknown>("");
    const categories = categoryNavigationFixture(busy, categoryError);
    const changeTab = actualFunction("apps/desktop/src/App.vue", "changeTab", {
      ...categories,
      storyScriptReview: ref(null),
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
    categories.categoryDirty.value = true;
    const categoryFailure = new Error("Category save failed");
    categories.patch.mockRejectedValueOnce(categoryFailure);
    await changeTab("edit");
    expect(calls).toEqual([]);
    expect(tab.value).toBe("library");
    expect(categories.categoryDirty.value).toBe(true);
    expect(categoryError.value).toBe(categoryFailure);
    categories.categoryDirty.value = false;
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
