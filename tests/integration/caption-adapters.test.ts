import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

vi.mock("@openfilm/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openfilm/media")>();
  return { ...actual, hashFile: vi.fn(actual.hashFile) };
});
const actualMedia =
  await vi.importActual<typeof import("@openfilm/media")>("@openfilm/media");
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(actual.rm) };
});
const actualFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  vi.mocked(hashFile).mockImplementation(actualMedia.hashFile);
  vi.mocked(rm).mockImplementation(actualFs.rm);
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(clipCount = 1) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-caption-adapters-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "回憶 # &.wav");
  await writeFile(source, "Immutable identity fixture, no ASR claim.");
  const sourceHash = await hashFile(source);
  const directory = join(root, "film.openfilm");
  const runtime = { userDataDirectory: join(root, "preferences") };
  const app = await OpenFilmApplication.create(
    directory,
    "Captions",
    {},
    runtime,
  );
  app.catalog.upsertAsset({
    id: "spoken",
    uri: pathToFileURL(source).href,
    name: "回憶 # &.wav",
    mediaType: "audio",
    duration: 10,
    contentHash: sourceHash,
    tags: [],
    state: {},
    metadata: {},
  });
  app.catalog.intelligence.replaceTranscript({
    id: "speech",
    assetId: "spoken",
    language: "zh",
    provenance: {
      providerId: "fixture",
      version: "1",
      sourceHash,
      createdAt: "2026-10-08T00:00:00Z",
    },
    segments: [{ id: "line", start: 2, end: 4, text: "十河田湖" }],
  });
  const transcript = await app.transcriptEditor.get("spoken");
  const edited = await app.transcriptEditor.edit("spoken", {
    baseRevision: transcript.revision!,
    requestId: "correction",
    commands: [{ type: "replace-text", segmentId: "line", text: "十和田湖" }],
  });
  app.project.stories = [{ id: "story", title: "Memories", beats: [] }];
  app.project.timelines = [
    {
      id: "film",
      storyId: "story",
      duration: 6 + clipCount * 2,
      tracks: [
        {
          id: "voice",
          type: "audio",
          clips: Array.from({ length: clipCount }, (_, index) => ({
            id: clipCount === 1 ? "clip" : `clip-${index}`,
            assetId: "spoken",
            sourceIn: 2,
            sourceOut: 6,
            timelineStart: 3 + index * 2,
            timelineDuration: 2,
            transform: { speed: 2 },
          })),
        },
      ],
    },
  ];
  await app.save();
  const revision = new TimelineEditor(app).get("film").revision;
  const projectId = app.project.id;
  app.close();
  return {
    root,
    directory,
    runtime,
    source,
    sourceHash,
    projectId,
    revision,
    transcriptRevision: edited.revision,
  };
}

async function captionServer() {
  const f = await fixture();
  const app = await OpenFilmApplication.openForExport(f.directory, f.runtime);
  const snapshot = await app.captions.prepare({
    projectId: f.projectId,
    compositionId: "film",
    trackId: "voice",
    baseRevision: f.revision,
  });
  app.close();
  const server = await startServer({
    port: 0,
    project: f.directory,
    ...f.runtime,
  });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}/api`;
  const post = (route: string, data: unknown = {}) =>
    fetch(`${base}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  return { ...f, snapshot, server, base, post };
}

function holdSourceHash(source: string) {
  let release = () => {};
  let notify = () => {};
  const entered = new Promise<void>((resolve) => {
    notify = resolve;
  });
  vi.mocked(hashFile).mockImplementation(async (path, signal) => {
    if (path === source) {
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      notify();
      await held;
    }
    return actualMedia.hashFile(path, signal);
  });
  return { entered, release: () => release() };
}

async function slowPost(
  server: Awaited<ReturnType<typeof startServer>>,
  path: string,
  data: unknown,
) {
  const bytes = JSON.stringify(data);
  let notify = () => {};
  const received = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const observe = (request: import("node:http").IncomingMessage) => {
    if (request.url === path && request.method === "POST") {
      server.server.removeListener("request", observe);
      notify();
    }
  };
  server.server.on("request", observe);
  let resolveResponse!: (value: { status: number; body: unknown }) => void;
  let rejectResponse!: (error: Error) => void;
  const response = new Promise<{ status: number; body: unknown }>(
    (resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    },
  );
  const request = httpRequest(
    {
      hostname: "127.0.0.1",
      port: server.port,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bytes),
      },
    },
    async (incoming) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        resolveResponse({
          status: incoming.statusCode!,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
      } catch (error) {
        rejectResponse(error as Error);
      }
    },
  );
  request.on("error", rejectResponse);
  request.write(bytes.slice(0, 1));
  await received;
  // Let the route reach its body await without ever completing that body.
  await yieldEventLoop();
  return { finish: () => request.end(bytes.slice(1)), response };
}

it("HTTP previews corrected composition timing, exports a receipt and rejects foreign project requests", async () => {
  const f = await fixture();
  const server = await startServer({
    port: 0,
    project: f.directory,
    ...f.runtime,
  });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}/api/captions`;
  const post = (path: string, value: unknown) =>
    fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  const context = await fetch(
    `${base}/context?${new URLSearchParams({ projectId: f.projectId, compositionId: "film" })}`,
  );
  expect(context.status).toBe(200);
  expect(await context.json()).toMatchObject({ revision: f.revision });
  const response = await post("prepare", {
    projectId: f.projectId,
    compositionId: "film",
    trackId: "voice",
    baseRevision: f.revision,
  });
  expect(response.status).toBe(200);
  const snapshot = await response.json();
  expect(snapshot.cues).toHaveLength(1);
  expect(snapshot.cues[0]).toMatchObject({
    startMs: 3000,
    endMs: 4000,
    text: "十和田湖",
    transcriptRevisionId: f.transcriptRevision,
  });
  const exported = await post("export", {
    projectId: f.projectId,
    snapshotId: snapshot.id,
    format: "srt",
  });
  expect(exported.status).toBe(200);
  const publication = await exported.json();
  const file = await fetch(
    `${base}/file?${new URLSearchParams({ projectId: f.projectId, id: publication.id, kind: "captions" })}`,
  );
  expect(file.status).toBe(200);
  expect(await file.text()).toContain(
    "00:00:03,000 --> 00:00:04,000\n十和田湖",
  );
  const manifest = await fetch(
    `${base}/file?${new URLSearchParams({ projectId: f.projectId, id: publication.id, kind: "manifest" })}`,
  );
  expect(manifest.status).toBe(200);
  expect(JSON.stringify(await manifest.json())).toContain(f.transcriptRevision);
  const foreign = await post("export", {
    projectId: "another-project",
    snapshotId: snapshot.id,
    format: "srt",
  });
  expect(foreign.status).toBe(409);
  expect((await foreign.json()).code).toBe("captions.stale");
  const unsafe = await fetch(
    `${base}/file?${new URLSearchParams({ projectId: f.projectId, id: "../project", kind: "captions" })}`,
  );
  expect(unsafe.status).toBeGreaterThanOrEqual(400);
  expect(await hashFile(f.source)).toBe(f.sourceHash);
});

it("CLI prepares and exports the same snapshot without another transcription or timeline mutation", async () => {
  const f = await fixture();
  const projectBefore = JSON.parse(
    await readFile(join(f.directory, "project.json"), "utf8"),
  );
  const cli = (...args: string[]) =>
    runProcess(process.execPath, [
      "--import",
      "tsx",
      resolve("apps/cli/src/index.ts"),
      "captions",
      ...args,
      "--project",
      f.directory,
      "--user-data-dir",
      f.runtime.userDataDirectory,
    ]);
  const prepared = await cli(
    "prepare",
    "--composition",
    "film",
    "--track",
    "voice",
  );
  const snapshot = JSON.parse(prepared.stdout.toString("utf8"));
  expect(snapshot.cues[0]).toMatchObject({
    startMs: 3000,
    endMs: 4000,
    text: "十和田湖",
  });
  const exported = JSON.parse(
    (await cli("export", snapshot.id, "--format", "vtt")).stdout.toString(
      "utf8",
    ),
  );
  expect(
    await readFile(join(f.directory, exported.relativePath), "utf8"),
  ).toContain("00:00:03.000 --> 00:00:04.000");
  const projectAfter = JSON.parse(
    await readFile(join(f.directory, "project.json"), "utf8"),
  );
  // The export session must not rewrite even updatedAt or recover unrelated jobs.
  expect(projectAfter).toEqual(projectBefore);
  expect(await hashFile(f.source)).toBe(f.sourceHash);
});

it("CLI pages more than 200 caption warnings independently of cue pages and validates warning bounds", async () => {
  const f = await fixture(250);
  const cli = (...args: string[]) =>
    runProcess(process.execPath, [
      "--import",
      "tsx",
      resolve("apps/cli/src/index.ts"),
      "captions",
      ...args,
      "--project",
      f.directory,
      "--user-data-dir",
      f.runtime.userDataDirectory,
    ]);
  const prepared = await cli(
    "prepare",
    "--composition",
    "film",
    "--track",
    "voice",
  );
  const snapshot = JSON.parse(prepared.stdout.toString("utf8"));
  expect(snapshot.issueCount).toBe(250);
  const later = JSON.parse(
    (
      await cli(
        "get",
        snapshot.id,
        "--offset",
        "5",
        "--limit",
        "3",
        "--issue-offset",
        "205",
        "--issue-limit",
        "7",
      )
    ).stdout.toString("utf8"),
  );
  expect(later.issueCount).toBe(250);
  expect(later.cues.map((cue: { clipId: string }) => cue.clipId)).toEqual([
    "clip-5",
    "clip-6",
    "clip-7",
  ]);
  expect(later.issues.map((issue: { clipId: string }) => issue.clipId)).toEqual(
    Array.from({ length: 7 }, (_, index) => `clip-${205 + index}`),
  );
  expect(later).toMatchObject({
    offset: 5,
    limit: 3,
    issueOffset: 205,
    issueLimit: 7,
  });
  for (const [option, value] of [
    ["--issue-offset", "-1"],
    ["--issue-offset", "0.5"],
    ["--issue-limit", "0"],
    ["--issue-limit", "201"],
    ["--issue-limit", "invalid"],
  ])
    await expect(cli("get", snapshot.id, option!, value!)).rejects.toThrow(
      "captions.invalid",
    );
  const help = await cli("--help");
  expect(help.stdout.toString("utf8")).toContain("--issue-offset");
  expect(help.stdout.toString("utf8")).toContain("--issue-limit");
});

it.each(["prepare", "export", "snapshot"] as const)(
  "server shutdown cancels the active caption %s request and waits for its cleanup without creating jobs",
  async (operation) => {
    const f = await fixture();
    const opened = await OpenFilmApplication.openForExport(
      f.directory,
      f.runtime,
    );
    const snapshot = await opened.captions.prepare({
      projectId: f.projectId,
      compositionId: "film",
      trackId: "voice",
      baseRevision: f.revision,
    });
    opened.close();
    const cacheBefore = await readdir(join(f.directory, "cache", "captions"));
    const server = await startServer({
      port: 0,
      project: f.directory,
      ...f.runtime,
    });
    let closed = false;
    cleanup.push(async () => {
      if (!closed) await server.close();
    });
    let releaseHash: () => void = () => {};
    let notifyStarted: (signal: AbortSignal) => void = () => {};
    const started = new Promise<AbortSignal>((resolve) => {
      notifyStarted = resolve;
    });
    vi.mocked(hashFile).mockImplementation(async (path, signal) => {
      if (path === f.source) {
        const held = new Promise<void>((resolve) => {
          releaseHash = resolve;
        });
        notifyStarted(signal!);
        await held;
      }
      return actualMedia.hashFile(path, signal);
    });
    const base = `http://127.0.0.1:${server.port}/api`;
    const request =
      operation === "snapshot"
        ? fetch(
            `${base}/captions/snapshot?${new URLSearchParams({ projectId: f.projectId, id: snapshot.id })}`,
          )
        : fetch(`${base}/captions/${operation}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              operation === "prepare"
                ? {
                    projectId: f.projectId,
                    compositionId: "film",
                    trackId: "voice",
                    baseRevision: f.revision,
                  }
                : {
                    projectId: f.projectId,
                    snapshotId: snapshot.id,
                    format: "srt",
                  },
            ),
          });
    // Observe rejection immediately, so shutdown-induced disconnect cannot create
    // an unhandled client rejection while the cleanup barrier is still held.
    const settledRequest = request.then(
      async (response) => ({
        status: response.status,
        body: await response.text(),
      }),
      () => ({ disconnected: true }),
    );
    const signal = await started;
    const jobs = await fetch(`${base}/jobs`);
    expect((await jobs.json()).jobs).toEqual([]);
    let shutdownSettled = false;
    const shuttingDown = server.close().then(() => {
      closed = true;
      shutdownSettled = true;
    });
    try {
      // close() reaches controller.abort() synchronously before awaiting work.
      // This fails before the fix without a timing-sensitive timeout or sleep.
      expect(signal.aborted).toBe(true);
      await yieldEventLoop();
      expect(shutdownSettled).toBe(false);
    } finally {
      releaseHash();
      await shuttingDown;
      await settledRequest;
    }
    expect(await readdir(join(f.directory, "exports"))).toEqual([]);
    expect(await readdir(join(f.directory, "cache", "captions"))).toEqual(
      cacheBefore,
    );
    vi.mocked(hashFile).mockImplementation(actualMedia.hashFile);
    const reopened = await OpenFilmApplication.openForExport(
      f.directory,
      f.runtime,
    );
    expect(reopened.catalog.listJobs()).toEqual([]);
    expect(
      (await reopened.captions.get(snapshot.id, { projectId: f.projectId }))
        .stale,
    ).toBe(false);
    reopened.close();
  },
);

it.each(["open", "create"] as const)(
  "a slow project %s body cannot close the catalog captured by a later caption read",
  async (operation) => {
    const f = await captionServer();
    const destination = join(f.root, "next.openfilm");
    if (operation === "open") {
      const next = await OpenFilmApplication.create(
        destination,
        "Next",
        {},
        f.runtime,
      );
      next.close();
    }
    const data = {
      path: destination,
      ...(operation === "create" ? { title: "Next" } : {}),
    };
    const pending = await slowPost(f.server, `/api/project/${operation}`, data);
    const held = holdSourceHash(f.source);
    const caption = fetch(
      `${f.base}/captions/snapshot?${new URLSearchParams({ projectId: f.projectId, id: f.snapshot.id })}`,
    );
    await held.entered;
    try {
      pending.finish();
      expect((await pending.response).status).toBe(409);
      expect((await (await fetch(`${f.base}/project`)).json()).project.id).toBe(
        f.projectId,
      );
    } finally {
      held.release();
      await caption.catch(() => undefined);
    }
    const response = await caption;
    expect(response.status).toBe(200);
    expect((await response.json()).stale).toBe(false);
    expect((await f.post(`/project/${operation}`, data)).status).toBe(200);
  },
);

it.each(["open", "create", "close"] as const)(
  "an earlier caption read keeps its catalog open when project %s is requested",
  async (operation) => {
    const f = await captionServer();
    const destination = join(f.root, "next.openfilm");
    if (operation === "open") {
      const next = await OpenFilmApplication.create(
        destination,
        "Next",
        {},
        f.runtime,
      );
      next.close();
    }
    const data =
      operation === "close"
        ? {}
        : {
            path: destination,
            ...(operation === "create" ? { title: "Next" } : {}),
          };
    const held = holdSourceHash(f.source);
    const caption = fetch(
      `${f.base}/captions/snapshot?${new URLSearchParams({ projectId: f.projectId, id: f.snapshot.id })}`,
    );
    await held.entered;
    try {
      expect((await f.post(`/project/${operation}`, data)).status).toBe(409);
    } finally {
      held.release();
      await caption.catch(() => undefined);
    }
    const response = await caption;
    expect(response.status).toBe(200);
    expect((await response.json()).stale).toBe(false);
    expect((await f.post(`/project/${operation}`, data)).status).toBe(200);
  },
);

it.each(["close", "open", "create"] as const)(
  "project %s rechecks caption ownership after asynchronous upload cleanup",
  async (operation) => {
    const f = await captionServer();
    const destination = join(f.root, "next.openfilm");
    if (operation === "open") {
      const next = await OpenFilmApplication.create(
        destination,
        "Next",
        {},
        f.runtime,
      );
      next.close();
    }
    const data =
      operation === "close"
        ? {}
        : {
            path: destination,
            ...(operation === "create" ? { title: "Next" } : {}),
          };
    const uploaded = await fetch(`${f.base}/import/upload?name=pending.wav`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: "unindexed upload",
    });
    expect(uploaded.status).toBe(201);
    const { uploadId } = await uploaded.json();
    const uploadDirectory = join(f.directory, "sources", uploadId);
    let releaseCleanup = () => {};
    let notifyCleanup = () => {};
    const cleanupStarted = new Promise<void>((resolve) => {
      notifyCleanup = resolve;
    });
    vi.mocked(rm).mockImplementation(async (...args) => {
      if (String(args[0]) === uploadDirectory) {
        const held = new Promise<void>((resolve) => {
          releaseCleanup = resolve;
        });
        notifyCleanup();
        await held;
      }
      return actualFs.rm(...args);
    });
    const closing = f.post(`/project/${operation}`, data);
    await cleanupStarted;
    const held = holdSourceHash(f.source);
    const caption = fetch(
      `${f.base}/captions/snapshot?${new URLSearchParams({ projectId: f.projectId, id: f.snapshot.id })}`,
    );
    await held.entered;
    releaseCleanup();
    try {
      expect((await closing).status).toBe(409);
    } finally {
      held.release();
      await caption.catch(() => undefined);
    }
    const response = await caption;
    expect(response.status).toBe(200);
    expect((await response.json()).stale).toBe(false);
    expect((await f.post(`/project/${operation}`, data)).status).toBe(200);
  },
);

it("HTTP pages clip provenance independently past its first 200 records", async () => {
  const f = await fixture(250);
  const app = await OpenFilmApplication.openForExport(f.directory, f.runtime);
  const snapshot = await app.captions.prepare({
    projectId: f.projectId,
    compositionId: "film",
    trackId: "voice",
    baseRevision: f.revision,
  });
  app.close();
  const server = await startServer({
    port: 0,
    project: f.directory,
    ...f.runtime,
  });
  cleanup.push(() => server.close());
  const params = new URLSearchParams({
    projectId: f.projectId,
    id: snapshot.id,
    offset: "3",
    limit: "2",
    clipOffset: "205",
    clipLimit: "3",
    sourceOffset: "0",
    sourceLimit: "1",
  });
  const url = `http://127.0.0.1:${server.port}/api/captions/snapshot`;
  const response = await fetch(`${url}?${params}`);
  expect(response.status).toBe(200);
  const page = await response.json();
  expect(page.clipBindings.map((clip: { id: string }) => clip.id)).toEqual([
    "clip-205",
    "clip-206",
    "clip-207",
  ]);
  expect(page.cues.map((cue: { clipId: string }) => cue.clipId)).toEqual([
    "clip-3",
    "clip-4",
  ]);
  expect(page.sources).toHaveLength(1);
  expect(page).toMatchObject({
    clipCount: 250,
    clipOffset: 205,
    clipLimit: 3,
    sourceOffset: 0,
    sourceLimit: 1,
  });
  for (const [field, value] of [
    ["clipOffset", "-1"],
    ["clipLimit", "201"],
    ["sourceOffset", "0.5"],
    ["sourceLimit", "0"],
  ]) {
    const invalid = new URLSearchParams({
      projectId: f.projectId,
      id: snapshot.id,
      [field!]: value!,
    });
    expect((await fetch(`${url}?${invalid}`)).status).toBe(400);
  }
});
