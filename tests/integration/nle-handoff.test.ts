import { FFmpegRenderer } from "@openfilm/render";
import { startServer } from "../../apps/server/src/server.js";
import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
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
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
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
it("hands off native cuts plus measured graphic/caption precomps and an aligned full mix", async () => {
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
  await runProcess(process.env.OPENFILM_OTIO_PYTHON ?? "python3", [
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

it("does not inherit the film look again on already rendered precomps", async () => {
  const { app, composition } = await fixture();
  composition.defaultLook = { version: 1, preset: "retro", strength: 0.8 };
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
  const exchange = timeline.metadata.openfilm.composition;
  const precomp = exchange.tracks.find(
    (track: { id: string }) =>
      track.id.startsWith("handoff-") && track.id.includes("-track-"),
  );
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
