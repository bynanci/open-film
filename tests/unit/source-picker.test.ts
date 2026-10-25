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
  releaseBrowserSources,
  sourcesFromBrowserDrop,
} from "../../apps/desktop/src/sourcePicker.js";

class MemoryBackend implements BrowserHandleBackend {
  records: StoredBrowserHandle[] = [];
  async list(projectId: string) {
    return this.records.filter((record) => record.projectId === projectId);
  }
  async putMany(records: readonly StoredBrowserHandle[]) {
    this.records.push(...records);
  }
  async removeMany(keys: readonly string[]) {
    const removed = new Set(keys);
    this.records = this.records.filter((record) => !removed.has(record.key));
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

  it("rejects oversized choices before retaining files or acquiring dropped handles", async () => {
    const { access } = registry();
    const rememberFiles = vi.spyOn(access, "rememberFiles");
    const files = Array.from({ length: 10_001 }, (_, index) =>
      file(`${index}.mp4`),
    );
    expect(() => pickBrowserFiles("project-a", files, access)).toThrow(
      /10,000/u,
    );
    expect(rememberFiles).not.toHaveBeenCalled();

    const getAsFileSystemHandle = vi.fn();
    const transfer = {
      items: Array.from({ length: 10_001 }, () => ({
        getAsFileSystemHandle,
      })),
      files: [],
    } as unknown as DataTransfer;
    await expect(
      sourcesFromBrowserDrop("project-a", transfer, access),
    ).rejects.toThrow(/10,000/u);
    expect(getAsFileSystemHandle).not.toHaveBeenCalled();
  });

  it("rejects a byte-oversized allowed-count choice before retaining files", () => {
    const { access } = registry();
    const rememberFiles = vi.spyOn(access, "rememberFiles");
    const files = Array.from({ length: 10_000 }, (_, index) =>
      file(`${"x".repeat(300)}-${index}.mp4`),
    );

    expect(() => pickBrowserFiles("project-a", files, access)).toThrow(
      /storage limit/u,
    );
    expect(rememberFiles).not.toHaveBeenCalled();
  });

  it("accepts the full 10,000-file boundary and groups a 10,000-member fallback folder", () => {
    const files = Array.from({ length: 10_000 }, (_, index) =>
      file(`f${index}.mp4`),
    );
    const individual = registry();

    const picked = pickBrowserFiles("project-a", files, individual.access);

    expect(picked.sources).toHaveLength(10_000);
    expect(
      individual.access.files("project-a", picked.sources[9_999]!.accessRef),
    ).toEqual([files[9_999]]);

    const fallback = registry();
    const members = files.map((entry, index) =>
      file(entry.name, `Synthetic/Day-${index % 10}/${entry.name}`),
    );
    const grouped = pickBrowserFallbackFolders(
      "project-a",
      members,
      fallback.access,
    );
    expect(grouped.sources).toHaveLength(1);
    expect(
      fallback.access.files("project-a", grouped.sources[0]!.accessRef),
    ).toHaveLength(10_000);
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

  it("releases only project-owned browser references not retained by the revised draft", async () => {
    const { access, backend } = registry();
    const ephemeral = access.rememberFiles("project-a", [file("private.mp4")]);
    const [persistent] = await access.rememberHandles("project-a", [
      { kind: "directory", name: "Private folder" },
    ]);

    await releaseBrowserSources(
      "project-a",
      [
        { accessClass: "ephemeral-browser-file", accessRef: ephemeral },
        { accessClass: "persistent-browser-handle", accessRef: persistent! },
      ],
      new Set([persistent!]),
      access,
    );
    expect(access.files("project-a", ephemeral)).toBeUndefined();
    expect(backend.records.map((record) => record.key)).toEqual([persistent]);

    await releaseBrowserSources(
      "project-a",
      [{ accessClass: "persistent-browser-handle", accessRef: persistent! }],
      new Set(),
      access,
    );
    expect(backend.records).toEqual([]);
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
