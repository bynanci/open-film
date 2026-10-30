// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { PRIMARY_COLOR_IDENTITY } from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";

const exec = promisify(execFile);
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const original = { version: 1 as const, preset: "none" as const, strength: 1 };
const natural = {
  version: 1 as const,
  preset: "natural" as const,
  strength: 0.6,
};
async function fixture(locked = false) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-look-adapters-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "Film # & 回憶.openfilm");
  const source = join(root, "photo # & 日本語.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x52708a:s=96x64",
    "-frames:v",
    "1",
    "-threads",
    "1",
    source,
  ]);
  const app = await OpenFilmApplication.create(directory, "A styled film");
  try {
    app.project.settings = { width: 96, height: 64, frameRate: 12 };
    app.catalog.upsertAsset({
      id: "photo",
      name: "Photo",
      uri: pathToFileURL(source).href,
      mediaType: "image",
      dimensions: { width: 96, height: 64 },
      state: { locked },
      tags: [],
      metadata: {},
    });
    app.project.stories.push({
      id: "story",
      title: "Story",
      beats: [{ id: "beat", title: "Together" }],
    });
    app.project.timelines.push({
      id: "film",
      storyId: "story",
      duration: 0.5,
      defaultLook: { version: 1, preset: "retro", strength: 0.8 },
      tracks: [
        {
          id: "pictures",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: "photo",
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 0.5,
              look: original,
            },
          ],
        },
      ],
    });
    await app.save();
  } finally {
    app.close();
  }
  return { root, directory, source };
}
async function server(directory: string) {
  const runtime = await startServer({ port: 0, project: directory });
  cleanup.push(() => runtime.close());
  return "http://127.0.0.1:" + runtime.port;
}
const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

it("HTTP retains the localized lock code, count and conflict status for rejected look edits", async () => {
  const { directory, source } = await fixture(true);
  const base = await server(directory);
  const url = base + "/api/compositions/film/editor";
  const before = await (await fetch(url)).json();
  const bytes = await readFile(source);
  const disk = await readFile(join(directory, "project.json"));
  for (const command of [
    { type: "look", scope: "clip", clipId: "clip", look: natural },
    {
      type: "primary-color",
      scope: "clip",
      clipId: "clip",
      correction: { ...PRIMARY_COLOR_IDENTITY, exposureEv: 0.5 },
    },
  ]) {
    const response = await post(base, "/api/compositions/film/edit", {
      baseRevision: before.revision,
      commands: [command],
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code:
        command.type === "look"
          ? "timeline.lookLocked"
          : "timeline.primaryColorLocked",
      params: { count: 1 },
    });
    expect(await (await fetch(url)).json()).toEqual(before);
    expect(await readFile(join(directory, "project.json"))).toEqual(disk);
    expect(await readFile(source)).toEqual(bytes);
  }
});

it("HTTP preview and MP4 export honor the same render-only override without saving it", async () => {
  const { directory, source } = await fixture();
  const base = await server(directory);
  const editorUrl = base + "/api/compositions/film/editor";
  const before = await (await fetch(editorUrl)).json();
  const sourceBytes = await readFile(source);
  for (const path of ["/api/render", "/api/export"]) {
    const response = await post(base, path, {
      compositionId: "film",
      ...(path === "/api/export" ? { format: "mp4" } : {}),
      lookOverride: natural,
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    const manifest = JSON.parse(
      await readFile(result.path + ".manifest.json", "utf8"),
    );
    expect(manifest.looks.override).toEqual(natural);
    expect(manifest.looks.clips[0]).toMatchObject({
      source: "export",
      preset: "natural",
      strength: 0.6,
    });
    expect((await (await fetch(editorUrl)).json()).composition).toEqual(
      before.composition,
    );
  }
  const preserved = await post(base, "/api/render", {
    compositionId: "film",
    lookOverride: null,
  });
  expect(preserved.status).toBe(200);
  const result = await preserved.json();
  const manifest = JSON.parse(
    await readFile(result.path + ".manifest.json", "utf8"),
  );
  expect(manifest.looks.override).toBeNull();
  expect(manifest.looks.clips[0]).toMatchObject({
    source: "clip",
    preset: "none",
  });
  expect(await readFile(source)).toEqual(sourceBytes);
}, 30000);

it("HTTP rejects malformed or non-MP4 output overrides before reserving a render job", async () => {
  const { directory } = await fixture();
  const base = await server(directory);
  const before = await (await fetch(base + "/api/jobs")).json();
  for (const lookOverride of [
    false,
    [],
    { ...natural, version: 2 },
    { ...natural, strength: 2 },
    { ...natural, preset: "unknown" },
    { ...natural, matrix: "arbitrary-filter" },
  ]) {
    const response = await post(base, "/api/render", {
      compositionId: "film",
      lookOverride,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "request.invalid" });
  }
  const interchange = await post(base, "/api/export", {
    compositionId: "film",
    format: "json",
    lookOverride: natural,
  });
  expect(interchange.status).toBe(400);
  expect(await interchange.json()).toMatchObject({ code: "request.invalid" });
  expect(await (await fetch(base + "/api/jobs")).json()).toEqual(before);
  expect(
    (
      await post(base, "/api/render", {
        compositionId: "film",
        lookOverride: original,
      })
    ).status,
  ).toBe(200);
}, 30000);

it("CLI renders and exports a uniform look on Unicode paths while preserving saved segmented choices", async () => {
  const { root, directory, source } = await fixture();
  const before = await OpenFilmApplication.open(directory);
  const composition = structuredClone(before.project.timelines[0]);
  before.close();
  const sourceBytes = await readFile(source);
  const cli = (args: string[]) =>
    exec(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        ...args,
        "--project",
        directory,
        "--user-data-dir",
        join(root, "user-data"),
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024 },
    );
  for (const args of [
    ["render", "--look", "natural", "--look-strength", "0.6"],
    [
      "export",
      "--format",
      "mp4",
      "--look",
      "natural",
      "--look-strength",
      "0.6",
    ],
  ]) {
    const { stdout } = await cli(args);
    const output = JSON.parse(stdout);
    const manifest = JSON.parse(
      await readFile(output.path + ".manifest.json", "utf8"),
    );
    expect(manifest.looks.override).toEqual(natural);
  }
  for (const args of [
    ["render", "--look", "unknown"],
    ["render", "--look-strength", "0"],
    ["render", "--look", "natural", "--look-strength", "2"],
    ["export", "--format", "otio", "--look", "natural"],
  ]) {
    await expect(cli(args)).rejects.toThrow();
  }
  const reopened = await OpenFilmApplication.open(directory);
  try {
    expect(reopened.project.timelines[0]).toEqual(composition);
  } finally {
    reopened.close();
  }
  expect(await readFile(source)).toEqual(sourceBytes);
}, 30000);
