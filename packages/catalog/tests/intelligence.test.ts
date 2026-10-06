import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import type {
  MediaAsset,
  SceneAnalysis,
  TranscriptDocument,
  WaveformData,
} from "@openfilm/core";
import { CATALOG_SCHEMA_VERSION, ProjectCatalog } from "../src/index";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const hash = "a".repeat(64);
const provenance = {
  providerId: "local-test",
  version: "1",
  model: "small",
  sourceHash: hash,
  createdAt: "2026-10-06T00:00:00.000Z",
};
function asset(id = "source"): MediaAsset {
  return {
    id,
    uri: `file:///original/${id}.mp4`,
    name: "回憶 # &.mp4",
    mediaType: "video",
    contentHash: hash,
    duration: 10_000,
    rating: 5,
    tags: ["旅行"],
    state: { favorite: true, locked: true },
    metadata: { "user.notes": { important: true } },
  };
}
function transcript(id = "first", count = 2): TranscriptDocument {
  return {
    id,
    assetId: "source",
    language: "zh-TW",
    provenance: { ...provenance },
    segments: Array.from({ length: count }, (_, index) => ({
      id: `segment-${index}`,
      start: index,
      end: index + 0.8,
      text: `記憶 ${index}`,
      words: [
        { start: index, end: index + 0.4, text: "記憶", confidence: 0.9 },
      ],
    })),
  };
}
function waveform(): WaveformData {
  return {
    assetId: "source",
    duration: 3,
    sampleRate: 16_000,
    peaks: [0, 0.3, 1],
    provenance: { ...provenance },
  };
}
function scenes(): SceneAnalysis {
  return {
    assetId: "source",
    provenance: { ...provenance },
    markers: [
      {
        id: "scene",
        assetId: "source",
        time: 2,
        type: "scene-cut",
        confidence: 0.8,
      },
    ],
  };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-intelligence-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let catalog = new ProjectCatalog(directory);
  cleanup.push(() => catalog.close());
  catalog.upsertAsset(asset());
  return {
    directory,
    get catalog() {
      return catalog;
    },
    reopen() {
      catalog.close();
      catalog = new ProjectCatalog(directory);
      return catalog;
    },
    database() {
      const database = new DatabaseSync(join(directory, "database.sqlite"));
      cleanup.push(() => database.close());
      return database;
    },
  };
}

it("persists detached transcript, waveform, scene and manual marker data separately from assets", async () => {
  const test = await fixture();
  const document = transcript();
  const amplitudes = waveform();
  const detection = scenes();
  const original = test.catalog.getAsset("source");
  test.catalog.intelligence.replaceTranscript(document);
  test.catalog.intelligence.saveWaveform(amplitudes);
  test.catalog.intelligence.saveScenes(detection);
  test.catalog.intelligence.saveManualMarker(
    {
      id: "manual",
      assetId: "source",
      time: 1,
      type: "manual",
      label: "保留",
      metadata: { user: true },
    },
    hash,
  );
  document.segments[0]!.text = "mutated";
  amplitudes.peaks[0] = 0.7;
  detection.markers[0]!.time = 99;
  const store = test.reopen().intelligence;
  expect(store.getFullTranscript("source", hash)).toEqual(transcript());
  expect(store.getWaveform("source", hash)).toEqual(waveform());
  expect(store.getScenes("source", hash)).toEqual(scenes());
  expect(store.listMarkers("source", hash).map((marker) => marker.id)).toEqual([
    "manual",
    "scene",
  ]);
  expect(test.catalog.getAsset("source")).toEqual(original);
  const read = store.getFullTranscript("source", hash)!;
  read.segments[0]!.words![0]!.text = "changed";
  expect(store.getFullTranscript("source", hash)).toEqual(transcript());
  store.removeMarker("source", "manual", hash);
  expect(store.listMarkers("source", hash).map((marker) => marker.id)).toEqual([
    "scene",
  ]);
});

it("retains the successful transcript and every prior revision on validation or SQL insertion failure", async () => {
  const test = await fixture();
  const store = test.catalog.intelligence;
  store.replaceTranscript(transcript());
  const invalid = transcript("invalid");
  invalid.segments[1]!.words![0]!.end = 9000;
  expect(() => store.replaceTranscript(invalid)).toThrow();
  const database = test.database();
  database.exec(`CREATE TRIGGER reject_test_segment BEFORE INSERT ON intelligence_segments
    WHEN NEW.text='reject-this-segment' BEGIN SELECT RAISE(ABORT,'injected disk write failure'); END`);
  const rejected = transcript("rejected");
  rejected.segments[1]!.text = "reject-this-segment";
  expect(() => store.replaceTranscript(rejected)).toThrow(
    "injected disk write failure",
  );
  expect(store.getFullTranscript("source", hash)).toEqual(transcript());
  expect(
    database
      .prepare("SELECT COUNT(*) AS total FROM intelligence_transcripts")
      .get()?.total,
  ).toBe(1);
  expect(
    database
      .prepare("SELECT COUNT(*) AS total FROM intelligence_segments")
      .get()?.total,
  ).toBe(2);
  database.exec("DROP TRIGGER reject_test_segment");
  store.replaceTranscript(transcript("second", 3));
  expect(
    database
      .prepare("SELECT COUNT(*) AS total FROM intelligence_transcripts")
      .get()?.total,
  ).toBe(2);
  expect(
    database
      .prepare("SELECT COUNT(*) AS total FROM intelligence_segments")
      .get()?.total,
  ).toBe(5);
  expect(test.reopen().intelligence.getFullTranscript("source", hash)).toEqual(
    transcript("second", 3),
  );
});

it("invalidates all analysis and manual markers by source hash without deleting old records", async () => {
  const test = await fixture();
  const store = test.catalog.intelligence;
  store.replaceTranscript(transcript());
  store.saveWaveform(waveform());
  store.saveScenes(scenes());
  const marker = {
    id: "manual",
    assetId: "source",
    time: 1,
    type: "manual" as const,
  };
  store.saveManualMarker(marker, hash);
  const changedHash = "b".repeat(64);
  test.catalog.upsertAsset({ ...asset(), contentHash: changedHash });
  for (const requested of [hash, changedHash]) {
    expect(store.getFullTranscript("source", requested)).toBeUndefined();
    expect(store.getTranscriptPage("source", requested)).toEqual({
      total: 0,
      offset: 0,
      limit: 200,
    });
    expect(store.getWaveform("source", requested)).toBeUndefined();
    expect(store.getScenes("source", requested)).toBeUndefined();
    expect(store.listMarkers("source", requested)).toEqual([]);
  }
  expect(() => store.replaceTranscript(transcript())).toThrow(
    "source is missing or has changed",
  );
  expect(() => store.saveWaveform(waveform())).toThrow();
  expect(() => store.saveScenes(scenes())).toThrow();
  expect(() => store.saveManualMarker(marker, hash)).toThrow();
  expect(() => store.removeMarker("source", marker.id, hash)).toThrow();
  test.catalog.upsertAsset(asset());
  expect(store.getFullTranscript("source", hash)).toEqual(transcript());
  expect(store.listMarkers("source", hash)).toHaveLength(2);
});

it("validates provider versions and selects the requested provider/model without reusing another analysis", async () => {
  const test = await fixture();
  const store = test.catalog.intelligence;
  store.replaceTranscript(transcript());
  store.replaceTranscript({
    ...transcript("future"),
    provenance: { ...provenance, version: "2" },
  });
  store.replaceTranscript({
    ...transcript("other-provider"),
    provenance: { ...provenance, providerId: "other", model: "large" },
  });
  expect(
    store.getFullTranscript("source", hash, {
      providerId: "local-test",
      model: "small",
    })?.id,
  ).toBe("first");
  expect(store.getFullTranscript("source", hash, { version: "2" })?.id).toBe(
    "future",
  );
  expect(
    store.getFullTranscript("source", hash, { model: "missing" }),
  ).toBeUndefined();
  store.saveWaveform(waveform());
  store.saveWaveform({
    ...waveform(),
    provenance: { ...provenance, version: "2" },
    peaks: [0.5],
  });
  expect(store.getWaveform("source", hash)?.peaks).toEqual([0, 0.3, 1]);
  expect(store.getWaveform("source", hash, { version: "2" })?.peaks).toEqual([
    0.5,
  ]);
  store.saveWaveform({ ...waveform(), peaks: [0.9] });
  expect(store.getWaveform("source", hash)?.peaks).toEqual([0.9]);
  expect(() =>
    store.saveScenes({
      ...scenes(),
      provenance: { ...provenance, version: "" },
    }),
  ).toThrow();
  expect(
    test
      .database()
      .prepare("SELECT COUNT(*) AS total FROM intelligence_cache")
      .get()?.total,
  ).toBe(2);
});

it("pages large transcripts in SQL with bounded segments and an accurate total", async () => {
  const test = await fixture();
  const store = test.catalog.intelligence;
  store.replaceTranscript(transcript("long", 5001));
  const result = store.getTranscriptPage("source", hash, {
    offset: 4800,
    limit: 200,
  });
  expect(result).toMatchObject({
    total: 5001,
    offset: 4800,
    limit: 200,
    document: { id: "long" },
  });
  expect(result.document?.segments).toHaveLength(200);
  expect(result.document?.segments[0]!.id).toBe("segment-4800");
  expect(store.getTranscript("source", hash)?.segments).toHaveLength(200);
  expect(store.getFullTranscript("source", hash)?.segments).toHaveLength(5001);
  expect(
    store.getTranscriptPage("source", hash, { offset: 5000 }).document
      ?.segments,
  ).toHaveLength(1);
  expect(
    store.getTranscriptPage("source", hash, { offset: 6000 }).document
      ?.segments,
  ).toEqual([]);
  for (const options of [
    { limit: 201 },
    { limit: 0 },
    { offset: -1 },
    { limit: 1.5 },
    { offset: Infinity },
  ])
    expect(() => store.getTranscriptPage("source", hash, options)).toThrow();
  // Corrupt an unrequested row to prove paging never materializes the full document.
  const database = test.database();
  database
    .prepare("UPDATE intelligence_segments SET data=? WHERE position=5000")
    .run("not JSON");
  expect(
    store.getTranscriptPage("source", hash).document?.segments,
  ).toHaveLength(200);
  expect(() =>
    store.getTranscriptPage("source", hash, { offset: 5000 }),
  ).toThrow();
  expect(
    database
      .prepare("SELECT length(header) AS size FROM intelligence_transcripts")
      .get()?.size,
  ).toBeLessThan(1000);
});

it("rejects out-of-source analysis and isolates manual marker edits between assets", async () => {
  const test = await fixture();
  test.catalog.upsertAsset({ ...asset(), duration: 1 });
  test.catalog.upsertAsset(asset("other"));
  const store = test.catalog.intelligence;
  expect(() => store.replaceTranscript(transcript())).toThrow();
  expect(() => store.saveScenes(scenes())).toThrow();
  expect(() =>
    store.saveManualMarker(
      { id: "marker", assetId: "source", time: 2, type: "manual" },
      hash,
    ),
  ).toThrow();
  store.saveManualMarker(
    { id: "marker", assetId: "source", time: 0.5, type: "manual" },
    hash,
  );
  expect(() =>
    store.saveManualMarker(
      { id: "marker", assetId: "other", time: 0, type: "manual" },
      hash,
    ),
  ).toThrow("another asset");
  store.removeMarker("other", "marker", hash);
  expect(store.listMarkers("source", hash)).toHaveLength(1);
  expect(() =>
    store.saveManualMarker(
      { id: "scene", assetId: "source", time: 0, type: "scene-cut" },
      hash,
    ),
  ).toThrow("Only manual");
  expect(() => store.saveWaveform({ ...waveform(), peaks: [NaN] })).toThrow();
  expect(CATALOG_SCHEMA_VERSION).toBe(4);
});
