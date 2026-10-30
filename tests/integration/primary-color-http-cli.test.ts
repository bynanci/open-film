// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import { PRIMARY_COLOR_IDENTITY } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";
it("uses project-bound HTTP review and ordinary CLI primary commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "primary-http-")),
    directory = join(root, "film.openfilm");
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const app = await OpenFilmApplication.create(directory, "Color");
    try {
      for (const [i, id] of ["target", "reference"].entries()) {
        const path = join(root, `${id}.bmp`);
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "gradients=seed=1:s=96x64:c0=0x303030:c1=0xa0a0a0:x0=0:y0=0:x1=96:y1=64",
          ...(i ? ["-vf", "lutrgb=r=val+24:g=val+24:b=val+24"] : []),
          "-frames:v",
          "1",
          "-threads",
          "1",
          path,
        ]);
        app.catalog.upsertAsset({
          ...(await inspectMedia({
            path,
            name: id,
            uri: pathToFileURL(path).href,
          })),
          id,
          contentHash: await hashFile(path),
        });
      }
      app.project.stories.push({
        id: "s",
        title: "Color",
        beats: [{ id: "b", title: "Scene" }],
      });
      app.project.timelines.push({
        id: "f",
        storyId: "s",
        duration: 2,
        tracks: [
          {
            id: "v",
            type: "video",
            clips: ["target", "reference"].map((id, i) => ({
              id,
              assetId: id,
              beatId: "b",
              timelineStart: i,
              timelineDuration: 1,
            })),
          },
        ],
      });
      await app.save();
    } finally {
      app.close();
    }
    server = await startServer({ port: 0, project: directory });
    const base = `http://127.0.0.1:${server.port}`;
    const post = (path: string, body: unknown) =>
      fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const state = await (
      await fetch(`${base}/api/compositions/f/editor`)
    ).json();
    const project = await (await fetch(`${base}/api/project`)).json();
    const input = {
      projectId: project.id ?? project.project?.id,
      baseRevision: state.revision,
      targetClipId: "target",
      referenceClipId: "reference",
    };
    expect(
      (
        await post("/api/compositions/f/primary-color-review", {
          ...input,
          projectId: "wrong",
        })
      ).status,
    ).toBe(409);
    const response = await post(
      "/api/compositions/f/primary-color-review",
      input,
    );
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.canApply).toBe(true);
    const media = `/api/primary-color-reviews/${report.id}/media/after/0`;
    expect((await fetch(base + media + "?projectId=wrong")).status).toBe(409);
    expect(
      (await fetch(base + media + `?projectId=${input.projectId}`)).headers.get(
        "content-type",
      ),
    ).toContain("image/png");
    expect(
      (
        await post("/api/compositions/f/edit", {
          baseRevision: state.revision,
          commands: [
            {
              type: "primary-color",
              scope: "clip",
              clipId: "target",
              correction: report.suggestedCorrection,
              primaryColorReviewId: report.id,
            },
          ],
        })
      ).status,
    ).toBe(200);
    await server.close();
    server = undefined;
    const opened = await OpenFilmApplication.open(directory);
    let revision: string;
    try {
      revision = new TimelineEditor(opened).get("f").revision;
    } finally {
      opened.close();
    }
    const request = join(root, "commands.json");
    await writeFile(
      request,
      JSON.stringify({
        baseRevision: revision,
        requestId: "cli-primary",
        commands: [
          {
            type: "primary-color",
            scope: "film",
            correction: { ...PRIMARY_COLOR_IDENTITY, temperature: 0.2 },
          },
        ],
      }),
    );
    const cli = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "primary-color",
        "edit",
        "--project",
        directory,
        "--composition",
        "f",
        "--commands",
        request,
      ],
      { cwd: resolve("."), timeout: 60000 },
    );
    expect(
      JSON.parse(cli.stdout).composition.defaultPrimaryColor.temperature,
    ).toBe(0.2);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
