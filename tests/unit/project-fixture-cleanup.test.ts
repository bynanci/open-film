// SPDX-License-Identifier: Apache-2.0
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  cleanupProjectFixture,
  runFixtureCleanup,
} from "../e2e/project-fixture-cleanup.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(statuses: number[], activeProject = false) {
  const outer = await mkdtemp(join(tmpdir(), "openfilm-cleanup-contract-"));
  roots.push(outer);
  const root = join(outer, "fixture"),
    artifact = join(outer, "interaction-performance.json");
  await mkdir(root);
  await writeFile(join(root, "database.sqlite"), "Synthetic handle fixture");
  await writeFile(artifact, '{"measurements":"preserved"}');
  const events: string[] = [];
  let attempts = 0;
  const page = {
    isClosed: () => false,
    goto: async (url: string) => {
      events.push(url);
    },
  };
  const request = {
    post: async () => {
      events.push("close");
      expect((await lstat(root)).isDirectory()).toBe(true);
      const status = statuses[Math.min(attempts++, statuses.length - 1)]!;
      return { status: () => status, text: async () => "fixture-close-status" };
    },
    get: async () => {
      events.push("closed-state");
      return {
        ok: () => true,
        json: async () => ({
          project: activeProject ? { id: "still-open" } : null,
        }),
      };
    },
  };
  return {
    root,
    artifact,
    events,
    page,
    request,
    get attempts() {
      return attempts;
    },
  };
}
it("quiesces page activity and waits for acknowledged closure before removing a fixture while preserving its benchmark artifact", async () => {
  const f = await fixture([409, 409, 200]);
  await cleanupProjectFixture({ ...f, api: "http://127.0.0.1:4310/api" });
  expect(f.events).toEqual([
    "about:blank",
    "close",
    "close",
    "close",
    "closed-state",
  ]);
  await expect(lstat(f.root)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(f.artifact, "utf8")).toBe(
    '{"measurements":"preserved"}',
  );
});
it("keeps the fixture when closure remains busy instead of deleting an open SQLite project", async () => {
  const f = await fixture([409]);
  await expect(
    cleanupProjectFixture({
      ...f,
      api: "http://127.0.0.1:4310/api",
      timeoutMs: 0,
    }),
  ).rejects.toThrow(/close|busy/i);
  expect((await lstat(f.root)).isDirectory()).toBe(true);
  expect(f.attempts).toBe(1);
});
it("fails immediately on a non-transient close response", async () => {
  const f = await fixture([500]);
  await expect(
    cleanupProjectFixture({ ...f, api: "http://127.0.0.1:4310/api" }),
  ).rejects.toThrow(/500/u);
  expect((await lstat(f.root)).isDirectory()).toBe(true);
  expect(f.attempts).toBe(1);
});
it("requires the closed project state even after HTTP200", async () => {
  const f = await fixture([200], true);
  await expect(
    cleanupProjectFixture({ ...f, api: "http://127.0.0.1:4310/api" }),
  ).rejects.toThrow(/project/i);
  expect((await lstat(f.root)).isDirectory()).toBe(true);
});

it("preserves the original seeding failure when teardown also fails", async () => {
  const primary = new Error("synthetic seed failed");
  const removal = new Error("synthetic fixture still locked");
  let caught: unknown;
  try {
    await runFixtureCleanup(
      async () => {
        throw removal;
      },
      { error: primary },
    );
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AggregateError);
  expect((caught as AggregateError).errors).toEqual([primary, removal]);
  expect((caught as Error).cause).toBe(removal);
  expect((caught as Error).message).toContain(primary.message);
});

it("propagates standalone cleanup failures unchanged", async () => {
  const failure = new Error("fixture close failed");
  await expect(
    runFixtureCleanup(async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});

it("keeps a failed benchmark failed after successful cleanup", async () => {
  const primary = new Error("real assertion failed");
  let cleaned = false;
  const benchmark = async () => {
    try {
      throw primary;
    } finally {
      await runFixtureCleanup(
        async () => {
          cleaned = true;
        },
        { error: primary },
      );
    }
  };
  await expect(benchmark()).rejects.toBe(primary);
  expect(cleaned).toBe(true);
});
