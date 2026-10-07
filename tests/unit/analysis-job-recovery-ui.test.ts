import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@openfilm/core";
import type {
  AnalysisJobRecoveryState,
  AnalysisRecoveryInput,
} from "../../apps/desktop/src/api";

const vue = createRequire(resolve("apps/desktop/package.json"))("vue");
const stopScopes: Array<() => void> = [];
afterEach(() => {
  for (const stop of stopScopes.splice(0)) stop();
});
const source = readFileSync(
  resolve("apps/desktop/src/components/AnalysisJobActions.vue"),
  "utf8",
);
// Execute the actual component with Vue refs and synchronous watchers. Only
// DOM focus and parent I/O are omitted; no replacement recovery implementation.
const componentCode = transformSync(
  source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!,
  { loader: "ts", format: "esm" },
).code.replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, "");
const job: Job = {
  id: "analysis-job",
  assetId: "source",
  type: "transcribe",
  status: "running",
};
const unknown: AnalysisJobRecoveryState = {
  jobId: job.id,
  ownerState: "unknown",
  manualRecoveryAllowed: true,
  ownerToken: "original-owner",
  checkpoint: "inspected-checkpoint",
  canCancel: false,
};
type Panel = {
  beginRecovery: () => void;
  confirmRecovery: () => void;
  keepCurrent: () => void;
  confirmation: { value: unknown };
  canCancel: { value: boolean };
  canRecover: { value: boolean };
};
function panel(initial?: Partial<AnalysisJobRecoveryState>) {
  const props = vue.reactive({
    projectId: "project",
    job: { ...job },
    recovery: { ...unknown, ...initial } as
      AnalysisJobRecoveryState | undefined,
    pending: false,
    disabled: false,
  });
  const emit = vi.fn();
  const dependencies = {
    ...vue,
    useI18n: () => ({ t: String }),
    defineProps: () => props,
    defineEmits: () => emit,
  };
  const scope = vue.effectScope();
  const instance = scope.run(() =>
    new Function(
      "dependencies",
      `const {${Object.keys(dependencies).join(",")}}=dependencies;\n${componentCode}\nreturn {beginRecovery,confirmRecovery,keepCurrent,confirmation,canCancel,canRecover};`,
    )(dependencies),
  ) as Panel;
  stopScopes.push(() => scope.stop());
  return { props, emit, instance };
}

describe("analysis recovery confirmation and local Cancel capability", () => {
  it("never advertises local Cancel or takeover for a proven-live foreign owner", () => {
    const { instance, emit } = panel({
      ownerState: "alive",
      manualRecoveryAllowed: false,
    });
    expect(instance.canCancel.value).toBe(false);
    expect(instance.canRecover.value).toBe(false);
    instance.beginRecovery();
    instance.confirmRecovery();
    expect(emit).not.toHaveBeenCalled();
  });
  it("preserves Cancel only for the server's actual local controller", () => {
    const { instance } = panel({ canCancel: true });
    expect(instance.canCancel.value).toBe(true);
    expect(instance.canRecover.value).toBe(false);
  });
  it("offers explicit recovery when a previously live owner dies after open", () => {
    const { props, instance, emit } = panel({
      ownerState: "alive",
      manualRecoveryAllowed: false,
    });
    props.recovery = {
      ...unknown,
      ownerState: "dead",
      manualRecoveryAllowed: true,
      checkpoint: "post-open-death-checkpoint",
    };
    expect(instance.canCancel.value).toBe(false);
    expect(instance.canRecover.value).toBe(true);
    instance.beginRecovery();
    expect(emit).not.toHaveBeenCalled();
    instance.confirmRecovery();
    expect(emit).toHaveBeenCalledExactlyOnceWith("recover", {
      confirmStopped: true,
      checkpoint: "post-open-death-checkpoint",
      ownerToken: unknown.ownerToken,
    });
  });
  it("does not grant controls without recovery evidence for this exact job", () => {
    const { props, instance } = panel({ jobId: "another-job" });
    expect(instance.canCancel.value).toBe(false);
    expect(instance.canRecover.value).toBe(false);
    props.recovery = undefined;
    expect(instance.canCancel.value).toBe(false);
    expect(instance.canRecover.value).toBe(false);
  });
  it("emits the inspected checkpoint only after explicit confirmation", () => {
    const { instance, emit } = panel();
    instance.beginRecovery();
    expect(emit).not.toHaveBeenCalled();
    instance.confirmRecovery();
    expect(emit).toHaveBeenCalledExactlyOnceWith("recover", {
      confirmStopped: true,
      checkpoint: unknown.checkpoint,
      ownerToken: unknown.ownerToken,
    });
  });
  it("supports ownerless legacy evidence without inventing an owner token", () => {
    const { instance, emit } = panel({ ownerToken: undefined });
    instance.beginRecovery();
    instance.confirmRecovery();
    expect(emit).toHaveBeenCalledExactlyOnceWith("recover", {
      confirmStopped: true,
      checkpoint: unknown.checkpoint,
    });
  });
  it.each([
    { checkpoint: "new-checkpoint" },
    { ownerToken: "new-owner" },
    { ownerState: "alive" as const },
    { manualRecoveryAllowed: false },
    { canCancel: true },
  ])(
    "invalidates a confirmation when fresh ownership evidence changes: %j",
    (changed) => {
      const { props, instance, emit } = panel();
      instance.beginRecovery();
      props.recovery = { ...unknown, ...changed };
      expect(instance.confirmation.value).toBeUndefined();
      instance.confirmRecovery();
      expect(emit).not.toHaveBeenCalled();
    },
  );
  it("invalidates confirmation after a project switch or terminal completion", () => {
    const { props, instance, emit } = panel();
    instance.beginRecovery();
    props.projectId = "new-project";
    instance.confirmRecovery();
    expect(emit).not.toHaveBeenCalled();
    instance.beginRecovery();
    props.job.status = "completed";
    instance.confirmRecovery();
    expect(instance.canRecover.value).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
  it("Keep current state performs no mutation, and pending requests prevent repeats", () => {
    const { props, instance, emit } = panel();
    instance.beginRecovery();
    instance.keepCurrent();
    expect(instance.confirmation.value).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
    instance.beginRecovery();
    props.pending = true;
    instance.confirmRecovery();
    expect(emit).not.toHaveBeenCalled();
  });
});

const appSource = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
const start = appSource.indexOf("async function recoverAnalysis(");
const end = appSource.indexOf("\n}", start) + 2;
if (start < 0 || end < 2) throw new Error("Missing App recovery operation");
const operationCode = transformSync(appSource.slice(start, end), {
  loader: "ts",
  format: "esm",
}).code;
function deferred() {
  let release!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  return { promise, release, reject };
}
function application() {
  const response = deferred();
  const project = vue.ref({ id: "project" });
  const analysisRecovery = vue.ref({ [job.id]: { ...unknown } });
  const pending = vue.ref({} as Record<string, boolean>);
  const notice = vue.ref(null);
  const error = vue.ref(null);
  const refreshJobs = vi.fn(async () => {});
  const api = { recoverAnalysis: vi.fn(() => response.promise) };
  const dependencies = {
    project,
    analysisRecovery,
    recoveringAnalysisJobs: pending,
    analysisRecoveryPending: vue.computed(() =>
      Object.values(pending.value).some(Boolean),
    ),
    busy: vue.ref(""),
    api,
    notice,
    error,
    refreshJobs,
  };
  const app = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}}=dependencies;\nlet analysisRecoveryGeneration=0;\n${operationCode}\nreturn {recoverAnalysis,advanceSession(){analysisRecoveryGeneration++;}};`,
  )(dependencies) as {
    recoverAnalysis: (job: Job, input: AnalysisRecoveryInput) => Promise<void>;
    advanceSession: () => void;
  };
  return {
    ...app,
    response,
    project,
    pending,
    api,
    notice,
    error,
    refreshJobs,
  };
}
const confirmed: AnalysisRecoveryInput = {
  confirmStopped: true,
  checkpoint: unknown.checkpoint,
  ownerToken: unknown.ownerToken,
};
describe("App owns a recovery response without touching transcript drafts", () => {
  it("retains the mutation barrier until the response and job refresh finish", async () => {
    const h = application();
    const work = h.recoverAnalysis(job, confirmed);
    expect(h.pending.value[job.id]).toBe(true);
    await h.recoverAnalysis(job, confirmed);
    expect(h.api.recoverAnalysis).toHaveBeenCalledTimes(1);
    h.response.release();
    await work;
    expect(h.refreshJobs).toHaveBeenCalledTimes(1);
    expect(h.pending.value[job.id]).toBe(false);
    expect(h.notice.value).toEqual({ uiKey: "precision.recovery.recovered" });
  });
  it("does not send a recovery using stale checkpoint or owner evidence", async () => {
    const h = application();
    await h.recoverAnalysis(job, { ...confirmed, checkpoint: "stale" });
    await h.recoverAnalysis(job, { ...confirmed, ownerToken: "stale-owner" });
    expect(h.api.recoverAnalysis).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "ignores a late response or error after reopening even the same project ID (reject=%s)",
    async (reject) => {
      const h = application();
      const work = h.recoverAnalysis(job, confirmed);
      // App's project/path watcher advances this session generation and resets
      // the pending map; simulate a new session with the same portable project ID.
      h.advanceSession();
      h.pending.value = { "new-session-work": true };
      if (reject) h.response.reject(new Error("old-session transport failure"));
      else h.response.release();
      await work;
      expect(h.refreshJobs).not.toHaveBeenCalled();
      expect(h.notice.value).toBeNull();
      expect(h.error.value).toBeNull();
      expect(h.pending.value).toEqual({ "new-session-work": true });
    },
  );
});
