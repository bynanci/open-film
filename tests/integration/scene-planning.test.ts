import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OpenFilmApplication, type ScenePlan } from "@openfilm/application";
import { type MediaAsset, type OpenFilmProject } from "@openfilm/core";
import { startServer } from "../../apps/server/src/server.js";

const exec = promisify(execFile);
const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const options = {
  groupBy: "category" as const,
  targetDuration: 16,
  maxDuration: 20,
};
function asset(id: string, changes: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    uri: pathToFileURL(`/media/${id}.jpg`).href,
    name: `${id}.jpg`,
    mediaType: "image",
    contentHash: `sha256:${id}`,
    capturedAt: "2026-01-01T12:00:00Z",
    tags: [id.startsWith("home") ? "Home" : "Beach"],
    dimensions: { width: 1920, height: 1080 },
    state: {},
    metadata: {},
    ...changes,
  };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-scene-plan-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Our memories", {
    projectContentLocale: "zh-TW",
  });
  let open = true;
  cleanups.push(() => {
    if (open) app.close();
  });
  for (const id of ["home-1", "home-2", "beach-1", "beach-2"])
    app.catalog.upsertAsset(asset(id));
  app.catalog.upsertAsset(
    asset("music", { mediaType: "audio", duration: 90, tags: [] }),
  );
  app.project.stories.push({
    id: "existing-story",
    title: "Keep my story",
    beats: [
      {
        id: "existing-beat",
        title: "Our opening",
        selectedAssetIds: ["home-1"],
      },
    ],
  });
  app.project.timelines.push({
    id: "existing-film",
    storyId: "existing-story",
    duration: 3,
    tracks: [
      {
        id: "existing-video",
        type: "video",
        clips: [
          {
            id: "existing-clip",
            beatId: "existing-beat",
            assetId: "home-1",
            timelineStart: 0,
            timelineDuration: 3,
            locked: true,
            transform: { scale: 1.25 },
          },
        ],
      },
    ],
  });
  await app.save();
  return {
    root,
    directory,
    app,
    close: () => {
      app.close();
      open = false;
    },
  };
}

async function rejectsCode(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("reviewable scene-plan application lifecycle", () => {
  it("previews without changing storage, obeys duration and applies incoming fades only", async () => {
    const { app, directory } = await fixture();
    const previous = structuredClone(app.project);
    const bytes = await readFile(join(directory, "project.json"), "utf8");
    const plan = app.previewScenePlan({ ...options, transition: "crossfade" });
    expect(plan.excludedAudioCount).toBe(1);
    expect(plan.composition.duration).toBeLessThanOrEqual(options.maxDuration);
    expect(plan.composition.duration).toBeGreaterThan(0);
    const clips = plan.composition.tracks[0]!.clips;
    expect(clips[0]!.transition).toBeUndefined();
    expect(clips.length).toBeGreaterThan(1);
    for (let index = 1; index < clips.length; index++) {
      expect(clips[index]!.transition?.type).toBe("crossfade");
      expect(clips[index]!.transition!.duration).toBeLessThanOrEqual(
        Math.min(
          clips[index]!.timelineDuration,
          clips[index - 1]!.timelineDuration,
        ),
      );
    }
    expect(app.project).toEqual(previous);
    expect(await readFile(join(directory, "project.json"), "utf8")).toBe(bytes);
  });

  it("atomically appends edited script and a freshly solved film, preserving old edits and reopen retry", async () => {
    const { app, directory, close } = await fixture();
    const oldStory = structuredClone(app.project.stories[0]);
    const oldFilm = structuredClone(app.project.timelines[0]);
    const plan = app.previewScenePlan(options);
    plan.story.beats[0]!.script = {
      narration: "我們的話 / 私たちの言葉",
      visualDirection: "Keep this authored direction.",
    };
    plan.story.beats[0]!.intent = "   ";
    // The client preview is informational, never accepted as authoritative timing.
    plan.composition.duration = 9999;
    plan.composition.tracks[0]!.clips[0]!.timelineDuration = 9999;
    const accepted = app.acceptScenePlan(plan);
    expect(accepted.story.beats[0]!.script).toEqual(
      plan.story.beats[0]!.script,
    );
    expect(accepted.story.beats[0]!.intent).toBeUndefined();
    expect(accepted.composition.duration).toBeLessThanOrEqual(
      options.maxDuration,
    );
    expect(app.project.stories[0]).toEqual(oldStory);
    expect(app.project.timelines[0]).toEqual(oldFilm);
    expect(app.acceptScenePlan(plan)).toEqual(accepted);
    expect(app.project.stories).toHaveLength(2);
    expect(app.project.timelines).toHaveLength(2);
    close();
    const reopened = await OpenFilmApplication.open(directory);
    try {
      expect(reopened.acceptScenePlan(plan)).toEqual(accepted);
      expect(reopened.project.timelines).toHaveLength(2);
      expect(reopened.project.stories[1]!.beats[0]!.script).toEqual(
        plan.story.beats[0]!.script,
      );
    } finally {
      reopened.close();
    }
  });

  it("returns the current accepted film after edits on retry and rejects a conflicting repeat", async () => {
    const { app } = await fixture();
    const plan = app.previewScenePlan(options);
    const accepted = app.acceptScenePlan(plan);
    const saved = app.project.timelines.find(
      (item) => item.id === accepted.composition.id,
    )!;
    saved.tracks[0]!.clips[0]!.transform = { volume: 0.25 };
    await app.save();
    expect(
      app.acceptScenePlan(plan).composition.tracks[0]!.clips[0]!.transform,
    ).toEqual({ volume: 0.25 });
    plan.story.title = "Different request with same identity";
    await rejectsCode(() => app.acceptScenePlan(plan), "story.planConflict");
    expect(app.project.stories).toHaveLength(2);
  });

  it.each([
    ["classification", (a: MediaAsset) => ({ ...a, tags: ["Reclassified"] })],
    [
      "lock",
      (a: MediaAsset) => ({ ...a, state: { ...a.state, locked: true } }),
    ],
    ["rating", (a: MediaAsset) => ({ ...a, rating: 5 })],
    ["source hash", (a: MediaAsset) => ({ ...a, contentHash: "replacement" })],
    ["source duration", (a: MediaAsset) => ({ ...a, duration: 12 })],
    [
      "source location",
      (a: MediaAsset) => ({
        ...a,
        uri: pathToFileURL("/other/changed.jpg").href,
      }),
    ],
  ] as const)("rejects stale %s evidence before writing", async (_, change) => {
    const { app } = await fixture();
    const plan = app.previewScenePlan(options);
    app.catalog.upsertAsset(change(app.catalog.getAsset("home-1")!));
    const previous = structuredClone(app.project);
    await rejectsCode(() => app.acceptScenePlan(plan), "story.planStale");
    expect(app.project).toEqual(previous);
  });

  it("binds project identity and film locale while ignoring unrelated analysis metadata", async () => {
    const { app } = await fixture();
    const plan = app.previewScenePlan(options);
    const originalId = app.project.id;
    app.project.id = "other-project";
    await rejectsCode(() => app.acceptScenePlan(plan), "story.planStale");
    app.project.id = originalId;
    app.project.projectContentLocale = "ja-JP";
    await rejectsCode(() => app.acceptScenePlan(plan), "story.planStale");
    app.project.projectContentLocale = "zh-TW";
    const a = app.catalog.getAsset("home-1")!;
    app.catalog.upsertAsset({
      ...a,
      metadata: {
        ...a.metadata,
        "future.analysis": { transcript: "Unrelated" },
      },
    });
    expect(app.acceptScenePlan(plan).story.id).toBe(plan.story.id);
  });

  it("includes all library locks even with explicit scope and invalidates a new lock outside that scope", async () => {
    const { app } = await fixture();
    app.catalog.upsertAsset(
      asset("outside", { state: { locked: true }, tags: ["Important"] }),
    );
    const plan = app.previewScenePlan({ ...options, assetIds: ["home-1"] });
    expect(plan.sourceAssetIds).toEqual(["home-1", "outside"]);
    expect(
      plan.composition.tracks.flatMap((t) => t.clips).map((c) => c.assetId),
    ).toContain("outside");
    app.catalog.upsertAsset(asset("new-lock", { state: { locked: true } }));
    await rejectsCode(() => app.acceptScenePlan(plan), "story.planStale");
  });

  it("excludes rejected media but never drops a rejected lock or locked audio", async () => {
    const { app } = await fixture();
    app.catalog.upsertAsset(asset("home-1", { state: { rejected: true } }));
    const plan = app.previewScenePlan(options);
    expect(
      plan.story.beats.flatMap((beat) => beat.candidateAssetIds ?? []),
    ).not.toContain("home-1");
    app.catalog.upsertAsset(
      asset("home-1", { state: { rejected: true, locked: true } }),
    );
    await rejectsCode(() => app.previewScenePlan(options), "story.invalid");
    app.catalog.upsertAsset(asset("home-1"));
    const music = app.catalog.getAsset("music")!;
    app.catalog.upsertAsset({ ...music, state: { locked: true } });
    await rejectsCode(() => app.previewScenePlan(options), "story.invalid");
  });

  it("rejects explicit or locked unsupported sources and excludes optional unsupported media", async () => {
    const { app } = await fixture();
    app.catalog.upsertAsset(
      asset("raw360", { mediaType: "360-video", duration: 30 }),
    );
    expect(
      app
        .previewScenePlan(options)
        .story.beats.flatMap((beat) => beat.candidateAssetIds ?? []),
    ).not.toContain("raw360");
    await rejectsCode(
      () =>
        app.previewScenePlan({ ...options, assetIds: ["home-1", "raw360"] }),
      "media.unsupported",
    );
    app.catalog.upsertAsset(
      asset("raw360", {
        mediaType: "360-video",
        duration: 30,
        state: { locked: true },
      }),
    );
    await rejectsCode(
      () => app.previewScenePlan({ ...options, assetIds: ["home-1"] }),
      "media.unsupported",
    );
  });

  it("rejects references outside preview scope and refuses missing or infeasible bounds", async () => {
    const { app } = await fixture();
    const plan = app.previewScenePlan({ ...options, assetIds: ["home-1"] });
    plan.story.beats[0]!.candidateAssetIds!.push("beach-1");
    await rejectsCode(() => app.acceptScenePlan(plan), "story.invalid");
    plan.story.beats[0]!.candidateAssetIds = ["home-1"];
    delete plan.story.maxDuration;
    await rejectsCode(() => app.acceptScenePlan(plan), "story.invalid");
    expect(() =>
      app.previewScenePlan({ ...options, targetDuration: 30, maxDuration: 10 }),
    ).toThrow();
    expect(app.project.stories).toHaveLength(1);
  });

  it("rolls back both new objects on project save failure and permits one clean retry", async () => {
    const { app, directory } = await fixture();
    const plan = app.previewScenePlan(options);
    const previous = structuredClone(app.project);
    const bytes = await readFile(join(directory, "project.json"), "utf8");
    const save = vi
      .spyOn(app as unknown as { saveSync(): void }, "saveSync")
      .mockImplementationOnce(() => {
        throw new Error("ENOSPC");
      });
    expect(() => app.acceptScenePlan(plan)).toThrow("ENOSPC");
    expect(app.project).toEqual(previous);
    expect(await readFile(join(directory, "project.json"), "utf8")).toBe(bytes);
    save.mockRestore();
    app.acceptScenePlan(plan);
    expect(app.project.stories).toHaveLength(2);
    expect(app.project.timelines).toHaveLength(2);
  });

  it("requires explicit scope for a large catalog and adds the locked media without an unbounded list", async () => {
    const { app } = await fixture();
    for (let index = 0; index < 2000; index++)
      app.catalog.upsertAsset(
        asset(`library-${index}`, {
          state: index === 1999 ? { locked: true } : {},
        }),
      );
    await rejectsCode(
      () => app.previewScenePlan(options),
      "story.scopeTooLarge",
    );
    const plan = app.previewScenePlan({ ...options, assetIds: ["home-1"] });
    expect(plan.sourceAssetIds).toEqual(["home-1", "library-1999"]);
    expect(
      plan.composition.tracks
        .flatMap((track) => track.clips)
        .map((clip) => clip.assetId),
    ).toContain("library-1999");
  });

  it("bounds explicit candidate lists before querying them", async () => {
    const { app } = await fixture();
    await rejectsCode(
      () =>
        app.previewScenePlan({
          ...options,
          assetIds: Array.from(
            { length: 2001 },
            (_, index) => `asset-${index}`,
          ),
        }),
      "story.invalid",
    );
  });
});

describe("scene-plan public boundaries", () => {
  it("accepts a 2000-clip CLI preview larger than the ordinary form payload cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-scene-large-cli-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "large.openfilm");
    const app = await OpenFilmApplication.create(
      directory,
      "Large memory collection",
    );
    for (let index = 0; index < 2000; index++) {
      const id = `asset-${String(index).padStart(36, "0")}`;
      app.catalog.upsertAsset(asset(id, { tags: ["Memories"] }));
    }
    app.close();
    const cli = (...args: string[]) =>
      exec(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/cli/src/index.ts",
          ...args,
          "--project",
          directory,
        ],
        {
          cwd: process.cwd(),
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, OPENFILM_USER_DATA_DIR: join(root, "user") },
        },
      );
    const preview = await cli(
      "scene-plan",
      "preview",
      "--target",
      "8000",
      "--max",
      "8500",
      "--group-by",
      "category",
      "--transition",
      "crossfade",
    );
    expect(Buffer.byteLength(preview.stdout)).toBeGreaterThan(1024 * 1024);
    const path = join(root, "large-preview.json");
    await writeFile(path, preview.stdout);
    const accepted = JSON.parse(
      (await cli("scene-plan", "accept", "--plan", path)).stdout,
    ) as { story: ScenePlan["story"]; composition: ScenePlan["composition"] };
    expect(accepted.composition.tracks[0]!.clips).toHaveLength(2000);
    expect(accepted.composition.duration).toBeLessThanOrEqual(8500);
    const saved = JSON.parse(
      await readFile(join(directory, "project.json"), "utf8"),
    ) as OpenFilmProject;
    expect(saved.stories).toHaveLength(1);
    expect(saved.timelines[0]!.id).toBe(accepted.composition.id);
  });

  it("accepts maximum CJK script text through the compact HTTP contract without increasing ordinary endpoint caps", async () => {
    const { app, directory, close } = await fixture();
    const ids = Array.from({ length: 30 }, (_, index) => `scene-${index}`);
    for (const id of ids) app.catalog.upsertAsset(asset(id, { tags: [id] }));
    const plan = app.previewScenePlan({
      ...options,
      assetIds: ids,
      targetDuration: 60,
      maxDuration: 90,
    });
    for (const beat of plan.story.beats)
      beat.script = {
        narration: "景".repeat(8000),
        visualDirection: "影".repeat(8000),
      };
    const { story, sourceAssetIds, sourceSignature, transition } = plan;
    const payload = JSON.stringify({
      plan: { story, sourceAssetIds, sourceSignature, transition },
    });
    expect(Buffer.byteLength(payload)).toBeGreaterThan(1024 * 1024);
    close();
    const runtime = await startServer({ port: 0, project: directory });
    let running = true;
    cleanups.push(() => (running ? runtime.close() : undefined));
    const base = `http://127.0.0.1:${runtime.port}/api`;
    const request = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    };
    const accepted = await fetch(`${base}/story-plans/accept`, request);
    expect(accepted.status).toBe(201);
    const result = await accepted.json();
    expect(result.story.beats[29].script).toEqual(plan.story.beats[29]!.script);
    expect((await fetch(`${base}/stories`, request)).status).toBe(413);
    const beats = structuredClone(
      result.story.beats,
    ) as ScenePlan["story"]["beats"];
    beats[0]!.script!.narration = `改${"景".repeat(7999)}`;
    const editedPayload = JSON.stringify({ beats });
    expect(Buffer.byteLength(editedPayload)).toBeGreaterThan(1024 * 1024);
    const edited = await fetch(
      `${base}/stories/${encodeURIComponent(result.story.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: editedPayload,
      },
    );
    expect(edited.status).toBe(200);
    expect((await edited.json()).story.beats[0].script.narration).toBe(
      beats[0]!.script!.narration,
    );
    await runtime.close();
    running = false;
    const reopened = await OpenFilmApplication.open(directory);
    try {
      const saved = reopened.project.stories.find(
        (item) => item.id === result.story.id,
      )!;
      expect(saved.beats[0]!.script).toEqual(beats[0]!.script);
      expect(saved.beats[29]!.script).toEqual(beats[29]!.script);
    } finally {
      reopened.close();
    }
  });

  it("previews, accepts, retries, and rejects stale evidence through the HTTP API", async () => {
    const { directory, close } = await fixture();
    close();
    const runtime = await startServer({ port: 0, project: directory });
    cleanups.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}/api`;
    const post = (path: string, value: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
    const preview = await post("/story-plans/preview", options);
    expect(preview.status).toBe(200);
    const { plan } = (await preview.json()) as { plan: ScenePlan };
    const response = await post("/story-plans/accept", { plan });
    expect(response.status).toBe(201);
    const accepted = await response.json();
    const retry = await post("/story-plans/accept", { plan });
    expect(await retry.json()).toEqual(accepted);
    const another = (await (await post("/story-plans/preview", options)).json())
      .plan as ScenePlan;
    const changed = await fetch(`${base}/assets/home-1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["changed"] }),
    });
    expect(changed.ok).toBe(true);
    const stale = await post("/story-plans/accept", { plan: another });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "story.planStale" });
  });

  it("keeps headless preview read-only and accepts the edited JSON only once", async () => {
    const { root, directory, close } = await fixture();
    close();
    const before = await readFile(join(directory, "project.json"), "utf8");
    const cli = (...args: string[]) =>
      exec(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/cli/src/index.ts",
          ...args,
          "--project",
          directory,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, OPENFILM_USER_DATA_DIR: join(root, "user") },
        },
      );
    const preview = await cli(
      "scene-plan",
      "preview",
      "--target",
      "16",
      "--max",
      "20",
      "--group-by",
      "category",
    );
    expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
      before,
    );
    const input = JSON.parse(preview.stdout) as { plan: ScenePlan };
    input.plan.story.beats[0]!.script = {
      narration: "Authored in CLI",
      visualDirection: "Stay on this image.",
    };
    const path = join(root, "場景 & script #1.json");
    await writeFile(path, JSON.stringify(input));
    const accepted = JSON.parse(
      (await cli("scene-plan", "accept", "--plan", path)).stdout,
    );
    expect(
      JSON.parse((await cli("scene-plan", "accept", "--plan", path)).stdout),
    ).toEqual(accepted);
    const saved = JSON.parse(
      await readFile(join(directory, "project.json"), "utf8"),
    ) as OpenFilmProject;
    expect(saved.stories).toHaveLength(2);
    expect(saved.timelines).toHaveLength(2);
    expect(saved.stories[1]!.beats[0]!.script!.narration).toBe(
      "Authored in CLI",
    );
  });
});
