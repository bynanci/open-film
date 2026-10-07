import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import type { Job } from "@openfilm/core";
import type { AnalysisJobRecoveryState } from "../../apps/desktop/src/api";

const vue = createRequire(resolve("apps/desktop/package.json"))("vue") as {
  ref: <T>(value: T) => { value: T };
  computed: <T>(value: () => T) => { value: T };
  proxyRefs: <T extends object>(value: T) => T;
};
const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
const activeStart = source.indexOf("const activeJobs = computed(");
const activeEnd = source.indexOf("const recentJob =", activeStart);
if (activeStart < 0 || activeEnd < 0)
  throw new Error("Missing App job navigation state");
const functions = ["run", "flushEditor", "flushPending", "changeWorkspace"];
// Execute App's actual reactive job state, close operation and draft flush.
// The headless host supplies only external I/O and the editor's public flush.
const code = transformSync(
  [
    "let statusGeneration = 0, jobsGeneration = 0, analysisRecoveryGeneration = 0;",
    source.slice(activeStart, activeEnd),
    ...functions.map((name) => {
      const start = source.indexOf(`async function ${name}(`);
      const end = source.indexOf("\n}", start) + 2;
      if (start < 0 || end < 2) throw new Error(`Missing App function ${name}`);
      return source.slice(start, end);
    }),
  ].join("\n"),
  { loader: "ts", format: "esm" },
).code;
const disabledExpression = source.match(
  /class="text-button project-switch"\s+:disabled="([\s\S]*?)"/u,
)?.[1];
if (!disabledExpression) throw new Error("Missing project switch button");

function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const analysisJob = (type = "transcribe", status: Job["status"] = "running") =>
  ({
    id: "foreign-analysis",
    assetId: "spoken-memory",
    type,
    status,
    analysisOwner: { host: "other-process", pid: 987654, token: "owner-token" },
  }) satisfies Job;
const foreignRecovery = (): AnalysisJobRecoveryState => ({
  jobId: "foreign-analysis",
  ownerState: "alive",
  manualRecoveryAllowed: false,
  ownerToken: "owner-token",
  checkpoint: "inspected-checkpoint",
  canCancel: false,
});

function host(
  initialJobs: Job[] = [analysisJob()],
  recovery: AnalysisJobRecoveryState | undefined = foreignRecovery(),
) {
  const originalProject = {
    id: "film",
    stories: [{ id: "story", selectedAssetIds: ["spoken-memory"] }],
    compositions: [{ clips: [{ id: "clip", locked: true, sourceIn: 1.25 }] }],
  };
  const flush = vi.fn(async () => true);
  const jobs = vue.ref(initialJobs);
  const analysisRecovery = vue.ref<Record<string, AnalysisJobRecoveryState>>(
    recovery ? { [recovery.jobId]: recovery } : {},
  );
  const dependencies = {
    computed: vue.computed,
    jobs,
    analysisRecovery,
    busy: vue.ref(""),
    relinkBusy: vue.ref(false),
    analysisRecoveryPending: vue.ref(false),
    timelineEditor: vue.ref({ flush }),
    beatDirty: vue.ref(false),
    saveBeat: vi.fn(async () => true),
    error: vue.ref<unknown>(null),
    notice: vue.ref<unknown>(null),
    message: (key: string) => key,
    post: vi.fn(async () => {}),
    project: vue.ref<typeof originalProject | null>(originalProject),
    projectPath: vue.ref<string | null>("/media/film.openfilm"),
    mediaStatus: vue.ref<unknown>({ assets: [] }),
    checkingMedia: vue.ref(false),
    relinkOpen: vue.ref(false),
    clearExport: vi.fn(),
    importOpen: vue.ref(false),
    refreshRecents: vi.fn(async () => {}),
    api: {
      jobs: vi.fn(async () => ({
        jobs: jobs.value,
        analysisRecovery: analysisRecovery.value,
      })),
    },
  };
  const app = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}}=dependencies;\n${code}\nreturn {changeWorkspace,activeJobs,advanceSession(){analysisRecoveryGeneration++;},projectSwitchBlocked:typeof projectSwitchBlocked === "undefined" ? undefined : projectSwitchBlocked};`,
  )(dependencies) as {
    changeWorkspace: () => Promise<void>;
    activeJobs: { value: Job[] };
    advanceSession: () => void;
    projectSwitchBlocked?: { value: boolean };
  };
  const buttonDisabled = () => {
    const values = vue.proxyRefs({ ...dependencies, ...app });
    return new Function(
      "values",
      `const {${Object.keys(values).join(",")}}=values;return !!(${disabledExpression});`,
    )(values) as boolean;
  };
  return { ...dependencies, ...app, flush, originalProject, buttonDisabled };
}

describe("project navigation during analysis owned by another process", () => {
  it.each(
    ["transcribe", "waveform", "scenes"].flatMap((type) =>
      (["queued", "running"] as const).map((status) => ({ type, status })),
    ),
  )(
    "can leave a foreign $status $type without cancelling or recovering it",
    async ({ type, status }) => {
      const h = host([analysisJob(type, status)]);
      const before = JSON.stringify({
        job: h.jobs.value,
        recovery: h.analysisRecovery.value,
        project: h.originalProject,
      });
      expect(h.buttonDisabled()).toBe(false);
      await h.changeWorkspace();
      expect(h.post).toHaveBeenCalledExactlyOnceWith("/project/close");
      expect(h.project.value).toBeNull();
      expect(h.flush).toHaveBeenCalledOnce();
      expect(
        JSON.stringify({
          job: h.jobs.value,
          recovery: h.analysisRecovery.value,
          project: h.originalProject,
        }),
      ).toBe(before);
    },
  );

  it.each(["transcribe", "waveform", "scenes"])(
    "keeps local %s blocked even if owner metadata looks foreign",
    async (type) => {
      const h = host([analysisJob(type)], {
        ...foreignRecovery(),
        canCancel: true,
      });
      expect(h.buttonDisabled()).toBe(true);
      await h.changeWorkspace();
      expect(h.post).not.toHaveBeenCalled();
      expect(h.flush).not.toHaveBeenCalled();
    },
  );

  it.each(["unknown", "dead"] as const)(
    "can leave an %s owner without declaring it stopped",
    async (ownerState) => {
      const h = host([analysisJob()], {
        ...foreignRecovery(),
        ownerState,
        manualRecoveryAllowed: true,
      });
      expect(h.buttonDisabled()).toBe(false);
      await h.changeWorkspace();
      expect(h.post).toHaveBeenCalledExactlyOnceWith("/project/close");
      expect(h.jobs.value[0]!.status).toBe("running");
      expect(h.analysisRecovery.value["foreign-analysis"]!.ownerState).toBe(
        ownerState,
      );
    },
  );

  it("a local job still blocks a project containing foreign analysis", async () => {
    const h = host([
      analysisJob(),
      { id: "local-render", type: "render", status: "running" },
    ]);
    expect(h.buttonDisabled()).toBe(true);
    await h.changeWorkspace();
    expect(h.post).not.toHaveBeenCalled();
  });

  it.each(["render", "import", "review", "future-background-job"])(
    "retains the existing active %s restriction",
    async (type) => {
      const h = host([analysisJob(type)]);
      expect(h.buttonDisabled()).toBe(true);
      await h.changeWorkspace();
      expect(h.post).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "different-job"])(
    "waits for exact runtime controller evidence when it is %s",
    async (kind) => {
      const h = host(
        [analysisJob()],
        kind === "missing" ? undefined : foreignRecovery(),
      );
      if (kind === "different-job")
        h.analysisRecovery.value["foreign-analysis"] = {
          ...foreignRecovery(),
          jobId: "another-job",
        };
      else h.analysisRecovery.value = {};
      expect(h.buttonDisabled()).toBe(true);
      await h.changeWorkspace();
      expect(h.post).not.toHaveBeenCalled();
    },
  );

  it.each(["busy", "relinkBusy", "analysisRecoveryPending"] as const)(
    "preserves the pending %s barrier",
    async (barrier) => {
      const h = host();
      if (barrier === "busy") h.busy.value = "saving";
      else h[barrier].value = true;
      expect(h.buttonDisabled()).toBe(true);
      await h.changeWorkspace();
      expect(h.flush).not.toHaveBeenCalled();
      expect(h.post).not.toHaveBeenCalled();
    },
  );

  it("awaits editor draft persistence and retains the project after a save failure", async () => {
    const h = host();
    const saved = deferred<boolean>();
    h.flush.mockImplementation(() => saved.promise);
    const closing = h.changeWorkspace();
    expect(h.flush).toHaveBeenCalledOnce();
    expect(h.post).not.toHaveBeenCalled();
    saved.release(false);
    await closing;
    expect(h.post).not.toHaveBeenCalled();
    expect(h.project.value).not.toBeNull();
    expect(h.error.value).toBe("feedback.flushFailed");
  });

  it("also preserves an unsaved Story draft when its save fails", async () => {
    const h = host();
    h.beatDirty.value = true;
    h.saveBeat.mockResolvedValue(false);
    await h.changeWorkspace();
    expect(h.flush).toHaveBeenCalledOnce();
    expect(h.saveBeat).toHaveBeenCalledOnce();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.project.value).not.toBeNull();
  });

  it("rechecks ownership after flushing a draft before closing", async () => {
    const h = host();
    const saved = deferred<boolean>();
    h.flush.mockImplementation(() => saved.promise);
    const closing = h.changeWorkspace();
    h.analysisRecovery.value["foreign-analysis"] = {
      ...foreignRecovery(),
      canCancel: true,
    };
    saved.release(true);
    await closing;
    expect(h.post).not.toHaveBeenCalled();
    expect(h.project.value).not.toBeNull();
  });

  it("checks the fresh runtime job response after a submission finishes during flush", async () => {
    const h = host();
    const saved = deferred<boolean>();
    h.flush.mockImplementation(() => saved.promise);
    const closing = h.changeWorkspace();
    h.api.jobs.mockResolvedValue({
      jobs: [analysisJob()],
      analysisRecovery: {
        "foreign-analysis": { ...foreignRecovery(), canCancel: true },
      },
    });
    saved.release(true);
    await closing;
    expect(h.api.jobs).toHaveBeenCalledOnce();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.project.value).not.toBeNull();
  });

  it("does not close if the fresh authoritative job read fails", async () => {
    const h = host();
    const cause = new Error("Activity status disconnected");
    h.api.jobs.mockRejectedValue(cause);
    await h.changeWorkspace();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.project.value).not.toBeNull();
    expect(h.error.value).toBe(cause);
    expect(h.busy.value).toBe("");
  });

  it("requires explicit matching controller evidence in the fresh response too", async () => {
    const h = host();
    h.api.jobs.mockResolvedValue({
      jobs: [analysisJob()],
      analysisRecovery: {},
    });
    await h.changeWorkspace();
    expect(h.post).not.toHaveBeenCalled();
    expect(h.project.value).not.toBeNull();
  });

  it("keeps a pending recovery barrier that starts during the authoritative read", async () => {
    const h = host();
    const read = deferred<{
      jobs: Job[];
      analysisRecovery: Record<string, AnalysisJobRecoveryState>;
    }>();
    h.api.jobs.mockImplementation(() => read.promise);
    const closing = h.changeWorkspace();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.api.jobs).toHaveBeenCalledOnce();
    expect(h.buttonDisabled()).toBe(true);
    h.analysisRecoveryPending.value = true;
    read.release({
      jobs: [analysisJob()],
      analysisRecovery: { "foreign-analysis": foreignRecovery() },
    });
    await closing;
    expect(h.post).not.toHaveBeenCalled();
    expect(h.project.value).not.toBeNull();
  });

  it.each(["draft-flush", "job-read"])(
    "does not close a reopened session with the same project ID during %s",
    async (phase) => {
      const h = host();
      const saved = deferred<boolean>();
      const read = deferred<{
        jobs: Job[];
        analysisRecovery: Record<string, AnalysisJobRecoveryState>;
      }>();
      if (phase === "draft-flush")
        h.flush.mockImplementation(() => saved.promise);
      else h.api.jobs.mockImplementation(() => read.promise);
      const closing = h.changeWorkspace();
      for (let i = 0; i < 8; i++) await Promise.resolve();
      h.advanceSession();
      saved.release(true);
      read.release({ jobs: [], analysisRecovery: {} });
      await closing;
      expect(h.post).not.toHaveBeenCalled();
      expect(h.project.value).not.toBeNull();
    },
  );
});
