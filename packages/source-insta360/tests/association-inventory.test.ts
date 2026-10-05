import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import { enrichInsta360Asset, Insta360ImportContext } from "../src/index";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

const directories: string[] = [];
const readInventory: (
  path: string,
  options: { withFileTypes: true },
) => Promise<Dirent[]> = readdir;
async function folder(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-associations-"));
  directories.push(directory);
  return directory;
}

function asset(directory: string, name: string): MediaAsset {
  return {
    id: name,
    uri: pathToFileURL(join(directory, name)).href,
    name,
    mediaType: "video",
    duration: 2,
    tags: [],
    state: {},
    metadata: {},
  };
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("import-scoped Insta360 association inventory", () => {
  it("scans and sorts a directory once for concurrent generic media and matching exports", async () => {
    const directory = await folder();
    const rawNames = Array.from(
      { length: 100 },
      (_, index) => `capture-${index}.insv`,
    );
    await Promise.all(
      rawNames.map((name) => writeFile(join(directory, name), "synthetic raw")),
    );
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const entries = await actual.readdir(directory, { withFileTypes: true });
    const sort = vi.spyOn(entries, "sort");
    vi.mocked(readInventory).mockResolvedValueOnce(entries);
    const context = new Insta360ImportContext();
    const generic = Array.from({ length: 500 }, (_, index) =>
      asset(directory, `generic-${index}.mp4`),
    );
    const exports = rawNames.map((name) =>
      asset(directory, name.replace(/\.insv$/u, "_export.mp4")),
    );
    const results = await Promise.all(
      [...generic, ...exports].map((source) =>
        enrichInsta360Asset(source, { context }),
      ),
    );
    expect(readdir).toHaveBeenCalledTimes(1);
    expect(sort).toHaveBeenCalledTimes(1);
    for (const generic of results.slice(0, 500))
      expect(generic.metadata["openfilm.insta360"]).toBeUndefined();
    for (const [index, exported] of results.slice(500).entries()) {
      expect(exported.metadata["openfilm.insta360"]).toMatchObject({
        original360Sources: [
          pathToFileURL(join(directory, rawNames[index]!)).href,
        ],
        evidence: { association: [{ kind: "named-sibling" }] },
      });
    }
  });

  it("refreshes the directory on the next import while retaining explicit offline provenance", async () => {
    const directory = await folder();
    const original = asset(directory, "capture.mp4");
    const offline = pathToFileURL(join(directory, "offline.insv")).href;
    original.metadata["openfilm.insta360"] = { original360Sources: [offline] };
    const firstImport = new Insta360ImportContext();
    const before = await enrichInsta360Asset(original, {
      context: firstImport,
    });
    expect(before.metadata["openfilm.insta360"]).toMatchObject({
      original360Sources: [offline],
    });
    const added = join(directory, "capture.insv");
    await writeFile(added, "newly copied original");
    const secondImport = new Insta360ImportContext();
    const after = await enrichInsta360Asset(original, {
      context: secondImport,
    });
    expect(after.metadata["openfilm.insta360"]).toMatchObject({
      original360Sources: [offline, pathToFileURL(added).href],
      evidence: {
        association: [
          { kind: "explicit-metadata", available: false },
          { kind: "named-sibling", available: true },
        ],
      },
    });
    expect(readdir).toHaveBeenCalledTimes(2);
  });

  it("propagates cancellation during a shared inventory read and does not poison the next import", async () => {
    const directory = await folder();
    const source = asset(directory, "capture.mp4");
    const controller = new AbortController();
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const entries = await actual.readdir(directory, { withFileTypes: true });
    vi.mocked(readInventory).mockImplementationOnce(async () => {
      controller.abort();
      return entries;
    });
    await expect(
      enrichInsta360Asset(source, {
        signal: controller.signal,
        context: new Insta360ImportContext(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      enrichInsta360Asset(source, {
        context: new Insta360ImportContext(),
      }),
    ).resolves.toEqual(source);
    expect(readdir).toHaveBeenCalledTimes(2);
  });
});
