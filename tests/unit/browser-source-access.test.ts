import { describe, expect, it, vi } from "vitest";
import {
  BrowserSourceAccessRegistry,
  type BrowserHandleBackend,
  type BrowserHandleLike,
  type StoredBrowserHandle,
} from "../../apps/desktop/src/browserSourceAccess.js";

class MemoryBackend implements BrowserHandleBackend {
  records: StoredBrowserHandle[] = [];

  async list(projectId: string) {
    return this.records.filter((record) => record.projectId === projectId);
  }

  async put(record: StoredBrowserHandle) {
    this.records = [
      ...this.records.filter((value) => value.key !== record.key),
      record,
    ];
  }

  async remove(key: string) {
    this.records = this.records.filter((record) => record.key !== key);
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
  it("structured-clones persistent handles through the backend and reuses the same entry", async () => {
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
    registry.clearEphemeral("project-a");
    expect(registry.files("project-a", first)).toBeUndefined();
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
