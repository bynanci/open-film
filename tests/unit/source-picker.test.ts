import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserSourceAccessRegistry,
  type BrowserHandleBackend,
  type BrowserHandleLike,
  type StoredBrowserHandle,
} from "../../apps/desktop/src/browserSourceAccess.js";
import {
  pickBrowserFallbackFolders,
  pickBrowserFolder,
  pickBrowserFiles,
  sourcesFromBrowserDrop,
} from "../../apps/desktop/src/sourcePicker.js";

class MemoryBackend implements BrowserHandleBackend {
  records: StoredBrowserHandle[] = [];
  async list(projectId: string) {
    return this.records.filter((record) => record.projectId === projectId);
  }
  async put(record: StoredBrowserHandle) {
    this.records.push(record);
  }
  async remove(key: string) {
    this.records = this.records.filter((record) => record.key !== key);
  }
}

function registry(backend = new MemoryBackend()) {
  let sequence = 0;
  return {
    backend,
    access: new BrowserSourceAccessRegistry(
      backend,
      () => `source-${++sequence}`,
    ),
  };
}

function file(name: string, relativePath = "") {
  return { name, webkitRelativePath: relativePath } as File;
}

const originalWindow = globalThis.window;
afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("browser source picker", () => {
  it("keeps repeated file choices additive and project-private", () => {
    const { access } = registry();
    const first = pickBrowserFiles("project-a", [file("一.mp4")], access);
    const second = pickBrowserFiles("project-a", [file("二.mp4")], access);

    expect([...first.sources, ...second.sources]).toMatchObject([
      {
        displayName: "一.mp4",
        accessClass: "ephemeral-browser-file",
        accessRef: "browser-file:source-1",
      },
      {
        displayName: "二.mp4",
        accessClass: "ephemeral-browser-file",
        accessRef: "browser-file:source-2",
      },
    ]);
    expect(
      access.files("project-b", first.sources[0]!.accessRef),
    ).toBeUndefined();
  });

  it("groups the webkitdirectory fallback by logical root without exposing a host path", () => {
    const { access } = registry();
    const picked = pickBrowserFallbackFolders(
      "project-a",
      [
        file("a.mp4", "旅行/第一天/a.mp4"),
        file("b.mp4", "旅行/第二天/b.mp4"),
        file("c.mp4", "家庭/c.mp4"),
      ],
      access,
    );

    expect(picked.sources).toMatchObject([
      { kind: "folder", displayName: "旅行", recursive: true },
      { kind: "folder", displayName: "家庭", recursive: true },
    ]);
    expect(
      picked.sources.every((source) => !source.accessRef.includes("/")),
    ).toBe(true);
  });

  it("acquires dropped handles synchronously and persists their opaque references", async () => {
    const { access, backend } = registry();
    let eventActive = true;
    const handle: BrowserHandleLike = {
      kind: "directory",
      name: "京都",
      queryPermission: vi.fn(async () => "granted" as PermissionState),
    };
    const getAsFileSystemHandle = vi.fn(() => {
      expect(eventActive).toBe(true);
      return Promise.resolve(handle);
    });
    const transfer = {
      items: [{ getAsFileSystemHandle }],
      files: [],
    } as unknown as DataTransfer;

    const pending = sourcesFromBrowserDrop("project-a", transfer, access);
    eventActive = false;
    await expect(pending).resolves.toMatchObject({
      sources: [
        {
          kind: "folder",
          displayName: "京都",
          accessClass: "persistent-browser-handle",
          accessRef: "browser-handle:source-1",
        },
      ],
      rejected: [],
    });
    expect(getAsFileSystemHandle).toHaveBeenCalledTimes(1);
    expect(backend.records).toHaveLength(1);
  });

  it("uses the directory picker receiver and treats user cancellation as a no-op", async () => {
    const { access } = registry();
    const receiver = {
      showDirectoryPicker: vi.fn(function (this: unknown) {
        expect(this).toBe(receiver);
        throw new DOMException("cancelled", "AbortError");
      }),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: receiver,
    });

    await expect(pickBrowserFolder("project-a", access)).resolves.toEqual({
      sources: [],
      rejected: [],
    });
  });

  it("reports an unsupported legacy directory instead of silently dropping it", async () => {
    const { access } = registry();
    const transfer = {
      items: [
        {
          webkitGetAsEntry: () => ({ isDirectory: true }),
        },
      ],
      files: [],
    } as unknown as DataTransfer;

    await expect(
      sourcesFromBrowserDrop("project-a", transfer, access),
    ).resolves.toEqual({
      sources: [],
      rejected: [{ label: "directory", kind: "directory-unsupported" }],
    });
  });
});
