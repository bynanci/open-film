// SPDX-License-Identifier: Apache-2.0
import {
  validateWaveformData,
  type SourceWaveformEvidence,
} from "@openfilm/core";

export interface WaveformReadResult {
  projectId: string;
  entries: SourceWaveformEvidence[];
}
export interface WaveformContext {
  key: string;
  projectId: string;
  sources: readonly { id: string; contentHash?: string }[];
}
export type WaveformCacheEntry =
  | SourceWaveformEvidence
  | {
      assetId: string;
      status: "loading" | "failed";
    };
type ReadWaveforms = (
  projectId: string,
  assetIds: string[],
  signal: AbortSignal,
) => Promise<WaveformReadResult>;
interface ReadTask {
  ids: string[];
  generation: number;
  context: WaveformContext;
  controller: AbortController;
  promise: Promise<void>;
  finish: () => void;
}

/** Bounded source evidence only. Playback frame changes never enter this owner. */
export class SequenceWaveformCache {
  private context?: WaveformContext;
  private signature = "";
  private generation = 0;
  private disposed = false;
  private values = new Map<string, WaveformCacheEntry>();
  private visible = new Set<string>();
  private sources = new Map<string, { id: string; contentHash?: string }>();
  private pending = new Map<string, ReadTask>();
  private tasks = new Set<ReadTask>();
  private queue: ReadTask[] = [];
  private activeReads = 0;

  constructor(
    private read: ReadWaveforms,
    private changed: () => void,
  ) {}

  setContext(context: WaveformContext) {
    if (this.disposed) return;
    const signature = JSON.stringify([
      context.key,
      context.projectId,
      context.sources,
    ]);
    if (signature === this.signature) return;
    this.invalidate();
    this.context = context;
    this.signature = signature;
    this.sources = new Map(
      context.sources.map((source) => [source.id, source]),
    );
    this.changed();
  }

  get(assetId: string): WaveformCacheEntry | undefined {
    return (
      this.values.get(assetId) ??
      (this.pending.has(assetId) ? { assetId, status: "loading" } : undefined)
    );
  }
  get size() {
    return this.values.size;
  }

  load(
    assetIds: readonly string[],
    options: { refresh?: boolean; visible?: boolean } = {},
  ): Promise<void> {
    if (!this.context || this.disposed) return Promise.resolve();
    // Only explicit page navigation changes retention; preparation/refresh do not.
    if (options.visible)
      this.visible = new Set(
        [...new Set(assetIds)].filter((id) => this.sources.has(id)).slice(0, 8),
      );
    const waiting = new Set<Promise<void>>();
    const missing: string[] = [];
    for (const assetId of new Set(assetIds)) {
      if (!this.sources.has(assetId)) continue;
      const pending = this.pending.get(assetId);
      if (pending) waiting.add(pending.promise);
      else if (options.refresh || !this.values.has(assetId))
        missing.push(assetId);
    }
    for (let offset = 0; offset < missing.length; offset += 8) {
      const ids = missing.slice(offset, offset + 8);
      let finish!: () => void;
      const promise = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const task: ReadTask = {
        ids,
        promise,
        finish,
        context: this.context,
        generation: this.generation,
        controller: new AbortController(),
      };
      for (const assetId of ids) {
        this.pending.set(assetId, task);
        this.retain({ assetId, status: "loading" });
      }
      waiting.add(promise);
      this.tasks.add(task);
      this.queue.push(task);
    }
    if (missing.length) this.changed();
    this.pump();
    return Promise.all(waiting).then(() => undefined);
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
    this.context = undefined;
  }

  private invalidate() {
    this.generation++;
    for (const task of this.tasks) {
      task.controller.abort();
      task.finish();
    }
    this.tasks.clear();
    this.queue = [];
    this.pending.clear();
    this.values.clear();
    this.visible.clear();
  }

  private current(task: ReadTask) {
    return (
      !this.disposed &&
      task.generation === this.generation &&
      !task.controller.signal.aborted
    );
  }

  private retain(entry: WaveformCacheEntry) {
    // Preserve the current page; FIFO among other sources stays independent of
    // render/access frequency. At most eight visible IDs fit within the 32 limit.
    this.values.delete(entry.assetId);
    this.values.set(entry.assetId, entry);
    while (this.values.size > 32) {
      const oldest = [...this.values.keys()].find(
        (id) => !this.visible.has(id),
      )!;
      this.values.delete(oldest);
    }
  }

  private pump() {
    while (!this.disposed && this.activeReads < 2 && this.queue.length) {
      const task = this.queue.shift()!;
      if (!this.current(task)) continue;
      this.activeReads++;
      void this.execute(task);
    }
  }

  private async execute(task: ReadTask) {
    try {
      const response = await this.read(
        task.context.projectId,
        task.ids,
        task.controller.signal,
      );
      if (!this.current(task)) return;
      const entries = this.verify(response, task);
      for (const entry of entries) this.retain(entry);
      this.changed();
    } catch {
      if (this.current(task)) {
        for (const assetId of task.ids)
          this.retain({ assetId, status: "failed" });
        this.changed();
      }
    } finally {
      for (const assetId of task.ids)
        if (this.pending.get(assetId) === task) this.pending.delete(assetId);
      this.tasks.delete(task);
      this.activeReads--;
      task.finish();
      this.pump();
    }
  }

  private verify(
    response: WaveformReadResult,
    task: ReadTask,
  ): SourceWaveformEvidence[] {
    if (
      response.projectId !== task.context.projectId ||
      !Array.isArray(response.entries) ||
      response.entries.length !== task.ids.length
    )
      throw new Error(
        "Waveform response does not match the requested project and sources.",
      );
    const expected = new Set(task.ids);
    return response.entries.map((entry) => {
      if (!entry || !expected.delete(entry.assetId))
        throw new Error("Unexpected waveform source.");
      if (entry.status === "ready" || entry.status === "not-cached") {
        const importedHash = this.sources.get(entry.assetId)?.contentHash;
        if (
          typeof entry.sourceHash !== "string" ||
          !entry.sourceHash ||
          (importedHash && importedHash !== entry.sourceHash)
        )
          throw new Error("Waveform source identity changed.");
        if (entry.status === "not-cached")
          return {
            assetId: entry.assetId,
            status: entry.status,
            sourceHash: entry.sourceHash,
          };
        if (
          !Array.isArray(entry.waveform?.peaks) ||
          entry.waveform.peaks.length > 20_000
        )
          throw new Error("Waveform exceeds the bounded peak budget.");
        const waveform = validateWaveformData(entry.waveform);
        if (
          waveform.assetId !== entry.assetId ||
          waveform.provenance.sourceHash !== entry.sourceHash
        )
          throw new Error(
            "Waveform evidence is stale or belongs to another source.",
          );
        return {
          assetId: entry.assetId,
          status: entry.status,
          sourceHash: entry.sourceHash,
          waveform,
        };
      }
      if (
        (entry.status === "unavailable" &&
          ["media.notFound", "media.missing"].includes(entry.issue?.code)) ||
        (entry.status === "source-changed" &&
          entry.issue?.code === "source.changed")
      )
        return {
          assetId: entry.assetId,
          status: entry.status,
          issue: { code: entry.issue.code },
        };
      throw new Error("Invalid source waveform evidence.");
    });
  }
}
