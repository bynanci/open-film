import { describe, expect, it, vi } from "vitest";
import {
  BrowserSourceAccessRegistry,
  type BrowserHandleBackend,
  type BrowserHandleLike,
  type StoredBrowserHandle,
} from "../../apps/desktop/src/browserSourceAccess.js";

class MemoryBackend implements BrowserHandleBackend {
  records: StoredBrowserHandle[] = [];
  listCalls = 0;
  putBatches = 0;
  removeBatches = 0;

  async list(projectId: string) {
    this.listCalls++;
    return this.records.filter((record) => record.projectId === projectId);
  }

  async putMany(records: readonly StoredBrowserHandle[]) {
    this.putBatches++;
    for (const record of records)
      this.records = [
        ...this.records.filter((value) => value.key !== record.key),
        record,
      ];
  }

  async removeMany(keys: readonly string[]) {
    this.removeBatches++;
    const removed = new Set(keys);
    this.records = this.records.filter((record) => !removed.has(record.key));
  }
}

const handle = (
  identity: string,
  name = identity,
): BrowserHandleLike & { identity: string } => ({
  kind: "directory",
  name,
  isSameEntry: vi.fn(async (other: BrowserHandleLike) =>
    Boolean((other as { identity?: string }).identity === identity),
  ),
  identity,
});

describe("browser source access registry", () => {
  it("persists handles through the backend and reuses the same entry", async () => {
    const backend = new MemoryBackend();
    let sequence = 0;
    const registry = new BrowserSourceAccessRegistry(
      backend,
      () => `id-${++sequence}`,
    );
    const first = await registry.rememberHandle(
      "project-a",
      handle("kyoto", "京都"),
    );
    const repeated = await registry.rememberHandle(
      "project-a",
      handle("kyoto", "京都"),
    );
    const foreign = await registry.rememberHandle(
      "project-b",
      handle("kyoto", "京都"),
    );
    expect(first).toBe("browser-handle:id-1");
    expect(repeated).toBe(first);
    expect(foreign).toBe("browser-handle:id-2");
    expect(backend.records).toHaveLength(2);
    expect(backend.records[0]).toMatchObject({
      key: first,
      projectId: "project-a",
      kind: "directory",
      name: "京都",
    });
  });

  it("validates and persists a handle batch with one project lookup and one write transaction", async () => {
    const backend = new MemoryBackend();
    const registry = new BrowserSourceAccessRegistry(
      backend,
      (() => {
        let sequence = 0;
        return () => `batch-${++sequence}`;
      })(),
    );

    await expect(
      registry.rememberHandles("project-a", [
        handle("one", "一"),
        handle("two", "二"),
        handle("three", "三"),
      ]),
    ).resolves.toEqual([
      "browser-handle:batch-1",
      "browser-handle:batch-2",
      "browser-handle:batch-3",
    ]);
    expect(backend.listCalls).toBe(1);
    expect(backend.putBatches).toBe(1);
    expect(backend.records).toHaveLength(3);

    const listCalls = backend.listCalls;
    await registry.removeHandles("project-a", [
      "browser-handle:batch-1",
      "browser-handle:batch-2",
      "browser-handle:not-owned",
    ]);
    expect(backend.listCalls).toBe(listCalls + 1);
    expect(backend.removeBatches).toBe(1);
    expect(backend.records.map((record) => record.key)).toEqual([
      "browser-handle:batch-3",
    ]);
  });

  it("keeps ordinary File objects session-only and clears only their owning project", () => {
    const registry = new BrowserSourceAccessRegistry(
      new MemoryBackend(),
      (() => {
        let sequence = 0;
        return () => `file-${++sequence}`;
      })(),
    );
    const a = { name: "a.mp4" } as File;
    const b = { name: "b.mp4" } as File;
    const other = { name: "other.mp4" } as File;
    const first = registry.rememberFiles("project-a", [a, b]);
    const second = registry.rememberFiles("project-b", [other]);
    expect(first).toBe("browser-file:file-1");
    expect(registry.files("project-a", first)).toEqual([a, b]);
    expect(registry.files("project-b", first)).toBeUndefined();
    registry.releaseFiles("project-b", first);
    expect(registry.files("project-a", first)).toEqual([a, b]);
    registry.releaseFiles("project-a", first);
    expect(registry.files("project-a", first)).toBeUndefined();
    const replacement = registry.rememberFiles("project-a", [a, b]);
    registry.clearEphemeral("project-a");
    expect(registry.files("project-a", replacement)).toBeUndefined();
    expect(registry.files("project-b", second)).toEqual([other]);
  });

  it("checks a reopened persistent handle permission without requesting it", async () => {
    const backend = new MemoryBackend();
    const queryPermission = vi.fn(async () => "granted" as PermissionState);
    backend.records.push({
      key: "browser-handle:reopened",
      projectId: "project-a",
      kind: "directory",
      name: "旅程",
      handle: { kind: "directory", name: "旅程", queryPermission },
    });
    const registry = new BrowserSourceAccessRegistry(backend);

    await expect(
      registry.availability("project-a", {
        accessClass: "persistent-browser-handle",
        accessRef: "browser-handle:reopened",
      }),
    ).resolves.toBe("available");
    expect(queryPermission).toHaveBeenCalledWith({ mode: "read" });
  });

  it("distinguishes expired file objects, missing handles and permission prompts", async () => {
    const backend = new MemoryBackend();
    backend.records.push({
      key: "browser-handle:prompt",
      projectId: "project-a",
      kind: "directory",
      name: "旅行",
      handle: {
        kind: "directory",
        name: "旅行",
        queryPermission: vi.fn(async () => "prompt" as PermissionState),
      },
    });
    const registry = new BrowserSourceAccessRegistry(backend);

    await expect(
      registry.availability("project-a", {
        accessClass: "ephemeral-browser-file",
        accessRef: "browser-file:expired",
      }),
    ).resolves.toBe("needs-reselection");
    await expect(
      registry.availability("project-a", {
        accessClass: "persistent-browser-handle",
        accessRef: "browser-handle:missing",
      }),
    ).resolves.toBe("needs-reselection");
    await expect(
      registry.availability("project-a", {
        accessClass: "persistent-browser-handle",
        accessRef: "browser-handle:prompt",
      }),
    ).resolves.toBe("needs-permission");
    await expect(
      registry.availability("project-b", {
        accessClass: "persistent-browser-handle",
        accessRef: "browser-handle:prompt",
      }),
    ).resolves.toBe("needs-reselection");
  });
});
