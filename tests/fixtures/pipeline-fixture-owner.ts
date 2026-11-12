// Modified by OpenFilm contributors on 2026-11-12. See LICENSE and NOTICE.
import { rm } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";

interface FixtureApplication {
  pipeline: { cancelRun(runId: string): Promise<unknown> };
  catalog: { close(): void | Promise<void> };
}

export function createPipelineFixtureOwner() {
  const runIds = new Set<string>();
  const pending = new Set<Promise<void>>();
  let closing = false;
  let cleanup: Promise<void> | undefined;

  async function drainAndClose(app?: FixtureApplication, directory?: string) {
    if (pending.size && !app) {
      throw new Error(
        "Cannot drain pending pipeline actions without their application.",
      );
    }
    if (app) {
      do {
        for (const runId of runIds) await app.pipeline.cancelRun(runId);
        // Review/retry persist idle before creating their internal controller.
        // Yield and reobserve cancellation until every owning action settles.
        if (pending.size) await setImmediate();
      } while (pending.size);
      await app.catalog.close();
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  return {
    ownAction<T>(runId: string, launch: () => Promise<T>): Promise<T> {
      if (closing)
        return Promise.reject(new Error("Pipeline fixture cleanup has begun."));
      runIds.add(runId);
      const action = launch();
      // Both handlers fulfill the observer, preserving the caller's original
      // promise/error without leaving a rejecting finally() promise behind.
      const settled = action.then(
        () => {
          pending.delete(settled);
        },
        () => {
          pending.delete(settled);
        },
      );
      pending.add(settled);
      return action;
    },
    get pendingCount() {
      return pending.size;
    },
    cleanup(app?: FixtureApplication, directory?: string): Promise<void> {
      closing = true;
      cleanup ??= drainAndClose(app, directory);
      return cleanup;
    },
  };
}
