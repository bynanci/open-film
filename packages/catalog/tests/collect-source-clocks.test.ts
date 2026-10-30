import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import {
  inspectCollectSourceClockAssets,
  ProjectCatalog,
} from "../src/index.js";
const stops: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});
const hash = "a".repeat(64);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-collect-clocks-"));
  stops.push(() => rm(root, { recursive: true, force: true }));
  const catalog = new ProjectCatalog(root);
  stops.push(() => catalog.close());
  for (const id of ["one", "two"])
    catalog.upsertAsset({
      id,
      uri: `file:///synthetic/${id}.mp4`,
      name: id,
      mediaType: "video",
      duration: 5,
      contentHash: hash,
      tags: [],
      state: {},
      metadata: {},
    });
  return {
    catalog,
    image: () =>
      catalog.withConsistentSnapshot((image, version) => ({ image, version })),
  };
}
it("classifies immutable transcript clocks only in the selected source scope without rewriting the snapshot", async () => {
  const f = await fixture();
  f.catalog.intelligence.replaceTranscript({
    id: "transcript",
    assetId: "one",
    language: "zh-TW",
    provenance: {
      providerId: "synthetic",
      version: "1",
      sourceHash: hash,
      createdAt: "2026-10-30T00:00:00.000Z",
    },
    segments: [{ id: "line", start: 1, end: 2, text: "合成旁白" }],
  });
  const { image, version } = f.image();
  const before = createHash("sha256").update(image).digest("hex");
  const revision = f.catalog.logicalRevision();
  expect(
    inspectCollectSourceClockAssets(image, version, ["two", "one"]),
  ).toEqual(["one"]);
  expect(inspectCollectSourceClockAssets(image, version, ["two"])).toEqual([]);
  expect(createHash("sha256").update(image).digest("hex")).toBe(before);
  expect(f.catalog.logicalRevision()).toBe(revision);
});
it("excludes operational jobs and disposable waveform caches from immutable portable clocks", async () => {
  const f = await fixture();
  f.catalog.saveJob({
    id: "job",
    type: "waveform",
    assetId: "one",
    status: "completed",
  });
  f.catalog.intelligence.saveWaveform({
    assetId: "one",
    duration: 5,
    sampleRate: 48000,
    peaks: [0.1, 0.2, 0.3, 0.2, 0.1],
    provenance: {
      providerId: "local-ffmpeg",
      version: "1",
      sourceHash: hash,
      createdAt: "2026-10-30T00:00:00.000Z",
    },
  });
  const { image, version } = f.image();
  expect(
    inspectCollectSourceClockAssets(image, version, ["one", "two"]),
  ).toEqual([]);
});
it.each([{ ids: ["missing"] }, { ids: ["one", "one"] }, { ids: [""] }])(
  "rejects an invalid selected clock scope %j",
  async ({ ids }) => {
    const f = await fixture();
    const { image, version } = f.image();
    expect(() => inspectCollectSourceClockAssets(image, version, ids)).toThrow(
      expect.objectContaining({ code: "request.invalid" }),
    );
  },
);
it("reads the authentic v5 snapshot without migration or byte changes", async () => {
  const image = gunzipSync(
    Buffer.from(
      (
        await readFile(
          new URL(
            "./fixtures/catalog-v5-61a4659.sqlite.gz.b64",
            import.meta.url,
          ),
          "utf8",
        )
      ).trim(),
      "base64",
    ),
  );
  const before = createHash("sha256").update(image).digest("hex");
  expect(inspectCollectSourceClockAssets(image, 5, ["legacy-asset"])).toEqual(
    [],
  );
  expect(createHash("sha256").update(image).digest("hex")).toBe(before);
});
