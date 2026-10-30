// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Job } from "@openfilm/core";
import { SequenceWaveformPreparation } from "../../apps/desktop/src/sequenceWaveformPreparation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const settle = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
function job(assetId: string, status: Job["status"] = "running"): Job {
  return { id: `job-${assetId}`, assetId, status, type: "waveform" };
}
function harness() {
  const reads: Array<{
    signal: AbortSignal;
    result: ReturnType<typeof deferred<Job[]>>;
  }> = [];
  const starts: Array<{
    assetId: string;
    projectId: string;
    result: ReturnType<typeof deferred<Job>>;
  }> = [];
  const waits: Array<{
    signal: AbortSignal;
    result: ReturnType<typeof deferred<void>>;
  }> = [];
  const refreshed: string[] = [];
  let ready = true;
  const queue = new SequenceWaveformPreparation({
    jobs: (signal) => {
      const result = deferred<Job[]>();
      reads.push({ signal, result });
      return result.promise;
    },
    start: (assetId, projectId) => {
      const result = deferred<Job>();
      starts.push({ assetId, projectId, result });
      return result.promise;
    },
    wait: (signal) => {
      const result = deferred<void>();
      waits.push({ signal, result });
      return result.promise;
    },
    refresh: async (assetId) => {
      refreshed.push(assetId);
      return ready;
    },
    changed: () => {},
  });
  queue.setContext("film:cut:revision:source-version", "film");
  return {
    queue,
    reads,
    starts,
    waits,
    refreshed,
    unavailable: () => {
      ready = false;
    },
  };
}

describe("explicit sequential waveform preparation", () => {
  it("has no ambient jobs reads, runs one analysis, and refreshes evidence before the next source", async () => {
    const { queue, reads, starts, waits, refreshed } = harness();
    expect(reads).toHaveLength(0);
    const preparing = queue.prepare(["a", "a", "b"]);
    reads[0]!.result.resolve([]);
    await settle();
    expect(
      starts.map(({ assetId, projectId }) => [assetId, projectId]),
    ).toEqual([["a", "film"]]);
    starts[0]!.result.resolve(job("a"));
    await settle();
    expect(starts).toHaveLength(1);
    waits[0]!.result.resolve();
    await settle();
    reads[1]!.result.resolve([job("a", "completed")]);
    await settle();
    expect(refreshed).toEqual(["a"]);
    expect(starts).toHaveLength(1);
    reads[2]!.result.resolve([]);
    await settle();
    expect(starts[1]).toMatchObject({ assetId: "b", projectId: "film" });
    starts[1]!.result.resolve(job("b", "completed"));
    await preparing;
    expect(refreshed).toEqual(["a", "b"]);
    expect(queue.state.status).toBe("completed");
  });

  it("stopping a queue aborts polling and prevents a delayed analysis POST from starting the next item", async () => {
    const { queue, reads, starts, waits, refreshed } = harness();
    const preparing = queue.prepare(["a", "b"]);
    reads[0]!.result.resolve([]);
    await settle();
    queue.stop();
    starts[0]!.result.resolve(job("a"));
    await preparing;
    expect(starts).toHaveLength(1);
    expect(waits).toHaveLength(0);
    expect(refreshed).toEqual([]);
    expect(queue.state.status).toBe("stopped");
  });

  it("cannot overlap an unsettled analysis POST when a stopped queue is immediately retried", async () => {
    const { queue, reads, starts } = harness();
    const preparing = queue.prepare(["a"]);
    reads[0]!.result.resolve([]);
    await settle();
    queue.stop();
    const retry = queue.prepare(["b"]);
    await settle();
    expect(reads).toHaveLength(1);
    expect(queue.state).toMatchObject({
      status: "failed",
      code: "analysis-busy",
    });
    starts[0]!.result.resolve(job("a"));
    await Promise.all([preparing, retry]);
    expect(starts).toHaveLength(1);
  });

  it("does not start or cancel foreign analysis and only reports that it is busy", async () => {
    const { queue, reads, starts } = harness();
    const preparing = queue.prepare(["a", "b"]);
    reads[0]!.result.resolve([{ ...job("foreign"), type: "transcribe" }]);
    await preparing;
    expect(starts).toHaveLength(0);
    expect(queue.state).toMatchObject({
      status: "failed",
      code: "analysis-busy",
    });
  });

  it("can observe a shared waveform job; stop aborts its poll without a cancel request", async () => {
    const { queue, reads, starts, waits, refreshed } = harness();
    const preparing = queue.prepare(["a", "b"]);
    reads[0]!.result.resolve([job("a")]);
    await settle();
    expect(starts).toHaveLength(0);
    waits[0]!.result.resolve();
    await settle();
    expect(reads).toHaveLength(2);
    queue.stop();
    expect(reads[1]!.signal.aborted).toBe(true);
    reads[1]!.result.resolve([job("a", "completed")]);
    await preparing;
    expect(starts).toHaveLength(0);
    expect(refreshed).toEqual([]);
  });

  it.each(["owner-change", "unmount"])(
    "fences every continuation after %s",
    async (cause) => {
      const { queue, reads, starts } = harness();
      const preparing = queue.prepare(["a", "b"]);
      if (cause === "unmount") queue.dispose();
      else queue.setContext("new-film:cut:revision:source-version", "new-film");
      expect(reads[0]!.signal.aborted).toBe(true);
      reads[0]!.result.resolve([]);
      await preparing;
      expect(starts).toHaveLength(0);
    },
  );

  it.each(["failed", "cancelled", "missing", "no-evidence"])(
    "reports %s and requires explicit retry",
    async (failure) => {
      const { queue, reads, starts, waits, unavailable } = harness();
      const preparing = queue.prepare(["a", "b"]);
      reads[0]!.result.resolve([]);
      await settle();
      if (failure === "no-evidence") unavailable();
      starts[0]!.result.resolve(
        job("a", failure === "no-evidence" ? "completed" : "running"),
      );
      await settle();
      if (failure !== "no-evidence") {
        waits[0]!.result.resolve();
        await settle();
        reads[1]!.result.resolve(
          failure === "missing"
            ? []
            : [job("a", failure as "failed" | "cancelled")],
        );
      }
      await preparing;
      expect(queue.state.status).toBe("failed");
      expect(starts).toHaveLength(1);
      const retry = queue.prepare(["a"]);
      expect(reads.length).toBeGreaterThan(1);
      queue.stop();
      reads.at(-1)!.result.resolve([]);
      await retry;
    },
  );
});
