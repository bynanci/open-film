// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { inspectMedia, runProcess, hashFile } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";
import { extractStoredZip } from "../src/collect-archive.js";
import { FFmpegRenderer } from "@openfilm/render";

const stops: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-collect-derived-"));
  stops.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "synthetic-long-gop.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=20:d=8",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000:duration=8",
    "-c:v",
    "libx264",
    "-g",
    "160",
    "-bf",
    "2",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  const asset = await inspectMedia({
    path: source,
    uri: pathToFileURL(source).href,
    name: "Synthetic long GOP",
  });
  // No opaque import provenance or immutable transcript clock in this fixture.
  asset.metadata = {
    "openfilm.ffprobe": asset.metadata["openfilm.ffprobe"],
    "openfilm.color": asset.metadata["openfilm.color"],
  };
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Synthetic derivatives",
  );
  stops.push(() => app.close({ requireSave: false }));
  app.catalog.upsertAsset(asset);
  app.project.settings = { width: 160, height: 90, frameRate: 20 };
  app.project.stories = [
    {
      id: "story",
      title: "Synthetic",
      beats: [
        {
          id: "beat",
          title: "Synthetic beat",
          candidateAssetIds: [asset.id],
          selectedAssetIds: [asset.id],
        },
      ],
    },
  ];
  app.project.timelines = [
    {
      id: "film",
      storyId: "story",
      duration: 2,
      tracks: [
        {
          id: "picture",
          type: "video",
          clips: [
            {
              id: "first",
              assetId: asset.id,
              beatId: "beat",
              timelineStart: 0,
              timelineDuration: 1,
              sourceIn: 1,
              sourceOut: 2,
            },
            {
              id: "second",
              assetId: asset.id,
              beatId: "beat",
              timelineStart: 1,
              timelineDuration: 1,
              sourceIn: 5,
              sourceOut: 7,
              transform: { speed: 2 },
            },
          ],
        },
      ],
    },
  ];
  await app.save();
  const base = {
    scope: "current-film" as const,
    compositionId: "film",
    rightsDeclarations: [
      {
        resourceId: `asset:${asset.id}`,
        basis: "cc0" as const,
        licenseName: "CC0-1.0",
        confirmed: true as const,
      },
    ],
  };
  const delivery = {
    version: 1 as const,
    mode: "trimmed-originals" as const,
    handlesSeconds: 0.25,
  };
  const review = await app.collectMedia.coverage({
    ...base,
    projectId: app.project.id,
    delivery,
  });
  const before = {
    project: await readFile(join(app.directory, "project.json")),
    revision: app.catalog.logicalRevision(),
    asset: app.catalog.getAsset(asset.id),
    hash: await hashFile(source),
  };
  const input = {
    ...base,
    planId: review.baseline.id,
    baseRevision: review.baseline.revision,
    delivery,
    coverageId: review.coverageId,
    projectId: app.project.id,
    acceptDelivery: true as const,
  };
  return { root, source, asset, app, base, delivery, review, before, input };
}

it("publishes actual lossless disjoint source windows with original-baseline decoded parity and immutable originals", async () => {
  const f = await fixture(),
    destination = join(f.root, "delivery.zip");
  const result = await f.app.collectMedia.create({
    ...f.input,
    destination,
    format: "zip",
  });
  const relocated = join(f.root, "relocated.openfilm");
  await extractStoredZip(destination, relocated);
  const manifest = JSON.parse(
    await readFile(join(relocated, "collect-manifest.json"), "utf8"),
  );
  expect(manifest.version).toBe(2);
  expect(manifest.delivery.mode).toBe("trimmed-originals");
  expect(manifest.derivatives).toHaveLength(1);
  const receipt = manifest.derivatives[0];
  expect(receipt).toMatchObject({
    assetId: f.asset.id,
    originalSha256: f.before.hash,
    recipe: "ffv1-pcm-v1",
    quality: "lossless",
    sourceDuration: 8,
  });
  expect(receipt.windows).toEqual([
    { sourceStart: 0.75, sourceEnd: 2.25, derivedStart: 0, derivedEnd: 1.5 },
    { sourceStart: 4.75, sourceEnd: 7.25, derivedStart: 1.5, derivedEnd: 4 },
  ]);
  expect(receipt.derivedSha256).not.toBe(f.before.hash);
  expect(await hashFile(join(relocated, manifest.assets[0].path))).toBe(
    receipt.derivedSha256,
  );
  expect(manifest.parity).toHaveLength(1);
  expect(manifest.parity[0]).toMatchObject({
    compositionId: "film",
    matched: true,
  });
  expect(manifest.parity[0].original).toEqual(manifest.parity[0].derived);
  expect(manifest.parity[0].original.videoFrames).toBe(40);
  expect(manifest.parity[0].original.audioSha256).toMatch(/^[a-f0-9]{64}$/u);
  const packed = JSON.parse(
    await readFile(join(relocated, "project.json"), "utf8"),
  );
  expect(
    packed.timelines[0].tracks[0].clips.map(
      (clip: { sourceIn: number; sourceOut: number }) => [
        clip.sourceIn,
        clip.sourceOut,
      ],
    ),
  ).toEqual([
    [0.25, 1.25],
    [1.75, 3.75],
  ]);
  expect(packed.timelines[0].duration).toBe(2);
  const verified = await f.app.collectMedia.verify(relocated);
  expect(verified.verified).toBe(true);
  expect(verified.outputFrames).toBe(40);
  expect(result.manifestSha256).toBe(
    await hashFile(join(relocated, "collect-manifest.json")),
  );
  expect(await readFile(join(f.app.directory, "project.json"))).toEqual(
    f.before.project,
  );
  expect(f.app.catalog.logicalRevision()).toBe(f.before.revision);
  expect(f.app.catalog.getAsset(f.asset.id)).toEqual(f.before.asset);
  expect(await hashFile(f.source)).toBe(f.before.hash);
}, 120_000);

it("requires explicit version-bound delivery acceptance before writing a package", async () => {
  const f = await fixture();
  await expect(
    f.app.collectMedia.create({
      ...f.input,
      acceptDelivery: false,
      destination: join(f.root, "unaccepted.zip"),
      format: "zip",
    } as never),
  ).rejects.toMatchObject({ code: "request.invalid" });
  await expect(
    f.app.collectMedia.create({
      ...f.input,
      projectId: "foreign",
      destination: join(f.root, "foreign.zip"),
      format: "zip",
    }),
  ).rejects.toMatchObject({ code: "story.planStale" });
  await expect(
    f.app.collectMedia.create({
      ...f.input,
      delivery: { ...f.delivery, handlesSeconds: 1 },
      destination: join(f.root, "changed-options.zip"),
      format: "zip",
    }),
  ).rejects.toMatchObject({ code: "story.planStale" });
});

it("labels offline delivery and every reopened export as lower-quality review media", async () => {
  const f = await fixture(),
    delivery = { ...f.delivery, mode: "offline-proxies" as const };
  const review = await f.app.collectMedia.coverage({
    ...f.base,
    projectId: f.app.project.id,
    delivery,
  });
  const destination = join(f.root, "offline.openfilm");
  await f.app.collectMedia.create({
    ...f.input,
    delivery,
    coverageId: review.coverageId,
    destination,
    format: "directory",
  });
  const manifest = JSON.parse(
    await readFile(join(destination, "collect-manifest.json"), "utf8"),
  );
  expect(manifest.derivatives[0]).toMatchObject({
    recipe: "preview-v1",
    quality: "offline-only",
    sourceDuration: 8,
    derivedDuration: 8,
    windows: [{ sourceStart: 0, sourceEnd: 8, derivedStart: 0, derivedEnd: 8 }],
  });
  expect(manifest.parity[0].matched).toBe(false);
  expect(manifest.parity[0].derived.videoFrames).toBe(40);
  const verified = await f.app.collectMedia.verify(destination);
  expect(verified.warnings).toContain("collect.offline-quality");
  expect(await hashFile(f.source)).toBe(f.before.hash);
});

it("retains protected transcript clocks and locked source identity while preserving manual captions", async () => {
  const f = await fixture();
  f.app.catalog.intelligence.replaceTranscript({
    id: "transcript",
    assetId: f.asset.id,
    language: "zh-TW",
    provenance: {
      providerId: "synthetic",
      version: "1",
      sourceHash: f.before.hash,
      createdAt: "2026-10-30T00:00:00.000Z",
    },
    segments: [{ id: "segment", start: 1, end: 2, text: "合成旁白" }],
  });
  const film = f.app.project.timelines[0]!;
  film.tracks[0]!.clips[0]!.locked = true;
  film.captionTracks = [
    {
      version: 1,
      id: "manual",
      name: "繁體中文",
      language: "zh-TW",
      style: {
        version: 1,
        role: "subtitle",
        fontFamily: "Noto Sans CJK TC",
        fontSize: 14,
      },
      cues: [
        {
          version: 1,
          id: "manual-cue",
          startMs: 250,
          endMs: 1500,
          text: "合成繁體字幕",
          source: { kind: "manual" },
          manualRevision: 2,
        },
      ],
    },
  ];
  await f.app.save();
  const preliminary = await f.app.collectMedia.plan(f.base);
  const rightsDeclarations = [
    ...f.base.rightsDeclarations,
    ...preliminary.items
      .filter((item) => item.kind === "font")
      .map((item) => ({
        resourceId: item.resourceId,
        basis: "licensed" as const,
        licenseName: "SIL-OFL-1.1",
        confirmed: true as const,
      })),
  ];
  const review = await f.app.collectMedia.coverage({
    ...f.base,
    rightsDeclarations,
    projectId: f.app.project.id,
    delivery: f.delivery,
  });
  const destination = join(f.root, "protected.openfilm");
  await f.app.collectMedia.create({
    ...f.input,
    rightsDeclarations,
    coverageId: review.coverageId,
    planId: review.baseline.id,
    baseRevision: review.baseline.revision,
    destination,
    format: "directory",
  });
  const manifest = JSON.parse(
    await readFile(join(destination, "collect-manifest.json"), "utf8"),
  );
  expect(manifest.derivatives).toEqual([]);
  expect(manifest.retained[0].assetId).toBe(f.asset.id);
  expect(manifest.assets[0].sha256).toBe(f.before.hash);
  const reopened = await OpenFilmApplication.openForExport(destination);
  stops.push(() => reopened.close({ requireSave: false }));
  expect(reopened.project.timelines[0]!.tracks[0]!.clips).toEqual(
    film.tracks[0]!.clips,
  );
  expect(reopened.project.timelines[0]!.captionTracks).toEqual(
    film.captionTracks,
  );
  expect(
    reopened.catalog.intelligence.getFullTranscript(f.asset.id, f.before.hash)
      ?.segments[0]?.text,
  ).toBe("合成旁白");
});

it("rejects malformed v2 source clocks and unknown lineage versions before relocation rendering", async () => {
  const f = await fixture(),
    destination = join(f.root, "strict.openfilm");
  await f.app.collectMedia.create({
    ...f.input,
    destination,
    format: "directory",
  });
  const path = join(destination, "collect-manifest.json"),
    original = JSON.parse(await readFile(path, "utf8"));
  const { writeFile } = await import("node:fs/promises");
  for (const mutate of [
    (m: typeof original) => {
      m.derivatives[0].version = 2;
    },
    (m: typeof original) => {
      m.derivatives[0].windows[0].sourceStart = -1;
    },
    (m: typeof original) => {
      m.derivatives[0].windows[1].derivedStart = 0;
    },
    (m: typeof original) => {
      m.derivatives[0].derivedSha256 = "a".repeat(64);
    },
    (m: typeof original) => {
      m.delivery.remoteUrl = "https://invalid.test/private";
    },
    (m: typeof original) => {
      m.parity[0].matched = false;
    },
  ]) {
    const malformed = structuredClone(original);
    mutate(malformed);
    await writeFile(path, JSON.stringify(malformed));
    await expect(f.app.collectMedia.verify(destination)).rejects.toMatchObject({
      code: "request.invalid",
    });
  }
});

it("cancels before derivative work without a published or partial destination", async () => {
  const f = await fixture(),
    controller = new AbortController(),
    destination = join(f.root, "cancelled.zip");
  await expect(
    f.app.collectMedia.create({
      ...f.input,
      destination,
      format: "zip",
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).rejects.toMatchObject({ code: "export.failed" });
  await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await hashFile(f.source)).toBe(f.before.hash);
});
it("bounds private parity render bytes without publishing a truncated render", async () => {
  const f = await fixture(),
    output = join(f.root, "bounded.mp4");
  await expect(
    new FFmpegRenderer().render(
      f.app.project.timelines[0]!,
      [f.asset],
      output,
      f.app.project.settings,
      { maximumOutputBytes: 1024 },
    ),
  ).rejects.toThrow(/byte|bound/i);
  await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
});
it("retains a real variable-frame-rate source with an explicit unsupported-clock receipt", async () => {
  const f = await fixture(),
    vfr = join(f.root, "synthetic-vfr.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-i",
    f.source,
    "-vf",
    "select=not(eq(mod(n\\,5)\\,0))",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-c:a",
    "copy",
    vfr,
  ]);
  const inspected = await inspectMedia({
    path: vfr,
    uri: pathToFileURL(vfr).href,
    name: "Synthetic VFR",
  });
  f.app.catalog.upsertAsset({
    ...inspected,
    id: f.asset.id,
    metadata: { "openfilm.ffprobe": inspected.metadata["openfilm.ffprobe"] },
  });
  const review = await f.app.collectMedia.coverage({
    ...f.base,
    projectId: f.app.project.id,
    delivery: f.delivery,
  });
  const destination = join(f.root, "vfr.zip");
  await f.app.collectMedia.create({
    ...f.input,
    planId: review.baseline.id,
    baseRevision: review.baseline.revision,
    coverageId: review.coverageId,
    destination,
    format: "zip",
  });
  const relocated = join(f.root, "vfr.openfilm");
  await extractStoredZip(destination, relocated);
  const manifest = JSON.parse(
    await readFile(join(relocated, "collect-manifest.json"), "utf8"),
  );
  expect(manifest.derivatives).toEqual([]);
  expect(manifest.retained).toEqual([
    { assetId: f.asset.id, reason: "source.clock-unsupported" },
  ]);
  expect(manifest.assets[0].sha256).toBe(await hashFile(vfr));
});

it("fences a source changed after copying before publishing validated delivery", async () => {
  const f = await fixture(),
    destination = join(f.root, "changed.zip");
  const { appendFileSync } = await import("node:fs");
  let changed = false;
  await expect(
    f.app.collectMedia.create({
      ...f.input,
      destination,
      format: "zip",
      onProgress: (progress) => {
        if (progress < 1 && !changed) {
          appendFileSync(f.source, "external synthetic mutation");
          changed = true;
        }
      },
    }),
  ).rejects.toMatchObject({ code: "story.planStale" });
  await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([0.5, 1.5])(
  "preserves decoded picture/audio clocks at fractional speed %s",
  async (speed) => {
    const f = await fixture(),
      clip = f.app.project.timelines[0]!.tracks[0]!.clips[1]!;
    clip.sourceOut = 5 + speed;
    clip.transform = { speed };
    await f.app.save();
    const saved = await readFile(join(f.app.directory, "project.json"));
    const review = await f.app.collectMedia.coverage({
      ...f.base,
      projectId: f.app.project.id,
      delivery: f.delivery,
    });
    const destination = join(f.root, "fractional.openfilm");
    await f.app.collectMedia.create({
      ...f.input,
      planId: review.baseline.id,
      baseRevision: review.baseline.revision,
      coverageId: review.coverageId,
      destination,
      format: "directory",
    });
    const manifest = JSON.parse(
      await readFile(join(destination, "collect-manifest.json"), "utf8"),
    );
    expect(manifest.parity[0].matched).toBe(true);
    expect(manifest.parity[0].original).toEqual(manifest.parity[0].derived);
    expect(manifest.parity[0].derived.videoFrames).toBe(40);
    expect(await readFile(join(f.app.directory, "project.json"))).toEqual(
      saved,
    );
    expect(await hashFile(f.source)).toBe(f.before.hash);
  },
);

it("preserves every retained native PCM32 sample rather than relying on lossy AAC parity", async () => {
  const f = await fixture(),
    source = join(f.root, "precision.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.5+1/2147483648:s=48000:d=8",
    "-c:a",
    "pcm_s32le",
    source,
  ]);
  const audio = await inspectMedia({
    path: source,
    uri: pathToFileURL(source).href,
    name: "Synthetic PCM32",
  });
  f.app.catalog.upsertAsset({
    ...audio,
    id: f.asset.id,
    metadata: { "openfilm.ffprobe": audio.metadata["openfilm.ffprobe"] },
  });
  const review = await f.app.collectMedia.coverage({
    ...f.base,
    projectId: f.app.project.id,
    delivery: f.delivery,
  });
  const destination = join(f.root, "precision.openfilm");
  await f.app.collectMedia.create({
    ...f.input,
    planId: review.baseline.id,
    baseRevision: review.baseline.revision,
    coverageId: review.coverageId,
    destination,
    format: "directory",
  });
  const manifest = JSON.parse(
    await readFile(join(destination, "collect-manifest.json"), "utf8"),
  );
  expect(manifest.derivatives[0].quality).toBe("lossless");
  const decoded = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      join(destination, manifest.assets[0].path),
      "-map",
      "0:a:0",
      "-c:a",
      "pcm_s32le",
      "-f",
      "s32le",
      "-",
    ],
    { maxOutputBytes: 1024 * 1024 },
  );
  expect(decoded.stdout.length).toBe(192000 * 4);
  for (let offset = 0; offset < decoded.stdout.length; offset += 4)
    expect(decoded.stdout.readInt32LE(offset)).toBe(1073741825);
});

it("rejects an oversized v2 project before invoking a renderer", async () => {
  const f = await fixture(),
    destination = join(f.root, "oversized.openfilm");
  await f.app.collectMedia.create({
    ...f.input,
    destination,
    format: "directory",
  });
  const { writeFile } = await import("node:fs/promises");
  const projectPath = join(destination, "project.json"),
    manifestPath = join(destination, "collect-manifest.json");
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  project.settings.width = 3840;
  project.settings.height = 2160;
  await writeFile(projectPath, JSON.stringify(project));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")),
    record = manifest.files.find(
      (file: { path: string }) => file.path === "project.json",
    );
  record.sha256 = await hashFile(projectPath);
  record.size = (await readFile(projectPath)).length;
  await writeFile(manifestPath, JSON.stringify(manifest));
  const render = vi.spyOn(FFmpegRenderer.prototype, "render");
  try {
    await expect(f.app.collectMedia.verify(destination)).rejects.toMatchObject({
      code: "request.tooLarge",
    });
    expect(render).not.toHaveBeenCalled();
  } finally {
    render.mockRestore();
  }
});

it("bounds each relocated render and removes previous film outputs before the next film", async () => {
  const f = await fixture();
  f.app.project.timelines.push({
    ...structuredClone(f.app.project.timelines[0]!),
    id: "second-film",
  });
  await f.app.save();
  const base = { ...f.base, scope: "entire-project" as const };
  delete (base as { compositionId?: string }).compositionId;
  const review = await f.app.collectMedia.coverage({
      ...base,
      projectId: f.app.project.id,
      delivery: f.delivery,
    }),
    destination = join(f.root, "several.openfilm");
  await f.app.collectMedia.create({
    ...f.input,
    ...base,
    planId: review.baseline.id,
    baseRevision: review.baseline.revision,
    coverageId: review.coverageId,
    destination,
    format: "directory",
  });
  const real = FFmpegRenderer.prototype.render,
    observed: { limit?: number; existing: number }[] = [];
  const { readdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const render = vi
    .spyOn(FFmpegRenderer.prototype, "render")
    .mockImplementation(async function (this: FFmpegRenderer, ...args) {
      const folder = dirname(args[2]);
      let existing = 0;
      try {
        existing = (await readdir(folder)).filter((name) =>
          name.endsWith(".mp4"),
        ).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      observed.push({ limit: args[4]?.maximumOutputBytes, existing });
      return real.apply(this, args);
    });
  try {
    await f.app.collectMedia.verify(destination);
  } finally {
    render.mockRestore();
  }
  expect(observed.length).toBe(3);
  expect(observed.every((item) => item.limit === 2 * 1024 * 1024 * 1024)).toBe(
    true,
  );
  expect(observed.every((item) => item.existing === 0)).toBe(true);
});
