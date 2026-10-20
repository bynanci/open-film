import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import type { MediaAsset } from "@openfilm/core";
import { extractStoredZip } from "../src/collect-archive.js";
import { OpenFilmApplication } from "../src/index.js";

const roots: string[] = [];
const applications = new Set<OpenFilmApplication>();
afterEach(async () => {
  for (const application of applications) {
    try {
      application.close({ requireSave: false });
    } catch {
      // A test may have explicitly closed this instance before reopening.
    }
  }
  applications.clear();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function imageAsset(path: string, name: string, color: string) {
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=96x54`,
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    path,
  ]);
  return inspectMedia({ path, uri: pathToFileURL(path).href, name });
}

async function seededFilm(root: string) {
  const external = join(root, "external-media");
  const directory = join(root, "source.film");
  const nested = join(external, "合成素材", "2026 年", "照片");
  await mkdir(nested, { recursive: true });
  const app = await OpenFilmApplication.create(
    directory,
    "Synthetic collect film",
  );
  applications.add(app);
  app.project.settings = { width: 320, height: 180, frameRate: 10 };

  const colors = [
    "red",
    "blue",
    "green",
    "yellow",
    "purple",
    "orange",
    "cyan",
    "magenta",
    "white",
  ];
  const photos: MediaAsset[] = [];
  const paths: string[] = [];
  for (const [index, color] of colors.entries()) {
    const name = index < 2 ? "同名.png" : `照片-${index + 1}.png`;
    const folder = index === 0 ? nested : join(external, `資料夾-${index + 1}`);
    await mkdir(folder, { recursive: true });
    const path = join(folder, name);
    const asset = await imageAsset(path, name, color);
    if (index === 0) asset.name = path;
    app.catalog.upsertAsset(asset);
    photos.push(asset);
    paths.push(path);
  }
  const duplicatePath = join(external, "重複內容", "相同位元組.png");
  await mkdir(join(external, "重複內容"), { recursive: true });
  await copyFile(paths[0]!, duplicatePath);
  const duplicate = await inspectMedia({
    path: duplicatePath,
    uri: pathToFileURL(duplicatePath).href,
    name: "相同位元組.png",
  });
  app.catalog.upsertAsset(duplicate);
  photos.push(duplicate);
  paths.push(duplicatePath);

  const audioPath = join(external, "錄音", "合成旁白.wav");
  await mkdir(join(external, "錄音"), { recursive: true });
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    "-t",
    "3",
    "-c:a",
    "pcm_s16le",
    "-y",
    audioPath,
  ]);
  const audio = await inspectMedia({
    path: audioPath,
    uri: pathToFileURL(audioPath).href,
    name: "合成旁白.wav",
  });
  app.catalog.upsertAsset(audio);
  paths.push(audioPath);

  const unusedPath = join(external, "未使用的私人素材.png");
  const unused = await imageAsset(unusedPath, "未使用的私人素材.png", "black");
  app.catalog.upsertAsset(unused);

  const storyId = "legacy-story-id";
  const compositionId = "legacy-composition-id";
  app.project.stories = [
    {
      id: storyId,
      title: "Synthetic memories",
      beats: [
        {
          id: "legacy-beat-id",
          title: "Ten synthetic images",
          candidateAssetIds: [...photos.map((asset) => asset.id), audio.id],
          selectedAssetIds: photos.map((asset) => asset.id),
        },
      ],
    },
  ];
  const imageDuration = 0.3;
  app.project.timelines = [
    {
      id: compositionId,
      storyId,
      // A non-frame-aligned saved duration exercises the renderer's complete
      // frame floor when Package Verify checks its decoded output.
      duration: 3.05,
      tracks: [
        {
          id: "pictures",
          type: "video",
          clips: photos.slice(0, 10).map((asset, index) => ({
            id: `photo-clip-${index}`,
            assetId: asset.id,
            beatId: "legacy-beat-id",
            timelineStart: index * imageDuration,
            timelineDuration: imageDuration,
            sourceIn: 0,
            sourceOut: 1,
            ...(index === 5 ? { title: "合成字幕" } : {}),
          })),
        },
        {
          id: "sound",
          type: "audio",
          clips: [
            {
              id: "voice-clip",
              assetId: audio.id,
              timelineStart: 0,
              timelineDuration: 3,
              sourceIn: 0,
              sourceOut: 3,
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  return {
    app,
    directory,
    external,
    photos,
    audio,
    unused,
    paths,
    compositionId,
  };
}

function ownedRights(items: { resourceId: string }[]) {
  return items.map((item) => ({
    resourceId: item.resourceId,
    basis: "owned" as const,
    confirmed: true as const,
  }));
}

async function decodedVideoFrames(path: string): Promise<string[]> {
  const result = await runProcess("ffmpeg", [
    "-v",
    "error",
    "-i",
    path,
    "-map",
    "0:v:0",
    "-f",
    "framemd5",
    "-",
  ]);
  return result.stdout
    .toString("utf8")
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").at(-1)!.trim());
}

describe("Collect Media portable packages", () => {
  it("collects only referenced files, deduplicates bytes, relocates, reopens, and renders identical decoded frames", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-collect-integration-"));
    roots.push(root);
    const fixture = await seededFilm(root);
    expect(
      (await lstat(join(fixture.directory, "database.sqlite-wal"))).isFile(),
    ).toBe(true);
    const originalHashes = await Promise.all(
      fixture.paths.map((path) => hashFile(path)),
    );
    const photoHashes = new Map(
      fixture.photos.map((asset, index) => [asset.id, originalHashes[index]!]),
    );
    const baseline = await fixture.app.exportMp4(fixture.compositionId);
    const baselineFrames = await decodedVideoFrames(baseline.path);

    const scope = {
      scope: "current-film" as const,
      compositionId: fixture.compositionId,
    };
    const unconfirmed = await fixture.app.collectMedia.plan(scope);
    expect(unconfirmed.complete).toBe(false);
    expect(
      unconfirmed.items.filter((item) => item.kind === "media"),
    ).toHaveLength(11);
    expect(
      unconfirmed.items.some(
        (item) => item.displayName === fixture.unused.name,
      ),
    ).toBe(false);
    expect(
      unconfirmed.items.every((item) => !item.displayName.includes(root)),
    ).toBe(true);
    const declarations = ownedRights(unconfirmed.items);
    const plan = await fixture.app.collectMedia.plan({
      ...scope,
      rightsDeclarations: declarations,
    });
    expect(plan.complete).toBe(true);
    expect(plan.compositionIds).toEqual([fixture.compositionId]);
    expect(plan.storyIds).toEqual(["legacy-story-id"]);
    expect(plan.versionsIncluded).toBe(false);

    const transfer = join(root, "handoff");
    const relocated = join(root, "different-root", "received-film.zip");
    await mkdir(transfer);
    await mkdir(join(root, "different-root"));
    const created = await fixture.app.collectMedia.create({
      ...scope,
      rightsDeclarations: declarations,
      planId: plan.id,
      baseRevision: plan.revision,
      destination: join(transfer, "portable.zip"),
      format: "zip",
    });
    expect(created).toMatchObject({
      format: "zip",
      sourceCount: 11,
      uniqueSourceCount: 10,
      fontCount: 1,
      versionsIncluded: false,
    });
    expect(created.packageBytes).toBeGreaterThan(0);
    const directoryPackage = await fixture.app.collectMedia.create({
      ...scope,
      rightsDeclarations: declarations,
      planId: plan.id,
      baseRevision: plan.revision,
      destination: join(transfer, "portable-directory.openfilm"),
      format: "directory",
    });
    expect(directoryPackage.format).toBe("directory");
    const directoryVerification = await fixture.app.collectMedia.verify(
      join(transfer, directoryPackage.fileName),
    );
    expect(directoryVerification).toMatchObject({
      verified: true,
      outputWidth: 320,
      outputHeight: 180,
      outputFrameRate: "10/1",
      outputFrames: 30,
    });

    const extracted = join(root, "inspect");
    await mkdir(extracted);
    const files = await extractStoredZip(
      join(transfer, created.fileName),
      extracted,
    );
    const manifestPath = join(extracted, "collect-manifest.json");
    const manifestBytes = await readFile(manifestPath);
    expect(await hashFile(manifestPath)).toBe(created.manifestSha256);
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
      files: { path: string; sha256: string; size: number }[];
      assets: {
        id: string;
        name: string;
        sha256: string;
        size: number;
        path: string;
      }[];
      fonts: { path: string; sha256: string; size: number }[];
      rights: { resourceId: string }[];
      versionsIncluded: boolean;
    };
    const firstSameName = manifest.assets.find(
      (asset) => asset.id === fixture.photos[0]!.id,
    )!;
    const secondSameName = manifest.assets.find(
      (asset) => asset.id === fixture.photos[1]!.id,
    )!;
    const identicalCopy = manifest.assets.find(
      (asset) => asset.id === fixture.photos[9]!.id,
    )!;
    expect(firstSameName.path).not.toBe(secondSameName.path);
    expect(firstSameName.path).toBe(identicalCopy.path);
    expect(firstSameName.sha256).toBe(identicalCopy.sha256);
    expect(firstSameName.sha256).not.toBe(secondSameName.sha256);
    expect(manifest.fonts).toHaveLength(1);
    expect(manifest.rights).toHaveLength(12);
    expect(manifest.versionsIncluded).toBe(false);
    expect(
      manifest.assets.some((asset) => asset.id === fixture.unused.id),
    ).toBe(false);
    expect(JSON.stringify(manifest)).not.toContain(fixture.external);
    expect(manifestBytes.toString("utf8")).not.toContain("file://");
    expect(
      await readFile(join(extracted, "project.json"), "utf8"),
    ).not.toContain(fixture.external);
    expect(
      (await readFile(join(extracted, "database.sqlite"))).toString("latin1"),
    ).not.toContain(fixture.external);
    expect(files).toHaveLength(manifest.files.length + 1);
    for (const asset of manifest.assets) {
      expect(await hashFile(join(extracted, asset.path))).toBe(asset.sha256);
    }
    for (const font of manifest.fonts) {
      expect(await hashFile(join(extracted, font.path))).toBe(font.sha256);
    }
    expect(
      await Promise.all(fixture.paths.map((path) => hashFile(path))),
    ).toEqual(originalHashes);

    const originalFontOverride = process.env.OPENFILM_TITLE_FONT;
    process.env.OPENFILM_TITLE_FONT = join(root, "missing-font.ttf");
    try {
      const missingFontPlan = await fixture.app.collectMedia.plan({
        ...scope,
        rightsDeclarations: declarations.filter((right) =>
          right.resourceId.startsWith("asset:"),
        ),
      });
      expect(missingFontPlan.complete).toBe(false);
      expect(missingFontPlan.issues.map((issue) => issue.code)).toContain(
        "font.unavailable",
      );
    } finally {
      if (originalFontOverride === undefined)
        delete process.env.OPENFILM_TITLE_FONT;
      else process.env.OPENFILM_TITLE_FONT = originalFontOverride;
    }

    await copyFile(join(transfer, created.fileName), relocated);
    fixture.app.close();
    await rm(fixture.external, { recursive: true, force: true });
    const verification = await fixture.app.collectMedia.verify(relocated);
    expect(verification).toMatchObject({
      verified: true,
      projectId: fixture.app.project.id,
      sourceCount: 11,
      fontCount: 1,
      compositionId: fixture.compositionId,
      outputWidth: 320,
      outputHeight: 180,
      outputFrameRate: "10/1",
      outputFrames: 30,
      outputAudio: { codec: "aac", sampleRate: 48000, channels: 1 },
      versionsIncluded: false,
    });
    expect(verification.previewSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verification.outputSha256).toMatch(/^[a-f0-9]{64}$/u);

    const movedProject = join(root, "moved-again", "portable.film");
    await mkdir(movedProject, { recursive: true });
    await extractStoredZip(relocated, movedProject);
    const reopened = await OpenFilmApplication.open(movedProject);
    applications.add(reopened);
    for (const asset of fixture.photos.slice(0, 10)) {
      const source = reopened.catalog.getAsset(asset.id)!;
      expect(source.uri).toContain(join(movedProject, "sources"));
      expect(await hashFile(fileURLToPath(source.uri))).toBe(
        photoHashes.get(asset.id),
      );
    }
    const rendered = await reopened.exportMp4(fixture.compositionId);
    const movedFrames = await decodedVideoFrames(rendered.path);
    expect(movedFrames).toHaveLength(30);
    expect(movedFrames).toEqual(baselineFrames);
    expect(movedFrames[0]).toBe(movedFrames[27]);
    expect(movedFrames[0]).not.toBe(movedFrames[3]);
  }, 120_000);

  it("blocks missing rights, stale project revisions, changed sources, and output overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-collect-fencing-"));
    roots.push(root);
    const sourceDirectory = join(root, "physical-source");
    await mkdir(sourceDirectory);
    const external = join(sourceDirectory, "source.png");
    await imageAsset(external, "Synthetic source.png", "blue");
    const sourceAlias = join(root, "source-alias");
    await symlink(sourceDirectory, sourceAlias, "dir");
    const app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Fencing film",
    );
    applications.add(app);
    const asset = {
      id: "legacy-asset-id",
      uri: pathToFileURL(join(sourceAlias, "source.png")).href,
      name: "Synthetic source.png",
      mediaType: "image" as const,
      contentHash: await hashFile(external),
      tags: [],
      state: {},
      metadata: {},
    };
    app.catalog.upsertAsset(asset);
    app.project.stories = [
      {
        id: "legacy-story-id",
        title: "Story",
        beats: [
          {
            id: "beat",
            title: "Beat",
            candidateAssetIds: [asset.id],
            selectedAssetIds: [asset.id],
          },
        ],
      },
    ];
    app.project.timelines = [
      {
        id: "legacy-composition-id",
        storyId: "legacy-story-id",
        duration: 1,
        tracks: [
          {
            id: "pictures",
            type: "video",
            clips: [
              {
                id: "clip",
                assetId: asset.id,
                timelineStart: 0,
                timelineDuration: 1,
              },
            ],
          },
        ],
      },
    ];
    await app.save();
    const selection = {
      scope: "current-film" as const,
      compositionId: "legacy-composition-id",
    };
    const withoutRights = await app.collectMedia.plan(selection);
    expect(withoutRights.complete).toBe(false);
    expect(withoutRights.issues.map((issue) => issue.code)).toContain(
      "rights.required",
    );
    expect(withoutRights.issues.map((issue) => issue.code)).toContain(
      "source.unsafe-or-missing",
    );
    app.catalog.upsertAsset({ ...asset, uri: pathToFileURL(external).href });
    const rights = ownedRights(withoutRights.items);

    const savedManifest = await readFile(join(app.directory, "project.json"));
    const invalidProject = JSON.parse(savedManifest.toString("utf8")) as {
      timelines: Record<string, unknown>[];
    };
    invalidProject.timelines[0]!.graphicSceneTemplates = [
      {
        sceneId: "missing-scene",
        templateId: "route-story",
        version: 1,
        data: {},
      },
    ];
    await writeFile(
      join(app.directory, "project.json"),
      JSON.stringify(invalidProject),
    );
    await expect(app.collectMedia.plan(selection)).rejects.toMatchObject({
      code: "request.invalid",
    });
    await writeFile(join(app.directory, "project.json"), savedManifest);

    const staleProjectPlan = await app.collectMedia.plan({
      ...selection,
      rightsDeclarations: rights,
    });
    app.project.title = "Changed after package preview";
    await app.save();
    await expect(
      app.collectMedia.create({
        ...selection,
        rightsDeclarations: rights,
        planId: staleProjectPlan.id,
        baseRevision: staleProjectPlan.revision,
        destination: join(root, "stale.zip"),
        format: "zip",
      }),
    ).rejects.toMatchObject({ code: "story.planStale", status: 409 });

    const currentPlan = await app.collectMedia.plan({
      ...selection,
      rightsDeclarations: rights,
    });
    const outputAlias = join(root, "output-alias");
    await symlink(root, outputAlias, "dir");
    await expect(
      app.collectMedia.create({
        ...selection,
        rightsDeclarations: rights,
        planId: currentPlan.id,
        baseRevision: currentPlan.revision,
        destination: join(outputAlias, "symlink-parent.zip"),
        format: "zip",
      }),
    ).rejects.toMatchObject({ code: "export.failed", status: 422 });

    const controller = new AbortController();
    const cancelledPath = join(root, "cancelled.zip");
    await expect(
      app.collectMedia.create({
        ...selection,
        rightsDeclarations: rights,
        planId: currentPlan.id,
        baseRevision: currentPlan.revision,
        destination: cancelledPath,
        format: "zip",
        signal: controller.signal,
        onProgress(progress) {
          if (progress > 0) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "export.failed", status: 409 });
    await expect(lstat(cancelledPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const retried = await app.collectMedia.create({
      ...selection,
      rightsDeclarations: rights,
      planId: currentPlan.id,
      baseRevision: currentPlan.revision,
      destination: join(root, "retried.zip"),
      format: "zip",
    });
    expect(retried.sourceCount).toBe(1);

    await writeFile(external, "changed source bytes", { mode: 0o600 });
    await expect(
      app.collectMedia.create({
        ...selection,
        rightsDeclarations: rights,
        planId: currentPlan.id,
        baseRevision: currentPlan.revision,
        destination: join(root, "changed.zip"),
        format: "zip",
      }),
    ).rejects.toMatchObject({ code: "story.planStale", status: 409 });

    const existingPath = join(root, "already-here.zip");
    await writeFile(existingPath, "keep this", { flag: "wx", mode: 0o600 });
    await expect(
      app.collectMedia.create({
        ...selection,
        rightsDeclarations: rights,
        planId: currentPlan.id,
        baseRevision: currentPlan.revision,
        destination: existingPath,
        format: "zip",
      }),
    ).rejects.toMatchObject({
      code: "project.destinationInvalid",
      status: 409,
    });
    expect(await readFile(existingPath, "utf8")).toBe("keep this");
  });
});
