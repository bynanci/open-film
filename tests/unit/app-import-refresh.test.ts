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
  "beginImport",
  "importStarted",
  "refreshJobs",
  "pollJobs",
];
// Execute the real App functions; replace only network requests and unrelated
// workspace reads so a fast import can deterministically outrun its first poll.
const code = transformSync(
  [
    'let jobsGeneration = 0, polling = false, lastJobSignature = "";',
    "const EMPTY_ANALYSIS_RECOVERY = Object.freeze({});",
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
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
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
function host() {
  const reads: ReturnType<typeof deferred<JobSnapshot>>[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const acknowledgement = deferred<void>();
  const project = ref<{ id: string } | null>({ id: "our-film" });
  const jobs = ref<Job[]>([{ ...imported(), id: "first-import" }]);
  const refreshes = { assets: 0, project: 0, media: 0 };
  const importOpen = ref(true);
  const busy = ref("");
  const error = ref<unknown>("");
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
    analysisRecovery: ref({}),
    storyScriptReview: ref(null),
    post: (path: string, body: unknown) => {
      posts.push({ path, body });
      return acknowledgement.promise;
    },
    message: (key: string) => key,
    reloadAssets: async () => {
      refreshes.assets++;
    },
    refreshProject: async () => {
      refreshes.project++;
    },
    checkMediaStatus: async () => {
      refreshes.media++;
    },
  };
  const app = new Function(
    "dependencies",
    `const {${Object.keys(dependencies).join(",")}} = dependencies;\n${code}\nreturn {${names.join(",")}};`,
  )(dependencies) as {
    beginImport: (folder: string) => Promise<void>;
    refreshJobs: (refreshImportedMedia?: boolean) => Promise<Job[] | undefined>;
    pollJobs: () => Promise<void>;
  };
  return {
    ...app,
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

  it("lets startup read jobs before its own media load without a duplicate scan", async () => {
    const h = host();
    const read = h.refreshJobs(false);
    h.reads[0]!.resolve({ jobs: [imported()] });
    await read;
    expect(h.jobs.value).toEqual([imported()]);
    expect(h.refreshes).toEqual({ assets: 0, project: 0, media: 0 });
    const poll = h.pollJobs();
    h.reads[1]!.resolve({ jobs: [imported()] });
    await poll;
    expect(h.refreshes).toEqual({ assets: 0, project: 0, media: 0 });
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
