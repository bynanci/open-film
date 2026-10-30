// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import type { MediaAsset, WaveformData } from "@openfilm/core";
import { hashFile, WAVEFORM_CACHE_IDENTITY } from "@openfilm/media";
import * as media from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(saveCurrent = true) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-wave-read-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "synthetic.wav");
  await writeFile(
    source,
    "Synthetic waveform cache identity; no decoder is invoked.",
  );
  const sourceHash = await hashFile(source);
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Waveform read",
  );
  cleanup.push(() => app.close());
  const asset: MediaAsset = {
    id: "source",
    name: "Synthetic",
    uri: pathToFileURL(source).href,
    mediaType: "audio",
    duration: 2,
    contentHash: sourceHash,
    tags: [],
    state: { locked: true },
    metadata: {},
  };
  app.catalog.upsertAsset(asset);
  const waveform: WaveformData = {
    assetId: asset.id,
    sampleRate: 2,
    duration: 2,
    peaks: [0, 1, 0.5, 0],
    provenance: {
      ...WAVEFORM_CACHE_IDENTITY,
      sourceHash,
      createdAt: "2026-10-30T00:00:00Z",
    },
  };
  if (saveCurrent) app.catalog.intelligence.saveWaveform(waveform);
  await app.save();
  return { root, source, sourceHash, asset, waveform, app };
}
it("reads only current cached peaks without transcript hydration or saved edits", async () => {
  const { root, source, sourceHash, waveform, app } = await fixture();
  const before = await readFile(join(root, "film.openfilm/project.json"));
  vi.spyOn(app.catalog.intelligence, "getTranscriptPage").mockImplementation(
    () => {
      throw new Error("Transcript storage unavailable");
    },
  );
  vi.spyOn(app.catalog.intelligence, "getScenes").mockImplementation(() => {
    throw new Error("Scene storage unavailable");
  });
  expect(await app.intelligence.readWaveforms(["source"])).toEqual([
    { assetId: "source", status: "ready", sourceHash, waveform },
  ]);
  expect(await readFile(join(root, "film.openfilm/project.json"))).toEqual(
    before,
  );
  expect(await hashFile(source)).toBe(sourceHash);
});
it("returns typed unavailable and source-changed evidence without stale peaks", async () => {
  const { source, app } = await fixture();
  expect(await app.intelligence.readWaveforms(["foreign"])).toEqual([
    {
      assetId: "foreign",
      status: "unavailable",
      issue: { code: "media.notFound" },
    },
  ]);
  await writeFile(source, "Changed synthetic bytes");
  expect(await app.intelligence.readWaveforms(["source"])).toEqual([
    {
      assetId: "source",
      status: "source-changed",
      issue: { code: "source.changed" },
    },
  ]);
  await rm(source);
  expect(await app.intelligence.readWaveforms(["source"])).toEqual([
    {
      assetId: "source",
      status: "unavailable",
      issue: { code: "media.missing" },
    },
  ]);
});
it("returns missing cache explicitly without interpreting an incompatible model", async () => {
  const { sourceHash, waveform, app } = await fixture(false);
  app.catalog.intelligence.saveWaveform({
    ...waveform,
    provenance: { ...waveform.provenance, model: "obsolete" },
  });
  expect(await app.intelligence.readWaveforms(["source"])).toEqual([
    { assetId: "source", status: "not-cached", sourceHash },
  ]);
});
it.each(
  [
    [],
    Array.from({ length: 9 }, (_, i) => `source-${i}`),
    ["source", "source"],
    [""],
    ["x".repeat(1025)],
    [3] as unknown as string[],
  ].map((ids) => ({ ids })),
)("rejects invalid or unbounded read batches %#", async ({ ids }) => {
  const { app } = await fixture();
  await expect(app.intelligence.readWaveforms(ids)).rejects.toMatchObject({
    code: "request.invalid",
  });
});

it("bounds simultaneous source hashing and releases admission after completion", async () => {
  const { app } = await fixture();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let hashing = 0;
  const original = media.hashFile;
  vi.spyOn(media, "hashFile").mockImplementation(async (...args) => {
    hashing++;
    if (hashing === 2) entered();
    if (hashing > 2) throw new Error("A third waveform read started hashing.");
    await held;
    return original(...args);
  });
  const first = app.intelligence.readWaveforms(["source"]);
  const second = app.intelligence.readWaveforms(["source"]);
  try {
    await started;
    await expect(
      app.intelligence.readWaveforms(["source"]),
    ).rejects.toMatchObject({ code: "jobs.busy", status: 429 });
  } finally {
    release();
    await Promise.allSettled([first, second]);
  }
  expect((await first)[0]?.status).toBe("ready");
  expect((await second)[0]?.status).toBe("ready");
  expect((await app.intelligence.readWaveforms(["source"]))[0]?.status).toBe(
    "ready",
  );
});

it("propagates storage errors and restores both read slots", async () => {
  const { app } = await fixture();
  const read = vi
    .spyOn(app.catalog.intelligence, "getWaveform")
    .mockImplementationOnce(() => {
      throw new Error("Controlled storage failure");
    });
  await expect(app.intelligence.readWaveforms(["source"])).rejects.toThrow(
    "Controlled storage failure",
  );
  read.mockRestore();
  const results = await Promise.all([
    app.intelligence.readWaveforms(["source"]),
    app.intelligence.readWaveforms(["source"]),
  ]);
  expect(results.map((result) => result[0]?.status)).toEqual([
    "ready",
    "ready",
  ]);
});
