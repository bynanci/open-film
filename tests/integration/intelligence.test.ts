import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";
import type { TranscriptionProvider } from "@openfilm/plugin-sdk";
import { startServer } from "../../apps/server/src/server.js";

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const fixtureProvider = (
  overrides: Partial<TranscriptionProvider> = {},
): TranscriptionProvider => ({
  id: "integration-transcript-fixture",
  name: "Explicit test transcript",
  kind: "transcription",
  execution: "local",
  dataKinds: ["video", "audio", "metadata"],
  capabilities: {
    wordTimestamps: true,
    languages: ["auto", "zh", "en", "ja"],
    cpuFallback: true,
  },
  async transcribe(_asset, options) {
    options?.onStage?.("loading-model");
    options?.onStage?.("transcribing");
    options?.onProgress?.(0.5);
    return {
      text: "Our story",
      language:
        options?.language === "auto" ? "en" : (options?.language ?? "en"),
      execution: "cpu",
      model: "test-only",
      version: "fixture-engine-1",
      segments: [
        {
          start: 0.2,
          end: 1.2,
          text: "Our story",
          words: [
            { start: 0.2, end: 0.6, text: "Our", confidence: 0.9 },
            { start: 0.7, end: 1.2, text: "story", confidence: 0.95 },
          ],
        },
      ],
    };
  },
  ...overrides,
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-intelligence-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "訪問 # & memories.mp4");
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=160x90:r=24:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=160x90:r=24:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000:duration=4",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-map",
    "2:a",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Memories",
  );
  const imported = await app.importFiles([source], { proxies: false });
  expect(imported.imported, JSON.stringify(imported.job.errors)).toBe(1);
  const asset = app.catalog.listAssets()[0]!;
  app.intelligence.registerTranscriptionProvider(fixtureProvider());
  cleanups.push(() => {
    if (!app.hasActiveJobs) {
      try {
        app.close();
      } catch {
        /* Already closed/reopened by the test. */
      }
    }
  });
  return { app, source, asset, root };
}

describe("durable media intelligence orchestration", () => {
  it("keeps a Proposal film with photo, spoken video and music unchanged until a shared precision edit", async () => {
    const { app, root } = await fixture();
    const photo = join(root, "proposal-photo.png");
    const spoken = join(root, "proposal-spoken.mp4");
    const music = join(root, "proposal-music.wav");
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=green:s=160x90",
      "-frames:v",
      "1",
      "-threads",
      "1",
      photo,
    ]);
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=blue:s=160x90:r=24:d=4",
      "-f",
      "lavfi",
      "-i",
      "flite=text='Our memories are the beginning of our story':voice=slt",
      "-t",
      "4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      spoken,
    ]);
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=4",
      music,
    ]);
    expect(
      (await app.importFiles([photo, spoken, music], { proxies: false }))
        .imported,
    ).toBe(3);
    const selected = app.catalog
      .listAssets()
      .filter((a) => a.name.startsWith("proposal-"));
    const video = selected.find((a) => a.mediaType === "video")!;
    const story = app.generateStory({
      template: "proposal-film",
      assetIds: selected.map((a) => a.id),
      targetDuration: 18,
      maxDuration: 30,
    });
    const savedStory = app.project.stories.find((s) => s.id === story.id)!;
    for (const beat of savedStory.beats)
      beat.selectedAssetIds = [...(beat.candidateAssetIds ?? [])];
    await app.save();
    const composition = app.compose(story.id);
    expect(story.template).toBe("proposal-film");
    expect(
      new Set(composition.tracks.flatMap((t) => t.clips).map((c) => c.assetId)),
    ).toEqual(new Set(selected.map((a) => a.id)));
    const before = JSON.stringify(app.project);
    const hashes = await Promise.all(
      [photo, spoken, music].map((p) => hashFile(p)),
    );
    expect(
      (await app.analyzeIntelligence(video.id, { operation: "transcribe" }))
        .status,
    ).toBe("completed");
    expect(
      (await app.analyzeIntelligence(video.id, { operation: "waveform" }))
        .status,
    ).toBe("completed");
    expect(
      (await app.analyzeIntelligence(video.id, { operation: "scenes" })).status,
    ).toBe("completed");
    expect(JSON.stringify(app.project)).toBe(before);
    const editor = new TimelineEditor(app);
    const state = editor.get(composition.id);
    const clip = composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.assetId === video.id)!;
    const edited = await editor.edit(composition.id, {
      baseRevision: state.revision,
      requestId: randomUUID(),
      commands: [
        { type: "trim", clipId: clip.id, sourceIn: 0.25, sourceOut: 3.5 },
      ],
    });
    const path = app.directory;
    app.close();
    const reopened = await OpenFilmApplication.open(path);
    cleanups.push(() => reopened.close());
    expect(reopened.project.timelines[0]).toEqual(edited.composition);
    expect(reopened.project.stories[0]).toEqual(savedStory);
    reopened.project.settings = { width: 160, height: 90, frameRate: 24 };
    expect(
      (await readFile(await reopened.render(composition.id))).length,
    ).toBeGreaterThan(100);
    expect(
      await Promise.all([photo, spoken, music].map((p) => hashFile(p))),
    ).toEqual(hashes);
  }, 60000);
  it("isolates throwing progress observers from durable completion", async () => {
    const { app, asset } = await fixture();
    const job = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
      onJob() {
        throw new Error("Observer failed");
      },
    });
    expect(job.status).toBe("completed");
    expect(app.catalog.listJobs()[0]?.status).toBe("completed");
    expect(
      (await app.intelligence.read(asset.id)).transcript?.segments,
    ).toHaveLength(1);
    expect(app.hasActiveJobs).toBe(false);
  });
  it("records the invoked provider even when registration changes during its awaited result", async () => {
    const { app, asset } = await fixture();
    app.intelligence.registerTranscriptionProvider(
      fixtureProvider({
        async transcribe(media, options) {
          app.intelligence.registerTranscriptionProvider(
            fixtureProvider({ id: "replacement-fixture" }),
          );
          await Promise.resolve();
          return fixtureProvider().transcribe(media, options);
        },
      }),
    );
    const job = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
    });
    expect(job.status).toBe("completed");
    expect(
      (await app.intelligence.read(asset.id)).transcript?.provenance.providerId,
    ).toBe("integration-transcript-fixture");
    await app.analyzeIntelligence(asset.id, { operation: "transcribe" });
    expect(
      (await app.intelligence.read(asset.id)).transcript?.provenance.providerId,
    ).toBe("replacement-fixture");
  });
  it("shares jobs, word timing, source caches and timeline split across save/reopen without altering Story", async () => {
    const { app, source, asset } = await fixture();
    const original = await hashFile(source);
    const story = app.generateStory({
      title: "Our story",
      assetIds: [asset.id],
      targetDuration: 4,
      maxDuration: 10,
    });
    const composition = app.compose(story.id);
    const before = JSON.stringify(app.project);
    const stages: string[] = [];
    const job = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
      language: "ja",
      onJob: (j) => {
        stages.push(j.stage ?? j.status);
        j.status = "failed";
      },
    });
    expect(job.status).toBe("completed");
    expect(job.language).toBe("ja");
    expect(job.execution).toBe("cpu");
    expect(stages).toEqual(
      expect.arrayContaining([
        "queued",
        "checking-source",
        "loading-model",
        "transcribing",
        "indexing",
        "completed",
      ]),
    );
    expect(JSON.stringify(app.project)).toBe(before);
    const state = await app.intelligence.read(asset.id);
    expect(state.transcript?.segments[0]?.words?.[1]?.start).toBe(0.7);
    expect(state.transcript?.provenance.providerVersion).toBe(
      "fixture-engine-1",
    );
    expect(state.transcript?.provenance.sourceHash).toBe(original);
    expect(asset.metadata).not.toHaveProperty("transcript");
    expect(
      (await app.analyzeIntelligence(asset.id, { operation: "waveform" }))
        .status,
    ).toBe("completed");
    const waveform = (await app.intelligence.read(asset.id)).waveform!;
    expect(waveform.peaks.length).toBeGreaterThan(100);
    expect(waveform.duration).toBeCloseTo(4, 1);
    expect(
      (await app.analyzeIntelligence(asset.id, { operation: "waveform" }))
        .status,
    ).toBe("completed");
    expect((await app.intelligence.read(asset.id)).waveform).toEqual(waveform);
    expect(
      (await app.analyzeIntelligence(asset.id, { operation: "scenes" })).status,
    ).toBe("completed");
    expect(
      (await app.intelligence.read(asset.id)).scenes?.markers.some(
        (m) => Math.abs(m.time - 2) < 0.1,
      ),
    ).toBe(true);
    const marker = await app.intelligence.addMarker(
      asset.id,
      1.5,
      "Important memory",
    );
    const editor = new TimelineEditor(app);
    const initial = editor.get(composition.id);
    const clip = composition.tracks.flatMap((t) => t.clips)[0]!;
    const edited = await editor.edit(composition.id, {
      baseRevision: initial.revision,
      requestId: randomUUID(),
      commands: [{ type: "clip.split", clipId: clip.id, sourceTime: 2 }],
    });
    expect(edited.composition.tracks.flatMap((t) => t.clips)).toHaveLength(2);
    expect(edited.composition.duration).toBe(composition.duration);
    const undone = await editor.undo(composition.id, edited.revision);
    expect(undone.composition.tracks.flatMap((t) => t.clips)).toHaveLength(1);
    const redone = await editor.redo(composition.id, undone.revision);
    expect(redone.composition.tracks.flatMap((t) => t.clips)).toHaveLength(2);
    const directory = app.directory;
    app.close();
    const reopened = await OpenFilmApplication.open(directory);
    cleanups.push(() => reopened.close());
    const restored = await reopened.intelligence.read(asset.id);
    expect(restored.transcript).toEqual(state.transcript);
    expect(restored.waveform).toEqual(waveform);
    expect(restored.markers).toContainEqual(marker);
    expect(
      reopened.project.timelines[0]?.tracks.flatMap((t) => t.clips),
    ).toHaveLength(2);
    expect(reopened.project.stories[0]).toEqual(story);
    reopened.project.settings = { width: 160, height: 90, frameRate: 24 };
    const preview = await reopened.render(composition.id);
    expect((await readFile(preview)).length).toBeGreaterThan(100);
    expect(await hashFile(source)).toBe(original);
  }, 60000);

  it("successful retranscription replaces only after validation; failed and cancelled jobs preserve the prior revision", async () => {
    const { app, asset } = await fixture();
    await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
      language: "en",
    });
    const prior = (await app.intelligence.read(asset.id)).transcript!;
    app.intelligence.registerTranscriptionProvider(
      fixtureProvider({
        async transcribe() {
          throw new Error("Decoder initialization failed");
        },
      }),
    );
    const failed = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
      language: "ja",
    });
    expect(failed.status).toBe("failed");
    expect(failed.errors?.[0]?.code).toBe("media.transcriptionFailed");
    expect((await app.intelligence.read(asset.id)).transcript).toEqual(prior);
    app.intelligence.registerTranscriptionProvider(
      fixtureProvider({
        async transcribe(_asset, options) {
          options?.signal?.throwIfAborted();
          await new Promise((_resolve, reject) =>
            options?.signal?.addEventListener(
              "abort",
              () =>
                reject(
                  Object.assign(new Error("Cancelled"), { name: "AbortError" }),
                ),
              { once: true },
            ),
          );
          throw new Error("Unreachable");
        },
      }),
    );
    const controller = new AbortController();
    const task = app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
      signal: controller.signal,
    });
    await expect
      .poll(() => app.catalog.listJobs()[0]?.stage)
      .toBe("checking-source");
    controller.abort();
    const cancelled = await task;
    expect(cancelled.status).toBe("cancelled");
    expect(app.hasActiveJobs).toBe(false);
    expect((await app.intelligence.read(asset.id)).transcript).toEqual(prior);
    app.intelligence.registerTranscriptionProvider(fixtureProvider());
    await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
      language: "ja",
    });
    expect((await app.intelligence.read(asset.id)).transcript?.language).toBe(
      "ja",
    );
  }, 30000);

  it("invalidates analysis for changed or missing sources and rejects mid-job source replacement", async () => {
    const { app, asset, source } = await fixture();
    await app.analyzeIntelligence(asset.id, { operation: "transcribe" });
    const prior = (await app.intelligence.read(asset.id)).transcript!;
    app.intelligence.registerTranscriptionProvider(
      fixtureProvider({
        async transcribe(media, options) {
          await writeFile(source, "changed original");
          return fixtureProvider().transcribe(media, options);
        },
      }),
    );
    const changed = await app.analyzeIntelligence(asset.id, {
      operation: "transcribe",
    });
    expect(changed.status).toBe("failed");
    expect(changed.errors?.[0]?.code).toBe("source.changed");
    expect(
      app.catalog.intelligence.getFullTranscript(
        asset.id,
        prior.provenance.sourceHash,
      ),
    ).toEqual(prior);
    await expect(app.intelligence.read(asset.id)).rejects.toMatchObject({
      code: "source.changed",
    });
    await rm(source);
    await expect(app.intelligence.read(asset.id)).rejects.toMatchObject({
      code: "media.missing",
    });
  }, 30000);
});

describe("media intelligence HTTP boundary", () => {
  it("returns background jobs and bounded transcripts, rejects malformed markers, and persists marker deletion", async () => {
    const { app, asset } = await fixture();
    const directory = app.directory;
    app.close();
    const runtime = await startServer({
      port: 0,
      project: directory,
      transcriptionProvider: fixtureProvider(),
    });
    cleanups.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}/api`;
    const preflight = await fetch(
      `${base}/assets/${asset.id}/markers/example`,
      {
        method: "OPTIONS",
        headers: {
          Origin: "http://127.0.0.1:1420",
          "Access-Control-Request-Method": "DELETE",
        },
      },
    );
    expect(preflight.status).toBe(204);
    expect(
      preflight.headers.get("Access-Control-Allow-Methods")?.split(", "),
    ).toContain("DELETE");
    const post = (path: string, value: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
    const result = await post(`/assets/${asset.id}/intelligence`, {
      operation: "transcribe",
      language: "zh",
    });
    expect(result.status).toBe(202);
    const { job } = await result.json();
    await expect
      .poll(
        async () =>
          (await (await fetch(`${base}/jobs`)).json()).jobs.find(
            (j: { id: string }) => j.id === job.id,
          )?.status,
      )
      .toBe("completed");
    const page = await (
      await fetch(`${base}/assets/${asset.id}/intelligence?limit=1`)
    ).json();
    expect(page.transcript.language).toBe("zh");
    expect(page.transcriptTotal).toBe(1);
    expect(
      (await fetch(`${base}/assets/${asset.id}/intelligence?limit=201`)).status,
    ).toBe(400);
    expect(
      (
        await post(`/assets/${asset.id}/intelligence`, {
          operation: "transcribe",
          modelPath: "untrusted",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`/assets/${asset.id}/intelligence`, {
          operation: "transcribe",
          language: ["en"],
          execution: ["cpu"],
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(`/assets/${asset.id}/markers`, { time: "1" })).status,
    ).toBe(400);
    const added = await (
      await post(`/assets/${asset.id}/markers`, { time: 1.5 })
    ).json();
    expect(
      (
        await fetch(`${base}/assets/${asset.id}/markers/${added.marker.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await fetch(`${base}/assets/${asset.id}/intelligence`)).json())
        .markers,
    ).toHaveLength(0);
  }, 30000);
});
