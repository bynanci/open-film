import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import type { Job } from "@openfilm/core";
import { ApiError } from "../../apps/desktop/src/api";

const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
const { ref } = desktopRequire("vue") as {
  ref: <T>(value: T) => { value: T };
};
const source = readFileSync(resolve("apps/desktop/src/App.vue"), "utf8");
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
type JobRead = ReturnType<typeof deferred<{ jobs: Job[] }>>;
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
  const project = ref<{ id: string } | null>({ id: "film" });
  const jobs = ref<Job[]>([current("running"), oldCancelled]);
  const error = ref<unknown>("");
  const notice = ref<unknown>(null);
  const requested = ref<string | null>(null);
  const busy = ref("");
  const dependencies = {
    api: {
      jobs: () => {
        const read = deferred<{ jobs: Job[] }>();
        reads.push(read);
        return read.promise;
      },
    },
    project,
    jobs,
    busy,
    error,
    notice,
    renderCancellationRequested: requested,
    cancellingJobs: ref<Record<string, boolean>>({}),
    flushPending: async () => true,
    activeComposition: ref({ id: "composition" }),
    editSerial: 0,
    post: (path: string) =>
      path.includes("/cancel") ? cancellation.promise : rendering.promise,
    message: (key: string) => key,
    reloadAssets: async () => {},
    refreshProject: async () => {},
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
    reads,
    rendering,
    cancellation,
    project,
    jobs,
    error,
    notice,
    requested,
    busy,
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
});
