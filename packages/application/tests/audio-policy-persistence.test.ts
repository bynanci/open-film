import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { hashFile } from "@openfilm/media";
import {
  OpenFilmApplication,
  TimelineEditor,
  createPresetSnapshot,
} from "../src/index.js";
import { validatePresetPackage } from "@openfilm/core";
import { presetPackage } from "../../../tests/fixtures/local-presets/package.js";
import { remapCollectProject } from "../src/collect-derived-media.js";
import { extractStoredZip } from "../src/collect-archive.js";
import { toneSource } from "../../../tests/fixtures/audio-policy.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const timing = {
  version: 1 as const,
  sampleRate: 48000 as const,
  timelineStartSample: 84001,
  sourceInSample: 24001,
  sourceOutSample: 204001,
};
async function fixture(independent = true) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-audio-retention-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const asset = await toneSource(root, "sound", 440, 8);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Sound retention",
  );
  cleanup.push(() => app.close());
  app.catalog.upsertAsset(asset);
  app.project.stories = [
    {
      id: "story",
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
  app.project.settings = { width: 160, height: 90, frameRate: 30 };
  app.project.timelines = [
    {
      id: "cut",
      storyId: "story",
      duration: 8,
      tracks: [
        {
          id: "sound",
          type: "audio",
          clips: [
            {
              id: "sound-1",
              beatId: "beat",
              assetId: asset.id,
              timelineStart: 2,
              timelineDuration: 2,
              sourceIn: 1,
              sourceOut: 3,
              ...(independent ? { audioTiming: structuredClone(timing) } : {}),
              audioAutomation: { version: 1, role: "dialogue", fadeIn: 0.2 },
            },
            {
              id: "same-source-legacy",
              beatId: "beat",
              assetId: asset.id,
              timelineStart: 6,
              timelineDuration: 2,
              sourceIn: 4,
              sourceOut: 6,
            },
          ],
        },
      ],
    },
  ];
  if (independent) app.project.schemaVersion = "1.2.0";
  await app.save();
  return {
    root,
    app,
    asset,
    source: fileURLToPath(asset.uri),
    composition: app.project.timelines[0]!,
  };
}

it("retains exact samples through named versions, explicit older Restore, checkpoints and reopen", async () => {
  const { app, source, asset } = await fixture(false);
  const old = await app.versions.create({
    name: "Linked",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  const editor = new TimelineEditor(app);
  await editor.edit("cut", {
    baseRevision: editor.get("cut").revision,
    commands: [{ type: "audio.timing", clipId: "sound-1", timing }],
  });
  const saved = structuredClone(app.project.timelines[0]);
  const independent = await app.versions.create({
    name: "Independent",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  expect(app.versions.inspect(independent.id).record.name).toBe("Independent");
  expect(
    app.versions.diff(old.id, independent.id).entries.length,
  ).toBeGreaterThan(0);
  const restore = await app.versions.restore(old.id, {
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
    confirmed: true,
  });
  expect(app.project.schemaVersion).toBe("1.0.0");
  expect(
    app.project.timelines[0]!.tracks[0]!.clips[0]!.audioTiming,
  ).toBeUndefined();
  await app.versions.restore(restore.checkpointVersionId, {
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
    confirmed: true,
  });
  expect(app.project.schemaVersion).toBe("1.2.0");
  expect(app.project.timelines[0]).toEqual(saved);
  const reopened = await OpenFilmApplication.open(app.directory);
  cleanup.push(() => reopened.close());
  expect(reopened.project.timelines[0]).toEqual(saved);
  expect(reopened.catalog.getAsset(asset.id)?.contentHash).toBe(
    await hashFile(source),
  );
});

it("retains independent same-source occurrences and pin payloads in no-op variant/adoption", async () => {
  const { app, root, composition, source, asset } = await fixture();
  const photo = join(root, "pixel.png");
  await writeFile(
    photo,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5h8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  app.catalog.upsertAsset({
    id: "photo",
    name: "Synthetic pixel",
    uri: pathToFileURL(photo).href,
    mediaType: "image",
    dimensions: { width: 1, height: 1 },
    contentHash: await hashFile(photo),
    tags: [],
    state: {},
    metadata: {},
  });
  const pkg = validatePresetPackage(presetPackage());
  const entry = pkg.entries.find((row) => row.kind === "film-look")!;
  // Sound is an authored overlay beside the one sequential photo spine.
  composition.tracks[0]!.timing = "overlay";
  app.project.stories[0]!.beats[0]!.selectedAssetIds = ["photo"];
  app.project.stories[0]!.beats[0]!.candidateAssetIds = ["sound", "photo"];
  composition.tracks.push({
    id: "photo",
    type: "video",
    clips: [
      {
        id: "finishing",
        beatId: "beat",
        assetId: "photo",
        timelineStart: 0,
        timelineDuration: 8,
        sourceIn: 0,
        sourceOut: 8,
        layout: {
          version: 2,
          preset: "contain",
          fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
        },
        motion: {
          version: 2,
          preset: "pan",
          easing: {
            version: 1,
            kind: "cubic-bezier",
            x1: 0.2,
            y1: 0.1,
            x2: 0.8,
            y2: 0.9,
          },
          from: { scale: 1, x: 0, y: 0 },
          to: { scale: 1, x: 1, y: 0 },
        },
        title: "記憶\nMemories",
        titleRuns: { version: 1, splitAt: 2, secondary: { tracking: 1 } },
        titleStyle: {
          version: 1,
          role: "film-title",
          finishing: { version: 1, stroke: { color: "#000000", width: 1 } },
        },
        primaryColor: {
          version: 1,
          temperature: 0.1,
          exposureEv: 0.2,
          contrast: 1.1,
        },
        look: {
          version: 2,
          preset: "local",
          strength: 0.8,
          snapshot: createPresetSnapshot<"film-look">(pkg, entry),
        },
        userOverrides: {
          version: 1,
          isUserPinned: true,
          lockedAttributes: ["timing", "motionPreset"],
        },
      },
    ],
  });
  composition.tracks[0]!.clips[0]!.userOverrides = {
    version: 1,
    isUserPinned: true,
    lockedAttributes: ["timing"],
  };
  await app.save();
  const before = structuredClone(
    composition.tracks.flatMap((track) => track.clips),
  );
  const variant = await app.creativeVariants.createVariant({
    name: "Preserve",
    intent: "Retain authored sound",
    scope: { type: "film" },
    modifications: {},
  });
  await app.save();
  const derived = app.project.timelines.find(
    (c) => c.id === variant.derivedCompositionId,
  )!;
  for (const prior of before) {
    const mapped = variant.provenanceMapping.clipMappings.find(
      (m) => m.baselineClipId === prior.id,
    )!;
    const beat = variant.provenanceMapping.beatMappings.find(
      (m) => m.baselineBeatId === prior.beatId,
    )!;
    expect(
      derived.tracks
        .flatMap((track) => track.clips)
        .find((c) => c.id === mapped.variantClipId),
    ).toEqual({
      ...prior,
      id: mapped.variantClipId,
      beatId: beat.variantBeatId,
    });
  }
  await app.creativeVariants.adoptVariant(variant.id, {
    expectedRevision: app.versions.currentRevision(),
  });
  await app.save();
  const reopened = await OpenFilmApplication.open(app.directory);
  cleanup.push(() => reopened.close());
  expect(reopened.project.schemaVersion).toBe("1.2.0");
  expect(reopened.project.timelines[0]).toEqual(derived);
  expect(await hashFile(source)).toBe(asset.contentHash);
});

it("rejects variant replacement of independently configured sound before publishing any variant", async () => {
  const { app, composition, root } = await fixture();
  const substitute = await toneSource(root, "replacement", 880, 8);
  app.catalog.upsertAsset(substitute);
  await app.save();
  const before = structuredClone(app.project),
    revision = app.catalog.logicalRevision();
  await expect(
    app.creativeVariants.createVariant({
      name: "Replacement",
      intent: "Replace picture",
      scope: { type: "section", targetBeatId: "beat" },
      modifications: {
        replaceAssetIds: [{ fromAssetId: "sound", toAssetId: "replacement" }],
      },
    }),
  ).rejects.toMatchObject({ code: "timeline.audioTimingConflict" });
  expect(app.project).toEqual(before);
  expect(app.project.timelines[0]).toEqual(composition);
  expect(app.catalog.logicalRevision()).toBe(revision);
  expect(await app.creativeVariants.listVariants()).toEqual([]);
});

it("takes full-original coverage for mixed independent/legacy uses", async () => {
  const { app } = await fixture();
  const review = await app.collectMedia.coverage({
    scope: "current-film",
    compositionId: "cut",
    projectId: app.project.id,
    delivery: { version: 1, mode: "trimmed-originals", handlesSeconds: 0 },
  });
  expect(review.coverage.entries[0]).toMatchObject({
    action: "copy-original",
    reasons: ["source.independent-audio"],
    ranges: [{ start: 0, end: 8 }],
  });
});

it("refuses defensive derivative remap for a source shared by independent and legacy uses", async () => {
  const { app, composition, asset } = await fixture();
  expect(() =>
    remapCollectProject(
      app.project,
      [asset],
      [
        {
          version: 1,
          assetId: asset.id,
          originalSha256: asset.contentHash!,
          derivedSha256: "b".repeat(64),
          sourceDuration: 8,
          derivedDuration: 7,
          quality: "lossless",
          recipe: "ffv1-pcm-v1",
          windows: [
            { sourceStart: 1, sourceEnd: 8, derivedStart: 0, derivedEnd: 7 },
          ],
        },
      ],
    ),
  ).toThrow(/independent sound|independent audio/i);
  expect(composition.tracks[0]!.clips[0]!.audioTiming).toEqual(timing);
});

it.each(["current-film", "entire-project"] as const)(
  "retains exact sample objects and source hashes in %s directory and ZIP Collect",
  async (scope) => {
    const { app, root, asset, source, composition } = await fixture();
    const input = {
      scope,
      ...(scope === "current-film" ? { compositionId: "cut" } : {}),
      rightsDeclarations: [
        {
          resourceId: "asset:sound",
          basis: "owned" as const,
          confirmed: true as const,
        },
      ],
    };
    const plan = await app.collectMedia.plan(input);
    expect(plan.complete).toBe(true);
    for (const format of ["directory", "zip"] as const) {
      const destination = join(
        root,
        `portable-${scope}-${format}${format === "zip" ? ".zip" : ".openfilm"}`,
      );
      await app.collectMedia.create({
        ...input,
        planId: plan.id,
        baseRevision: plan.revision,
        destination,
        format,
      });
      let packageDirectory = destination;
      if (format === "zip") {
        packageDirectory = join(root, `unpacked-${scope}`);
        await mkdir(packageDirectory);
        await extractStoredZip(destination, packageDirectory);
      }
      const manifest = JSON.parse(
        await readFile(join(packageDirectory, "project.json"), "utf8"),
      );
      expect(manifest.schemaVersion).toBe("1.2.0");
      expect(manifest.timelines[0]).toEqual(composition);
      const opened = await OpenFilmApplication.open(packageDirectory);
      cleanup.push(() => opened.close());
      const packaged = opened.catalog.getAsset(asset.id)!;
      expect(await hashFile(fileURLToPath(packaged.uri))).toBe(
        asset.contentHash,
      );
      expect(opened.project.timelines[0]).toEqual(composition);
    }
    expect(await hashFile(source)).toBe(asset.contentHash);
  },
);
