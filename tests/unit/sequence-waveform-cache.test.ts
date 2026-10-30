// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { SourceWaveformEvidence } from "@openfilm/core";
import {
  SequenceWaveformCache,
  type WaveformReadResult,
} from "../../apps/desktop/src/sequenceWaveformCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const ids = Array.from({ length: 48 }, (_, index) => `source-${index}`);
function evidence(assetId: string): SourceWaveformEvidence {
  return {
    assetId,
    status: "ready",
    sourceHash: `hash-${assetId}`,
    waveform: {
      assetId,
      duration: 1,
      sampleRate: 4,
      peaks: [0, 0.75, 0, 0.25],
      provenance: {
        providerId: "local-ffmpeg",
        version: "1",
        sourceHash: `hash-${assetId}`,
        createdAt: "2026-10-30T00:00:00.000Z",
      },
    },
  };
}
function context(key = "film:cut:revision:source-version") {
  return {
    key,
    projectId: "film",
    sources: ids.map((id) => ({ id, contentHash: `hash-${id}` })),
  };
}
function harness() {
  const calls: Array<{
    projectId: string;
    ids: string[];
    signal: AbortSignal;
    result: ReturnType<typeof deferred<WaveformReadResult>>;
  }> = [];
  let publications = 0;
  const cache = new SequenceWaveformCache(
    (projectId, assetIds, signal) => {
      const result = deferred<WaveformReadResult>();
      calls.push({ projectId, ids: assetIds, signal, result });
      return result.promise;
    },
    () => publications++,
  );
  cache.setContext(context());
  function finish(index: number, entries?: SourceWaveformEvidence[]) {
    const call = calls[index]!;
    call.result.resolve({
      projectId: call.projectId,
      entries: entries ?? call.ids.map(evidence),
    });
  }
  return { cache, calls, finish, publications: () => publications };
}
const settle = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};

describe("bounded current-source waveform evidence", () => {
  it("batches eight unique IDs with at most two reads and shares repeated-source work", async () => {
    const { cache, calls, finish } = harness();
    const first = cache.load([...ids.slice(0, 24), ids[0]!]);
    const repeated = cache.load(ids.slice(0, 8));
    expect(calls.map((call) => call.ids.length)).toEqual([8, 8]);
    finish(1);
    await settle();
    expect(calls).toHaveLength(3);
    expect(calls[2]!.ids).toEqual(ids.slice(16, 24));
    finish(0);
    finish(2);
    await Promise.all([first, repeated]);
    expect(calls).toHaveLength(3);
    expect(cache.get(ids[0]!)?.status).toBe("ready");
    await cache.load([ids[0]!]);
    expect(calls).toHaveLength(3);
  });

  it("evicts deterministically after 32 entries and rereads an evicted source", async () => {
    const { cache, calls, finish } = harness();
    for (let page = 0; page < 5; page++) {
      const read = cache.load(ids.slice(page * 8, page * 8 + 8));
      finish(page);
      await read;
    }
    expect(cache.size).toBe(32);
    expect(cache.get(ids[0]!)).toBeUndefined();
    const reread = cache.load([ids[0]!]);
    expect(calls).toHaveLength(6);
    finish(5);
    await reread;
    expect(cache.size).toBe(32);
  });

  it.each([
    "project",
    "composition",
    "revision",
    "source-version",
    "source-uri",
  ])("fences an ignored-abort response after a %s change", async (change) => {
    const { cache, calls, finish, publications } = harness();
    const old = cache.load(ids.slice(0, 24));
    cache.setContext({
      ...context(`changed-${change}`),
      projectId: "new-film",
    });
    expect(calls.every((call) => call.signal.aborted)).toBe(true);
    const current = cache.load([ids[0]!]);
    // Aborted reads can ignore AbortSignal; the physical limit still applies.
    expect(calls).toHaveLength(2);
    finish(0);
    await settle();
    expect(calls).toHaveLength(3);
    expect(calls[2]!.projectId).toBe("new-film");
    finish(2, [
      { assetId: ids[0]!, status: "not-cached", sourceHash: `hash-${ids[0]}` },
    ]);
    await current;
    const beforeLate = publications();
    finish(1);
    await old;
    await settle();
    expect(cache.get(ids[0]!)?.status).toBe("not-cached");
    expect(publications()).toBe(beforeLate);
  });

  it("aborts on disposal and cannot publish into a reopened component cache", async () => {
    const old = harness();
    const read = old.cache.load([ids[0]!]);
    old.cache.dispose();
    const beforeLate = old.publications();
    expect(old.calls[0]!.signal.aborted).toBe(true);
    const reopened = harness();
    old.finish(0);
    await read;
    expect(old.publications()).toBe(beforeLate);
    expect(old.cache.size).toBe(0);
    expect(reopened.cache.get(ids[0]!)).toBeUndefined();
  });

  it.each([
    "project",
    "asset",
    "duplicate",
    "missing",
    "source-hash",
    "asset-hash",
    "large",
    "nonfinite",
  ])(
    "rejects mismatched or invalid %s response evidence without retaining peaks",
    async (fault) => {
      const { cache, calls } = harness();
      const read = cache.load([ids[0]!]);
      const entry = evidence(ids[0]!);
      if (entry.status !== "ready") throw new Error("fixture");
      const response: WaveformReadResult = {
        projectId: "film",
        entries: [entry],
      };
      if (fault === "project") response.projectId = "foreign-film";
      if (fault === "asset") entry.waveform.assetId = "foreign-source";
      if (fault === "duplicate") response.entries.push(entry);
      if (fault === "missing") response.entries = [];
      if (fault === "source-hash")
        entry.waveform.provenance.sourceHash = "stale";
      if (fault === "asset-hash") {
        entry.sourceHash = "stale";
        entry.waveform.provenance.sourceHash = "stale";
      }
      if (fault === "large") entry.waveform.peaks = Array(20_001).fill(1);
      if (fault === "nonfinite") entry.waveform.peaks[0] = Number.NaN;
      calls[0]!.result.resolve(response);
      await read;
      expect(cache.get(ids[0]!)).toMatchObject({ status: "failed" });
      expect(cache.get(ids[0]!)).not.toHaveProperty("waveform");
    },
  );

  it("retains explicit absence and source-change states, retrying only on request", async () => {
    const { cache, calls, finish } = harness();
    const read = cache.load(ids.slice(0, 3));
    finish(0, [
      { assetId: ids[0]!, status: "not-cached", sourceHash: `hash-${ids[0]}` },
      {
        assetId: ids[1]!,
        status: "source-changed",
        issue: { code: "source.changed" },
      },
      {
        assetId: ids[2]!,
        status: "unavailable",
        issue: { code: "media.missing" },
      },
    ]);
    await read;
    await cache.load(ids.slice(0, 3));
    expect(calls).toHaveLength(1);
    const retry = cache.load([ids[0]!], { refresh: true });
    expect(cache.get(ids[0]!)).toMatchObject({ status: "loading" });
    finish(1);
    await retry;
    expect(cache.get(ids[0]!)?.status).toBe("ready");
  });
});
