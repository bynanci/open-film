import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserSourceAccessRegistry,
  IndexedDbBrowserHandleBackend,
  type BrowserHandleBackend,
  type BrowserHandleLike,
  type StoredBrowserHandle,
} from "../../apps/desktop/src/browserSourceAccess.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

class MemoryBackend implements BrowserHandleBackend {
  records: StoredBrowserHandle[] = [];
  listCalls = 0;
  getManyCalls = 0;
  recordsReturned = 0;
  putBatches = 0;
  removeBatches = 0;

  async list(projectId: string) {
    this.listCalls++;
    return this.records.filter((record) => record.projectId === projectId);
  }

  async getMany(projectId: string, keys: readonly string[]) {
    this.getManyCalls++;
    const requested = new Set(keys);
    const records = this.records.filter(
      (record) => record.projectId === projectId && requested.has(record.key),
    );
    this.recordsReturned += records.length;
    return records;
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
    const getManyCalls = backend.getManyCalls;
    await registry.removeHandles("project-a", [
      "browser-handle:batch-1",
      "browser-handle:batch-2",
      "browser-handle:not-owned",
    ]);
    expect(backend.listCalls).toBe(listCalls);
    expect(backend.getManyCalls).toBe(getManyCalls + 1);
    expect(backend.recordsReturned).toBe(2);
    expect(backend.removeBatches).toBe(1);
    expect(backend.records.map((record) => record.key)).toEqual([
      "browser-handle:batch-3",
    ]);
  });

  it("indexes handle candidates instead of scanning every known entry", async () => {
    const backend = new MemoryBackend();
    let nameReads = 0;
    backend.records = Array.from({ length: 500 }, (_, index) => {
      const record: StoredBrowserHandle = {
        key: `browser-handle:known-${index}`,
        projectId: "project-a",
        kind: "directory" as const,
        name: `known-${index}`,
        handle: handle(`known-${index}`, `known-${index}`),
      };
      Object.defineProperty(record, "name", {
        enumerable: true,
        get() {
          nameReads++;
          return `known-${index}`;
        },
      });
      return record;
    });
    const registry = new BrowserSourceAccessRegistry(backend);

    await registry.rememberHandles(
      "project-a",
      Array.from({ length: 500 }, (_, index) =>
        handle(`incoming-${index}`, `incoming-${index}`),
      ),
    );

    expect(nameReads).toBeLessThanOrEqual(1_000);
  });

  it("bounds identity comparisons for 1,000 distinct same-name handles", async () => {
    const backend = new MemoryBackend();
    let probes = 0;
    const handles = Array.from({ length: 1_000 }, (_, index) => {
      const value: BrowserHandleLike & { identity: number } = {
        kind: "directory",
        name: "Shared camera folder",
        identity: index,
      };
      Object.defineProperty(value, "isSameEntry", {
        get() {
          probes++;
          return async (other: BrowserHandleLike) =>
            (other as { identity?: number }).identity === index;
        },
      });
      return value;
    });
    const registry = new BrowserSourceAccessRegistry(backend);

    await registry.rememberHandles("project-a", handles);

    expect(backend.records).toHaveLength(1_000);
    expect(probes).toBeLessThanOrEqual(64_000);
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

  it("checks a mixed source batch with one persistent storage lookup", async () => {
    const backend = new MemoryBackend();
    const granted = vi.fn(async () => "granted" as PermissionState);
    const prompt = vi.fn(async () => "prompt" as PermissionState);
    backend.records.push(
      {
        key: "browser-handle:granted",
        projectId: "project-a",
        kind: "directory",
        name: "Granted",
        handle: {
          kind: "directory",
          name: "Granted",
          queryPermission: granted,
        },
      },
      {
        key: "browser-handle:prompt",
        projectId: "project-a",
        kind: "directory",
        name: "Prompt",
        handle: {
          kind: "directory",
          name: "Prompt",
          queryPermission: prompt,
        },
      },
    );
    const registry = new BrowserSourceAccessRegistry(backend);
    const ephemeral = registry.rememberFiles("project-a", [
      { name: "local.mp4" } as File,
    ]);
    backend.listCalls = 0;

    await expect(
      registry.availabilities("project-a", [
        {
          accessClass: "native-path",
          accessRef: "/synthetic/native.mp4",
        },
        { accessClass: "ephemeral-browser-file", accessRef: ephemeral },
        {
          accessClass: "persistent-browser-handle",
          accessRef: "browser-handle:granted",
        },
        {
          accessClass: "persistent-browser-handle",
          accessRef: "browser-handle:prompt",
        },
        {
          accessClass: "persistent-browser-handle",
          accessRef: "browser-handle:missing",
        },
      ]),
    ).resolves.toEqual([
      "available",
      "available",
      "available",
      "needs-permission",
      "needs-reselection",
    ]);
    expect(backend.listCalls).toBe(0);
    expect(backend.getManyCalls).toBe(1);
    expect(backend.recordsReturned).toBe(2);
    expect(granted).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("bounds permission checks and reuses a result for duplicate access references", async () => {
    const backend = new MemoryBackend();
    let active = 0;
    let maximumActive = 0;
    const duplicatePermission = vi.fn(async () => "granted" as PermissionState);
    backend.records.push({
      key: "browser-handle:duplicate",
      projectId: "project-a",
      kind: "directory",
      name: "Duplicate",
      handle: {
        kind: "directory",
        name: "Duplicate",
        queryPermission: duplicatePermission,
      },
    });
    for (let index = 0; index < 48; index++) {
      backend.records.push({
        key: `browser-handle:${index}`,
        projectId: "project-a",
        kind: "directory",
        name: `Source ${index}`,
        handle: {
          kind: "directory",
          name: `Source ${index}`,
          async queryPermission() {
            active++;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active--;
            return "granted" as PermissionState;
          },
        },
      });
    }
    const registry = new BrowserSourceAccessRegistry(backend);
    const duplicate = {
      accessClass: "persistent-browser-handle" as const,
      accessRef: "browser-handle:duplicate",
    };

    const results = await registry.availabilities("project-a", [
      duplicate,
      duplicate,
      duplicate,
      ...Array.from({ length: 48 }, (_, index) => ({
        accessClass: "persistent-browser-handle" as const,
        accessRef: `browser-handle:${index}`,
      })),
    ]);

    expect(results).toEqual(Array.from({ length: 51 }, () => "available"));
    expect(duplicatePermission).toHaveBeenCalledTimes(1);
    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(16);
  });

  it("loads only requested persistent records for a visible page", async () => {
    const backend = new MemoryBackend();
    backend.records = Array.from({ length: 10_000 }, (_, index) => ({
      key: `browser-handle:${index}`,
      projectId: "project-a",
      kind: "directory" as const,
      name: `Source ${index}`,
      handle: {
        kind: "directory" as const,
        name: `Source ${index}`,
        queryPermission: vi.fn(async () => "granted" as PermissionState),
      },
    }));
    const registry = new BrowserSourceAccessRegistry(backend);

    await expect(
      registry.availabilities(
        "project-a",
        Array.from({ length: 100 }, (_, index) => ({
          accessClass: "persistent-browser-handle" as const,
          accessRef: `browser-handle:${5_000 + index}`,
        })),
      ),
    ).resolves.toEqual(Array.from({ length: 100 }, () => "available"));

    expect(backend.listCalls).toBe(0);
    expect(backend.getManyCalls).toBe(1);
    expect(backend.recordsReturned).toBe(100);
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

  it("retries a blocked IndexedDB open and closes a late connection", async () => {
    interface MockOpenRequest {
      result?: unknown;
      onblocked?: () => void;
      onsuccess?: () => void;
    }
    const opens: MockOpenRequest[] = [];
    const open = vi.fn(() => {
      const request: MockOpenRequest = {};
      opens.push(request);
      return request;
    });
    vi.stubGlobal("indexedDB", { open });
    const backend = new IndexedDbBrowserHandleBackend();

    const first = backend.list("project-a");
    expect(open).toHaveBeenCalledTimes(1);
    opens[0]!.onblocked!();
    await expect(first).rejects.toThrow("blocked");

    const lateDatabase = { close: vi.fn() };
    opens[0]!.result = lateDatabase;
    opens[0]!.onsuccess!();
    expect(lateDatabase.close).toHaveBeenCalledTimes(1);

    const second = backend.list("project-a");
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith("openfilm-source-access", 2);
    const allRequest: {
      result?: StoredBrowserHandle[];
      onsuccess?: () => void;
    } = {};
    const transaction: {
      oncomplete?: () => void;
      objectStore: () => {
        index: (name: string) => {
          getAll: (projectId: string) => typeof allRequest;
        };
      };
    } = {
      objectStore: vi.fn(() => ({
        index: vi.fn((name: string) => {
          expect(name).toBe("projectId");
          return {
            getAll: vi.fn((projectId: string) => {
              expect(projectId).toBe("project-a");
              queueMicrotask(() => {
                allRequest.result = [];
                allRequest.onsuccess!();
                transaction.oncomplete!();
              });
              return allRequest;
            }),
          };
        }),
      })),
    };
    const database = {
      close: vi.fn(),
      transaction: vi.fn(() => transaction),
      onversionchange: undefined as undefined | (() => void),
    };
    opens[1]!.result = database;
    opens[1]!.onsuccess!();

    await expect(second).resolves.toEqual([]);
    expect(database.onversionchange).toBeTypeOf("function");
    database.onversionchange!();
    expect(database.close).toHaveBeenCalledTimes(1);

    const third = backend.list("project-a");
    expect(open).toHaveBeenCalledTimes(3);
    opens[2]!.onblocked!();
    await expect(third).rejects.toThrow("blocked");
  });
});
