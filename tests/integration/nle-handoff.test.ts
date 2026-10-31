import * as media from "@openfilm/media";
import { FFmpegRenderer, createTitleOverlay } from "@openfilm/render";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { startServer } from "../../apps/server/src/server.js";
import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  cp,
  mkdir,
  symlink,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import { createHandoffPlan } from "@openfilm/exporters";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
it.each(["preserve-editability", "preserve-visual-fidelity"] as const)(
  "preserves offline quality through %s source copies and precomps",
  async (mode) => {
    const f = await fixture(),
      assetId = f.composition.tracks[0]!.clips[0]!.assetId,
      asset = f.app.catalog.getAsset(assetId)!;
    f.app.catalog.upsertAsset({
      ...asset,
      metadata: {
        ...asset.metadata,
        "openfilm.collectDelivery": {
          version: 1,
          mode: "offline-proxies",
          quality: "offline-only",
          originalSha256: "a".repeat(64),
        },
      },
    });
    const review = f.app.reviewHandoff(f.composition.id, { mode });
    const publication = await f.app.exportHandoff({
      projectId: review.projectId,
      revision: review.revision,
      compositionId: f.composition.id,
      mode,
    });
    const index = publication.files.findIndex(
      (file) => file.name === "timeline.otio",
    );
    const timeline = JSON.parse(
      await readFile(await f.app.handoff.file(publication.id, index), "utf8"),
    );
    expect(timeline.metadata.openfilm.compatibility.warnings).toContain(
      "collect.offline-quality",
    );
    const clips = timeline.tracks.children
      .flatMap(
        (track: {
          children: {
            media_reference?: {
              metadata?: {
                openfilm?: { collectDelivery?: { quality: string } };
              };
            };
          }[];
        }) => track.children,
      )
      .filter(
        (clip: {
          media_reference?: {
            metadata?: { openfilm?: { collectDelivery?: { quality: string } } };
          };
        }) =>
          clip.media_reference?.metadata?.openfilm?.collectDelivery?.quality ===
          "offline-only",
      );
    expect(clips.length).toBeGreaterThan(0);
  },
);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-handoff-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const image = join(root, "synthetic.mp4"),
    audio = join(root, "synthetic.wav");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:duration=5",
    "-t",
    "5",
    "-r",
    "8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    "-y",
    image,
  ]);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-y",
    audio,
  ]);
  const app = await OpenFilmApplication.create(
    join(root, "Film.openfilm"),
    "Synthetic handoff",
  );
  cleanup.push(() => app.close());
  app.project.settings = { width: 160, height: 90, frameRate: 8 };
  const photo = await inspectMedia({
      path: image,
      uri: pathToFileURL(image).href,
      name: "synthetic.mp4",
    }),
    sound = await inspectMedia({
      path: audio,
      uri: pathToFileURL(audio).href,
      name: "synthetic.wav",
    });
  photo.contentHash = await hashFile(image);
  sound.contentHash = await hashFile(audio);
  for (const asset of [photo, sound])
    asset.metadata["openfilm.reference"] = {
      id: asset.id,
      uri: asset.uri,
      type: "file",
      originalUri: asset.uri,
      rootUri: pathToFileURL(root).href,
      relativePath: asset.name,
      contentHash: asset.contentHash,
    };
  app.catalog.upsertAsset(photo);
  app.catalog.upsertAsset(sound);
  const story = app.generateStory({
    template: "blank",
    title: "Synthetic",
    assetIds: [photo.id],
    targetDuration: 4,
    maxDuration: 4,
  });
  const composition = app.compose(story.id);
  composition.duration = 4;
  composition.tracks = [
    {
      id: "picture",
      type: "video",
      clips: [
        {
          id: "cut",
          assetId: photo.id,
          timelineStart: 0,
          timelineDuration: 4,
          sourceIn: 1,
          sourceOut: 5,
          locked: true,
        },
      ],
    },
    {
      id: "audio",
      type: "audio",
      clips: [
        {
          id: "voice",
          assetId: sound.id,
          timelineStart: 0,
          timelineDuration: 4,
          sourceIn: 0,
          sourceOut: 4,
          audioAutomation: { version: 1, role: "dialogue", fadeIn: 0.5 },
        },
      ],
    },
  ];
  composition.graphicScenes = [
    {
      version: 1,
      id: "graphic",
      name: "Synthetic card",
      start: 1,
      duration: 1,
      zIndex: 1,
      nodes: [
        {
          id: "shape",
          type: "shape",
          shape: "rect",
          fill: "#ff0000",
          x: 10,
          y: 10,
          width: 40,
          height: 30,
          opacity: 1,
          zIndex: 0,
          start: 0,
          end: 1,
        },
      ],
    },
  ];
  composition.captionTracks = [
    {
      version: 1,
      id: "zh",
      name: "繁中",
      style: { version: 1, role: "subtitle", fontSize: 14 },
      cues: [
        {
          version: 1,
          id: "cue",
          startMs: 2000,
          endMs: 3000,
          text: "合成字幕",
          source: { kind: "manual" },
          manualRevision: 0,
        },
      ],
    },
  ];
  app.project.timelines = [composition];
  await app.save();
  return { root, app, composition, image, audio };
}
it.each([false, true])(
  "publishes a rounded canonical endpoint through the real handoff service (bakeAudio=%s)",
  async (bakeAudio) => {
    const { app, composition, image, audio } = await fixture(),
      clip = composition.tracks[0]!.clips[0]!;
    app.project.settings.frameRate = 30;
    app.project.schemaVersion = "1.2.0";
    composition.duration = 1;
    composition.tracks = [composition.tracks[0]!];
    composition.captionTracks = [];
    composition.graphicScenes = [];
    clip.timelineDuration = 1;
    clip.sourceIn = 0;
    clip.sourceOut = 3;
    clip.transform = { speed: 3 };
    clip.audioTiming = {
      version: 1,
      sampleRate: 48000,
      timelineStartSample: 0,
      sourceInSample: 0,
      sourceOutSample: 144001,
    };
    app.project.timelines = [composition];
    await app.save();
    const before = await readFile(join(app.directory, "project.json")),
      hashes = await Promise.all([hashFile(image), hashFile(audio)]),
      original = structuredClone(composition),
      review = app.reviewHandoff(composition.id, { bakeAudio }),
      publication = await app.exportHandoff({
        projectId: review.projectId,
        compositionId: composition.id,
        revision: review.revision,
        bakeAudio,
      }),
      file = (name: string) =>
        app.handoff.file(
          publication.id,
          publication.files.findIndex((item) => item.name === name),
        );
    expect(
      publication.plan.items.find((item) => item.feature === "audioTiming"),
    ).toMatchObject({ startFrame: 0, endFrame: 30 });
    const otio = JSON.parse(
      await readFile(await file("timeline.otio"), "utf8"),
    );
    expect(otio.metadata.openfilm.originalComposition).toEqual(original);
    if (bakeAudio) {
      const picture = JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "json",
            await file("reference.mp4"),
          ])
        ).stdout.toString(),
      );
      expect(picture.streams[0].nb_read_frames).toBe("30");
      const sound = JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "stream=duration_ts,time_base,sample_rate,codec_name",
            "-of",
            "json",
            await file("media/full-mix.wav"),
          ])
        ).stdout.toString(),
      );
      expect(sound.streams[0]).toMatchObject({
        duration_ts: 48000,
        time_base: "1/48000",
        sample_rate: "48000",
        codec_name: "pcm_s24le",
      });
      const decoded = await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        await file("media/full-mix.wav"),
        "-map",
        "0:a:0",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s24le",
        "-f",
        "s24le",
        "pipe:1",
      ]);
      expect(decoded.stdout.length).toBe(48000 * 6);
      expect(decoded.stdout.some((byte) => byte !== 0)).toBe(true);
    } else {
      expect(
        publication.files.some((item) => item.name === "reference.mp4"),
      ).toBe(false);
      const copied = publication.files.find(
        (item) => item.name.startsWith("media/") && item.name.endsWith(".mp4"),
      );
      expect(copied).toBeDefined();
      expect(await hashFile(await file(copied!.name))).toBe(hashes[0]);
    }
    expect(await readFile(join(app.directory, "project.json"))).toEqual(before);
    expect(await Promise.all([hashFile(image), hashFile(audio)])).toEqual(
      hashes,
    );
    if (process.env.OPENFILM_AUDIO_EVIDENCE_DIR) {
      const evidence = join(
        process.env.OPENFILM_AUDIO_EVIDENCE_DIR,
        `handoff-rounded-${bakeAudio ? "baked" : "native"}`,
      );
      await cp(
        join(app.directory, "cache", "nle-handoff-published", publication.id),
        evidence,
        { recursive: true },
      );
      await writeFile(
        join(evidence, "canonical-range-evidence.json"),
        JSON.stringify({
          sourceHashes: hashes,
          originalComposition: original,
          plan: publication.plan,
          decodedReferenceFrames: bakeAudio ? 30 : null,
          decodedFullMixSamples: bakeAudio ? 48000 : null,
          sourceFiles: await Promise.all(
            [
              "packages/core/src/audio-policy.ts",
              "packages/core/src/validation.ts",
              "packages/exporters/src/handoff.ts",
              "packages/exporters/tests/audio-policy.test.ts",
              "tests/integration/nle-handoff.test.ts",
            ].map(async (path) => ({ path, sha256: await hashFile(path) })),
          ),
        }),
      );
    }
  },
);
it.each(["title-track", "attached-title", "caption"])(
  "rejects an over-8K %s reference before review approval while retaining native metadata",
  async (kind) => {
    const { root, app, composition } = await fixture();
    composition.graphicScenes = [];
    if (kind !== "caption") {
      composition.captionTracks = [];
      if (kind === "title-track")
        composition.tracks.push({
          id: "title-track",
          type: "titles",
          clips: [
            {
              id: "title",
              assetId: composition.tracks[0]!.clips[0]!.assetId,
              timelineStart: 0,
              timelineDuration: 4,
              title: "Title",
            },
          ],
        });
      else composition.tracks[0]!.clips[0]!.title = "Title";
    }
    app.project.settings.width = 7682;
    app.project.settings.height = 4320;
    app.project.timelines = [composition];
    await app.save();
    expect(app.project.timelines[0]!.graphicScenes).toEqual([]);
    await expect(
      createTitleOverlay(
        "Title",
        undefined,
        app.project.settings,
        join(root, "oversize.png"),
      ),
    ).rejects.toThrow(/8K/u);
    expect(() => app.reviewHandoff(composition.id)).not.toThrow();
    for (const options of [
      { mode: "preserve-visual-fidelity" as const },
      { bakeAudio: true },
    ])
      expect(() => app.reviewHandoff(composition.id, options)).toThrow(/8K/u);
    expect(await readdir(join(app.directory, "cache"))).not.toContain(
      "nle-handoff",
    );
    app.project.settings.width = 7680;
    app.project.timelines = [composition];
    await app.save();
    expect(() =>
      app.reviewHandoff(composition.id, { mode: "preserve-visual-fidelity" }),
    ).not.toThrow();
    expect(() =>
      app.reviewHandoff(composition.id, { bakeAudio: true }),
    ).not.toThrow();
    app.project.settings.width = 7682;
    composition.tracks = composition.tracks.filter(
      (track) => track.type !== "titles",
    );
    for (const track of composition.tracks)
      for (const clip of track.clips) delete clip.title;
    composition.captionTracks = [];
    app.project.timelines = [composition];
    await app.save();
    expect(() =>
      app.reviewHandoff(composition.id, { bakeAudio: true }),
    ).not.toThrow();
  },
);

it.each(["preserve-editability", "preserve-visual-fidelity"] as const)(
  "CLI %s review/export preserve project bytes, asset rows and another owner's queued/running jobs",
  async (mode) => {
    const { root, app, composition, image, audio } = await fixture();
    const directory = app.directory;
    app.catalog.saveJob({
      id: "other-running",
      type: "render",
      status: "running",
      progress: 0.25,
      createdAt: "2026-10-20T00:00:00.000Z",
    });
    app.catalog.saveJob({
      id: "other-queued",
      type: "import",
      status: "queued",
      progress: 0,
      createdAt: "2026-10-20T00:00:00.000Z",
    });
    await app.save();
    app.close();
    cleanup.pop();
    const projectPath = join(directory, "project.json"),
      databasePath = join(directory, "database.sqlite");
    const beforeProject = await readFile(projectPath),
      beforeDatabase = await readFile(databasePath);
    const sourceHashes = await Promise.all([hashFile(image), hashFile(audio)]);
    const catalog = () => {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const tables = database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
          )
          .all() as { name: string }[];
        return JSON.stringify(
          tables.map(({ name }) => [
            name,
            database
              .prepare(
                `SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`,
              )
              .all(),
          ]),
        );
      } finally {
        database.close();
      }
    };
    const beforeCatalog = catalog();
    const cli = (...args: string[]) =>
      runProcess(process.execPath, [
        "--import",
        "tsx",
        "apps/cli/src/index.ts",
        "handoff",
        ...args,
        "--project",
        directory,
      ]);
    const review = JSON.parse(
      (
        await cli("review", "--composition", composition.id, "--mode", mode)
      ).stdout.toString(),
    );
    expect.soft(await readFile(projectPath)).toEqual(beforeProject);
    expect.soft(catalog()).toEqual(beforeCatalog);
    expect.soft(await readFile(databasePath)).toEqual(beforeDatabase);
    const reviewPath = join(root, "passive-review.json");
    await writeFile(reviewPath, JSON.stringify(review));
    const publication = JSON.parse(
      (await cli("export", "--review", reviewPath)).stdout.toString(),
    );
    expect(publication.plan).toEqual(review.plan);
    expect.soft(await readFile(projectPath)).toEqual(beforeProject);
    expect.soft(catalog()).toEqual(beforeCatalog);
    expect.soft(await readFile(databasePath)).toEqual(beforeDatabase);
    expect(await Promise.all([hashFile(image), hashFile(audio)])).toEqual(
      sourceHashes,
    );
    if (process.env.OPENFILM_HANDOFF_WAVE5_EVIDENCE) {
      const evidence = join(
        process.env.OPENFILM_HANDOFF_WAVE5_EVIDENCE,
        `cli-${mode}`,
      );
      await mkdir(evidence, { recursive: true });
      const sha256 = (bytes: Buffer | string) =>
        createHash("sha256").update(bytes).digest("hex");
      await writeFile(
        join(evidence, "immutability.json"),
        JSON.stringify(
          {
            mode,
            projectSha256: sha256(beforeProject),
            databaseSha256: sha256(beforeDatabase),
            allCatalogTablesSha256: sha256(beforeCatalog),
            sourceHashes,
            publicationPlan: publication.plan,
          },
          null,
          2,
        ),
      );
    }
  },
);

it("does not impose the text raster cap on unselected or zero-frame captions", async () => {
  const { app, composition } = await fixture();
  composition.graphicScenes = [];
  app.project.settings.width = 7682;
  app.project.settings.height = 4320;
  app.project.timelines = [composition];
  await app.save();
  expect(() =>
    app.reviewHandoff(composition.id, {
      bakeAudio: true,
      captionTrackId: null,
    }),
  ).not.toThrow();
  const cue = composition.captionTracks![0]!.cues[0]!;
  cue.startMs = 1;
  cue.endMs = 2;
  app.project.timelines = [composition];
  await app.save();
  expect(() =>
    app.reviewHandoff(composition.id, { bakeAudio: true }),
  ).not.toThrow();
  expect(
    app.reviewHandoff(composition.id, { mode: "preserve-visual-fidelity" }).plan
      .visualRanges,
  ).toEqual([]);
});

it.each([29.97, 30000 / 1001])(
  "publishes fractional %s caption precomps matching decoded reference frames and exact SRT times",
  async (rate) => {
    const { app, composition, image, audio } = await fixture();
    composition.graphicScenes = [];
    app.project.settings.frameRate = rate;
    const track = composition.captionTracks![0]!;
    track.cues = [
      { ...track.cues[0]!, id: "tiny", startMs: 1, endMs: 2, text: "Tiny" },
      {
        ...track.cues[0]!,
        id: "ordinary",
        startMs: 2000,
        endMs: 3000,
        text: "Caption",
      },
      {
        ...track.cues[0]!,
        id: "last",
        startMs: 3000,
        endMs: 4000,
        text: "Last",
      },
    ];
    app.project.timelines = [composition];
    await app.save();
    const before = JSON.stringify(app.project);
    const sourceHashes = await Promise.all([hashFile(image), hashFile(audio)]);
    const review = app.reviewHandoff(composition.id, {
      mode: "preserve-visual-fidelity",
    });
    expect(review.plan.visualRanges).toEqual([
      { startFrame: 60, endFrame: 119 },
    ]);
    const publication = await app.exportHandoff({
      projectId: review.projectId,
      compositionId: composition.id,
      revision: review.revision,
      mode: review.plan.mode,
    });
    const file = (name: string) =>
      app.handoff.file(
        publication.id,
        publication.files.findIndex((item) => item.name === name),
      );
    const reference = await file("reference.mp4"),
      precomp = await file("media/precomp-0.mp4");
    const frames = async (path: string) =>
      JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "json",
            path,
          ])
        ).stdout.toString(),
      ).streams[0].nb_read_frames;
    expect(await frames(reference)).toBe("119");
    expect(await frames(precomp)).toBe("59");
    const whitePixels = async (path: string, frame: number) => {
      const pixels = (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          path,
          "-vf",
          `select=eq(n\\,${frame})`,
          "-frames:v",
          "1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-",
        ])
      ).stdout;
      expect(pixels.length).toBe(160 * 90 * 3);
      let count = 0;
      for (let i = 0; i < pixels.length; i += 3)
        if (pixels[i]! > 180 && pixels[i + 1]! > 180 && pixels[i + 2]! > 180)
          count++;
      return count;
    };
    const referenceWhites: Record<number, number> = {};
    for (const index of [59, 60, 89, 90, 118])
      referenceWhites[index] = await whitePixels(reference, index);
    expect(referenceWhites[59]).toBe(0);
    for (const index of [60, 89, 90, 118])
      expect(referenceWhites[index]).toBeGreaterThan(0);
    expect(await whitePixels(precomp, 0)).toBeGreaterThan(0);
    expect(await whitePixels(precomp, 58)).toBeGreaterThan(0);
    const sidecar = await readFile(await file("captions-0.srt"), "utf8");
    expect(sidecar).toContain("00:00:00,001 --> 00:00:00,002");
    expect(sidecar).toContain("00:00:02,000 --> 00:00:03,000");
    expect(sidecar).toContain("00:00:03,000 --> 00:00:04,000");
    expect(JSON.stringify(app.project)).toBe(before);
    expect(await Promise.all([hashFile(image), hashFile(audio)])).toEqual(
      sourceHashes,
    );
    if (process.env.OPENFILM_HANDOFF_WAVE5_EVIDENCE) {
      const evidence = join(
        process.env.OPENFILM_HANDOFF_WAVE5_EVIDENCE,
        `fractional-${rate}`,
      );
      await cp(
        join(app.directory, "cache", "nle-handoff-published", publication.id),
        evidence,
        { recursive: true },
      );
      await writeFile(
        join(evidence, "timing-proof.json"),
        JSON.stringify(
          {
            rate,
            referenceFrames: 119,
            precompFrames: 59,
            referenceWhites,
            sourceHashes,
            plan: publication.plan,
          },
          null,
          2,
        ),
      );
    }
  },
);

it("hands off native cuts plus measured graphic/caption precomps and an aligned full mix", async () => {
  const processSpy = vi.spyOn(media, "runProcess");
  const { root, app, composition, image, audio } = await fixture();
  const before = JSON.stringify(app.project),
    hashes = await Promise.all([hashFile(image), hashFile(audio)]);
  const review = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
    bakeAudio: true,
  });
  const publication = await app.exportHandoff({
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
    mode: review.plan.mode,
    bakeAudio: true,
  });
  expect(
    processSpy.mock.calls
      .filter(
        ([command, args]) =>
          command === "ffprobe" && args.includes("-count_frames"),
      )
      .map(([, , options]) => options?.timeoutMs),
  ).toEqual([1800000, 1800000]);
  expect(publication.plan.visualRanges).toEqual([
    { startFrame: 8, endFrame: 24 },
  ]);
  const otioIndex = publication.files.findIndex(
    (f) => f.name === "timeline.otio",
  );
  const timeline = JSON.parse(
    await readFile(await app.handoff.file(publication.id, otioIndex), "utf8"),
  );
  const tracks = timeline.tracks.children;
  const native = tracks
    .find((t: { name: string }) => t.name === "picture")
    .children.filter(
      (c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA === "Clip.1",
    );
  expect(native).toHaveLength(2);
  expect(
    native.map(
      (c: { source_range: { start_time: { value: number } } }) =>
        c.source_range.start_time.value,
    ),
  ).toEqual([8, 32]);
  expect(
    native.map(
      (c: { source_range: { duration: { value: number } } }) =>
        c.source_range.duration.value,
    ),
  ).toEqual([8, 8]);
  expect(timeline.metadata.openfilm.originalComposition).toEqual(composition);
  const visualMapping = timeline.metadata.openfilm.handoff.mappings.find(
    (m: { kind: string }) => m.kind === "visual-precomp",
  );
  expect(visualMapping.sourceOwnerIds).not.toContain("audio");
  expect(visualMapping.sourceOwnerIds).not.toContain("voice");
  expect(
    timeline.metadata.openfilm.handoff.sources
      .map((s: { sha256: string }) => s.sha256)
      .sort(),
  ).toEqual([...hashes].sort());
  const baked = await app.handoff.file(
    publication.id,
    publication.files.findIndex((f) => f.name === "media/precomp-0.mp4"),
  );
  const frame = await runProcess("ffmpeg", [
    "-v",
    "error",
    "-i",
    baked,
    "-vf",
    "select=eq(n\\,0)",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ]);
  const pixel = (50 * 160 + 80) * 3;
  expect(frame.stdout[pixel]).toBeGreaterThan(200);
  expect(frame.stdout[pixel + 2]).toBeLessThan(40);
  const reference = await app.handoff.file(
    publication.id,
    publication.files.findIndex((f) => f.name === "reference.mp4"),
  );
  for (const [sourceFrame, bakedFrame] of [
    [8, 0],
    [23, 15],
  ]) {
    const decode = async (path: string, n: number) =>
      (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          path,
          "-vf",
          `select=eq(n\\,${n})`,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ])
      ).stdout;
    const a = await decode(reference, sourceFrame!),
      b = await decode(baked, bakedFrame!);
    expect(a.length).toBe(160 * 90 * 3);
    expect(b.length).toBe(a.length);
    const error =
      a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / a.length;
    expect(error).toBeLessThan(3);
  }
  const mix = await app.handoff.file(
    publication.id,
    publication.files.findIndex((f) => f.name === "media/full-mix.wav"),
  );
  const mixProbe = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=duration_ts,time_base,sample_rate,codec_name",
    "-of",
    "json",
    mix,
  ]);
  expect(JSON.parse(mixProbe.stdout.toString()).streams[0]).toMatchObject({
    duration_ts: 192000,
    time_base: "1/48000",
    sample_rate: "48000",
    codec_name: "pcm_s24le",
  });
  const srt = await readFile(
    await app.handoff.file(
      publication.id,
      publication.files.findIndex((f) => f.name === "captions-0.srt"),
    ),
    "utf8",
  );
  expect(srt).toContain("00:00:02,000 --> 00:00:03,000");
  expect(srt).toContain("合成字幕");
  const tar = await app.handoff.file(
    publication.id,
    publication.files.findIndex((f) => f.name === "handoff.tar"),
  );
  const listed = await runProcess("tar", ["-tf", tar]);
  expect(listed.stdout.toString()).toContain("media/precomp-0.mp4");
  const output = join(root, "official-otio.json");
  const python =
    process.env.OPENFILM_OTIO_PYTHON ??
    (process.platform === "win32" ? "python" : "python3");
  await runProcess(python, [
    "-c",
    `import opentimelineio as o,json,sys; t=o.adapters.read_from_file(sys.argv[1]); r=o.adapters.read_from_string(o.adapters.write_to_string(t,adapter_name='otio_json'),adapter_name='otio_json'); assert r.duration()==t.duration(); assert json.loads(o.adapters.write_to_string(r,adapter_name='otio_json'))==json.loads(o.adapters.write_to_string(t,adapter_name='otio_json'));  json.dump({'duration':r.duration().to_seconds(),'clips':len(list(r.find_clips()))},open(sys.argv[2],'w'))`,
    await app.handoff.file(publication.id, otioIndex),
    output,
  ]);
  expect(JSON.parse(await readFile(output, "utf8")).duration).toBe(4);
  expect(await Promise.all([hashFile(image), hashFile(audio)])).toEqual(hashes);
  expect(JSON.stringify(app.project)).toBe(before);
  if (process.env.OPENFILM_HANDOFF_QA_OUTPUT) {
    const { cp, mkdir } = await import("node:fs/promises");
    await mkdir(process.env.OPENFILM_HANDOFF_QA_OUTPUT, { recursive: true });
    await cp(
      join(app.directory, "cache", "nle-handoff-published", publication.id),
      process.env.OPENFILM_HANDOFF_QA_OUTPUT,
      { recursive: true },
    );
  }
}, 60000);
it("rejects stale revisions, missing/changed source, unsafe download and cancellation without publication", async () => {
  const { app, composition, image } = await fixture();
  const review = app.reviewHandoff(composition.id);
  const request = {
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
  };
  await expect(
    app.exportHandoff({ ...request, revision: "stale" }),
  ).rejects.toThrow(/stale/i);
  const controller = new AbortController();
  controller.abort();
  await expect(app.exportHandoff(request, controller.signal)).rejects.toThrow();
  await expect(app.handoff.file("../escape", 0)).rejects.toThrow(/invalid/i);
  await writeFile(image, "changed synthetic bytes");
  await expect(app.exportHandoff(request)).rejects.toThrow(/hash/i);
  expect(await readdir(join(app.directory, "cache", "nle-handoff"))).toEqual(
    [],
  );
});

it("preserves editability by default and produces reproducible native OTIO", async () => {
  const { app, composition, root } = await fixture();
  const review = app.reviewHandoff(composition.id);
  const input = {
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
  };
  const first = await app.exportHandoff(input),
    second = await app.exportHandoff(input);
  expect(first.plan.mode).toBe("preserve-editability");
  expect(first.plan.visualRanges).toEqual([]);
  expect(first.files.some((f) => f.name === "reference.mp4")).toBe(false);
  const a = await readFile(
    await app.handoff.file(
      first.id,
      first.files.findIndex((f) => f.name === "timeline.otio"),
    ),
    "utf8",
  );
  const b = await readFile(
    await app.handoff.file(
      second.id,
      second.files.findIndex((f) => f.name === "timeline.otio"),
    ),
    "utf8",
  );
  expect(a).toBe(b);
  expect(a).not.toContain(root);
  expect(a).not.toContain("file://");
  const packaged = JSON.parse(a);
  expect(packaged.metadata.openfilm.originalComposition).toEqual(composition);
});

it("cleans partial material after mid-render cancellation, real bad codec and stale saved revision", async () => {
  const { app, composition } = await fixture();
  const review = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
  });
  const input = {
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
    mode: review.plan.mode,
  };
  const aborted = new AbortController();
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementationOnce(
    async () => {
      aborted.abort();
      aborted.signal.throwIfAborted();
      throw new Error("unreachable");
    },
  );
  await expect(app.exportHandoff(input, aborted.signal)).rejects.toThrow();
  vi.restoreAllMocks();
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementationOnce(
    async () => {
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=s=16x16:d=0.1",
        "-c:v",
        "openfilm_deliberately_invalid_codec",
        "-f",
        "null",
        "-",
      ]);
      throw new Error("unreachable");
    },
  );
  await expect(app.exportHandoff(input)).rejects.toThrow(
    /Unknown encoder.*openfilm_deliberately_invalid_codec/i,
  );
  vi.restoreAllMocks();
  const projectPath = join(app.directory, "project.json"),
    saved = await readFile(projectPath, "utf8");
  const render = FFmpegRenderer.prototype.render;
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementationOnce(
    async function (this: FFmpegRenderer, ...args) {
      const result = await render.apply(this, args);
      const changed = JSON.parse(saved);
      changed.settings.width += 2;
      await writeFile(projectPath, JSON.stringify(changed));
      return result;
    },
  );
  try {
    await expect(app.exportHandoff(input)).rejects.toThrow(/stale/i);
  } finally {
    await writeFile(projectPath, saved);
    vi.restoreAllMocks();
  }
  expect(await readdir(join(app.directory, "cache", "nle-handoff"))).toEqual(
    [],
  );
  expect(
    await readdir(join(app.directory, "cache", "nle-handoff-published")).catch(
      () => [],
    ),
  ).toEqual([]);
});
it("shares revision-fenced HTTP and CLI handoff behavior with project-scoped downloads", async () => {
  const { app, composition, root } = await fixture();
  const directory = app.directory;
  // Independent process ownership: the seed app is closed before opening adapters.
  const index = cleanup.length - 1;
  cleanup.splice(index, 1);
  app.close();
  const server = await startServer({ port: 0, project: directory });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}/api`;
  const { project } = (await (await fetch(`${base}/project`)).json()) as {
    project: { id: string };
  };
  const post = (route: string, data: unknown) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const reviewResponse = await post("/handoff/review", {
    projectId: project.id,
    compositionId: composition.id,
  });
  expect(reviewResponse.status).toBe(200);
  const review =
    (await reviewResponse.json()) as import("@openfilm/application").HandoffReview;
  const result = await post("/handoff/export", {
    projectId: project.id,
    compositionId: composition.id,
    revision: review.revision,
  });
  expect(result.status).toBe(200);
  const published =
    (await result.json()) as import("@openfilm/application").HandoffPublication;
  expect(
    (
      await fetch(
        `${base}/handoff/file?projectId=wrong&id=${published.id}&index=0`,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await fetch(
        `${base}/handoff/file?projectId=${project.id}&id=..%2Fescape&index=0`,
      )
    ).status,
  ).toBe(400);
  const file = await fetch(
    `${base}/handoff/file?projectId=${project.id}&id=${published.id}&index=${published.files.findIndex((f) => f.name === "handoff.tar")}`,
  );
  expect(file.status).toBe(200);
  expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(1024);
  await server.close();
  cleanup.pop();
  const cli = await runProcess(process.execPath, [
    "--import",
    "tsx",
    "apps/cli/src/index.ts",
    "handoff",
    "review",
    "--project",
    directory,
    "--composition",
    composition.id,
  ]);
  const cliReview = JSON.parse(
    cli.stdout.toString(),
  ) as import("@openfilm/application").HandoffReview;
  expect(cliReview).toEqual(review);
  const path = join(root, "review.json");
  await writeFile(path, JSON.stringify(cliReview));
  const exported = await runProcess(process.execPath, [
    "--import",
    "tsx",
    "apps/cli/src/index.ts",
    "handoff",
    "export",
    "--project",
    directory,
    "--review",
    path,
  ]);
  expect(JSON.parse(exported.stdout.toString()).plan).toEqual(review.plan);
});

it("fails closed for missing sources and symlinked private staging parents", async () => {
  const { app, composition, image, root } = await fixture();
  const review = app.reviewHandoff(composition.id);
  const request = {
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
  };
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(app.directory, "cache", "nle-handoff"), "dir");
  await expect(app.exportHandoff(request)).rejects.toThrow(/symlink/i);
  expect(await readdir(outside)).toEqual([]);
  await rm(join(app.directory, "cache", "nle-handoff"));
  await rm(image);
  await expect(app.exportHandoff(request)).rejects.toThrow();
  expect(await readdir(join(app.directory, "cache", "nle-handoff"))).toEqual(
    [],
  );
});

it("preserves embedded dialogue as native Audio when only pictures are baked", async () => {
  const { app, composition } = await fixture();
  composition.tracks = composition.tracks.filter((t) => t.type !== "audio");
  composition.tracks[0]!.clips[0]!.transform = { scale: 1.1 };
  app.project.timelines = [composition];
  await app.save();
  const review = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
  });
  expect(
    review.plan.items.find((i) => i.feature === "embeddedAudio"),
  ).toMatchObject({
    disposition: "native-editable",
    startFrame: 0,
    endFrame: 32,
  });
  const result = await app.exportHandoff({
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
    mode: review.plan.mode,
  });
  const timeline = JSON.parse(
    await readFile(
      await app.handoff.file(
        result.id,
        result.files.findIndex((f) => f.name === "timeline.otio"),
      ),
      "utf8",
    ),
  );
  const tracks = timeline.tracks.children.filter(
    (t: { kind: string }) => t.kind === "Audio",
  );
  expect(tracks).toHaveLength(1);
  const clips = tracks[0].children.filter(
    (c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA === "Clip.1",
  );
  expect(clips).toHaveLength(1);
  expect(clips[0].source_range).toMatchObject({
    start_time: { value: 8, rate: 8 },
    duration: { value: 32, rate: 8 },
  });
  const sourceFile = clips[0].media_reference.target_url as string;
  const source = await app.handoff.file(
    result.id,
    result.files.findIndex((f) => f.name === sourceFile),
  );
  const audio = await runProcess("ffmpeg", [
    "-v",
    "error",
    "-ss",
    "1",
    "-i",
    source,
    "-t",
    "4",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  const samples = new Float32Array(
    audio.stdout.buffer,
    audio.stdout.byteOffset,
    audio.stdout.byteLength / 4,
  );
  const rms = Math.sqrt(
    samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
  );
  expect(rms).toBeGreaterThan(0.05);
  expect(result.files.some((f) => f.name === "media/full-mix.wav")).toBe(false);
});

it("HTTP disconnect cancels the owned render and releases the project after staging cleanup", async () => {
  const { app, composition } = await fixture();
  const review = app.reviewHandoff(composition.id, {
      mode: "preserve-visual-fidelity",
    }),
    directory = app.directory;
  cleanup.pop();
  app.close();
  const server = await startServer({ port: 0, project: directory });
  cleanup.push(() => server.close());
  let entered!: () => void;
  const rendering = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementationOnce(
    async function (this: FFmpegRenderer, ...args) {
      const signal = args[4]?.signal;
      entered();
      await new Promise<void>((_, reject) => {
        if (signal?.aborted) reject(new Error("cancelled"));
        else
          signal?.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
      });
      throw new Error("unreachable");
    },
  );
  const controller = new AbortController();
  const pending = fetch(`http://127.0.0.1:${server.port}/api/handoff/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: review.projectId,
      compositionId: composition.id,
      revision: review.revision,
      mode: review.plan.mode,
    }),
    signal: controller.signal,
  }).catch((error) => error);
  await rendering;
  controller.abort();
  await pending;
  await server.close();
  cleanup.pop();
  expect(await readdir(join(directory, "cache", "nle-handoff"))).toEqual([]);
  expect(
    await readdir(join(directory, "cache", "nle-handoff-published")).catch(
      () => [],
    ),
  ).toEqual([]);
});

it("rejects source ranges beyond actual duration even if catalog duration was enlarged", async () => {
  const { app, composition } = await fixture();
  const clip = composition.tracks[0]!.clips[0]!;
  const asset = app.catalog.getAsset(clip.assetId)!;
  app.catalog.upsertAsset({ ...asset, duration: 6 });
  clip.sourceIn = 2;
  clip.sourceOut = 6;
  app.project.timelines = [composition];
  await app.save();
  const review = app.reviewHandoff(composition.id);
  await expect(
    app.exportHandoff({
      projectId: review.projectId,
      compositionId: composition.id,
      revision: review.revision,
    }),
  ).rejects.toThrow(/source bounds.*duration/i);
  expect(await readdir(join(app.directory, "cache", "nle-handoff"))).toEqual(
    [],
  );
});

it("queues an immediate review retry until cancelled server cleanup completes", async () => {
  const { app, composition } = await fixture();
  const review = app.reviewHandoff(composition.id, {
      mode: "preserve-visual-fidelity",
    }),
    directory = app.directory;
  cleanup.pop();
  app.close();
  const server = await startServer({ port: 0, project: directory });
  cleanup.push(() => server.close());
  let entered!: () => void, sawAbort!: () => void, finishCleanup!: () => void;
  const rendering = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    aborting = new Promise<void>((resolve) => {
      sawAbort = resolve;
    }),
    cleanupHeld = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
  vi.spyOn(FFmpegRenderer.prototype, "render").mockImplementationOnce(
    async function (this: FFmpegRenderer, ...args) {
      entered();
      await new Promise<void>((resolve) => {
        const signal = args[4]?.signal;
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      sawAbort();
      await cleanupHeld;
      throw new Error("cancelled after controlled cleanup");
    },
  );
  const base = `http://127.0.0.1:${server.port}/api`,
    controller = new AbortController();
  const input = {
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
    mode: review.plan.mode,
  };
  const post = (route: string, signal?: AbortSignal) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
  const first = post("/handoff/export", controller.signal).catch(
    (error) => error,
  );
  await rendering;
  controller.abort();
  await aborting;
  let replied = false;
  const retry = post("/handoff/review").then((response) => {
    replied = true;
    return response;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(replied).toBe(false);
  } finally {
    finishCleanup();
  }
  expect((await retry).status).toBe(200);
  await first;
  expect(await readdir(join(directory, "cache", "nle-handoff"))).toEqual([]);
});

it("rejects a renamed concat playlist through the existing local media demuxer whitelist", async () => {
  const { app, composition, root } = await fixture();
  const original = app.catalog.getAsset(
    composition.tracks[0]!.clips[0]!.assetId,
  )!;
  const playlist = join(root, "disguised.mp4");
  await writeFile(
    playlist,
    "ffconcat version 1.0\nfile 'synthetic.mp4'\nduration 5\n",
  );
  app.catalog.upsertAsset({
    ...original,
    uri: pathToFileURL(playlist).href,
    contentHash: await hashFile(playlist),
  });
  const review = app.reviewHandoff(composition.id);
  await expect(
    app.exportHandoff({
      projectId: review.projectId,
      compositionId: composition.id,
      revision: review.revision,
    }),
  ).rejects.toThrow(/whitelist/i);
  expect(await readdir(join(app.directory, "cache", "nle-handoff"))).toEqual(
    [],
  );
});

it("seeks disjoint decimal-rate precomps without changing first/last frames or OTIO rate", async () => {
  const { app, composition } = await fixture(),
    rate = 29.97;
  app.project.settings.frameRate = rate;
  composition.duration = 119 / rate;
  composition.captionTracks = [];
  for (const track of composition.tracks)
    for (const clip of track.clips) {
      clip.timelineDuration = composition.duration;
      clip.sourceOut = (clip.sourceIn ?? 0) + composition.duration;
    }
  const scene = composition.graphicScenes![0]!;
  composition.graphicScenes = [
    { ...scene, id: "early", start: 20 / rate, duration: 20 / rate },
    { ...scene, id: "late", start: 80 / rate, duration: 20 / rate },
  ];
  for (const graphic of composition.graphicScenes)
    graphic.nodes[0]!.end = 20 / rate;
  app.project.timelines = [composition];
  await app.save();
  const review = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
  });
  expect(review.plan.rate).toEqual({ numerator: 2997, denominator: 100 });
  const result = await app.exportHandoff({
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
    mode: review.plan.mode,
  });
  const path = (name: string) =>
    app.handoff.file(
      result.id,
      result.files.findIndex((f) => f.name === name),
    );
  const timeline = JSON.parse(
    await readFile(await path("timeline.otio"), "utf8"),
  );
  expect(timeline.global_start_time.rate).toBe(rate);
  const reference = await path("reference.mp4");
  const decode = async (file: string, n: number) =>
    (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        file,
        "-vf",
        `select=eq(n\\,${n})`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ])
    ).stdout;
  for (const [index, start] of [20, 80].entries()) {
    const baked = await path(`media/precomp-${index}.mp4`);
    for (const offset of [0, 19]) {
      const a = await decode(reference, start + offset),
        b = await decode(baked, offset);
      expect(a.length).toBe(160 * 90 * 3);
      expect(b.length).toBe(a.length);
      expect(
        a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / a.length,
      ).toBeLessThan(3);
    }
  }
});

it("bakes v2 ambient and Bezier photo recipes through the normal fidelity handoff without changing sources", async () => {
  const { root, app, composition, image, audio } = await fixture();
  const path = join(root, "synthetic-portrait.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x305090:s=100x200,drawbox=x=20:y=70:w=20:h=50:c=white:t=fill",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-y",
    path,
  ]);
  const source = await inspectMedia({
    path,
    uri: pathToFileURL(path).href,
    name: "synthetic-portrait.png",
  });
  source.contentHash = await hashFile(path);
  app.catalog.upsertAsset(source);
  const clip = composition.tracks[0]!.clips[0]!;
  clip.assetId = source.id;
  clip.sourceIn = 0;
  clip.sourceOut = 4;
  clip.layout = {
    version: 2,
    preset: "contain",
    fill: { version: 1, kind: "ambient", blurSigma: 0.02, dim: 0.45 },
  };
  clip.motion = {
    version: 2,
    preset: "pan",
    easing: {
      version: 1,
      kind: "cubic-bezier",
      x1: 0.25,
      y1: 0.1,
      x2: 0.25,
      y2: 1,
    },
    from: { scale: 1.08, x: -3, y: 0 },
    to: { scale: 1.08, x: 3, y: 0 },
  };
  clip.look = { version: 1, preset: "retro", strength: 1 };
  composition.graphicScenes = [];
  composition.captionTracks = [];
  app.project.timelines = [composition];
  await app.save();
  const before = JSON.stringify(app.project),
    hashes = await Promise.all([
      hashFile(image),
      hashFile(audio),
      hashFile(path),
    ]);
  const review = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
  });
  expect(review.plan.visualRanges).toEqual([{ startFrame: 0, endFrame: 32 }]);
  const publication = await app.exportHandoff({
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
    mode: review.plan.mode,
  });
  const file = async (name: string) =>
    app.handoff.file(
      publication.id,
      publication.files.findIndex((item) => item.name === name),
    );
  const timeline = JSON.parse(
    await readFile(await file("timeline.otio"), "utf8"),
  );
  expect(timeline.metadata.openfilm.originalComposition).toEqual(composition);
  const baked = await file("media/precomp-0.mp4");
  const probe = JSON.parse(
    (
      await runProcess("ffprobe", [
        "-v",
        "error",
        "-count_frames",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "json",
        baked,
      ])
    ).stdout.toString(),
  );
  expect(probe.streams[0].nb_read_frames).toBe("32");
  const rgb = (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      baked,
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ])
  ).stdout;
  expect(rgb[(45 * 160 + 5) * 3 + 2]).toBeGreaterThan(40);
  expect(JSON.stringify(app.project)).toBe(before);
  expect(
    await Promise.all([hashFile(image), hashFile(audio), hashFile(path)]),
  ).toEqual(hashes);
});

it("does not inherit primary color or the film look again on already rendered precomps", async () => {
  const { app, composition } = await fixture();
  composition.defaultLook = { version: 1, preset: "retro", strength: 0.8 };
  composition.defaultPrimaryColor = {
    version: 1,
    temperature: 0.3,
    exposureEv: 0.4,
    contrast: 1.2,
  };
  app.project.timelines = [composition];
  await app.save();
  const review = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
  });
  const publication = await app.exportHandoff({
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
    mode: review.plan.mode,
  });
  const index = publication.files.findIndex(
    (file) => file.name === "timeline.otio",
  );
  const timeline = JSON.parse(
    await readFile(await app.handoff.file(publication.id, index), "utf8"),
  );
  expect(timeline.metadata.openfilm.originalComposition.defaultLook).toEqual(
    composition.defaultLook,
  );
  expect(
    timeline.metadata.openfilm.compatibility.metadataOnlyEdits.filter(
      (item: { features: string[] }) => item.features.includes("look"),
    ),
  ).toEqual([]);
  expect(
    timeline.metadata.openfilm.originalComposition.defaultPrimaryColor,
  ).toEqual(composition.defaultPrimaryColor);
  const exchange = timeline.metadata.openfilm.composition;
  const precomp = exchange.tracks.find(
    (track: { id: string }) =>
      track.id.startsWith("handoff-") && track.id.includes("-track-"),
  );
  expect(precomp.clips[0].primaryColor).toEqual({
    version: 1,
    temperature: 0,
    exposureEv: 0,
    contrast: 1,
  });
  expect(
    timeline.metadata.openfilm.compatibility.metadataOnlyEdits.some(
      (item: { features: string[] }) => item.features.includes("primary color"),
    ),
  ).toBe(false);
  expect(precomp.clips[0].look).toEqual({
    version: 1,
    preset: "none",
    strength: 1,
  });
});

it("CLI can explicitly omit caption burn-in and consume its maximum-caption review", async () => {
  const { root, app, composition } = await fixture();
  composition.duration = 625;
  composition.captionTracks![0]!.cues = Array.from(
    { length: 5000 },
    (_, index) => ({
      version: 1 as const,
      id: `cue-${index}`,
      startMs: index * 125,
      endMs: index * 125 + 100,
      text: "合成字幕",
      source: { kind: "manual" as const },
      manualRevision: 0,
    }),
  );
  app.project.timelines = [composition];
  await app.save();
  const project = join(root, "Film.openfilm");
  await app.close();
  cleanup.pop();
  const cli = (...args: string[]) =>
    runProcess(process.execPath, [
      "--import",
      "tsx",
      "apps/cli/src/index.ts",
      "handoff",
      ...args,
      "--project",
      project,
    ]);
  const omitted = JSON.parse(
    (
      await cli("review", "--composition", composition.id, "--no-captions")
    ).stdout.toString(),
  );
  expect(omitted.plan.captionTrackId).toBeNull();
  const review = (
    await cli("review", "--composition", composition.id)
  ).stdout.toString();
  expect(Buffer.byteLength(review)).toBeGreaterThan(1024 * 1024);
  const path = join(root, "review.json");
  await writeFile(path, review);
  const published = JSON.parse(
    (await cli("export", "--review", path)).stdout.toString(),
  );
  expect(
    published.plan.items.filter(
      (item: { feature: string }) => item.feature === "caption",
    ),
  ).toHaveLength(5000);
  for (const format of ["srt", "vtt"]) {
    const sidecar = await readFile(
      await app.handoff.file(
        published.id,
        published.files.findIndex(
          (file: { name: string }) => file.name === `captions-0.${format}`,
        ),
      ),
      "utf8",
    );
    expect(sidecar.match(/ --> /gu)).toHaveLength(5000);
    expect(sidecar.match(/合成字幕/gu)).toHaveLength(5000);
  }
});

it("rejects unresolved title placeholders during review rather than after approval", async () => {
  const { app, composition } = await fixture();
  composition.tracks.push({
    id: "titles",
    type: "titles",
    clips: [
      {
        id: "title",
        assetId: "synthetic-placeholder",
        timelineStart: 0,
        timelineDuration: 1,
        title: "合成標題",
      },
    ],
  });
  app.project.timelines = [composition];
  await app.save();
  expect(() =>
    app.reviewHandoff(composition.id, { mode: "preserve-visual-fidelity" }),
  ).toThrow(/title.*source/i);
});

it("omits catalog-backed title placeholder media from native exchange while retaining authored and baked title evidence", async () => {
  const { root, app, composition, image, audio } = await fixture();
  composition.graphicScenes = [];
  composition.captionTracks = [];
  const placeholderPath = join(root, "ignored-placeholder.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=160x90",
    "-frames:v",
    "1",
    "-threads",
    "1",
    placeholderPath,
  ]);
  const placeholder = await inspectMedia({
    path: placeholderPath,
    uri: pathToFileURL(placeholderPath).href,
    name: "ignored-placeholder.png",
  });
  placeholder.contentHash = await hashFile(placeholderPath);
  app.catalog.upsertAsset(placeholder);
  composition.tracks.push({
    id: "titles",
    type: "titles",
    clips: [
      {
        id: "generated-title",
        assetId: placeholder.id,
        timelineStart: 0,
        timelineDuration: 4,
        title: "LOCAL TITLE",
        titleStyle: { version: 1, role: "subtitle", fontSize: 14 },
      },
    ],
  });
  app.project.timelines = [composition];
  await app.save();
  const before = JSON.stringify(app.project);
  const sourceHashes = await Promise.all(
    [image, audio, placeholderPath].map((path) => hashFile(path)),
  );
  const rendered = await app.render(composition.id);
  const renderedHash = await hashFile(rendered);
  const decoded = (
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      rendered,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ])
  ).stdout;
  expect(decoded[2]).toBeGreaterThan(240);
  expect(decoded[1]).toBeLessThan(12);
  const publications = [];
  for (const mode of [
    "preserve-editability",
    "preserve-visual-fidelity",
  ] as const) {
    const review = app.reviewHandoff(composition.id, { mode });
    expect(
      review.plan.items
        .filter(
          (item) =>
            item.ownerId === "generated-title" &&
            ["sourceIdentity", "cut"].includes(item.feature),
        )
        .every((item) => item.disposition !== "native-editable"),
    ).toBe(true);
    const publication = await app.exportHandoff({
      projectId: review.projectId,
      compositionId: composition.id,
      revision: review.revision,
      mode,
    });
    const read = async (name: string) =>
      readFile(
        await app.handoff.file(
          publication.id,
          publication.files.findIndex((file) => file.name === name),
        ),
        "utf8",
      );
    const timeline = JSON.parse(await read("timeline.otio"));
    const nativeClips = timeline.tracks.children
      .flatMap(
        (track: {
          children: {
            OTIO_SCHEMA: string;
            metadata?: { openfilm?: { assetId?: string } };
          }[];
        }) => track.children,
      )
      .filter((clip: { OTIO_SCHEMA: string }) => clip.OTIO_SCHEMA === "Clip.1");
    expect(
      nativeClips.some(
        (clip: { metadata?: { openfilm?: { assetId?: string } } }) =>
          clip.metadata?.openfilm?.assetId === placeholder.id,
      ),
    ).toBe(false);
    expect(
      timeline.tracks.children.some(
        (track: { name: string }) => track.name === "titles",
      ),
    ).toBe(false);
    const provenance = JSON.parse(await read("provenance.json"));
    expect(
      provenance.originalComposition.tracks.find(
        (track: { id: string }) => track.id === "titles",
      ),
    ).toEqual(composition.tracks.at(-1));
    expect(publication.plan.realNleVerified).toBe(false);
    if (mode === "preserve-visual-fidelity") {
      expect(publication.plan.visualRanges).toEqual([
        { startFrame: 0, endFrame: 32 },
      ]);
      expect(
        provenance.mappings.find(
          (mapping: { kind: string }) => mapping.kind === "visual-precomp",
        ).sourceOwnerIds,
      ).toContain("generated-title");
      expect(
        await hashFile(
          await app.handoff.file(
            publication.id,
            publication.files.findIndex(
              (file) => file.name === "reference.mp4",
            ),
          ),
        ),
      ).toBe(renderedHash);
    }
    publications.push({ mode, id: publication.id, plan: publication.plan });
  }
  expect(
    await Promise.all(
      [image, audio, placeholderPath].map((path) => hashFile(path)),
    ),
  ).toEqual(sourceHashes);
  expect(JSON.stringify(app.project)).toBe(before);
  if (process.env.OPENFILM_HANDOFF_TITLE_QA_OUTPUT) {
    const { cp } = await import("node:fs/promises");
    const evidence = process.env.OPENFILM_HANDOFF_TITLE_QA_OUTPUT;
    await mkdir(evidence, { recursive: true });
    for (const publication of publications)
      await cp(
        join(app.directory, "cache", "nle-handoff-published", publication.id),
        join(evidence, publication.mode),
        { recursive: true },
      );
    await writeFile(
      join(evidence, "title-placeholder-proof.json"),
      JSON.stringify(
        {
          sourceHashes,
          renderedHash,
          firstPixel: [...decoded.subarray(0, 3)],
          publications,
        },
        null,
        2,
      ),
    );
  }
});

it.each(["video", "audio"] as const)(
  "publishes a long generated title with a short ignored %s source while protecting consumed source bounds",
  async (kind) => {
    const { root, app, composition, image, audio } = await fixture();
    composition.graphicScenes = [];
    composition.captionTracks = [];
    const path = join(
      root,
      kind === "video" ? "short-title.mp4" : "short-title.wav",
    );
    await runProcess(
      "ffmpeg",
      kind === "video"
        ? [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=green:s=160x90:r=8:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1200:duration=1",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "1",
            path,
          ]
        : [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1200:duration=1",
            path,
          ],
    );
    const placeholder = await inspectMedia({
      path,
      uri: pathToFileURL(path).href,
      name: `short-title.${kind === "video" ? "mp4" : "wav"}`,
    });
    placeholder.contentHash = await hashFile(path);
    expect(placeholder.duration).toBeCloseTo(1, 2);
    app.catalog.upsertAsset(placeholder);
    const title = {
      id: "long-generated-title",
      assetId: placeholder.id,
      sourceIn: 0,
      sourceOut: 4,
      timelineStart: 0,
      timelineDuration: 4,
      title: "FOUR SECOND TITLE",
      titleStyle: {
        version: 1 as const,
        role: "subtitle" as const,
        fontSize: 14,
      },
    };
    composition.tracks.push({
      id: "ignored-short-title",
      type: "titles",
      clips: [title],
    });
    app.project.timelines = [composition];
    await app.save();
    const before = JSON.stringify(app.project),
      savedBefore = await readFile(join(app.directory, "project.json"));
    const hashes = await Promise.all(
      [image, audio, path].map((path) => hashFile(path)),
    );
    const rendered = await app.render(composition.id),
      renderedHash = await hashFile(rendered);
    const publications = [];
    for (const mode of [
      "preserve-editability",
      "preserve-visual-fidelity",
    ] as const) {
      const review = app.reviewHandoff(composition.id, { mode });
      const publication = await app.exportHandoff({
        projectId: review.projectId,
        compositionId: composition.id,
        revision: review.revision,
        mode,
      });
      const read = async (name: string) =>
        readFile(
          await app.handoff.file(
            publication.id,
            publication.files.findIndex((file) => file.name === name),
          ),
          "utf8",
        );
      const timeline = JSON.parse(await read("timeline.otio"));
      const clips = timeline.tracks.children
        .flatMap(
          (track: { children: { OTIO_SCHEMA: string }[] }) => track.children,
        )
        .filter(
          (clip: { OTIO_SCHEMA: string }) => clip.OTIO_SCHEMA === "Clip.1",
        );
      expect(
        clips.some(
          (clip: { metadata?: { openfilm?: { assetId?: string } } }) =>
            clip.metadata?.openfilm?.assetId === placeholder.id,
        ),
      ).toBe(false);
      const provenance = JSON.parse(await read("provenance.json"));
      expect(
        provenance.originalComposition.tracks.find(
          (track: { id: string }) => track.id === "ignored-short-title",
        ).clips,
      ).toEqual([title]);
      const reference = provenance.sources.find(
        (source: { assetId: string }) => source.assetId === placeholder.id,
      );
      expect(reference.sha256).toBe(placeholder.contentHash);
      expect(
        await hashFile(
          await app.handoff.file(
            publication.id,
            publication.files.findIndex((file) => file.name === reference.file),
          ),
        ),
      ).toBe(placeholder.contentHash);
      if (mode === "preserve-visual-fidelity")
        expect(
          await hashFile(
            await app.handoff.file(
              publication.id,
              publication.files.findIndex(
                (file) => file.name === "reference.mp4",
              ),
            ),
          ),
        ).toBe(renderedHash);
      publications.push({ id: publication.id, mode });
    }
    expect(JSON.stringify(app.project)).toBe(before);
    expect(await readFile(join(app.directory, "project.json"))).toEqual(
      savedBefore,
    );
    // The identical short source is now consumed on a real picture/audio track.
    // Stale catalog duration must not bypass the freshly inspected one-second bound.
    app.catalog.upsertAsset({ ...placeholder, duration: 4 });
    const consumed = composition.tracks[kind === "video" ? 0 : 1]!.clips[0]!;
    consumed.assetId = placeholder.id;
    consumed.sourceIn = 0;
    consumed.sourceOut = 4;
    app.project.timelines = [composition];
    await app.save();
    const review = app.reviewHandoff(composition.id);
    await expect(
      app.exportHandoff({
        projectId: review.projectId,
        compositionId: composition.id,
        revision: review.revision,
      }),
    ).rejects.toThrow(/Source bounds exceed inspected media duration/);
    expect(await readdir(join(app.directory, "cache", "nle-handoff"))).toEqual(
      [],
    );
    expect(
      await Promise.all([image, audio, path].map((path) => hashFile(path))),
    ).toEqual(hashes);
    const evidence = process.env.OPENFILM_HANDOFF_SHORT_TITLE_QA_OUTPUT;
    if (evidence) {
      const { cp } = await import("node:fs/promises");
      await mkdir(evidence, { recursive: true });
      for (const publication of publications)
        await cp(
          join(app.directory, "cache", "nle-handoff-published", publication.id),
          join(evidence, `${kind}-${publication.mode}`),
          { recursive: true },
        );
      await writeFile(
        join(evidence, `${kind}-short-title-proof.json`),
        JSON.stringify(
          {
            sourceDuration: placeholder.duration,
            titleDuration: 4,
            sourceHashes: hashes,
            renderedHash,
            consumedSourceRejected: true,
            publications,
          },
          null,
          2,
        ),
      );
    }
  },
);

it.each([
  "overlay-layout",
  "overlay-motion",
  "video-layout",
  "video-motion",
] as const)(
  "rejects render-required %s at review with the renderer's capability diagnostic",
  async (kind) => {
    const { root, app, composition } = await fixture();
    const track = composition.tracks[0]!;
    if (kind.startsWith("overlay")) {
      track.type = "overlay";
      const path = join(root, "overlay-photo.png");
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=160x90",
        "-frames:v",
        "1",
        "-threads",
        "1",
        path,
      ]);
      const photo = await inspectMedia({
        path,
        uri: pathToFileURL(path).href,
        name: "overlay-photo.png",
      });
      photo.contentHash = await hashFile(path);
      app.catalog.upsertAsset(photo);
      track.clips[0]!.assetId = photo.id;
    }
    const clip = track.clips[0]!;
    if (kind.endsWith("layout")) clip.layout = { version: 1, preset: "hero" };
    else
      clip.motion = {
        version: 1,
        preset: "pan",
        easing: "linear",
        from: { x: 0, y: 0, scale: 1 },
        to: { x: 0.05, y: 0, scale: 1.02 },
      };
    app.project.timelines = [composition];
    await app.save();
    const assets = app.catalog.listAssets({ limit: 100 });
    await expect(
      new FFmpegRenderer().render(
        composition,
        assets,
        join(root, "unsupported.mp4"),
        app.project.settings,
      ),
    ).rejects.toThrow(/still image on a story video track/i);
    expect(() => app.reviewHandoff(composition.id)).not.toThrow();
    for (const input of [
      { mode: "preserve-visual-fidelity" as const },
      { bakeAudio: true },
    ])
      expect(() => app.reviewHandoff(composition.id, input)).toThrow(
        /still image on a story video track/i,
      );
    expect(await readdir(join(app.directory, "cache"))).not.toContain(
      "nle-handoff",
    );
  },
);

it.each([{ mode: "preserve-visual-fidelity" as const }, { bakeAudio: true }])(
  "rejects render-required review over its associated Story maximum: %j",
  async (input) => {
    const { app, composition } = await fixture();
    composition.duration = 4.25;
    app.project.timelines = [composition];
    await app.save();
    await expect(app.render(composition.id)).rejects.toMatchObject({
      code: "render.overMaximum",
    });
    expect(() => app.reviewHandoff(composition.id)).not.toThrow();
    expect(() => app.reviewHandoff(composition.id, input)).toThrow(
      /story maximum/i,
    );
    app.project.stories.find(
      (story) => story.id === composition.storyId,
    )!.maxDuration = 4.25 - 0.000005;
    await app.save();
    expect(() => app.reviewHandoff(composition.id, input)).not.toThrow();
  },
);

it("binds render approval to the saved Story maximum without mutating the project", async () => {
  const { app, composition } = await fixture();
  const first = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
  });
  app.project.stories.find(
    (story) => story.id === composition.storyId,
  )!.maxDuration = 5;
  expect(() =>
    app.reviewHandoff(composition.id, { mode: "preserve-visual-fidelity" }),
  ).toThrow(/stale|unsaved/i);
  await app.save();
  const next = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
  });
  expect(next.revision).not.toBe(first.revision);
  await expect(
    app.exportHandoff({
      projectId: first.projectId,
      compositionId: composition.id,
      revision: first.revision,
      mode: first.plan.mode,
    }),
  ).rejects.toThrow(/stale/i);
});

it("invalidates reviewed approval when a same-ID catalog source is refreshed", async () => {
  const { app, composition } = await fixture();
  const review = app.reviewHandoff(composition.id);
  const asset = app.catalog.getAsset(composition.tracks[0]!.clips[0]!.assetId)!;
  const refreshed = structuredClone(asset);
  refreshed.contentHash = "f".repeat(64);
  app.catalog.upsertAsset(refreshed);
  expect(app.reviewHandoff(composition.id).revision).not.toBe(review.revision);
  await expect(
    app.exportHandoff({
      projectId: review.projectId,
      compositionId: composition.id,
      revision: review.revision,
    }),
  ).rejects.toThrow(/stale/i);
  app.catalog.upsertAsset(asset);
  const metadataChanged = structuredClone(asset);
  metadataChanged.metadata["openfilm.ffprobe"] = {
    streams: [{ codec_type: "video" }],
  };
  app.catalog.upsertAsset(metadataChanged);
  expect(app.reviewHandoff(composition.id).revision).not.toBe(review.revision);
});

it("renders only a short transition and preserves its remaining native cut without reapplying it", async () => {
  const { app, composition } = await fixture();
  composition.graphicScenes = [];
  composition.captionTracks = [];
  composition.tracks[0]!.clips[0]!.transition = {
    type: "crossfade",
    duration: 0.5,
  };
  app.project.timelines = [composition];
  await app.save();
  const review = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
  });
  const result = await app.exportHandoff({
    projectId: review.projectId,
    revision: review.revision,
    compositionId: composition.id,
    mode: review.plan.mode,
  });
  expect(result.plan.visualRanges).toEqual([{ startFrame: 0, endFrame: 4 }]);
  const path = (name: string) =>
    app.handoff.file(
      result.id,
      result.files.findIndex((file) => file.name === name),
    );
  const timeline = JSON.parse(
    await readFile(await path("timeline.otio"), "utf8"),
  );
  const native = timeline.metadata.openfilm.composition.tracks.find(
    (track: { id: string }) => track.id === "picture",
  ).clips[0];
  expect(native.timelineStart).toBe(0.5);
  expect(native.timelineDuration).toBe(3.5);
  expect(native.transition).toBeUndefined();
  for (const frame of [0, 3]) {
    const pixels = await Promise.all(
      ["reference.mp4", "media/precomp-0.mp4"].map(
        async (name) =>
          (
            await runProcess("ffmpeg", [
              "-v",
              "error",
              "-i",
              await path(name),
              "-vf",
              `select=eq(n\\,${frame})`,
              "-frames:v",
              "1",
              "-f",
              "rawvideo",
              "-pix_fmt",
              "rgb24",
              "pipe:1",
            ])
          ).stdout,
      ),
    );
    expect(pixels[0]!.length).toBe(160 * 90 * 3);
    expect(pixels[1]!.length).toBe(pixels[0]!.length);
    expect(
      pixels[0]!.reduce(
        (sum, value, i) => sum + Math.abs(value - pixels[1]![i]!),
        0,
      ) / pixels[0]!.length,
    ).toBeLessThan(3);
  }
});

it("binds mode, audio and caption selections to the reviewed approval", async () => {
  const { app, composition } = await fixture();
  const review = app.reviewHandoff(composition.id);
  const request = {
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
  };
  for (const change of [
    { mode: "preserve-visual-fidelity" as const },
    { bakeAudio: true },
    { captionTrackId: null },
  ])
    await expect(app.exportHandoff({ ...request, ...change })).rejects.toThrow(
      /stale/i,
    );
});

it("rejects audio-only sources on visual tracks during review before silent picture baking", async () => {
  const { app, composition } = await fixture();
  composition.tracks[0]!.clips[0]!.assetId =
    composition.tracks[1]!.clips[0]!.assetId;
  app.project.timelines = [composition];
  await app.save();
  expect(() =>
    app.reviewHandoff(composition.id, { mode: "preserve-visual-fidelity" }),
  ).toThrow(/audio.*visual/i);
});

it("rejects expanded reviews that cannot fit the downloadable receipt budget", async () => {
  const { app, composition } = await fixture();
  app.project.settings.frameRate = 100;
  const clip = composition.tracks[0]!.clips[0]!;
  composition.graphicScenes = [];
  composition.tracks = Array.from({ length: 128 }, (_, index) => ({
    id: `visual-${index}`,
    type: "video" as const,
    clips: [{ ...clip, id: `clip-${index}` }],
  }));
  composition.captionTracks![0]!.cues = Array.from(
    { length: 64 },
    (_, index) => ({
      version: 1 as const,
      id: `cue-${index}`,
      startMs: index * 30,
      endMs: index * 30 + 10,
      text: "合成字幕",
      source: { kind: "manual" as const },
      manualRevision: 0,
    }),
  );
  app.project.timelines = [composition];
  await app.save();
  const plan = createHandoffPlan(composition, 100, {
    mode: "preserve-visual-fidelity",
  });
  expect(plan.visualRanges).toHaveLength(64);
  expect(Buffer.byteLength(JSON.stringify(plan, null, 2))).toBeGreaterThan(
    2 * 1024 ** 2,
  );
  expect(() =>
    app.reviewHandoff(composition.id, { mode: "preserve-visual-fidelity" }),
  ).toThrow(/review.*limit/i);
});

it("sorts sidecar copies without changing saved cue storage order", async () => {
  const { app, composition } = await fixture();
  const track = composition.captionTracks![0]!;
  track.cues.push({
    ...track.cues[0]!,
    id: "early",
    startMs: 0,
    endMs: 1000,
    text: "較早字幕",
  });
  app.project.timelines = [composition];
  await app.save();
  const before = JSON.stringify(app.project);
  const review = app.reviewHandoff(composition.id);
  const result = await app.exportHandoff({
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
  });
  for (const format of ["srt", "vtt"]) {
    const index = result.files.findIndex(
      (file) => file.name === `captions-0.${format}`,
    );
    const text = await readFile(
      await app.handoff.file(result.id, index),
      "utf8",
    );
    expect(text.indexOf("較早字幕")).toBeLessThan(text.indexOf("合成字幕"));
  }
  expect(JSON.stringify(app.project)).toBe(before);
});

it.each(["video", "overlay", "audio", "music"] as const)(
  "rejects a missing %s catalog source before approving a handoff",
  async (type) => {
    const { app, composition } = await fixture();
    composition.tracks = [
      {
        id: `missing-${type}`,
        type,
        clips: [
          { ...composition.tracks[0]!.clips[0]!, assetId: "absent-source" },
        ],
      },
    ];
    app.project.timelines = [composition];
    await app.save();
    expect(() => app.reviewHandoff(composition.id)).toThrow(
      /missing.*source|missing media/i,
    );
  },
);

it.each(["aggregate", "frame-rate"] as const)(
  "applies the renderer's %s graphic budget only when handoff rendering is required",
  async (budget) => {
    const { app, composition } = await fixture();
    composition.captionTracks = [];
    if (budget === "aggregate") {
      app.project.settings.frameRate = 30;
      composition.duration = 30;
      composition.graphicScenes = Array.from({ length: 3 }, (_, index) => ({
        ...composition.graphicScenes![0]!,
        id: `graphic-${index}`,
        start: 0,
        duration: 30,
        zIndex: index,
        nodes: [
          {
            ...composition.graphicScenes![0]!.nodes[0]!,
            id: `shape-${index}`,
            end: 30,
          },
        ],
      }));
    } else app.project.settings.frameRate = 90;
    app.project.timelines = [composition];
    await app.save();
    expect(() => app.reviewHandoff(composition.id)).not.toThrow();
    expect(() =>
      app.reviewHandoff(composition.id, { mode: "preserve-visual-fidelity" }),
    ).toThrow(/graphic.*budget/i);
    expect(() =>
      app.reviewHandoff(composition.id, { bakeAudio: true }),
    ).toThrow(/graphic.*budget/i);
  },
);

it.each(["<b>bold</b>", "00:00:00,000 --> 00:00:01,000"])(
  "rejects SubRip-unsafe saved text before approving even an unselected caption track: %s",
  async (text) => {
    const { app, composition } = await fixture();
    composition.captionTracks![0]!.cues[0]!.text = text;
    app.project.timelines = [composition];
    await app.save();
    expect(() =>
      app.reviewHandoff(composition.id, { captionTrackId: null }),
    ).toThrow(/SubRip/i);
  },
);

it("bakes amplified gain into the real full mix while retaining the original recipe and neutralizing native picture gain", async () => {
  const { app, composition, image, audio } = await fixture();
  composition.graphicScenes = [];
  composition.captionTracks = [];
  app.project.timelines = [composition];
  await app.save();
  const hashes = await Promise.all([hashFile(image), hashFile(audio)]);
  const publish = async () => {
    const review = app.reviewHandoff(composition.id, { bakeAudio: true });
    return app.exportHandoff({
      projectId: review.projectId,
      compositionId: composition.id,
      revision: review.revision,
      bakeAudio: true,
    });
  };
  const rms = async (publication: Awaited<ReturnType<typeof publish>>) => {
    const path = await app.handoff.file(
      publication.id,
      publication.files.findIndex((file) => file.name === "media/full-mix.wav"),
    );
    const { stdout } = await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-f",
      "f32le",
      "-ac",
      "1",
      "pipe:1",
    ]);
    let squared = 0;
    for (let offset = 0; offset < stdout.length; offset += 4)
      squared += stdout.readFloatLE(offset) ** 2;
    return Math.sqrt(squared / (stdout.length / 4));
  };
  const nativeGain = await publish();
  for (const track of composition.tracks)
    for (const clip of track.clips) clip.transform = { volume: 2 };
  app.project.timelines = [composition];
  await app.save();
  const before = JSON.stringify(app.project);
  const amplified = await publish();
  const unamplifiedRms = await rms(nativeGain),
    amplifiedRms = await rms(amplified),
    ratio = amplifiedRms / unamplifiedRms;
  expect(ratio).toBeGreaterThan(1.9);
  expect(ratio).toBeLessThan(2.1);
  const timeline = JSON.parse(
    await readFile(
      await app.handoff.file(
        amplified.id,
        amplified.files.findIndex((file) => file.name === "timeline.otio"),
      ),
      "utf8",
    ),
  );
  expect(timeline.metadata.openfilm.originalComposition).toEqual(composition);
  const exchange = timeline.metadata.openfilm.composition;
  expect(
    exchange.tracks.find((track: { id: string }) => track.id === "picture")
      .clips[0].transform.volume ?? 1,
  ).toBe(1);
  expect(
    exchange.tracks.filter((track: { type: string }) => track.type === "audio"),
  ).toHaveLength(1);
  expect(
    amplified.plan.items
      .filter((item) => item.feature === "volume")
      .every((item) => item.disposition === "baked"),
  ).toBe(true);
  expect(() => app.reviewHandoff(composition.id)).toThrow(/volume/i);
  expect(await Promise.all([hashFile(image), hashFile(audio)])).toEqual(hashes);
  expect(JSON.stringify(app.project)).toBe(before);
  if (process.env.OPENFILM_HANDOFF_GAIN_QA_OUTPUT) {
    const output = process.env.OPENFILM_HANDOFF_GAIN_QA_OUTPUT;
    const { cp } = await import("node:fs/promises");
    await mkdir(output, { recursive: true, mode: 0o700 });
    for (const [name, publication] of [
      ["unamplified", nativeGain],
      ["amplified", amplified],
    ] as const)
      await cp(
        join(app.directory, "cache", "nle-handoff-published", publication.id),
        join(output, name),
        { recursive: true },
      );
    await writeFile(
      join(output, "gain-proof.json"),
      JSON.stringify(
        {
          unamplifiedRms,
          amplifiedRms,
          ratio,
          sourceHashes: hashes,
          originalGain: 2,
          nativePictureGain: 1,
          projectUnchanged: true,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  }
});

it.each(["width", "height"] as const)(
  "rejects an odd render %s before approval even without GraphicScenes",
  async (dimension) => {
    const { app, composition } = await fixture();
    composition.graphicScenes = [];
    app.project.settings[dimension]++;
    app.project.timelines = [composition];
    await app.save();
    expect(() => app.reviewHandoff(composition.id)).not.toThrow();
    expect(() =>
      app.reviewHandoff(composition.id, { bakeAudio: true }),
    ).toThrow(/even.*dimension|dimension.*even/i);
    expect(() =>
      app.reviewHandoff(composition.id, { mode: "preserve-visual-fidelity" }),
    ).toThrow(/even.*dimension|dimension.*even/i);
  },
);

it.each(
  [65, 5000].flatMap((cueCount) => [
    { cueCount, options: { mode: "preserve-visual-fidelity" as const } },
    { cueCount, options: { bakeAudio: true } },
  ]),
)(
  "rejects $cueCount selected render cues even when they merge into one bake range: $options",
  async ({ cueCount, options }) => {
    const { app, composition } = await fixture();
    composition.graphicScenes = [];
    const track = composition.captionTracks![0]!;
    track.cues = Array.from({ length: cueCount }, (_, index) => ({
      ...track.cues[0]!,
      id: `caption-${index}`,
      startMs: 0,
      endMs: 1000,
    }));
    app.project.timelines = [composition];
    await app.save();
    expect(() => app.reviewHandoff(composition.id)).not.toThrow();
    expect(() => app.reviewHandoff(composition.id, options)).toThrow(
      /64.*caption|caption.*64/i,
    );
    expect(() =>
      app.reviewHandoff(composition.id, { ...options, captionTrackId: null }),
    ).not.toThrow();
  },
);

it("packages freshly measured video and audio handles while leaving stale catalog durations unchanged", async () => {
  const { app, composition, image, audio } = await fixture();
  const assets = composition.tracks.map((track) =>
    app.catalog.getAsset(track.clips[0]!.assetId)!,
  );
  for (const asset of assets)
    app.catalog.upsertAsset({ ...asset, duration: 9 });
  const project = JSON.stringify(app.project),
    hashes = await Promise.all([hashFile(image), hashFile(audio)]);
  const review = app.reviewHandoff(composition.id);
  const publication = await app.exportHandoff({
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
  });
  const timeline = JSON.parse(
    await readFile(
      await app.handoff.file(
        publication.id,
        publication.files.findIndex((file) => file.name === "timeline.otio"),
      ),
      "utf8",
    ),
  );
  const references = timeline.tracks.children.flatMap(
    (track: {
      children: {
        media_reference?: {
          target_url: string;
          available_range: { duration: { value: number; rate: number } };
        };
      }[];
    }) =>
      track.children.flatMap((clip) =>
        clip.media_reference ? [clip.media_reference] : [],
      ),
  );
  expect(references).toHaveLength(3);
  for (const reference of references) {
    const duration = reference.available_range.duration;
    expect(duration.value / duration.rate).toBe(
      reference.target_url.endsWith(".mp4") ? 5 : 4,
    );
  }
  for (const asset of assets)
    expect(app.catalog.getAsset(asset.id)!.duration).toBe(9);
  expect(await Promise.all([hashFile(image), hashFile(audio)])).toEqual(hashes);
  expect(JSON.stringify(app.project)).toBe(project);
});

it("renders the admitted 64-cue reference within the filter argument budget", async () => {
  const { app, composition } = await fixture();
  const processes = vi.spyOn(media, "runProcess");
  composition.graphicScenes = [];
  const track = composition.captionTracks![0]!;
  track.cues = Array.from({ length: 64 }, (_, index) => ({
    ...track.cues[0]!,
    id: `caption-${index}`,
    startMs: 0,
    endMs: 1000,
  }));
  app.project.timelines = [composition];
  await app.save();
  const review = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
  });
  const publication = await app.exportHandoff({
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
    mode: review.plan.mode,
  });
  const graphs = processes.mock.calls
    .filter(
      ([command, args]) =>
        command === "ffmpeg" && args.includes("-filter_complex"),
    )
    .map(([, args]) => args[args.indexOf("-filter_complex") + 1]!);
  expect(graphs).toHaveLength(1);
  expect(Buffer.byteLength(graphs[0]!)).toBeLessThan(128 * 1024);
  expect(publication.plan.visualRanges).toEqual([
    { startFrame: 0, endFrame: 8 },
  ]);
  const proof = JSON.parse(
    await readFile(
      await app.handoff.file(
        publication.id,
        publication.files.findIndex(
          (file) => file.name === "render-evidence.json",
        ),
      ),
      "utf8",
    ),
  );
  expect(Number(proof.measured.nb_read_frames)).toBe(32);
  if (process.env.OPENFILM_HANDOFF_LIMIT_QA_OUTPUT) {
    await mkdir(process.env.OPENFILM_HANDOFF_LIMIT_QA_OUTPUT, {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      join(
        process.env.OPENFILM_HANDOFF_LIMIT_QA_OUTPUT,
        "caption-budget-proof.json",
      ),
      JSON.stringify(
        {
          selectedCues: track.cues.length,
          filterArgumentBytes: Buffer.byteLength(graphs[0]!),
          plan: publication.plan,
          measured: proof.measured,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  }
});

it("rejects an aligned visual bake beyond the complete fractional reference duration before approval", async () => {
  const { app, composition } = await fixture();
  app.project.settings.frameRate = 30;
  composition.duration = 0.9999999;
  composition.captionTracks = [];
  composition.graphicScenes = [];
  for (const track of composition.tracks)
    for (const clip of track.clips) {
      clip.timelineDuration = 1;
      clip.sourceOut = (clip.sourceIn ?? 0) + 1;
    }
  composition.tracks[0]!.clips[0]!.transform = { scale: 1.1 };
  app.project.timelines = [composition];
  await app.save();
  expect(() => app.reviewHandoff(composition.id)).not.toThrow();
  expect(() =>
    app.reviewHandoff(composition.id, {
      mode: "preserve-visual-fidelity",
    }),
  ).toThrow(/reference.*frame|frame.*reference/i);
});

it("renders a near-boundary duration admitted by the shared one-nanosecond contract with all 30 frames", async () => {
  const { app, composition } = await fixture();
  app.project.settings.frameRate = 30;
  composition.duration = 1 - 5e-10;
  composition.captionTracks = [];
  for (const track of composition.tracks)
    for (const clip of track.clips) {
      clip.timelineDuration = composition.duration;
      clip.sourceOut = (clip.sourceIn ?? 0) + composition.duration;
    }
  const scene = composition.graphicScenes![0]!;
  scene.start = 0;
  scene.duration = composition.duration;
  scene.nodes[0]!.end = composition.duration;
  app.project.timelines = [composition];
  await app.save();
  const review = app.reviewHandoff(composition.id, {
    mode: "preserve-visual-fidelity",
    bakeAudio: true,
  });
  const publication = await app.exportHandoff({
    projectId: review.projectId,
    compositionId: composition.id,
    revision: review.revision,
    mode: review.plan.mode,
    bakeAudio: true,
  });
  expect(publication.plan.visualRanges).toEqual([
    { startFrame: 0, endFrame: 30 },
  ]);
  expect(publication.plan.durationFrames).toBe(30);
  const proof = JSON.parse(
    await readFile(
      await app.handoff.file(
        publication.id,
        publication.files.findIndex(
          (file) => file.name === "render-evidence.json",
        ),
      ),
      "utf8",
    ),
  );
  expect(Number(proof.measured.nb_read_frames)).toBe(30);
});

it.each(["chunked", "content-length"] as const)(
  "does not start a queued publication after its fully sent %s request disconnects",
  async (encoding) => {
    const { app, composition } = await fixture();
    const review = app.reviewHandoff(composition.id, {
        mode: "preserve-visual-fidelity",
      }),
      directory = app.directory;
    cleanup.pop();
    await app.close();
    const server = await startServer({ port: 0, project: directory });
    cleanup.push(() => server.close());
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exportSpy = vi.spyOn(OpenFilmApplication.prototype, "exportHandoff");
    const original = FFmpegRenderer.prototype.render;
    const renderer = vi
      .spyOn(FFmpegRenderer.prototype, "render")
      .mockImplementationOnce(async function (this: FFmpegRenderer, ...args) {
        entered();
        await held;
        return original.apply(this, args);
      });
    const input = {
      projectId: review.projectId,
      compositionId: composition.id,
      revision: review.revision,
      mode: review.plan.mode,
    };
    const endpoint = `http://127.0.0.1:${server.port}/api/handoff/export`;
    const first = fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    await started;
    let received!: (request: import("node:http").IncomingMessage) => void,
      disconnected!: () => void;
    const arriving = new Promise<import("node:http").IncomingMessage>(
      (resolve) => {
        received = resolve;
      },
    );
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    server.server.once("request", (request, response) => {
      received(request);
      response.once("close", disconnected);
    });
    const { request } = await import("node:http");
    const queued = request(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(encoding === "content-length"
          ? { "Content-Length": Buffer.byteLength(JSON.stringify(input)) }
          : {}),
      },
    });
    queued.on("error", () => {});
    queued.end(JSON.stringify(input));
    const incoming = await arriving;
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      expect(incoming.complete).toBe(true);
      queued.destroy();
      await closed;
    } finally {
      queued.destroy();
      release();
    }
    expect((await first).status).toBe(200);
    const barrier = await fetch(
      `http://127.0.0.1:${server.port}/api/handoff/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    expect(barrier.status).toBe(200);
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect(
      await readdir(join(directory, "cache", "nle-handoff-published")),
    ).toHaveLength(1);
    expect(await readdir(join(directory, "cache", "nle-handoff"))).toEqual([]);
  },
);
