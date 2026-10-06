import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import type {
  MediaAsset,
  SceneAnalysis,
  TranscriptDocument,
  WaveformData,
} from "@openfilm/core";
import * as media from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it.each(["providerId", "version", "model"] as const)(
  "recomputes incompatible %s caches while preserving transcripts and manual markers",
  async (field) => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-cache-identity-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const source = join(root, "source.mp4");
    // Generation is mocked; source identity and all persistence are real.
    await writeFile(
      source,
      "stable source bytes for cache identity regression",
    );
    const sourceHash = await media.hashFile(source);
    let app = await OpenFilmApplication.create(
      join(root, "film.openfilm"),
      "Cache identity",
    );
    cleanups.push(() => app.close());
    const asset: MediaAsset = {
      id: "source",
      uri: pathToFileURL(source).href,
      name: "source.mp4",
      mediaType: "video",
      duration: 4,
      contentHash: sourceHash,
      tags: [],
      state: {},
      metadata: {},
    };
    app.catalog.upsertAsset(asset);
    const stamp = { sourceHash, createdAt: "2026-10-06T00:00:00.000Z" };
    const transcript: TranscriptDocument = {
      id: "historical-transcript",
      assetId: asset.id,
      language: "en",
      provenance: {
        ...stamp,
        providerId: "previous-transcription-provider",
        providerVersion: "old-engine",
        model: "previous-model",
        version: "1",
      },
      segments: [{ id: "speech", start: 0.5, end: 1.5, text: "Keep my words" }],
    };
    app.catalog.intelligence.replaceTranscript(transcript);
    const manual = await app.intelligence.addMarker(asset.id, 1, "Keep marker");
    const waveform: WaveformData = {
      assetId: asset.id,
      duration: 4,
      sampleRate: 1,
      peaks: [0, 0.5, 1, 0],
      provenance: { ...media.WAVEFORM_CACHE_IDENTITY, ...stamp },
    };
    const scenes: SceneAnalysis = {
      assetId: asset.id,
      markers: [
        { id: "current-scene", assetId: asset.id, type: "scene-cut", time: 2 },
      ],
      provenance: { ...media.sceneCacheIdentity(), ...stamp },
    };
    const oldWaveform: WaveformData = {
      ...waveform,
      peaks: [1, 1, 1, 1],
      provenance: {
        ...waveform.provenance,
        [field]:
          field === "model"
            ? "channel-max-s16le-8000hz-max-20000-peaks"
            : "incompatible",
      },
    };
    const oldScenes: SceneAnalysis = {
      ...scenes,
      markers: [
        { id: "old-scene", assetId: asset.id, type: "scene-cut", time: 0.25 },
      ],
      provenance: {
        ...scenes.provenance,
        [field]:
          field === "model" ? "scene-score-0.3-width-320" : "incompatible",
      },
    };
    app.catalog.intelligence.saveWaveform(oldWaveform);
    app.catalog.intelligence.saveScenes(oldScenes);
    const before = await app.intelligence.read(asset.id);
    expect(before.waveform).toBeUndefined();
    expect(before.scenes).toBeUndefined();
    expect(before.markers).toEqual([manual]);
    expect(before.transcript).toEqual(transcript);

    const generate = vi
      .spyOn(media, "generateWaveform")
      .mockResolvedValue(waveform);
    const detect = vi.spyOn(media, "detectScenes").mockResolvedValue(scenes);
    for (const operation of ["waveform", "scenes"] as const)
      expect(
        (await app.analyzeIntelligence(asset.id, { operation })).status,
      ).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledTimes(1);

    // A newer incompatible row must not shadow the valid current pipeline cache.
    app.catalog.intelligence.saveWaveform(oldWaveform);
    app.catalog.intelligence.saveScenes(oldScenes);
    for (const operation of ["waveform", "scenes"] as const)
      expect(
        (await app.analyzeIntelligence(asset.id, { operation })).status,
      ).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(detect).toHaveBeenCalledTimes(1);
    const directory = app.directory;
    app.close();
    app = await OpenFilmApplication.open(directory);
    const restored = await app.intelligence.read(asset.id);
    expect(restored.waveform).toEqual(waveform);
    expect(restored.scenes).toEqual(scenes);
    expect(restored.markers).toEqual([manual, ...scenes.markers]);
    expect(restored.transcript).toEqual(transcript);
    expect(
      app.catalog.intelligence.getScenes(
        asset.id,
        sourceHash,
        oldScenes.provenance,
      ),
    ).toEqual(oldScenes);
  },
);
