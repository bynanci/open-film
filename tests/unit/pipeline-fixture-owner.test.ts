// Modified by OpenFilm contributors on 2026-11-12. See LICENSE and NOTICE.
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createPipelineFixtureOwner } from "../fixtures/pipeline-fixture-owner.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("pipeline fixture owner", () => {
  it("cancels, waits for action settlement, then closes and removes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pipeline-owner-"));
    const owner = createPipelineFixtureOwner();
    const action = deferred<string>();
    const cancelled = deferred<void>();
    const events: string[] = [];
    let cleanupSettled = false;
    const original = owner.ownAction("run-a", () => action.promise);
    void original.then(() => events.push("settled"));
    const cleanup = owner.cleanup(
      {
        pipeline: {
          async cancelRun(runId) {
            events.push(`cancel:${runId}`);
            cancelled.resolve();
          },
        },
        catalog: {
          async close() {
            expect(owner.pendingCount).toBe(0);
            await access(directory);
            events.push("close");
          },
        },
      },
      directory,
    );
    const observedCleanup = cleanup.then(
      () => {
        cleanupSettled = true;
      },
      () => {
        cleanupSettled = true;
      },
    );
    try {
      await setImmediate();
      expect(events[0]).toBe("cancel:run-a");
      await cancelled.promise;
      expect(cleanupSettled).toBe(false);
      expect(owner.pendingCount).toBe(1);
      await access(directory);
      action.resolve("completed");
      await expect(original).resolves.toBe("completed");
      await cleanup;
      expect(events.indexOf("settled")).toBeLessThan(events.indexOf("close"));
      expect(owner.pendingCount).toBe(0);
      await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      action.resolve("completed");
      await original;
      await observedCleanup;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("drains every owned run including work queued behind another action", async () => {
    const owner = createPipelineFixtureOwner();
    const first = deferred<void>();
    const cancelled = new Set<string>();
    const active = owner.ownAction("active", () => first.promise);
    const queued = owner.ownAction("queued", async () => {
      await first.promise;
      await setImmediate();
      expect(cancelled.has("queued")).toBe(true);
      return "cancelled";
    });
    expect(owner.pendingCount).toBe(2);
    try {
      await owner.cleanup({
        pipeline: {
          async cancelRun(id) {
            cancelled.add(id);
            if (id === "active") first.resolve();
          },
        },
        catalog: {
          close() {
            expect(owner.pendingCount).toBe(0);
          },
        },
      });
      expect([...cancelled].sort()).toEqual(["active", "queued"]);
      await expect(queued).resolves.toBe("cancelled");
    } finally {
      first.resolve();
      await Promise.allSettled([active, queued]);
    }
  });

  it.each(["review", "retry"])(
    "reobserves cancellation across a %s pre-controller persistence gap",
    async () => {
      const owner = createPipelineFixtureOwner();
      const persistence = deferred<void>();
      const result = deferred<string>();
      const events: string[] = [];
      let active = false;
      const action = owner.ownAction("resumed", async () => {
        await persistence.promise;
        await setImmediate();
        active = true;
        events.push("active");
        return result.promise;
      });
      try {
        await owner.cleanup({
          pipeline: {
            async cancelRun(id) {
              expect(id).toBe("resumed");
              events.push(active ? "cancel:active" : "cancel:idle");
              persistence.resolve();
              if (active) result.resolve("cancelled");
            },
          },
          catalog: {
            close() {
              expect(owner.pendingCount).toBe(0);
              events.push("close");
            },
          },
        });
        await expect(action).resolves.toBe("cancelled");
        expect(events[0]).toBe("cancel:idle");
        expect(events.indexOf("cancel:active")).toBeGreaterThan(
          events.indexOf("active"),
        );
        expect(events.at(-1)).toBe("close");
      } finally {
        persistence.resolve();
        result.resolve("cancelled");
        await action;
      }
    },
  );

  it("refuses late launch thunks once cleanup begins", async () => {
    const owner = createPipelineFixtureOwner();
    const closing = deferred<void>();
    let launched = false;
    const cleanup = owner.cleanup({
      pipeline: { async cancelRun() {} },
      catalog: { close: () => closing.promise },
    });
    try {
      await expect(
        owner.ownAction("too-late", async () => {
          launched = true;
        }),
      ).rejects.toThrow(/cleanup/i);
      expect(launched).toBe(false);
    } finally {
      closing.resolve();
      await cleanup;
    }
  });

  it("returns the original promise and preserves its identical rejection without an unhandled observer", async () => {
    const owner = createPipelineFixtureOwner();
    const action = deferred<void>();
    const originalError = new Error("original action failure");
    const returned = owner.ownAction("failed", () => action.promise);
    expect(returned).toBe(action.promise);
    action.reject(originalError);
    // Leave the caller's rejection handler until a later turn: the owner must
    // attach nonrejecting fulfillment/rejection observers immediately.
    await setImmediate();
    await expect(returned).rejects.toBe(originalError);
    await owner.cleanup();
    expect(owner.pendingCount).toBe(0);
  });

  it("retains the sentinel assertion error after successful cleanup", async () => {
    const owner = createPipelineFixtureOwner();
    const sentinel = new Error("original assertion");
    let captured: unknown;
    try {
      try {
        throw sentinel;
      } finally {
        await owner.cleanup();
      }
    } catch (error) {
      captured = error;
    }
    expect(captured).toBe(sentinel);
  });

  it("cleans partial setup with no application or directory", async () => {
    await createPipelineFixtureOwner().cleanup();
    const directory = await mkdtemp(join(tmpdir(), "pipeline-owner-partial-"));
    await createPipelineFixtureOwner().cleanup(undefined, directory);
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps unsettled resources when cancellation fails and exposes the identical error", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "pipeline-owner-cancel-failure-"),
    );
    const owner = createPipelineFixtureOwner();
    const action = deferred<void>();
    const original = owner.ownAction("pending", () => action.promise);
    const failure = new Error("cannot cancel");
    let closed = false;
    try {
      await expect(
        owner.cleanup(
          {
            pipeline: {
              async cancelRun() {
                throw failure;
              },
            },
            catalog: {
              close() {
                closed = true;
              },
            },
          },
          directory,
        ),
      ).rejects.toBe(failure);
      expect(closed).toBe(false);
      expect(owner.pendingCount).toBe(1);
      await access(directory);
    } finally {
      action.resolve();
      await original;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps a pending fixture when its application is unavailable", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "pipeline-owner-missing-app-"),
    );
    const owner = createPipelineFixtureOwner();
    const action = deferred<void>();
    const original = owner.ownAction("pending", () => action.promise);
    try {
      await expect(owner.cleanup(undefined, directory)).rejects.toThrow(
        /application/i,
      );
      await access(directory);
      expect(owner.pendingCount).toBe(1);
    } finally {
      action.resolve();
      await original;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the directory when catalog close fails", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "pipeline-owner-close-failure-"),
    );
    const failure = new Error("cannot close catalog");
    try {
      await expect(
        createPipelineFixtureOwner().cleanup(
          {
            pipeline: { async cancelRun() {} },
            catalog: {
              close() {
                throw failure;
              },
            },
          },
          directory,
        ),
      ).rejects.toBe(failure);
      await access(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exposes directory removal failures", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "pipeline-owner-remove-failure-"),
    );
    const file = join(directory, "regular-file");
    await writeFile(file, "fixture");
    try {
      await expect(
        createPipelineFixtureOwner().cleanup(undefined, join(file, "child")),
      ).rejects.toMatchObject({ code: "ENOTDIR" });
      await access(file);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
