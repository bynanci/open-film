// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  cp,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import { inspectMedia, hashFile, runProcess } from "@openfilm/media";
import { exportTimeline } from "@openfilm/exporters";
import type { PresetApplyInput } from "@openfilm/core";
import { extractStoredZip } from "../../packages/application/src/collect-archive.js";
import { presetPackage } from "../fixtures/local-presets/package.js";
const roots: string[] = [],
  apps = new Set<OpenFilmApplication>();
afterEach(async () => {
  for (const a of apps) a.close({ requireSave: false });
  apps.clear();
  for (const p of roots.splice(0))
    await rm(p, { recursive: true, force: true });
});
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function decode(path: string) {
  return (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-threads",
      "1",
      "-i",
      path,
      "-pix_fmt",
      "rgb24",
      "-threads",
      "1",
      "-f",
      "rawvideo",
      "pipe:1",
    ])
  ).stdout;
}
it("keeps look/title/story snapshots through named restore and directory/ZIP Collect relocation without registry or original media", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-d8-portable-"));
  roots.push(root);
  const external = join(root, "originals"),
    directory = join(root, "Film.openfilm"),
    userDataDirectory = join(root, "user");
  await mkdir(external);
  const app = await OpenFilmApplication.create(
    directory,
    "Synthetic portable presets",
    {},
    { userDataDirectory },
  );
  apps.add(app);
  app.project.settings = { width: 160, height: 90, frameRate: 12 };
  const sources = [];
  for (const [i, color] of ["0x705038", "0x2070b0", "0xb08030"].entries()) {
    const path = join(external, `synthetic-${i}.png`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=160x90`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      path,
    ]);
    const asset = await inspectMedia({
      path,
      name: `Synthetic ${i}`,
      uri: pathToFileURL(path).href,
    });
    app.catalog.upsertAsset(asset);
    sources.push({ path, asset, sha256: await hashFile(path) });
  }
  app.project.stories.push({
    id: "source-story",
    title: "Authored original",
    targetDuration: 3,
    maxDuration: 12,
    beats: sources.map((s, i) => ({
      id: `b${i}`,
      title: `Scene ${i}`,
      candidateAssetIds: [s.asset.id],
      selectedAssetIds: [s.asset.id],
      constraints: [{ type: "must-include", assetIds: [s.asset.id] }],
      targetDuration: 1,
      minDuration: 1,
      maxDuration: 4,
    })),
  });
  const original = app.compose("source-story");
  original.tracks[0]!.clips[0]!.title = "記憶 Memories";
  app.project.timelines[0] = original;
  await app.save();
  const document = JSON.stringify(presetPackage()),
    imported = app.presets.registry.reviewImport(document),
    view = await app.presets.registry.install({
      document,
      packageSha256: imported.packageSha256,
      baseRegistryRevision: imported.registryRevision,
      reviewSha256: imported.reviewSha256,
      acknowledgeLicense: true,
    }),
    p = view.packages[0]!,
    editor = new TimelineEditor(app);
  for (const kind of ["film-look", "title", "story"] as const) {
    const target: PresetApplyInput["target"] =
      kind === "film-look"
        ? { kind, compositionId: original.id, scope: "film" }
        : kind === "title"
          ? {
              kind,
              compositionId: original.id,
              clipId: original.tracks[0]!.clips[0]!.id,
            }
          : {
              kind,
              storyId: "source-story",
              bindings: ["begin", "middle", "end"].map((recipeBeatKey, i) => ({
                recipeBeatKey,
                beatId: `b${i}`,
              })),
              options: { targetDuration: 6, maxDuration: 12 },
            };
    const request: PresetApplyInput = {
        projectId: app.project.id,
        selection: {
          canonicalId: p.entrySummaries.find((e) => e.kind === kind)!
            .canonicalId,
          packageSha256: p.packageSha256,
          registryRevision: view.revision,
        },
        baseRevision:
          kind === "story"
            ? app.versions.currentRevision()
            : editor.get(original.id).revision,
        target,
      },
      review = app.presets.review(request, editor);
    await app.presets.accept(
      {
        request,
        reviewSha256: review.reviewSha256,
        requestId: `media-${kind}`,
      },
      editor,
    );
  }
  const saved = structuredClone(app.project.timelines[0]!);
  for (const format of ["json", "otio"] as const) {
    const content = exportTimeline(
      format,
      saved,
      sources.map((s) => s.asset),
      app.project.settings,
    ).content;
    expect(content).toContain(
      saved.defaultLook!.version === 2
        ? saved.defaultLook!.snapshot.snapshotSha256
        : "missing",
    );
    expect(content).toContain(
      saved.tracks[0]!.clips[0]!.titlePresetSnapshot!.snapshotSha256,
    );
  }
  const version = await app.versions.create({
    name: "All local presets",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  await editor.edit(original.id, {
    baseRevision: editor.get(original.id).revision,
    commands: [{ type: "look", scope: "film", look: null }],
  });
  await app.versions.restore(version.id, {
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
    confirmed: true,
  });
  expect(app.project.timelines[0]).toEqual(saved);
  const baseline = await app.exportMp4(original.id),
    pixels = await decode(baseline.path),
    manifest = JSON.parse(
      await readFile(baseline.path + ".manifest.json", "utf8"),
    );
  expect(pixels.length / (160 * 90 * 3)).toBe(36);
  expect(manifest.fonts.length).toBeGreaterThan(0);
  expect(
    manifest.fonts.every((f: { sha256: string }) =>
      /^[a-f0-9]{64}$/.test(f.sha256),
    ),
  ).toBe(true);
  expect(
    [...pixels.subarray(0, 160 * 90 * 3)].filter(
      (_, i) =>
        i % 3 === 0 &&
        pixels[i]! > 240 &&
        pixels[i + 1]! > 240 &&
        pixels[i + 2]! > 240,
    ).length,
  ).toBeGreaterThan(10);
  const selection = { scope: "entire-project" as const },
    unconfirmed = await app.collectMedia.plan(selection),
    rightsDeclarations = unconfirmed.items.map((item) => ({
      resourceId: item.resourceId,
      basis: item.kind === "font" ? ("licensed" as const) : ("cc0" as const),
      confirmed: true as const,
      ...(item.kind === "font"
        ? {
            licenseName: "SIL Open Font License 1.1",
            attribution: "Noto contributors",
          }
        : {
            licenseName: "CC0-1.0",
            attribution: "OpenFilm contributors; original synthetic media",
          }),
    })),
    plan = await app.collectMedia.plan({ ...selection, rightsDeclarations });
  expect(plan.complete).toBe(true);
  const transfer = join(root, "transfer");
  await mkdir(transfer);
  for (const format of ["directory", "zip"] as const)
    await app.collectMedia.create({
      ...selection,
      rightsDeclarations,
      planId: plan.id,
      baseRevision: plan.revision,
      destination: join(
        transfer,
        format === "zip" ? "Film.zip" : "Film.openfilm",
      ),
      format,
    });
  await app.presets.registry.remove({
    packageId: p.id,
    packageVersion: p.version,
    packageSha256: p.packageSha256,
    baseRegistryRevision: view.revision,
  });
  for (const source of sources)
    expect(await hashFile(source.path)).toBe(source.sha256);
  app.close();
  apps.delete(app);
  await rm(external, { recursive: true });
  await rm(userDataDirectory, { recursive: true });
  const moved = join(root, "relocated.openfilm");
  await cp(join(transfer, "Film.openfilm"), moved, { recursive: true });
  const extracted = join(root, "unzipped.openfilm");
  await mkdir(extracted);
  await extractStoredZip(join(transfer, "Film.zip"), extracted);
  const relocated: Array<{
    format: string;
    decodedSha256: string;
    encodedSha256: string;
    snapshotSha256s: string[];
  }> = [];
  for (const [format, path] of [
    ["directory", moved],
    ["zip", extracted],
  ] as const) {
    const received = await OpenFilmApplication.open(path, {
      userDataDirectory: join(root, `empty-user-${format}`),
    });
    apps.add(received);
    expect(received.project.timelines[0]).toEqual(saved);
    expect(
      received.project.stories.some((s) => s.presetSnapshot?.kind === "story"),
    ).toBe(true);
    expect((await readdir(path)).includes("presets")).toBe(false);
    const output = await received.exportMp4(original.id),
      actual = await decode(output.path);
    expect(actual).toEqual(pixels);
    const evidence = JSON.parse(
      await readFile(output.path + ".manifest.json", "utf8"),
    );
    relocated.push({
      format,
      decodedSha256: sha(actual),
      encodedSha256: await hashFile(output.path),
      snapshotSha256s: evidence.presetSnapshots.map(
        (s: { snapshotSha256: string }) => s.snapshotSha256,
      ),
    });
  }
  await writeFile(
    join(tmpdir(), "openfilm-d8-portability-evidence.json"),
    JSON.stringify(
      {
        format: "openfilm.d8.portability",
        sources: sources.map((s) => ({
          assetId: s.asset.id,
          sha256: s.sha256,
        })),
        packageSha256: p.packageSha256,
        fonts: manifest.fonts,
        decodedBaselineSha256: sha(pixels),
        encodedBaselineSha256: await hashFile(baseline.path),
        frames: 36,
        rate: "12/1",
        namedVersionRestored: true,
        relocated,
      },
      null,
      2,
    ),
  );
});
