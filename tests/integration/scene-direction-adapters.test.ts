import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";

const exec = promisify(execFile);
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const compositionId = "film # & 記憶";
const beatId = "scene / 日本語";
const clipId = "photo # & 一";
async function fixture(targetClipId = clipId) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-direction-adapters-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "Film # & 記憶.openfilm");
  const app = await OpenFilmApplication.create(directory, "Our memories", {
    projectContentLocale: "zh-TW",
  });
  try {
    for (const id of ["photo", "other"])
      app.catalog.upsertAsset({
        id,
        name: `${id}.jpg`,
        uri: pathToFileURL(join(root, `${id}.jpg`)).href,
        mediaType: "image",
        dimensions: { width: 640, height: 960 },
        contentHash: `sha256:${id}`,
        state: {},
        tags: [],
        metadata: {},
      });
    app.project.stories.push({
      id: "story",
      title: "Our story",
      maxDuration: 10,
      beats: [
        {
          id: beatId,
          title: "Our first scene",
          selectedAssetIds: ["photo"],
          script: {
            narration: "Do not rewrite my words",
            visualDirection: "保留比例；緩慢推近",
          },
        },
        { id: "other-beat", title: "Keep this scene" },
      ],
    });
    app.project.timelines.push({
      id: compositionId,
      storyId: "story",
      duration: 8,
      tracks: [
        {
          id: "pictures",
          type: "video",
          clips: [
            {
              id: targetClipId,
              assetId: "photo",
              beatId,
              timelineStart: 0,
              timelineDuration: 4,
            },
            {
              id: "other-clip",
              assetId: "other",
              beatId: "other-beat",
              timelineStart: 4,
              timelineDuration: 4,
              locked: true,
            },
          ],
        },
      ],
    });
    await app.save();
  } finally {
    app.close();
  }
  return { root, directory };
}
async function server(directory: string) {
  const runtime = await startServer({ port: 0, project: directory });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await runtime.close();
  };
  cleanup.push(close);
  const request = (route: string, data?: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}/api${route}`, {
      method: data === undefined ? "GET" : "POST",
      ...(data === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          }),
    });
  return { runtime: { ...runtime, close }, request };
}
const route = `/compositions/${encodeURIComponent(compositionId)}`;
const options = { beatId, clipIds: [clipId] };

describe("scene direction HTTP and CLI adapters", () => {
  it("previews without saving, adopts selected actions as one undo unit and retries after reopen", async () => {
    const { directory } = await fixture();
    const initial = await readFile(join(directory, "project.json"), "utf8");
    const { runtime, request } = await server(directory);
    const response = await request(`${route}/direction/preview`, options);
    expect(response.status).toBe(200);
    const plan = await response.json();
    expect(plan.actions.map((action: { kind: string }) => action.kind)).toEqual(
      ["layout", "motion"],
    );
    expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
      initial,
    );
    const payload = {
      planId: plan.id,
      baseRevision: plan.baseRevision,
      contextSignature: plan.contextSignature,
      options: plan.options,
      actionIds: plan.actions.map((action: { id: string }) => action.id),
      requestId: "direction-http-1",
    };
    const accepted = await request(`${route}/direction/accept`, payload);
    expect(accepted.status).toBe(200);
    const state = await accepted.json();
    expect(state.composition.duration).toBe(8);
    expect(state.composition.tracks[0].clips[0].motion.preset).toBe("push-in");
    expect(state.composition.tracks[0].clips[1]).toEqual(
      plan.preview.composition.tracks[0].clips[1],
    );
    expect(state.story.beats[0].script.narration).toBe(
      "Do not rewrite my words",
    );
    const undone = await (
      await request(`${route}/undo`, { baseRevision: state.revision })
    ).json();
    expect(undone.composition.tracks[0].clips[0].motion).toBeUndefined();
    expect(undone.composition.tracks[0].clips[0].layout).toBeUndefined();
    const redone = await (
      await request(`${route}/redo`, { baseRevision: undone.revision })
    ).json();
    expect(redone.composition).toEqual(state.composition);
    await runtime.close();
    const reopened = await server(directory);
    const retried = await reopened.request(
      `${route}/direction/accept`,
      payload,
    );
    expect(retried.status).toBe(200);
    expect((await retried.json()).composition).toEqual(state.composition);
    const persisted = JSON.parse(
      await readFile(join(directory, "project.json"), "utf8"),
    );
    expect(persisted.sceneDirectionReceipts).toHaveLength(1);
  });

  it("rejects stale and injected acceptance without overwriting the current film", async () => {
    const { directory } = await fixture();
    const { request } = await server(directory);
    const planResponse = await request(`${route}/direction/preview`, options);
    expect(planResponse.status).toBe(200);
    const plan = await planResponse.json();
    const injected = await request(`${route}/direction/accept`, {
      planId: plan.id,
      baseRevision: plan.baseRevision,
      contextSignature: plan.contextSignature,
      options,
      actionIds: ["unknown-action"],
      requestId: "invalid-action",
    });
    expect(injected.status).toBe(409);
    const edited = await request(`${route}/edit`, {
      baseRevision: plan.baseRevision,
      requestId: "manual-volume",
      commands: [{ type: "transform", clipId, rotation: 90 }],
    });
    expect(edited.status).toBe(200);
    const current = await edited.json();
    const stale = await request(`${route}/direction/accept`, {
      planId: plan.id,
      baseRevision: plan.baseRevision,
      contextSignature: plan.contextSignature,
      options,
      actionIds: plan.actions.map((action: { id: string }) => action.id),
      requestId: "stale-direction",
    });
    expect(stale.status).toBe(409);
    const after = await (await request(`${route}/editor`)).json();
    expect(after.composition).toEqual(current.composition);
    expect(after.composition.tracks[0].clips[0].motion).toBeUndefined();
  });

  it("lets headless users review a file and adopt the same instructions with Unicode paths", async () => {
    const { root, directory } = await fixture();
    const args = [
      "--import",
      "tsx",
      "apps/cli/src/index.ts",
      "direction-review",
    ];
    const command = (extra: string[]) =>
      exec(process.execPath, [...args, ...extra, "--project", directory], {
        cwd: process.cwd(),
      });
    const before = await readFile(join(directory, "project.json"), "utf8");
    const preview = await command([
      "preview",
      compositionId,
      "--beat",
      beatId,
      "--clips",
      clipId,
    ]);
    const plan = JSON.parse(preview.stdout).plan;
    expect(plan.sourceText).toBe("保留比例；緩慢推近");
    expect(plan.actions).toHaveLength(2);
    expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
      before,
    );
    const file = join(root, "review # & 日本語.json");
    await writeFile(file, JSON.stringify({ plan }));
    const adopted = await command([
      "accept",
      compositionId,
      "--plan",
      file,
      "--request-id",
      "cli-direction-1",
    ]);
    const state = JSON.parse(adopted.stdout);
    expect(state.composition.tracks[0].clips[0].motion.preset).toBe("push-in");
    expect(state.composition.duration).toBe(8);
    const retried = await command([
      "accept",
      compositionId,
      "--plan",
      file,
      "--request-id",
      "cli-direction-1",
    ]);
    expect(JSON.parse(retried.stdout).composition).toEqual(state.composition);
    const saved = JSON.parse(
      await readFile(join(directory, "project.json"), "utf8"),
    );
    expect(saved.sceneDirectionReceipts).toHaveLength(1);
  });

  it("preserves comma-bearing opaque identities in CLI target and action selections", async () => {
    const opaqueId = "photo, # & 回憶 / [one]";
    const { root, directory } = await fixture(opaqueId);
    const command = (extra: string[]) =>
      exec(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/cli/src/index.ts",
          "direction-review",
          ...extra,
          "--project",
          directory,
        ],
        { cwd: process.cwd() },
      );
    const before = await readFile(join(directory, "project.json"), "utf8");
    const preview = await command([
      "preview",
      compositionId,
      "--beat",
      beatId,
      "--clips-json",
      JSON.stringify([opaqueId]),
    ]);
    const plan = JSON.parse(preview.stdout).plan;
    expect(plan.actions).toHaveLength(2);
    expect(
      plan.actions.every(
        (action: { clipId: string }) => action.clipId === opaqueId,
      ),
    ).toBe(true);
    expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
      before,
    );
    const file = join(root, "comma review.json");
    await writeFile(file, JSON.stringify({ plan }));
    const actionIds = plan.actions.map((action: { id: string }) => action.id);
    const args = [
      "accept",
      compositionId,
      "--plan",
      file,
      "--request-id",
      "comma-direction",
      "--actions-json",
      JSON.stringify(actionIds),
    ];
    const accepted = JSON.parse((await command(args)).stdout);
    expect(accepted.composition.tracks[0].clips[0].id).toBe(opaqueId);
    expect(accepted.composition.tracks[0].clips[0].motion.preset).toBe(
      "push-in",
    );
    expect(JSON.parse((await command(args)).stdout).composition).toEqual(
      accepted.composition,
    );
    const saved = JSON.parse(
      await readFile(join(directory, "project.json"), "utf8"),
    );
    expect(saved.sceneDirectionReceipts).toHaveLength(1);
    expect(
      saved.sceneDirectionReceipts[0].actions.map(
        (action: { id: string }) => action.id,
      ),
    ).toEqual(actionIds);
  });

  it.each(["not-json", "{}", '["valid",4]', '[""]'])(
    "rejects malformed identity arrays without changing the project: %s",
    async (encoded) => {
      const { directory } = await fixture();
      const before = await readFile(join(directory, "project.json"), "utf8");
      await expect(
        exec(
          process.execPath,
          [
            "--import",
            "tsx",
            "apps/cli/src/index.ts",
            "direction-review",
            "preview",
            compositionId,
            "--project",
            directory,
            "--beat",
            beatId,
            "--clips-json",
            encoded,
          ],
          { cwd: process.cwd() },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "--clips-json must be a JSON array of nonempty identifiers",
        ),
      });
      expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
        before,
      );
    },
  );
});
