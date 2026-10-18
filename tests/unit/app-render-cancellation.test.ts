// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; this derivative as a whole is GPL-3.0-only. See LICENSE/NOTICE.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import type { FilmLook, Job } from "@openfilm/core";
import {
  ApiError,
  type AnalysisJobRecoveryState,
} from "../../apps/desktop/src/api";

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
const { ref } = desktopRequire("vue") as {
  ref: <T>(value: T) => { value: T };
};
const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
const emptyRecoveryStart = source.indexOf("const EMPTY_ANALYSIS_RECOVERY");
const emptyRecoveryEnd = source.indexOf(
  "const analysisRecovery =",
  emptyRecoveryStart,
);
if (emptyRecoveryStart < 0 || emptyRecoveryEnd < 0)
  throw new Error("Missing App empty analysis recovery state");
const names = [
  "run",
  "refreshJobs",
  "pollJobs",
  "renderPreview",
  "exportFilm",
  "cancelJob",
];
// Execute the App's actual functions with Vue refs; only external I/O and
// unrelated workspace refreshes are supplied by this headless host.
const code = transformSync(
  [
    'let jobsGeneration = 0, polling = false, lastJobSignature = "";',
    source.slice(emptyRecoveryStart, emptyRecoveryEnd),
    ...names.map((name) => {
      const start = source.indexOf(`async function ${name}(`);
      const end = source.indexOf("\n}", start) + 2;
      if (start < 0 || end < 2) throw new Error(`Missing App function ${name}`);
      return source.slice(start, end);
    }),
  ].join("\n"),
  { loader: "ts", format: "esm" },
).code;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type JobSnapshot = {
  jobs: Job[];
  analysisRecovery?: Record<string, AnalysisJobRecoveryState>;
};
type JobRead = ReturnType<typeof deferred<JobSnapshot>>;
type Mode = "render" | "export";
const current = (status: Job["status"]): Job => ({
  id: "current-render",
  type: "render",
  status,
});
const oldCancelled: Job = {
  id: "old-render",
  type: "render",
  status: "cancelled",
};
async function turn() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function host() {
  const reads: JobRead[] = [];
  const rendering = deferred<{ path: string }>();
  const cancellation = deferred<void>();
  const cancellations = [cancellation];
  let cancellationCalls = 0;
  const cancelling = ref<Record<string, boolean>>({});
  const project = ref<{ id: string } | null>({ id: "film" });
  const jobs = ref<Job[]>([current("running"), oldCancelled]);
  const error = ref<unknown>("");
  const notice = ref<unknown>(null);
  const requested = ref<string | null>(null);
  const busy = ref("");
  const analysisRecovery = ref<Record<string, AnalysisJobRecoveryState>>({});
  const refreshes = { assets: 0, project: 0 };
  const dependencies = {
    api: {
      jobs: () => {
        const read = deferred<JobSnapshot>();
        reads.push(read);
        return read.promise;
      },
    },
    project,
    jobs,
    analysisRecovery,
    busy,
    error,
    notice,
    renderCancellationRequested: requested,
    cancellingJobs: cancelling,
    flushPending: async () => true,
    activeComposition: ref({ id: "composition" }),
    lookOverride: ref<FilmLook | undefined>(undefined),
    editSerial: 0,
    post: (path: string) => {
      if (!path.includes("/cancel")) return rendering.promise;
      if (cancellationCalls++ === 0) return cancellation.promise;
      const response = deferred<void>();
      cancellations.push(response);
      return response.promise;
    },
    message: (key: string) => key,
    reloadAssets: async () => {
      refreshes.assets++;
    },
    refreshProject: async () => {
      refreshes.project++;
    },
    checkMediaStatus: async () => {},
    previewVersion: ref(0),
    previewStale: ref(false),
    showRenderedPreview: ref(false),
    exportPath: ref(""),
    exportFilename: ref(""),
    exportFormat: ref(""),
    exportReport: ref(null),
    exportStale: ref(false),
  };
  const app = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}} = dependencies;\n${code}\nreturn {${names.join(",")}};`,
  )(dependencies) as {
    renderPreview: () => Promise<void>;
    exportFilm: (format: string) => Promise<void>;
    cancelJob: (job: Job) => Promise<void>;
    pollJobs: () => Promise<void>;
    refreshJobs: () => Promise<Job[] | undefined>;
  };
  return {
    ...app,
    analysisRecovery,
    reads,
    rendering,
    cancellation,
    cancellations,
    cancelling,
    project,
    jobs,
    error,
    notice,
    requested,
    busy,
    refreshes,
  };
}
async function requestedCancellation(h: ReturnType<typeof host>) {
  const cancel = h.cancelJob(current("running"));
  h.cancellation.resolve();
  await turn();
  expect(h.reads).toHaveLength(1);
  h.reads[0]!.resolve({ jobs: [current("running"), oldCancelled] });
  await cancel;
}
function start(h: ReturnType<typeof host>, mode: Mode) {
  return mode === "render" ? h.renderPreview() : h.exportFilm("mp4");
}

describe("App cancellation responses remain owned during overlapping job polling", () => {
  it.each<Mode>(["render", "export"])(
    "%s recognizes its cancelled job even when a newer poll supersedes its publication",
    async (mode) => {
      const h = host();
      const action = start(h, mode);
      await turn();
      await requestedCancellation(h);
      h.rendering.reject(
        new ApiError("Operation cancelled", 400, { code: "render.failed" }),
      );
      await turn();
      expect(h.reads).toHaveLength(2);
      const newerPoll = h.pollJobs();
      await turn();
      expect(h.reads).toHaveLength(3);
      h.reads[1]!.resolve({ jobs: [current("cancelled"), oldCancelled] });
      await turn();
      expect(h.jobs.value[0]!.status).toBe("running");
      expect(h.reads).toHaveLength(4);
      h.reads[3]!.resolve({ jobs: [current("cancelled"), oldCancelled] });
      await action;
      expect(h.error.value).toBe("");
      expect(h.notice.value).toBe("feedback.renderCancelled");
      expect(h.busy.value).toBe("");
      h.reads[2]!.resolve({ jobs: [current("running"), oldCancelled] });
      await newerPoll;
      expect(h.jobs.value[0]!.status).toBe("cancelled");
    },
  );

  it.each<Mode>(["render", "export"])(
    "%s retains a real failure when only an unrelated historic job is cancelled",
    async (mode) => {
      const h = host();
      const action = start(h, mode);
      await turn();
      await requestedCancellation(h);
      const cause = new ApiError("Unsupported codec", 400, {
        code: "render.failed",
      });
      h.rendering.reject(cause);
      await turn();
      h.reads[1]!.resolve({ jobs: [current("failed"), oldCancelled] });
      await turn();
      h.reads[2]!.resolve({ jobs: [current("failed"), oldCancelled] });
      await action;
      expect(h.error.value).toBe(cause);
      expect(h.notice.value).toBeNull();
    },
  );

  it.each<Mode>(["render", "export"])(
    "%s rejects a cancelled snapshot from a project that no longer owns the request",
    async (mode) => {
      const h = host();
      const action = start(h, mode);
      await turn();
      await requestedCancellation(h);
      const cause = new ApiError("Operation cancelled", 400, {
        code: "render.failed",
      });
      h.rendering.reject(cause);
      await turn();
      h.project.value = { id: "another-film" };
      h.reads[1]!.resolve({ jobs: [current("cancelled"), oldCancelled] });
      await turn();
      h.reads[2]!.resolve({ jobs: [] });
      await action;
      expect(h.error.value).toBe(cause);
      expect(h.notice.value).toBeNull();
    },
  );

  it("a rejected cancel clears the requested target and cannot hide a later render failure", async () => {
    const h = host();
    const action = h.renderPreview();
    await turn();
    const cancel = h.cancelJob(current("running"));
    const cancelFailure = new ApiError("Cannot cancel job", 409, {
      code: "operation.failed",
    });
    h.cancellation.reject(cancelFailure);
    await cancel;
    expect(h.requested.value).toBeNull();
    expect(h.error.value).toBe(cancelFailure);
    const cause = new ApiError("Unsupported codec", 400, {
      code: "render.failed",
    });
    h.rendering.reject(cause);
    await turn();
    h.reads[0]!.resolve({ jobs: [current("cancelled"), oldCancelled] });
    await turn();
    h.reads[1]!.resolve({ jobs: [current("cancelled"), oldCancelled] });
    await action;
    expect(h.error.value).toBe(cause);
    expect(h.notice.value).toBeNull();
  });

  it.each<Mode>(["render", "export"])(
    "%s does not classify a new project's matching historic UUID as its cancellation",
    async (mode) => {
      const h = host();
      const action = start(h, mode);
      await turn();
      await requestedCancellation(h);
      h.project.value = { id: "restored-film" };
      const cause = new ApiError("Operation cancelled", 400, {
        code: "render.failed",
      });
      h.rendering.reject(cause);
      await turn();
      h.reads[1]!.resolve({ jobs: [current("cancelled")] });
      await turn();
      h.reads[2]!.resolve({ jobs: [current("cancelled")] });
      await action;
      expect(h.error.value).toBe(cause);
      expect(h.notice.value).toBeNull();
    },
  );

  it.each<Mode>(["render", "export"])(
    "%s retains an acknowledged cancellation when only its auxiliary status read fails",
    async (mode) => {
      const h = host();
      const action = start(h, mode);
      await turn();
      const cancel = h.cancelJob(current("running"));
      h.cancellation.resolve();
      await turn();
      expect(h.reads).toHaveLength(1);
      h.reads[0]!.reject(new Error("Status read disconnected"));
      await cancel;
      expect(h.requested.value).toBe("current-render");
      expect(h.error.value).toBe("");
      h.rendering.reject(
        new ApiError("Operation cancelled", 400, { code: "render.failed" }),
      );
      await turn();
      h.reads[1]!.resolve({ jobs: [current("cancelled"), oldCancelled] });
      await turn();
      h.reads[2]!.resolve({ jobs: [current("cancelled"), oldCancelled] });
      await action;
      expect(h.error.value).toBe("");
      expect(h.notice.value).toBe("feedback.renderCancelled");
    },
  );

  it("returns the local snapshot without letting an older refresh overwrite a newer snapshot", async () => {
    const h = host();
    const older = h.refreshJobs();
    const newer = h.refreshJobs();
    h.reads[1]!.resolve({ jobs: [current("cancelled")] });
    expect(await newer).toEqual([current("cancelled")]);
    h.reads[0]!.resolve({ jobs: [current("running")] });
    expect(await older).toEqual([current("running")]);
    expect(h.jobs.value).toEqual([current("cancelled")]);
  });

  it.each(["same", "different"])(
    "an old cancellation failure cannot replace a newer request in the %s project",
    async (scope) => {
      const h = host();
      const oldCancel = h.cancelJob(current("running"));
      if (scope === "different") h.project.value = { id: "new-film" };
      const newJob = { ...current("running"), id: "new-render" };
      const newCancel = h.cancelJob(newJob);
      expect(h.requested.value).toBe(newJob.id);
      h.cancellation.reject(
        new ApiError("Old job already finished", 409, {
          code: "operation.failed",
        }),
      );
      await oldCancel;
      expect(h.requested.value).toBe(newJob.id);
      expect(h.error.value).toBe("");
      expect(h.cancelling.value["current-render"]).toBe(false);
      expect(h.cancelling.value[newJob.id]).toBe(true);
      expect(h.reads).toHaveLength(0);
      h.cancellations[1]!.resolve();
      await turn();
      h.reads[0]!.resolve({ jobs: [newJob] });
      await newCancel;
      expect(h.requested.value).toBe(newJob.id);
      expect(h.error.value).toBe("");
    },
  );

  it("a late old-project cancellation ACK does not read or overwrite the new project's jobs", async () => {
    const h = host();
    const oldCancel = h.cancelJob(current("running"));
    h.project.value = { id: "new-film" };
    const newJob = { ...current("running"), id: "new-render" };
    const newCancel = h.cancelJob(newJob);
    h.cancellation.resolve();
    await oldCancel;
    expect(h.reads).toHaveLength(0);
    expect(h.requested.value).toBe(newJob.id);
    expect(h.error.value).toBe("");
    expect(h.cancelling.value["current-render"]).toBe(false);
    h.cancellations[1]!.resolve();
    await turn();
    h.reads[0]!.resolve({ jobs: [newJob] });
    await newCancel;
    expect(h.jobs.value).toEqual([newJob]);
  });
});

const recoveryState = (
  checkpoint: string,
  ownerToken: string,
): AnalysisJobRecoveryState => ({
  jobId: "analysis-job",
  ownerState: "unknown",
  manualRecoveryAllowed: true,
  checkpoint,
  ownerToken,
  canCancel: false,
});

describe("App analysis recovery polling preserves evidence without empty prop churn", () => {
  it.each(["refreshJobs", "pollJobs"] as const)(
    "%s shares empty snapshots but publishes fresh ownership evidence and removals",
    async (operation) => {
      const h = host();
      const publish = async (snapshot: JobSnapshot) => {
        const read = h[operation]();
        h.reads.at(-1)!.resolve(snapshot);
        await read;
      };
      await publish({ jobs: [], analysisRecovery: {} });
      const empty = h.analysisRecovery.value;
      expect(Object.isFrozen(empty)).toBe(true);
      await publish({ jobs: [] });
      expect(h.analysisRecovery.value).toBe(empty);
      await publish({ jobs: [], analysisRecovery: {} });
      expect(h.analysisRecovery.value).toBe(empty);

      const first = recoveryState("checkpoint-1", "owner-1");
      const second = recoveryState("checkpoint-2", "owner-2");
      await publish({ jobs: [], analysisRecovery: { [first.jobId]: first } });
      const previous = h.analysisRecovery.value;
      expect(previous[first.jobId]).toEqual(first);
      // Job signatures are unchanged: recovery evidence still must be fresh.
      await publish({ jobs: [], analysisRecovery: { [second.jobId]: second } });
      expect(h.analysisRecovery.value).not.toBe(previous);
      expect(h.analysisRecovery.value[second.jobId]).toEqual(second);
      expect(previous[first.jobId]).toEqual(first);

      await publish({ jobs: [], analysisRecovery: {} });
      expect(h.analysisRecovery.value).toBe(empty);
      expect(h.analysisRecovery.value[first.jobId]).toBeUndefined();
    },
  );

  it.each(["refreshJobs", "pollJobs"] as const)(
    "%s cannot publish a delayed recovery snapshot into another project",
    async (operation) => {
      const h = host();
      const pending = h[operation]();
      h.project.value = { id: "new-film" };
      const newer = recoveryState("new-checkpoint", "new-owner");
      h.analysisRecovery.value = { [newer.jobId]: newer };
      const currentRecovery = h.analysisRecovery.value;
      const currentJobs = h.jobs.value;
      const older = recoveryState("old-checkpoint", "old-owner");
      h.reads[0]!.resolve({
        jobs: [],
        analysisRecovery: { [older.jobId]: older },
      });
      await pending;
      expect(h.analysisRecovery.value).toBe(currentRecovery);
      expect(h.analysisRecovery.value[newer.jobId]).toEqual(newer);
      expect(h.jobs.value).toBe(currentJobs);
    },
  );
});

describe("render job progress polling", () => {
  it("publishes render progress without reloading the media catalog or project", async () => {
    const h = host();
    const updated = { ...current("running"), progress: 0.42 };
    const poll = h.pollJobs();
    h.reads[0]!.resolve({ jobs: [updated, oldCancelled] });
    await poll;
    expect(h.jobs.value[0]?.progress).toBe(0.42);
    expect(h.refreshes).toEqual({ assets: 0, project: 0 });
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "refreshes project state once when a render becomes %s",
    async (status) => {
      const h = host();
      const poll = h.pollJobs();
      h.reads[0]!.resolve({ jobs: [current(status), oldCancelled] });
      await poll;
      expect(h.refreshes).toEqual({ assets: 1, project: 1 });
    },
  );
});
