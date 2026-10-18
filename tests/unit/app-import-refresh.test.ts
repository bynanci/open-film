// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import type { Job } from "@openfilm/core";

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
const { ref } = desktopRequire("vue") as {
  ref: <T>(value: T) => { value: T };
};
const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
const names = [
  "run",
  "resetJobView",
  "queueMediaRefresh",
  "refreshPendingMedia",
  "refreshInitialMedia",
  "beginImport",
  "importStarted",
  "refreshInitialJobs",
  "refreshJobs",
  "pollJobs",
];
function appFunction(name: string) {
  const declaration = source.includes(`async function ${name}(`)
    ? `async function ${name}(`
    : `function ${name}(`;
  const start = source.indexOf(declaration);
  const end = source.indexOf("\n}", start) + 2;
  if (start < 0 || end < 2) throw new Error(`Missing App function ${name}`);
  return source.slice(start, end);
}
// Execute the real App functions; replace only network requests and unrelated
// workspace reads so a fast import can deterministically outrun its first poll.
const code = transformSync(
  [
    'let jobsGeneration = 0, polling = false, lastJobSignature = "";',
    "let pendingMediaRefresh, mediaRefreshOwner;",
    "const EMPTY_ANALYSIS_RECOVERY = Object.freeze({});",
    ...names.map(appFunction),
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
type JobSnapshot = { jobs: Job[] };
const imported = (status: Job["status"] = "completed"): Job => ({
  id: "second-import",
  type: "import",
  status,
  progress: 1,
});
async function turn() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
function host(
  options: {
    onReload?: (attempt: number) => Promise<void> | void;
    onProject?: (attempt: number) => Promise<void>;
    onMediaStatus?: (attempt: number) => Promise<boolean>;
  } = {},
) {
  const reads: ReturnType<typeof deferred<JobSnapshot>>[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const acknowledgement = deferred<void>();
  const project = ref<{ id: string } | null>({ id: "our-film" });
  const jobs = ref<Job[]>([{ ...imported(), id: "first-import" }]);
  const refreshes = { assets: 0, project: 0, media: 0 };
  const importOpen = ref(true);
  const busy = ref("");
  const error = ref<unknown>("");
  const analysisRecovery = ref<Record<string, unknown>>({});
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
    importOpen,
    busy,
    error,
    notice: ref<unknown>(null),
    relinkBusy: ref(false),
    analysisRecovery,
    storyScriptReview: ref(null),
    post: (path: string, body: unknown) => {
      posts.push({ path, body });
      return acknowledgement.promise;
    },
    message: (key: string) => key,
    reloadAssets: () => {
      refreshes.assets++;
      return options.onReload?.(refreshes.assets) ?? Promise.resolve();
    },
    refreshProject: async () => {
      refreshes.project++;
      await options.onProject?.(refreshes.project);
    },
    checkMediaStatus: async () => {
      refreshes.media++;
      return (await options.onMediaStatus?.(refreshes.media)) ?? true;
    },
  };
  const app = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}} = dependencies;\n${code}\nreturn {${names.join(",")}};`,
  )(dependencies) as {
    beginImport: (folder: string) => Promise<void>;
    resetJobView: () => void;
    refreshInitialMedia: () => Promise<void>;
    refreshInitialJobs: () => Promise<void>;
    refreshJobs: (refreshImportedMedia?: boolean) => Promise<Job[] | undefined>;
    pollJobs: () => Promise<void>;
  };
  return {
    ...app,
    analysisRecovery,
    acknowledgement,
    reads,
    posts,
    project,
    jobs,
    importOpen,
    busy,
    error,
    refreshes,
  };
}

describe("App import completion refresh", () => {
  it.each(["completed", "failed", "cancelled"] as const)(
    "refreshes media when import already %s before its first jobs read",
    async (status) => {
      const h = host();
      const start = h.beginImport(" /media/second-folder ");
      expect(h.posts).toEqual([
        { path: "/import", body: { folder: "/media/second-folder" } },
      ]);
      h.acknowledgement.resolve();
      await turn();
      expect(h.reads).toHaveLength(1);
      h.reads[0]!.resolve({ jobs: [imported(status)] });
      await start;
      expect(h.jobs.value).toEqual([imported(status)]);
      expect(h.error.value).toBe("");
      expect(h.busy.value).toBe("");
      expect(h.importOpen.value).toBe(false);
      expect(h.refreshes).toEqual({ assets: 1, project: 1, media: 1 });

      // Publishing completion through refreshJobs must not consume the only
      // opportunity to load the newly added (or partially imported) assets.
      const poll = h.pollJobs();
      h.reads[1]!.resolve({ jobs: [imported(status)] });
      await poll;
      expect(h.refreshes).toEqual({ assets: 1, project: 1, media: 1 });
    },
  );

  it("refreshes once when a running import completes in the later poll", async () => {
    const h = host();
    const start = h.beginImport("/media/second-folder");
    h.acknowledgement.resolve();
    await turn();
    h.reads[0]!.resolve({ jobs: [imported("running")] });
    await start;
    expect(h.refreshes).toEqual({ assets: 0, project: 0, media: 0 });
    const poll = h.pollJobs();
    h.reads[1]!.resolve({ jobs: [imported()] });
    await poll;
    expect(h.refreshes).toEqual({ assets: 1, project: 1, media: 1 });
  });

  it("loads initial media once without a supplemental scan for historic imports", async () => {
    const h = host();
    h.resetJobView();
    const read = h.refreshInitialMedia();
    h.reads[0]!.resolve({ jobs: [imported()] });
    await read;
    expect(h.jobs.value).toEqual([imported()]);
    expect(h.refreshes).toEqual({ assets: 1, project: 0, media: 1 });
    const poll = h.pollJobs();
    h.reads[1]!.resolve({ jobs: [imported()] });
    await poll;
    expect(h.refreshes).toEqual({ assets: 1, project: 0, media: 1 });
  });

  it("keeps initial media loading available when jobs temporarily fail and retries polling", async () => {
    const h = host();
    h.analysisRecovery.value = { previousProject: { jobId: "old-owner" } };
    h.resetJobView();
    const initial = h.refreshInitialJobs();
    h.reads[0]!.reject(new Error("Temporary jobs endpoint failure"));
    await expect(initial).resolves.toBeUndefined();
    expect(h.jobs.value).toEqual([]);
    expect(h.analysisRecovery.value).toEqual({});
    expect(h.refreshes).toEqual({ assets: 0, project: 0, media: 0 });

    const retry = h.pollJobs();
    h.reads[1]!.resolve({ jobs: [imported()] });
    await retry;
    expect(h.jobs.value).toEqual([imported()]);
    expect(h.refreshes).toEqual({ assets: 1, project: 1, media: 1 });
  });

  it.each(["refreshJobs", "pollJobs"] as const)(
    "%s retries a media-status failure even after publishing import completion",
    async (method) => {
      const h = host({ onMediaStatus: async (attempt) => attempt > 1 });
      h.jobs.value = [imported("running")];
      const read = h[method]();
      h.reads[0]!.resolve({ jobs: [imported()] });
      await read;
      expect(h.jobs.value).toEqual([imported()]);
      const retry = h.pollJobs();
      h.reads[1]!.resolve({ jobs: [imported()] });
      await retry;
      expect(h.refreshes).toEqual({ assets: 2, project: 2, media: 2 });
    },
  );

  it("publishes render completion even if its auxiliary catalog read fails", async () => {
    const h = host({
      onReload: async () => {
        throw new Error("Media list temporarily unavailable");
      },
    });
    const render: Job = { id: "preview", type: "render", status: "running" };
    h.jobs.value = [render];
    const read = h.pollJobs();
    h.reads[0]!.resolve({ jobs: [{ ...render, status: "completed" }] });
    await read;
    expect(h.jobs.value[0]?.status).toBe("completed");
    expect(h.refreshes.assets).toBe(1);
  });

  it("does not scan all media statuses for running import progress", async () => {
    const h = host();
    h.jobs.value = [{ ...imported("running"), progress: 0.1 }];
    const progress = h.pollJobs();
    const updated = { ...imported("running"), progress: 0.5 };
    h.reads[0]!.resolve({ jobs: [updated] });
    await progress;
    expect(h.jobs.value).toEqual([updated]);
    expect(h.refreshes).toEqual({ assets: 1, project: 1, media: 0 });
    const completed = h.pollJobs();
    h.reads[1]!.resolve({ jobs: [imported()] });
    await completed;
    expect(h.refreshes).toEqual({ assets: 2, project: 2, media: 1 });
  });

  it("bounds overlapping import scans to one worker per project and retries newer pending work", async () => {
    const loadingAssets = deferred<void>();
    const h = host({ onReload: () => loadingAssets.promise });
    h.jobs.value = [imported("running")];
    const first = h.refreshJobs();
    h.reads[0]!.resolve({ jobs: [imported()] });
    await turn();
    const newerJob = { ...imported(), id: "third-import" };
    const newer = h.refreshJobs();
    h.reads[1]!.resolve({ jobs: [newerJob] });
    await newer;
    expect(h.refreshes).toEqual({ assets: 1, project: 0, media: 0 });
    loadingAssets.resolve();
    await first;
    const retry = h.pollJobs();
    h.reads[2]!.resolve({ jobs: [newerJob] });
    await retry;
    expect(h.jobs.value).toEqual([newerJob]);
    expect(h.refreshes).toEqual({ assets: 2, project: 1, media: 1 });
  });

  it("does not starve pending media refresh when an unrelated newer jobs read publishes", async () => {
    const loadingAssets = deferred<void>();
    const h = host({ onReload: () => loadingAssets.promise });
    h.jobs.value = [imported("running")];
    const first = h.refreshJobs();
    h.reads[0]!.resolve({ jobs: [imported()] });
    await turn();
    const latest: Job[] = [
      imported(),
      { id: "preview", type: "render", status: "running", progress: 0.3 },
    ];
    const newer = h.refreshJobs();
    h.reads[1]!.resolve({ jobs: latest });
    await newer;
    loadingAssets.resolve();
    await first;
    expect(h.jobs.value).toEqual(latest);
    expect(h.refreshes).toEqual({ assets: 1, project: 1, media: 1 });
  });

  it("retries failed initial source-status reads even when the project has no jobs", async () => {
    const h = host({ onMediaStatus: async (attempt) => attempt > 1 });
    h.resetJobView();
    const initial = h.refreshInitialMedia();
    h.reads[0]!.resolve({ jobs: [] });
    await initial;
    expect(h.refreshes).toEqual({ assets: 1, project: 0, media: 1 });
    const retry = h.pollJobs();
    h.reads[1]!.resolve({ jobs: [] });
    await retry;
    expect(h.refreshes).toEqual({ assets: 2, project: 1, media: 2 });
  });

  it("awaits an existing startup media worker before reporting initial media ready", async () => {
    const loadingAssets = deferred<void>();
    const h = host({ onReload: () => loadingAssets.promise });
    h.resetJobView();
    let ready = false;
    const initial = h.refreshInitialMedia().then(() => {
      ready = true;
    });
    const poll = h.pollJobs();
    h.reads[1]!.resolve({ jobs: [imported()] });
    await turn();
    h.reads[0]!.resolve({ jobs: [imported()] });
    await turn();
    const readyBeforeAssets = ready;
    loadingAssets.resolve();
    await Promise.all([initial, poll]);
    expect(readyBeforeAssets).toBe(false);
    expect(ready).toBe(true);
    expect(h.refreshes.assets).toBe(1);
  });

  it("bounds startup attempts with persistent source-status failure and keeps retrying in the background", async () => {
    const loadingAssets = deferred<void>();
    const h = host({
      onReload: (attempt) =>
        attempt === 1 ? loadingAssets.promise : Promise.resolve(),
      onMediaStatus: async () => false,
    });
    h.resetJobView();
    const initial = h.refreshInitialMedia();
    const poll = h.pollJobs();
    h.reads[1]!.resolve({ jobs: [imported()] });
    await turn();
    h.reads[0]!.resolve({ jobs: [imported()] });
    await turn();
    loadingAssets.resolve();
    await Promise.all([initial, poll]);
    expect(h.refreshes).toEqual({ assets: 2, project: 1, media: 2 });
    const retry = h.pollJobs();
    h.reads[2]!.resolve({ jobs: [imported()] });
    await retry;
    expect(h.refreshes).toEqual({ assets: 3, project: 2, media: 3 });
  });

  it("releases a worker after synchronous I/O throws so the next poll can retry", async () => {
    const h = host({
      onReload: (attempt) => {
        if (attempt === 1) throw new Error("Synchronous I/O failure");
      },
    });
    h.jobs.value = [imported("running")];
    const initial = h.refreshJobs();
    h.reads[0]!.resolve({ jobs: [imported()] });
    await initial;
    expect(h.jobs.value).toEqual([imported()]);
    const retry = h.pollJobs();
    h.reads[1]!.resolve({ jobs: [imported()] });
    await retry;
    expect(h.refreshes).toEqual({ assets: 2, project: 1, media: 1 });
  });

  it("does not refresh the catalog for a superseded jobs response", async () => {
    const h = host();
    const older = h.refreshJobs();
    const newer = h.refreshJobs();
    h.reads[1]!.resolve({ jobs: [imported()] });
    await newer;
    h.reads[0]!.resolve({ jobs: [imported("failed")] });
    await older;
    expect(h.jobs.value).toEqual([imported()]);
    expect(h.refreshes).toEqual({ assets: 1, project: 1, media: 1 });
  });

  it("ignores completion from a project that no longer owns the response", async () => {
    const h = host();
    const read = h.refreshJobs();
    h.project.value = { id: "another-film" };
    h.reads[0]!.resolve({ jobs: [imported()] });
    expect(await read).toBeUndefined();
    expect(h.jobs.value[0]?.id).toBe("first-import");
    expect(h.refreshes).toEqual({ assets: 0, project: 0, media: 0 });
  });

  it.each(["refreshJobs", "pollJobs"] as const)(
    "%s retries an import media refresh after the first assets read fails",
    async (method) => {
      const h = host({
        onReload: async (attempt) => {
          if (attempt === 1) throw new Error("Transient media disconnect");
        },
      });
      h.jobs.value = [imported("running")];
      const failedRead = h[method]().catch(() => undefined);
      h.reads[0]!.resolve({ jobs: [imported()] });
      await failedRead;
      const afterFailure = h.jobs.value.map((job) => ({ ...job }));

      const retry = h.pollJobs();
      h.reads[1]!.resolve({ jobs: [imported()] });
      await retry;
      expect(h.refreshes).toEqual({ assets: 2, project: 1, media: 1 });
      expect(afterFailure).toEqual([imported()]);
      expect(h.jobs.value).toEqual([imported()]);

      const settled = h.pollJobs();
      h.reads[2]!.resolve({ jobs: [imported()] });
      await settled;
      expect(h.refreshes).toEqual({ assets: 2, project: 1, media: 1 });
    },
  );

  it.each(["refreshJobs", "pollJobs"] as const)(
    "%s retries when its project refresh fails after assets were loaded",
    async (method) => {
      const h = host({
        onProject: async (attempt) => {
          if (attempt === 1) throw new Error("Temporary project read failure");
        },
      });
      h.jobs.value = [imported("running")];
      const read = h[method]();
      h.reads[0]!.resolve({ jobs: [imported()] });
      await read;
      expect(h.jobs.value).toEqual([imported()]);
      const retry = h.pollJobs();
      h.reads[1]!.resolve({ jobs: [imported()] });
      await retry;
      expect(h.refreshes).toEqual({ assets: 2, project: 2, media: 1 });
    },
  );

  it("an old project's worker cannot release or clear the new project's worker", async () => {
    const oldAssets = deferred<void>();
    const newAssets = deferred<void>();
    const h = host({
      onReload: (attempt) =>
        attempt === 1 ? oldAssets.promise : newAssets.promise,
    });
    h.jobs.value = [imported("running")];
    const previous = h.refreshJobs();
    h.reads[0]!.resolve({ jobs: [imported()] });
    await turn();
    h.project.value = { id: "another-film" };
    h.resetJobView();
    const newerJob = { ...imported(), id: "new-film-import" };
    const current = h.refreshJobs();
    h.reads[1]!.resolve({ jobs: [newerJob] });
    await turn();
    oldAssets.resolve();
    await previous;
    const overlapping = h.refreshJobs();
    h.reads[2]!.resolve({ jobs: [newerJob] });
    await overlapping;
    expect(h.refreshes).toEqual({ assets: 2, project: 0, media: 0 });
    newAssets.resolve();
    await current;
    expect(h.jobs.value).toEqual([newerJob]);
    expect(h.refreshes).toEqual({ assets: 2, project: 1, media: 1 });
  });

  it.each(["refreshJobs", "pollJobs"] as const)(
    "%s publishes terminal import state while its independent assets refresh is pending",
    async (method) => {
      const loadingAssets = deferred<void>();
      const h = host({ onReload: () => loadingAssets.promise });
      h.jobs.value = [imported("running")];
      const pending = h[method]();
      h.reads[0]!.resolve({ jobs: [imported()] });
      await turn();
      const whileLoading = h.jobs.value.map((job) => ({ ...job }));
      loadingAssets.resolve();
      await pending;
      expect(whileLoading).toEqual([imported()]);
      expect(h.jobs.value).toEqual([imported()]);
      expect(h.refreshes).toEqual({ assets: 1, project: 1, media: 1 });
    },
  );

  it.each(["refreshJobs", "pollJobs"] as const)(
    "%s cannot republish completion after project reset during media refresh",
    async (method) => {
      const loadingAssets = deferred<void>();
      const h = host({ onReload: () => loadingAssets.promise });
      h.jobs.value = [imported("running")];
      const pending = h[method]();
      h.reads[0]!.resolve({ jobs: [imported()] });
      await turn();
      h.project.value = { id: "another-film" };
      h.resetJobView();
      loadingAssets.resolve();
      await pending;
      expect(h.jobs.value).toEqual([]);
      expect(h.refreshes).toEqual({ assets: 1, project: 0, media: 0 });
    },
  );

  it.each(["refreshJobs", "pollJobs"] as const)(
    "%s cannot clear a newer import's pending refresh from an old asset read",
    async (method) => {
      const loadingAssets = deferred<void>();
      const h = host({ onReload: () => loadingAssets.promise });
      h.jobs.value = [imported("running")];
      const pending = h[method]();
      h.reads[0]!.resolve({ jobs: [imported()] });
      await turn();
      const newerJob = { ...imported(), id: "third-import" };
      const newer = h.refreshJobs(false);
      h.reads[1]!.resolve({ jobs: [newerJob] });
      await newer;
      loadingAssets.resolve();
      await pending;
      expect(h.jobs.value).toEqual([newerJob]);
      expect(h.refreshes).toEqual({ assets: 1, project: 0, media: 0 });
      const retry = h.pollJobs();
      h.reads[2]!.resolve({ jobs: [newerJob] });
      await retry;
      expect(h.refreshes).toEqual({ assets: 2, project: 1, media: 1 });
    },
  );

  it.each(["refreshJobs", "pollJobs"] as const)(
    "%s publishes render progress without catalog or project reloads",
    async (method) => {
      const h = host();
      h.jobs.value = [{ id: "preview", type: "render", status: "running" }];
      const read = h[method]();
      h.reads[0]!.resolve({
        jobs: [{ ...h.jobs.value[0]!, progress: 0.42 }],
      });
      await read;
      expect(h.jobs.value[0]?.progress).toBe(0.42);
      expect(h.refreshes).toEqual({ assets: 0, project: 0, media: 0 });
    },
  );
});

const statusCode = transformSync(appFunction("checkMediaStatus"), {
  loader: "ts",
  format: "esm",
}).code;
function statusHost(reloadAssets: () => Promise<void> = async () => {}) {
  const reads: ReturnType<typeof deferred<unknown>>[] = [];
  const project = ref<{ id: string } | null>({ id: "our-film" });
  const mediaStatus = ref<unknown>({ prior: true });
  const mediaStatusError = ref<unknown>("");
  const checkingMedia = ref(false);
  const libraryFilter = ref("all");
  const dependencies = {
    project,
    mediaStatus,
    mediaStatusError,
    checkingMedia,
    libraryFilter,
    api: {
      mediaStatus: () => {
        const read = deferred<unknown>();
        reads.push(read);
        return read.promise;
      },
    },
    reloadAssets,
  };
  const checkMediaStatus = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}} = dependencies;\nlet statusGeneration = 0;\n${statusCode}\nreturn checkMediaStatus;`,
  )(dependencies) as () => Promise<boolean>;
  return {
    checkMediaStatus,
    reads,
    project,
    mediaStatus,
    mediaStatusError,
    checkingMedia,
    dependencies,
  };
}

describe("App media-status success contract", () => {
  it("returns false with its inline error and preserves prior status until a retry succeeds", async () => {
    const h = statusHost();
    const error = new Error("Disk status unavailable");
    const failed = h.checkMediaStatus();
    h.reads[0]!.reject(error);
    expect(await failed).toBe(false);
    expect(h.mediaStatus.value).toEqual({ prior: true });
    expect(h.mediaStatusError.value).toBe(error);
    expect(h.checkingMedia.value).toBe(false);
    const retry = h.checkMediaStatus();
    const latest = { offline: 0 };
    h.reads[1]!.resolve(latest);
    expect(await retry).toBe(true);
    expect(h.mediaStatus.value).toEqual(latest);
    expect(h.mediaStatusError.value).toBe("");
  });

  it("does not acknowledge or publish an old project's status", async () => {
    const h = statusHost();
    const previous = h.checkMediaStatus();
    h.project.value = { id: "another-film" };
    h.reads[0]!.resolve({ stale: true });
    expect(await previous).toBe(false);
    expect(h.mediaStatus.value).toEqual({ prior: true });
  });

  it("only acknowledges the latest status request in the same project", async () => {
    const h = statusHost();
    const previous = h.checkMediaStatus();
    const latest = h.checkMediaStatus();
    h.reads[1]!.resolve({ latest: true });
    expect(await latest).toBe(true);
    h.reads[0]!.resolve({ stale: true });
    expect(await previous).toBe(false);
    expect(h.mediaStatus.value).toEqual({ latest: true });
  });

  it("does not acknowledge a failed missing-media Library refresh", async () => {
    const error = new Error("Missing media page unavailable");
    const h = statusHost(async () => {
      throw error;
    });
    h.dependencies.libraryFilter.value = "missing";
    const pending = h.checkMediaStatus();
    h.reads[0]!.resolve({ missing: 2 });
    expect(await pending).toBe(false);
    expect(h.mediaStatusError.value).toBe(error);
  });

  it("returns false without reading when no project is open", async () => {
    const h = statusHost();
    h.project.value = null;
    expect(await h.checkMediaStatus()).toBe(false);
    expect(h.reads).toHaveLength(0);
  });
});

it("checks pending refresh ownership inside the actual delayed project assignment", async () => {
  const response = deferred<{ project: { id: string }; path: string }>();
  const project = ref({ id: "our-film" });
  const projectPath = ref("/our-film.openfilm");
  const connected = ref(false);
  const dependencies = {
    api: { project: () => response.promise },
    project,
    projectPath,
    connected,
  };
  const projectCode = transformSync(appFunction("refreshProject"), {
    loader: "ts",
    format: "esm",
  }).code;
  const refreshProject = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}} = dependencies;\nlet projectMutationVersion = 0;\n${projectCode}\nreturn refreshProject;`,
  )(dependencies) as (owned: () => boolean) => Promise<void>;
  const oldRead = refreshProject(() => project.value.id === "our-film");
  project.value = { id: "another-film" };
  projectPath.value = "/another-film.openfilm";
  response.resolve({ project: { id: "our-film" }, path: "/our-film.openfilm" });
  await oldRead;
  expect(project.value.id).toBe("another-film");
  expect(projectPath.value).toBe("/another-film.openfilm");
  expect(connected.value).toBe(false);
});
