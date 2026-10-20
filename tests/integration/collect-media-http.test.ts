import { afterEach, describe, expect, it } from "vitest";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hashFile, runProcess } from "@openfilm/media";
import {
  OpenFilmApplication,
  type CollectRightsDeclaration,
} from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

describe("Collect Media HTTP boundary", () => {
  it("shares the application plan, writes only to project exports, and restricts verification paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-collect-http-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const external = join(root, "outside-source.png");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90",
      "-frames:v",
      "1",
      "-threads",
      "1",
      external,
    ]);
    const projectPath = join(root, "project.openfilm");
    const app = await OpenFilmApplication.create(
      projectPath,
      "Collect HTTP film",
    );
    app.project.settings = { width: 160, height: 90, frameRate: 10 };
    app.catalog.upsertAsset({
      id: "legacy-http-asset",
      uri: pathToFileURL(external).href,
      name: "Synthetic source.png",
      mediaType: "image",
      contentHash: await hashFile(external),
      tags: [],
      state: {},
      metadata: {},
    });
    app.project.stories = [
      {
        id: "legacy-http-story",
        title: "HTTP story",
        beats: [
          {
            id: "legacy-http-beat",
            title: "Synthetic beat",
            candidateAssetIds: ["legacy-http-asset"],
            selectedAssetIds: ["legacy-http-asset"],
          },
        ],
      },
    ];
    app.project.timelines = [
      {
        id: "legacy-http-composition",
        storyId: "legacy-http-story",
        duration: 1,
        tracks: [
          {
            id: "video",
            type: "video",
            clips: [
              {
                id: "http-clip",
                assetId: "legacy-http-asset",
                timelineStart: 0,
                timelineDuration: 1,
              },
            ],
          },
        ],
      },
    ];
    await app.save();
    const rightsDeclarations: CollectRightsDeclaration[] = [
      {
        resourceId: "asset:legacy-http-asset",
        basis: "owned",
        confirmed: true,
      },
    ];
    const plan = await app.collectMedia.plan({
      scope: "current-film",
      compositionId: "legacy-http-composition",
      rightsDeclarations,
    });
    expect(plan.complete).toBe(true);
    app.close();

    const runtime = await startServer({ port: 0, project: projectPath });
    cleanup.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}`;
    const post = (route: string, body: unknown) =>
      fetch(`${base}/api/collect/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const serverPlanResponse = await post("plan", {
      scope: "current-film",
      compositionId: "legacy-http-composition",
      rightsDeclarations,
    });
    expect(serverPlanResponse.status).toBe(200);
    expect((await serverPlanResponse.json()).plan).toMatchObject({
      id: plan.id,
      revision: plan.revision,
      complete: true,
    });

    const createdResponse = await post("create", {
      scope: "current-film",
      compositionId: "legacy-http-composition",
      rightsDeclarations,
      planId: plan.id,
      baseRevision: plan.revision,
      format: "zip",
    });
    expect(createdResponse.status).toBe(200);
    const created = (await createdResponse.json()).result as {
      fileName: string;
    };
    expect(created.fileName).toMatch(/^openfilm-collect-[0-9a-f-]{36}\.zip$/u);
    const savedPackage = await lstat(
      join(projectPath, "exports", created.fileName),
    );
    expect(savedPackage.isFile()).toBe(true);
    expect(
      await lstat(join(root, "outside.zip")).catch(() => undefined),
    ).toBeUndefined();

    expect(
      (await post("verify", { packagePath: join(root, "outside.zip") })).status,
    ).toBe(400);
    expect(
      (await post("verify", { packageName: "../../outside.zip" })).status,
    ).toBe(400);
    const verified = await post("verify", { packageName: created.fileName });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ result: { verified: true } });
  });
});
