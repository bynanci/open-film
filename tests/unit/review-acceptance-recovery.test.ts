import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  validateTranscriptCommand,
  type TranscriptCommand,
} from "@openfilm/core";
import {
  ApiError,
  type TranscriptEditorState,
} from "../../apps/desktop/src/api";

// Exercise the actual SFC setup closure with Vue's real refs/watchers. Rendering
// and the real HTTP path are covered by the browser recovery regression.
const vue = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
)("vue") as {
  computed: unknown;
  ref: unknown;
  shallowRef: unknown;
  watch: unknown;
  effectScope: () => {
    run: <T>(callback: () => T) => T | undefined;
    stop: () => void;
  };
};
type Acceptance = {
  suggestionId: string;
  receipt: { baseRevision: string; requestId: string };
};
type Panel = {
  retryAcceptance: () => Promise<void>;
  flush: () => Promise<boolean>;
  uncertainAcceptance: { value?: Acceptance };
  error: { value: unknown };
};
type Props = {
  projectId: string;
  assetId: string;
  revision: string;
  flush: () => Promise<boolean>;
};
type Backend = (id: string, receipt: Acceptance["receipt"]) => Promise<unknown>;
let factory: (...args: unknown[]) => Panel;
type Transcript = {
  load: () => Promise<boolean>;
  reconcile: () => Promise<boolean>;
  command: (command: TranscriptCommand) => boolean;
  state: { value: TranscriptEditorState | null };
  status: { value: string };
  hasPending: { value: boolean };
};
let transcriptFactory: (...args: unknown[]) => Transcript;
const cleanup: (() => void)[] = [];
beforeAll(async () => {
  const source = await readFile(
    new URL(
      "../../apps/desktop/src/components/ReviewPanel.vue",
      import.meta.url,
    ),
    "utf8",
  );
  const setup = source.match(
    /<script setup lang="ts">([\s\S]*?)<\/script>/,
  )![1]!;
  const compiled = await transform(setup, { loader: "ts", format: "esm" });
  const code = compiled.code.replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "");
  factory = new Function(
    "computed",
    "onBeforeUnmount",
    "onMounted",
    "ref",
    "shallowRef",
    "watch",
    "useI18n",
    "api",
    "ApiError",
    "post",
    "defineProps",
    "defineEmits",
    "defineExpose",
    `${code}\nreturn {retryAcceptance, flush: flushPending, uncertainAcceptance, error};`,
  ) as typeof factory;
  const transcriptSource = await readFile(
    new URL(
      "../../apps/desktop/src/composables/useTranscriptEditor.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const transcript = await transform(transcriptSource, {
    loader: "ts",
    format: "esm",
  });
  const transcriptCode = transcript.code
    .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "")
    .replace(/\nexport\s*\{[\s\S]*?\};\s*$/, "");
  transcriptFactory = new Function(
    "computed",
    "onBeforeUnmount",
    "onMounted",
    "ref",
    "shallowRef",
    "validateTranscriptCommand",
    "api",
    "ApiError",
    `${transcriptCode}\nreturn useTranscriptEditor('project', 'asset', () => {});`,
  ) as typeof transcriptFactory;
});
afterEach(() => {
  for (const action of cleanup.splice(0).reverse()) action();
  vi.unstubAllGlobals();
});

const packet: Acceptance = {
  suggestionId: "suggestion-from-original-project",
  receipt: {
    baseRevision: "original-revision",
    requestId: "exact-accept-request",
  },
};
function panel(backend: Backend, changed?: () => void) {
  const storage = new Map<string, string>();
  const key = "openfilm:review-accept:project:asset";
  storage.set(key, JSON.stringify(packet));
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => storage.set(name, value),
    removeItem: (name: string) => storage.delete(name),
  });
  const props: Props = {
    projectId: "project",
    assetId: "asset",
    revision: "current-revision",
    flush: vi.fn(async () => true),
  };
  const events: [string, unknown[]][] = [];
  let dispose = () => {};
  const scope = vue.effectScope();
  const api = {
    acceptSuggestion: vi.fn(backend),
    reviewSuggestions: vi.fn(async () => ({
      suggestions: [],
      total: 0,
      offset: 0,
      limit: 100,
    })),
    reviewProvider: vi.fn(async () => ({
      configured: false,
      available: false,
    })),
    jobs: vi.fn(async () => ({ jobs: [] })),
  };
  const state = scope.run(() =>
    factory(
      vue.computed,
      (callback: () => void) => {
        dispose = callback;
      },
      () => {},
      vue.ref,
      vue.shallowRef,
      vue.watch,
      () => ({ t: (key: string) => key }),
      api,
      ApiError,
      () => {},
      () => props,
      () =>
        (name: string, ...args: unknown[]) => {
          events.push([name, args]);
          if (name === "changed") changed?.();
        },
      () => {},
    ),
  )!;
  cleanup.push(() => {
    dispose();
    scope.stop();
  });
  return { state, props, events, storage, key, api, dispose: () => dispose() };
}
function deferred() {
  let resolve!: (value?: unknown) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("persisted review acceptance recovery", () => {
  it("releases a restored-copy receipt only after a definitive missing-suggestion response", async () => {
    const cause = new ApiError("Suggestion not found.", 404, {
      code: "request.notFound",
    });
    const test = panel(async () => {
      throw cause;
    });
    expect(await test.state.flush()).toBe(false);
    await test.state.retryAcceptance();
    expect(test.api.acceptSuggestion).toHaveBeenCalledWith(
      packet.suggestionId,
      packet.receipt,
    );
    expect(test.state.error.value).toBe(cause);
    expect(test.state.uncertainAcceptance.value).toBeUndefined();
    expect(test.storage.has(test.key)).toBe(false);
    expect(test.events).toContainEqual(["pending", [false]]);
    expect(test.events).toContainEqual(["changed", []]);
    expect(await test.state.flush()).toBe(true);
    expect(test.props.flush).not.toHaveBeenCalled();
  });

  it.each([
    new TypeError("Connection closed before acknowledgment"),
    new ApiError("Server unavailable", 503, { code: "operation.failed" }),
    new ApiError("Source is offline", 404, { code: "media.missing" }),
    new ApiError("Unknown missing response", 404),
  ])("retains exact receipts for uncertain outcomes: %s", async (cause) => {
    const test = panel(async () => {
      throw cause;
    });
    await test.state.retryAcceptance();
    expect(test.storage.get(test.key)).toBe(JSON.stringify(packet));
    expect(test.state.uncertainAcceptance.value).toEqual(packet);
    expect(await test.state.flush()).toBe(false);
    expect(test.events.filter(([name]) => name === "changed")).toEqual([]);
  });

  it("replays a lost committed response with the original request and reconciles only after acknowledgment", async () => {
    const receipts = new Set<string>();
    let commits = 0,
      calls = 0;
    const test = panel(async (_id, receipt) => {
      if (!receipts.has(receipt.requestId)) {
        receipts.add(receipt.requestId);
        commits++;
      }
      if (++calls === 1) throw new TypeError("Committed response lost");
      return {
        revision: "accepted-revision",
        acknowledgedRevision: "accepted-revision",
      };
    });
    await test.state.retryAcceptance();
    expect(commits).toBe(1);
    expect(await test.state.flush()).toBe(false);
    expect(test.events.filter(([name]) => name === "changed")).toEqual([]);
    await test.state.retryAcceptance();
    expect(commits).toBe(1);
    expect(test.api.acceptSuggestion.mock.calls).toEqual([
      [packet.suggestionId, packet.receipt],
      [packet.suggestionId, packet.receipt],
    ]);
    expect(test.events.filter(([name]) => name === "changed")).toEqual([
      ["changed", []],
    ]);
    expect(test.props.flush).not.toHaveBeenCalled();
    expect(await test.state.flush()).toBe(true);
  });

  it("keeps a recovered manual draft in conflict when receipt confirmation reveals a newer revision", async () => {
    let reconciled: Promise<boolean> | undefined;
    const test = panel(
      async () => ({ revision: "accepted-revision" }),
      () => {
        reconciled = transcript.reconcile();
      },
    );
    const saved: TranscriptEditorState = {
      revision: "original-revision",
      total: 1,
      offset: 0,
      limit: 100,
      canUndo: false,
      canRedo: false,
      document: {
        id: "transcript",
        assetId: "asset",
        provenance: {
          providerId: "fixture",
          version: "1",
          sourceHash: "hash",
          createdAt: "2026-10-06T00:00:00Z",
        },
        segments: [{ id: "segment", start: 0, end: 1, text: "Original text" }],
      },
    };
    const edit = vi.fn();
    const scope = vue.effectScope();
    let dispose = () => {};
    const transcript = scope.run(() =>
      transcriptFactory(
        vue.computed,
        (callback: () => void) => {
          dispose = callback;
        },
        () => {},
        vue.ref,
        vue.shallowRef,
        validateTranscriptCommand,
        {
          transcript: async () => structuredClone(saved),
          editTranscript: edit,
        },
        ApiError,
      ),
    )!;
    cleanup.push(() => {
      dispose();
      scope.stop();
    });
    const correction: TranscriptCommand = {
      type: "replace-text",
      segmentId: "segment",
      text: "My unsaved correction",
    };
    const draft = structuredClone(saved);
    draft.document!.segments[0]!.text = correction.text;
    test.storage.set(
      "openfilm:transcript:project:asset",
      JSON.stringify({
        state: draft,
        pending: [correction],
        receipt: null,
      }),
    );
    expect(await transcript.load()).toBe(true);
    expect(transcript.status.value).toBe("failed");
    saved.revision = "accepted-revision";
    saved.document!.segments[0]!.text = "Accepted suggestion";
    await test.state.retryAcceptance();
    expect(await reconciled).toBe(false);
    expect(transcript.status.value).toBe("conflict");
    expect(transcript.hasPending.value).toBe(true);
    expect(transcript.state.value?.revision).toBe("original-revision");
    expect(transcript.state.value?.document?.segments[0]?.text).toBe(
      "My unsaved correction",
    );
    expect(
      JSON.parse(test.storage.get("openfilm:transcript:project:asset")!)
        .pending,
    ).toEqual([
      {
        type: "replace-text",
        segmentId: "segment",
        text: "My unsaved correction",
      },
    ]);
    expect(edit).not.toHaveBeenCalled();
    expect(test.state.uncertainAcceptance.value).toBeUndefined();
  });

  it.each(
    ["project", "asset", "disposed"].flatMap((change) => [
      { change, outcome: "rejection" },
      { change, outcome: "success" },
    ]),
  )(
    "ignores an old $outcome recovery response after its $change scope changes",
    async ({ change, outcome }) => {
      const response = deferred();
      const test = panel(() => response.promise);
      const retry = test.state.retryAcceptance();
      if (change === "project") test.props.projectId = "different-project";
      else if (change === "asset") test.props.assetId = "different-asset";
      else test.dispose();
      const newer: Acceptance = {
        suggestionId: "newer-suggestion",
        receipt: { baseRevision: "newer-revision", requestId: "newer-request" },
      };
      test.state.uncertainAcceptance.value = newer;
      test.storage.set(test.key, JSON.stringify(newer));
      if (outcome === "success") response.resolve({ revision: "old-accepted" });
      else
        response.reject(
          new ApiError("Suggestion not found.", 404, {
            code: "request.notFound",
          }),
        );
      await retry;
      expect(test.state.uncertainAcceptance.value).toEqual(newer);
      expect(test.storage.get(test.key)).toBe(JSON.stringify(newer));
      expect(test.state.error.value).toBeNull();
      expect(test.events.filter(([name]) => name === "changed")).toEqual([]);
    },
  );
});
