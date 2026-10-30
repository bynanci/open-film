// SPDX-License-Identifier: Apache-2.0
import type { Job } from "@openfilm/core";

export interface WaveformPreparationState {
  status: "idle" | "running" | "stopped" | "completed" | "failed";
  remaining: number;
  assetId?: string;
  code?:
    | "analysis-busy"
    | "job-missing"
    | "job-failed"
    | "request-failed"
    | "no-evidence";
}
interface PreparationIO {
  jobs: (signal: AbortSignal) => Promise<Job[]>;
  start: (assetId: string, projectId: string) => Promise<Job>;
  refresh: (assetId: string) => Promise<boolean>;
  wait: (signal: AbortSignal) => Promise<void>;
  changed: () => void;
}

export class SequenceWaveformPreparation {
  state: WaveformPreparationState = { status: "idle", remaining: 0 };
  private key = "";
  private projectId = "";
  private generation = 0;
  private controller?: AbortController;
  private disposed = false;
  private starting = false;
  constructor(private io: PreparationIO) {}

  setContext(key: string, projectId: string) {
    if (this.key === key && this.projectId === projectId) return;
    this.halt();
    this.key = key;
    this.projectId = projectId;
    this.publish({ status: "idle", remaining: 0 });
  }

  async prepare(assetIds: readonly string[]) {
    if (this.disposed || !this.projectId || this.state.status === "running")
      return;
    if (this.starting) {
      this.fail("analysis-busy");
      return;
    }
    const ids = [...new Set(assetIds)].slice(0, 8);
    if (!ids.length) return;
    const generation = ++this.generation;
    const projectId = this.projectId;
    const controller = new AbortController();
    this.controller = controller;
    const current = () =>
      !this.disposed &&
      this.generation === generation &&
      !controller.signal.aborted;
    this.publish({ status: "running", remaining: ids.length, assetId: ids[0] });
    try {
      for (const [index, assetId] of ids.entries()) {
        this.publish({
          status: "running",
          remaining: ids.length - index,
          assetId,
        });
        const jobs = await this.io.jobs(controller.signal);
        if (!current()) return;
        const active = jobs.filter(
          (job) =>
            ["transcribe", "waveform", "scenes"].includes(job.type) &&
            ["queued", "running"].includes(job.status),
        );
        let job: Job;
        if (active.length) {
          // An existing waveform may be shared. No cancellation capability is
          // acquired by observing it, regardless of its server execution owner.
          if (
            active.length !== 1 ||
            active[0]!.type !== "waveform" ||
            active[0]!.assetId !== assetId
          ) {
            this.fail("analysis-busy", assetId);
            return;
          }
          job = active[0]!;
        } else {
          this.starting = true;
          try {
            job = await this.io.start(assetId, projectId);
          } finally {
            this.starting = false;
          }
          if (!current()) return;
        }
        if (job.type !== "waveform" || job.assetId !== assetId) {
          this.fail("job-missing", assetId);
          return;
        }
        while (job.status === "queued" || job.status === "running") {
          await this.io.wait(controller.signal);
          if (!current()) return;
          const latest = await this.io.jobs(controller.signal);
          if (!current()) return;
          const found = latest.find(
            (entry) =>
              entry.id === job.id &&
              entry.type === "waveform" &&
              entry.assetId === assetId,
          );
          if (!found) {
            this.fail("job-missing", assetId);
            return;
          }
          job = found;
        }
        if (job.status !== "completed") {
          this.fail("job-failed", assetId);
          return;
        }
        const ready = await this.io.refresh(assetId);
        if (!current()) return;
        if (!ready) {
          this.fail("no-evidence", assetId);
          return;
        }
      }
      if (current()) this.publish({ status: "completed", remaining: 0 });
    } catch {
      if (current()) this.fail("request-failed", this.state.assetId);
    }
  }

  stop() {
    this.halt();
    if (!this.disposed) this.publish({ status: "stopped", remaining: 0 });
  }

  dispose() {
    this.disposed = true;
    this.halt();
  }

  private halt() {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
  }

  private publish(state: WaveformPreparationState) {
    this.state = state;
    this.io.changed();
  }

  private fail(code: WaveformPreparationState["code"], assetId?: string) {
    this.publish({ status: "failed", remaining: 0, code, assetId });
  }
}

/** Only preparation owns this timer. Stopping aborts the wait, never the job. */
export function waitForWaveformJob(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 1000);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
