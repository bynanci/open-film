// SPDX-License-Identifier: Apache-2.0
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import { inspectMedia, hashFile, runProcess } from "@openfilm/media";
import { FFmpegRenderer } from "@openfilm/render";
import type { PresetApplyInput, TitleStyle } from "@openfilm/core";
import { presetPackage } from "../fixtures/local-presets/package.js";

const roots: string[] = [],
  apps = new Set<OpenFilmApplication>();
afterEach(async () => {
  for (const app of apps) app.close({ requireSave: false });
  apps.clear();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("applies nested title finishing to bilingual ambient photos and reopens without the local registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "preset-title-finishing-"));
  roots.push(root);
  const directory = join(root, "Film.openfilm"),
    userDataDirectory = join(root, "user"),
    source = join(root, "portrait.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x507090:s=120x180",
    "-frames:v",
    "1",
    "-threads",
    "1",
    source,
  ]);
  const sourceSha256 = await hashFile(source),
    asset = await inspectMedia({
      path: source,
      uri: pathToFileURL(source).href,
      name: "Synthetic portrait",
    });
  const app = await OpenFilmApplication.create(
    directory,
    "Synthetic finishing preset",
    {},
    { userDataDirectory },
  );
  apps.add(app);
  app.project.settings = { width: 320, height: 180, frameRate: 12 };
  app.catalog.upsertAsset(asset);
  app.project.stories.push({
    id: "story",
    title: "Authored",
    beats: [{ id: "beat", title: "Memory", selectedAssetIds: [asset.id] }],
  });
  app.project.timelines.push({
    id: "cut",
    storyId: "story",
    duration: 1,
    tracks: [
      {
        id: "picture",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: asset.id,
            timelineStart: 0,
            timelineDuration: 1,
            title: "繁體標題\nOur story",
            titleRuns: {
              version: 1,
              splitAt: 4,
              primary: { fontSize: 20 },
              secondary: { fontSize: 14, fontWeight: 700 },
              gap: 8,
            },
            layout: {
              version: 2,
              preset: "contain",
              fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
            },
            motion: {
              version: 2,
              preset: "push-in",
              from: { scale: 1, x: 0, y: 0 },
              to: { scale: 1.02, x: 0, y: 0 },
              easing: {
                version: 1,
                kind: "cubic-bezier",
                x1: 0.42,
                y1: 0,
                x2: 0.58,
                y2: 1,
              },
            },
          },
        ],
      },
    ],
  });
  await app.save();
  const editor = new TimelineEditor(app),
    before = editor.get("cut").composition;
  const pkg = presetPackage();
  const finishing: NonNullable<TitleStyle["finishing"]> = {
    version: 1,
    stroke: { color: "#112299", width: 2 },
    shadow: { color: "#000000", opacity: 0.7, offsetX: 2, offsetY: 2, blur: 1 },
    pill: {
      color: "#442211",
      opacity: 0.8,
      paddingX: 4,
      paddingY: 3,
      radius: 2,
    },
  };
  Object.assign(pkg.entries[1]!.recipe, { finishing });
  const document = JSON.stringify(pkg),
    imported = app.presets.registry.reviewImport(document);
  const malformed = structuredClone(pkg);
  Object.assign(malformed.entries[1]!.recipe, {
    finishing: { ...finishing, version: 999 },
  });
  expect(() =>
    app.presets.registry.reviewImport(JSON.stringify(malformed)),
  ).toThrow(/version/i);
  const view = await app.presets.registry.install({
    document,
    packageSha256: imported.packageSha256,
    baseRegistryRevision: imported.registryRevision,
    reviewSha256: imported.reviewSha256,
    acknowledgeLicense: true,
  });
  const installed = view.packages[0]!;
  for (const kind of ["film-look", "title"] as const) {
    const request: PresetApplyInput = {
      projectId: app.project.id,
      selection: {
        canonicalId: installed.entrySummaries.find((e) => e.kind === kind)!
          .canonicalId,
        packageSha256: installed.packageSha256,
        registryRevision: view.revision,
      },
      baseRevision: editor.get("cut").revision,
      target:
        kind === "film-look"
          ? { kind, compositionId: "cut", scope: "film" }
          : { kind, compositionId: "cut", clipId: "clip" },
    };
    const review = app.presets.review(request, editor);
    await app.presets.accept(
      {
        request,
        reviewSha256: review.reviewSha256,
        requestId: `finishing-${kind}`,
      },
      editor,
    );
  }
  const saved = editor.get("cut").composition,
    clip = saved.tracks[0]!.clips[0]!;
  expect(saved.defaultLook?.version).toBe(2);
  expect(clip.titleStyle?.finishing).toEqual(finishing);
  expect(clip.titlePresetSnapshot?.recipe.finishing).toEqual(finishing);
  for (const key of ["title", "titleRuns", "layout", "motion"] as const)
    expect(clip[key]).toEqual(before.tracks[0]!.clips[0]![key]);
  await editor.undo("cut", editor.get("cut").revision);
  expect(
    editor.get("cut").composition.tracks[0]!.clips[0]!.titleStyle,
  ).toBeUndefined();
  await editor.redo("cut", editor.get("cut").revision);
  expect(editor.get("cut").composition).toEqual(saved);
  await app.presets.registry.remove({
    packageId: installed.id,
    packageVersion: installed.version,
    packageSha256: installed.packageSha256,
    baseRegistryRevision: view.revision,
  });
  app.close();
  apps.delete(app);
  await rm(userDataDirectory, { recursive: true });
  const reopened = await OpenFilmApplication.open(directory, {
    userDataDirectory,
  });
  apps.add(reopened);
  expect(reopened.project.timelines[0]).toEqual(saved);
  const actual = await reopened.exportMp4("cut"),
    baseline = join(root, "direct-owner.mp4");
  const direct = structuredClone(saved);
  delete direct.tracks[0]!.clips[0]!.titlePresetSnapshot;
  await new FFmpegRenderer().render(
    direct,
    [asset],
    baseline,
    reopened.project.settings,
  );
  const decode = async (path: string) =>
    (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        path,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ])
    ).stdout;
  expect(await decode(actual.path)).toEqual(await decode(baseline));
  const manifest = JSON.parse(
    await readFile(`${actual.path}.manifest.json`, "utf8"),
  );
  expect(
    manifest.fontBindings
      .filter((b: { usage: string[] }) => b.usage[0] === "title")
      .map((b: { run: string }) => b.run),
  ).toEqual(["primary", "secondary"]);
  expect(
    manifest.presetSnapshots.some(
      (s: { snapshotSha256: string }) =>
        s.snapshotSha256 === clip.titlePresetSnapshot!.snapshotSha256,
    ),
  ).toBe(true);
  expect(await hashFile(source)).toBe(sourceSha256);
  const evidence = process.env.OPENFILM_PRESET_FINISHING_QA_OUTPUT;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await cp(root, join(evidence, "bilingual-preset"), { recursive: true });
  }
});
