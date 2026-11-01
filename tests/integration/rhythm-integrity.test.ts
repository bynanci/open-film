// Modified by OpenFilm contributors on 2026-11-01. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import type { MediaAsset } from "@openfilm/core";
import { hashFile, runProcess } from "@openfilm/media";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

/** Short pulse at the end of every `period` seconds: a steady beat grid. */
async function generateBeats(
  targetPath: string,
  period: number,
  durationSec = 6,
): Promise<void> {
  await runProcess("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=exprs=sin(2*PI*440*t)*gt(mod(t\\,${period})\\,${period - 0.05}):s=8000:d=${durationSec}`,
    "-c:a",
    "pcm_s16le",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-threads",
    "1",
    "-y",
    targetPath,
  ]);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-rhythm-integrity-"));
  cleanup.push(() =>
    rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  );
  const audioPath = join(root, "beats.wav");
  const alternatePath = join(root, "alternate.wav");
  await generateBeats(audioPath, 0.5);
  await generateBeats(alternatePath, 1);
  const hashA = await hashFile(audioPath);
  const hashB = await hashFile(alternatePath);
  expect(hashA).not.toBe(hashB);
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Rhythm integrity");
  cleanup.push(async () => {
    try {
      app.close();
    } catch {
      // already closed
    }
  });
  const asset: MediaAsset = {
    id: "rhythm-asset",
    name: "beats.wav",
    uri: pathToFileURL(audioPath).href,
    mediaType: "audio",
    duration: 6,
    contentHash: hashA,
    tags: [],
    state: {},
    metadata: {},
  };
  app.catalog.upsertAsset(asset);
  await app.save();
  return { app, asset, audioPath, alternatePath, directory, hashA, hashB };
}

describe("rhythm analysis source and persistence integrity", () => {
  it("analyzes the verified snapshot when the original is replaced after hash verification", async () => {
    const { app, asset, audioPath, alternatePath, hashA } = await fixture();
    const baseline = await app.rhythm.analyzeAsset(asset.id, { force: true });
    expect(baseline.sourceHash).toBe(hashA);

    let swapped = false;
    const evidence = await app.rhythm.analyzeAsset(asset.id, {
      force: true,
      // Runs after hash verification and snapshotting, before decoding.
      onProgress: () => {
        if (swapped) return;
        swapped = true;
        copyFileSync(alternatePath, audioPath);
      },
    });
    expect(swapped).toBe(true);
    // The result describes the bytes that were hashed (A), not the replacement.
    expect(evidence.sourceHash).toBe(hashA);
    expect(evidence.tempoBpm).toBe(baseline.tempoBpm);
    expect(evidence.landmarks).toEqual(baseline.landmarks);
    const saved = JSON.parse(
      await readFile(
        join(app.directory, "analysis", "rhythm-evidence.json"),
        "utf8",
      ),
    ) as Array<{ sourceHash: string; tempoBpm: number }>;
    expect(saved).toHaveLength(1);
    expect(saved[0]!.sourceHash).toBe(hashA);
    expect(saved[0]!.tempoBpm).toBe(baseline.tempoBpm);

    // The replaced file is detected by the next analysis.
    await expect(
      app.rhythm.analyzeAsset(asset.id, { force: true }),
    ).rejects.toMatchObject({ code: "source.changed", status: 409 });
  });

  it("recovers the save queue and flushes pending evidence after a failed write", async () => {
    const { app, asset, directory, hashA } = await fixture();
    const evidencePath = join(directory, "analysis", "rhythm-evidence.json");
    const writer = vi
      .spyOn(
        app.rhythm as unknown as { writeEvidenceFile: () => Promise<void> },
        "writeEvidenceFile",
      )
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(app.rhythm.analyzeAsset(asset.id)).rejects.toThrow(
      "disk full",
    );
    expect(existsSync(evidencePath)).toBe(false);

    // Plain retry hits the in-memory result, but must not claim success until
    // it is durably saved.
    const retried = await app.rhythm.analyzeAsset(asset.id);
    expect(retried.sourceHash).toBe(hashA);
    expect(existsSync(evidencePath)).toBe(true);

    // A failure followed by a forced retry also recovers.
    await rm(evidencePath, { force: true });
    writer.mockRejectedValueOnce(new Error("disk full again"));
    await expect(
      app.rhythm.analyzeAsset(asset.id, { force: true }),
    ).rejects.toThrow("disk full again");
    const forced = await app.rhythm.analyzeAsset(asset.id, { force: true });
    expect(forced.sourceHash).toBe(hashA);
    expect(existsSync(evidencePath)).toBe(true);

    app.close();
    const reopened = await OpenFilmApplication.open(directory);
    cleanup.push(async () => reopened.close());
    expect(reopened.rhythm.getEvidence(asset.id, hashA)?.sourceHash).toBe(
      hashA,
    );
  });
});
