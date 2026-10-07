import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { beforeAll, afterEach, it, expect, vi } from "vitest";
import { ApiError } from "../../apps/desktop/src/api";
import type { Job } from "@openfilm/core";
import type { ReviewRecoveryState } from "../../apps/desktop/src/api";
const vue = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
)("vue");
let code: string;
const cleanup: Array<() => void> = [];
beforeAll(async () => {
  const source = await readFile(
    new URL(
      "../../apps/desktop/src/components/ReviewPanel.vue",
      import.meta.url,
    ),
    "utf8",
  );
  code = (
    await transform(
      source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!,
      { loader: "ts", format: "esm" },
    )
  ).code.replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "");
});
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
  vi.unstubAllGlobals();
});
function fixture() {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  const job: Job = {
    id: "job",
    type: "language-review",
    assetId: "asset",
    status: "running",
  };
  const checkpoint: ReviewRecoveryState = {
    jobId: job.id,
    ownerState: "unknown",
    manualRecoveryAllowed: true,
    ownerToken: "original",
    updatedAt: "2026-10-07T00:00:00Z",
  };
  const emit = vi.fn();
  const api = {
    recoverReview: vi.fn(async () => ({ job })),
    reviewSuggestions: vi.fn(async () => ({
      suggestions: [],
      total: 0,
      offset: 0,
      limit: 100,
    })),
    reviewProvider: vi.fn(async () => ({ configured: false })),
    reviewBatches: vi.fn(async () => ({ batches: [] })),
    reviewRecovery: vi.fn(async () => checkpoint),
  };
  let dispose = () => {};
  const scope = vue.effectScope();
  const dependencies = {
    ...vue,
    api,
    ApiError,
    post: vi.fn(),
    useI18n: () => ({ t: String }),
    formatNumber: String,
    localizeError: String,
    errorDetail: String,
    defineProps: () => ({
      projectId: "project",
      assetId: "asset",
      jobs: [job],
      flush: async () => true,
    }),
    defineEmits: () => emit,
    defineExpose: () => {},
    onMounted: () => {},
    onBeforeUnmount: (fn: () => void) => {
      dispose = fn;
    },
  };
  const panel = scope.run(() =>
    new Function(
      "deps",
      `const {${Object.keys(dependencies).join(",")}}=deps;\n${code}\nreturn {recoverInterrupted,recoveryStates,uncertainAcceptance,flush:flushPending,select(job){if(typeof beginRecovery==='function')beginRecovery(job);else recoveryConfirmJobId.value=job.id;}};`,
    )(dependencies),
  ) as {
    recoverInterrupted: (job: Job) => Promise<void>;
    recoveryStates: { value: Record<string, ReviewRecoveryState> };
    uncertainAcceptance: { value: unknown };
    flush: () => Promise<boolean>;
    select: (job: Job) => void;
  };
  panel.recoveryStates.value = { [job.id]: checkpoint };
  cleanup.push(() => {
    dispose();
    scope.stop();
  });
  return { job, checkpoint, panel, api, emit, dispose: () => dispose() };
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}
it("manual confirmation retains the originally inspected execution", async () => {
  const { job, checkpoint, panel, api } = fixture();
  panel.select(job);
  panel.recoveryStates.value = {
    [job.id]: { ...checkpoint, ownerToken: "newer" },
  };
  await panel.recoverInterrupted(job);
  expect(api.recoverReview).toHaveBeenCalledWith(job.id, {
    confirmStopped: true,
    ownerToken: "original",
    updatedAt: checkpoint.updatedAt,
  });
});
it("navigation waits for the owned manual recovery request", async () => {
  const { job, panel, api } = fixture();
  const gate = deferred();
  api.recoverReview.mockImplementation(async () => {
    await gate.promise;
    return { job };
  });
  panel.select(job);
  const work = panel.recoverInterrupted(job);
  let settled = false;
  const flushed = panel.flush().then((value) => {
    settled = true;
    return value;
  });
  try {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(settled).toBe(false);
  } finally {
    gate.release();
    await work;
    await flushed;
  }
});
it("late manual recovery responses do not emit into a disposed panel", async () => {
  const { job, panel, api, emit, dispose } = fixture();
  const gate = deferred();
  api.recoverReview.mockImplementation(async () => {
    await gate.promise;
    return { job };
  });
  panel.select(job);
  const work = panel.recoverInterrupted(job);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  dispose();
  emit.mockClear();
  gate.release();
  await work;
  expect(emit.mock.calls.some((args) => args[0] === "activity")).toBe(false);
});
it("uncertain text acceptance blocks competing manual recovery", async () => {
  const { job, panel, api } = fixture();
  panel.uncertainAcceptance.value = {
    suggestionId: "s",
    receipt: { baseRevision: "r", requestId: "q" },
  };
  panel.select(job);
  await panel.recoverInterrupted(job);
  expect(api.recoverReview).not.toHaveBeenCalled();
});
