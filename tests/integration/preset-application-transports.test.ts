// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";
import type { PresetApplyInput } from "@openfilm/core";
import { presetPackage } from "../fixtures/local-presets/package.js";
const exec = promisify(execFile),
  cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-preset-transports-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "Film.openfilm"),
    userDataDirectory = join(root, "user"),
    app = await OpenFilmApplication.create(
      directory,
      "Original",
      {},
      { userDataDirectory },
    );
  for (const id of ["a", "b", "c"]) {
    const file = join(root, `${id}.png`),
      bytes = Buffer.from(`synthetic ${id}`);
    await writeFile(file, bytes);
    app.catalog.upsertAsset({
      id,
      name: id,
      uri: pathToFileURL(file).href,
      mediaType: "image",
      dimensions: { width: 320, height: 180 },
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      tags: [],
      state: {},
      metadata: {},
    });
  }
  app.project.settings = { width: 320, height: 180, frameRate: 24 };
  app.project.stories.push({
    id: "story",
    title: "Original",
    targetDuration: 6,
    maxDuration: 12,
    beats: ["a", "b", "c"].map((id) => ({
      id,
      title: id,
      candidateAssetIds: [id],
      selectedAssetIds: [id],
      targetDuration: 2,
      minDuration: 1,
      maxDuration: 4,
    })),
  });
  const composition = app.compose("story");
  composition.tracks[0]!.clips[0]!.title = "記憶 Memories";
  app.project.timelines[0] = composition;
  await app.save();
  const document = JSON.stringify(presetPackage()),
    review = app.presets.registry.reviewImport(document),
    view = await app.presets.registry.install({
      document,
      packageSha256: review.packageSha256,
      baseRegistryRevision: review.registryRevision,
      reviewSha256: review.reviewSha256,
      acknowledgeLicense: true,
    });
  app.close();
  const runtime = await startServer({
    port: 0,
    project: directory,
    userDataDirectory,
  });
  cleanup.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}`,
    cli = async (args: string[]) =>
      JSON.parse(
        (
          await exec(
            process.execPath,
            [
              "--import",
              "tsx",
              resolve("apps/cli/src/index.ts"),
              "presets",
              "apply",
              ...args,
              "--project",
              directory,
              "--user-data-dir",
              userDataDirectory,
            ],
            { cwd: resolve("."), maxBuffer: 4 * 1024 * 1024 },
          )
        ).stdout,
      );
  return { root, directory, base, composition, view, cli };
}
it("HTTP apply and ordinary Undo share the editor; CLI review/accept survives separate processes", async () => {
  const { root, directory, base, composition, view, cli } = await fixture(),
    p = view.packages[0]!,
    state = await (
      await fetch(`${base}/api/compositions/${composition.id}/editor`)
    ).json();
  const request: PresetApplyInput = {
    projectId: (await (await fetch(base + "/api/project")).json()).project.id,
    selection: {
      canonicalId: p.entrySummaries.find((e) => e.kind === "film-look")!
        .canonicalId,
      packageSha256: p.packageSha256,
      registryRevision: view.revision,
    },
    baseRevision: state.revision,
    target: { kind: "film-look", compositionId: composition.id, scope: "film" },
  };
  const r = await (
    await post(base, "/api/presets/apply/review", request)
  ).json();
  const accepted = await post(base, "/api/presets/apply/accept", {
    request,
    reviewSha256: r.reviewSha256,
    requestId: "http-look",
  });
  expect(accepted.status).toBe(200);
  const next = await accepted.json();
  expect(next.state.composition.defaultLook.version).toBe(2);
  const undone = await post(base, `/api/compositions/${composition.id}/undo`, {
    baseRevision: next.state.revision,
  });
  expect(undone.status).toBe(200);
  const beforeTitle = await undone.json();
  expect(beforeTitle.composition.defaultLook).toBeUndefined();
  expect(beforeTitle.canRedo).toBe(true);
  expect((await post(base, "/api/project/close", {})).status).toBe(200);
  const title: PresetApplyInput = {
    ...request,
    baseRevision: beforeTitle.revision,
    selection: {
      ...request.selection,
      canonicalId: p.entrySummaries.find((e) => e.kind === "title")!
        .canonicalId,
    },
    target: {
      kind: "title",
      compositionId: composition.id,
      clipId: composition.tracks[0]!.clips[0]!.id,
    },
  };
  const file = join(root, "apply.json");
  await writeFile(file, JSON.stringify(title));
  const review = await cli(["review", "--request", file]);
  const result = await cli([
    "accept",
    "--request",
    file,
    "--review-sha",
    review.reviewSha256,
    "--request-id",
    "cli-title",
  ]);
  expect(
    result.state.composition.tracks[0].clips[0].titlePresetSnapshot.kind,
  ).toBe("title");
  expect(
    (
      await cli([
        "accept",
        "--request",
        file,
        "--review-sha",
        review.reviewSha256,
        "--request-id",
        "cli-title",
      ])
    ).alreadyAccepted,
  ).toBe(true);
  const saved = JSON.parse(
    await readFile(join(directory, "project.json"), "utf8"),
  );
  expect(saved.timelines[0].tracks[0].clips[0].title).toBe("記憶 Memories");
});
it("reading a derived graph and view keeps the saved Story revision usable for preset review", async () => {
  const { directory, base } = await fixture(),
    before = await readFile(join(directory, "project.json"));
  expect((await fetch(base + "/api/stories/story/graph")).status).toBe(200);
  expect((await fetch(base + "/api/stories/story/graph-view")).status).toBe(
    200,
  );
  const revision = await fetch(base + "/api/versions/revision");
  expect(revision.status).toBe(200);
  expect(await readFile(join(directory, "project.json"))).toEqual(before);
});
