// Modified by OpenFilm contributors on 2026-11-13. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  rename,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const jsonSha = (value: unknown) => sha(JSON.stringify(value));

async function fixture(options: { managed?: boolean; large?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-version-preview-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Saved film");
  cleanup.push(() => app.close());
  await mkdir(join(directory, "sources"), { recursive: true });
  const source = join(directory, "sources", "synthetic.bin");
  await writeFile(source, "original synthetic source");
  if (options.large) await truncate(source, 128 * 1024 * 1024);
  const uri = pathToFileURL(source).href;
  const rootUri = pathToFileURL(join(directory, "sources")).href;
  app.project.settings = { width: 640, height: 360, frameRate: 24 };
  app.project.mediaLibraries.push({
    id: "library",
    name: "Synthetic",
    uri: rootUri,
  });
  app.catalog.upsertAsset({
    id: "source",
    name: "Saved source",
    uri,
    mediaType: "image",
    tags: ["saved"],
    state: { locked: true },
    metadata: options.managed
      ? {
          "openfilm.managedSource": {
            relativePath: "sources/synthetic.bin",
            uri,
          },
          "openfilm.reference": {
            mediaLibraryId: "library",
            rootUri,
            relativePath: "synthetic.bin",
            originalUri: uri,
          },
        }
      : {},
  });
  app.project.stories.push({ id: "story", title: "Saved story", beats: [] });
  app.project.timelines.push({
    id: "cut",
    storyId: "story",
    duration: 2,
    tracks: [
      {
        id: "picture",
        type: "video",
        clips: [
          {
            id: "clip",
            assetId: "source",
            timelineStart: 0,
            timelineDuration: 2,
            locked: true,
          },
        ],
      },
    ],
    captionTracks: [
      {
        version: 1,
        id: "captions",
        name: "Saved captions",
        language: "en",
        style: {
          version: 1,
          role: "subtitle",
          fontSize: 18,
          background: "none",
        },
        cues: [
          {
            version: 1,
            id: "cue",
            startMs: 0,
            endMs: 1000,
            text: "Saved caption",
            source: { kind: "manual" },
            manualRevision: 0,
          },
        ],
      },
    ],
  });
  await app.save();
  const version = await app.versions.create({
    name: "Saved cut",
    baseRevision: app.versions.currentRevision(),
    requestId: randomUUID(),
  });
  return { root, directory, app, version, source };
}

function payload(directory: string, versionId: string) {
  return ["project.json", "database.sqlite", "record.json"].map((file) =>
    sha(readFileSync(join(directory, "versions", versionId, file))),
  );
}

describe("trusted named-version preview snapshots", () => {
  it("uses saved settings, assets, captions and locks without changing active state or payload", async () => {
    const { app, directory, version } = await fixture();
    app.project.title = "Current film";
    app.project.settings = { width: 1920, height: 1080, frameRate: 60 };
    const asset = app.catalog.getAsset("source")!;
    app.catalog.upsertAsset({
      ...asset,
      name: "Current asset",
      state: {},
      tags: ["current"],
    });
    await app.save();
    const editor = new TimelineEditor(app);
    await editor.edit("cut", {
      baseRevision: editor.get("cut").revision,
      commands: [
        {
          type: "caption.cue.update",
          trackId: "captions",
          cueId: "cue",
          patch: { text: "Current caption" },
        },
      ],
    });
    const beforeEditor = editor.get("cut");
    expect(beforeEditor.canUndo).toBe(true);
    const beforeProject = structuredClone(app.project);
    const manifest = readFileSync(join(directory, "project.json"));
    const revision = app.catalog.logicalRevision();
    const assets = app.catalog.listAssets();
    const beforePayload = payload(directory, version.id);

    const snapshot = await app.versions.snapshotForPreview(version.id, "cut");
    expect(snapshot.projectId).toBe(app.project.id);
    expect(snapshot.versionId).toBe(version.id);
    expect(snapshot.project.title).toBe("Saved film");
    expect(snapshot.project.settings).toEqual({
      width: 640,
      height: 360,
      frameRate: 24,
    });
    expect(snapshot.assets[0]).toMatchObject({
      name: "Saved source",
      tags: ["saved"],
      state: { locked: true },
    });
    expect(snapshot.composition.tracks[0]!.clips[0]!.locked).toBe(true);
    expect(snapshot.composition.captionTracks?.[0]?.cues[0]?.text).toBe(
      "Saved caption",
    );
    expect(snapshot.sourceReferences).toEqual(version.sourceReferences);
    expect(snapshot.record).toEqual(version);
    expect(snapshot.compositionSha256).toBe(jsonSha(snapshot.composition));
    expect(snapshot.settingsSha256).toBe(jsonSha(snapshot.project.settings));
    expect(snapshot.assetsSha256).toBe(jsonSha(snapshot.assets));
    expect(snapshot.identity).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => snapshot.assertCurrent()).not.toThrow();
    expect(app.project).toEqual(beforeProject);
    expect(readFileSync(join(directory, "project.json"))).toEqual(manifest);
    expect(app.catalog.logicalRevision()).toBe(revision);
    expect(app.catalog.listAssets()).toEqual(assets);
    expect(editor.get("cut")).toEqual(beforeEditor);
    expect(payload(directory, version.id)).toEqual(beforePayload);
  });

  it("binds identity to the selected saved cut and rejects cross-project packages", async () => {
    const { app, directory, version } = await fixture();
    const second = structuredClone(app.project.timelines[0]!);
    second.id = "other-cut";
    app.project.timelines.push(second);
    await app.save();
    const twoCuts = await app.versions.create({
      name: "Two cuts",
      baseRevision: app.versions.currentRevision(),
      requestId: randomUUID(),
    });
    const a = await app.versions.snapshotForPreview(twoCuts.id, "cut");
    const b = await app.versions.snapshotForPreview(twoCuts.id, "other-cut");
    expect(a.identity).not.toBe(b.identity);
    expect(a.settingsSha256).toBe(b.settingsSha256);
    expect(a.assetsSha256).toBe(b.assetsSha256);
    expect(
      (await app.versions.snapshotForPreview(version.id)).identity,
    ).not.toBe(a.identity);
    const other = await fixture();
    await cp(
      join(directory, "versions", version.id),
      join(other.directory, "versions", version.id),
      { recursive: true },
    );
    const indexPath = join(other.directory, "versions", "index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    const foreignIndex = JSON.parse(
      readFileSync(join(directory, "versions", "index.json"), "utf8"),
    );
    index.entries.push(
      foreignIndex.entries.find(
        (entry: { id: string }) => entry.id === version.id,
      ),
    );
    writeFileSync(indexPath, JSON.stringify(index));
    expect(() => other.app.versions.previewTargets(version.id)).toThrow(
      expect.objectContaining({ code: "request.invalid" }),
    );
    await expect(
      other.app.versions.snapshotForPreview(version.id),
    ).rejects.toMatchObject({ code: "request.invalid" });
  });

  it("returns small saved-target metadata even when sources are offline", async () => {
    const { app, version, source } = await fixture();
    await rm(source);
    const result = app.versions.previewTargets(version.id);
    expect(result).toEqual({
      projectId: app.project.id,
      versionId: version.id,
      name: "Saved cut",
      projectHash: version.projectHash,
      catalogHash: version.catalogHash,
      identity: expect.stringMatching(/^[a-f0-9]{64}$/u),
      compositions: [
        {
          id: "cut",
          storyId: "story",
          title: "Saved story",
          duration: 2,
          frameRate: 24,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("file:");
    expect(JSON.stringify(result)).not.toContain("sourceReferences");
    await expect(
      app.versions.snapshotForPreview(version.id),
    ).rejects.toMatchObject({ code: "media.missing" });
  });

  it("rejects an explicit unknown Composition instead of selecting the first", async () => {
    const { app, version } = await fixture();
    await expect(
      app.versions.snapshotForPreview(version.id, "unknown"),
    ).rejects.toMatchObject({ code: "request.notFound" });
    expect(
      (await app.versions.snapshotForPreview(version.id)).composition.id,
    ).toBe("cut");
  });

  it("rejects a saved version with no Composition", async () => {
    const { app } = await fixture();
    app.project.timelines = [];
    await app.save();
    const version = await app.versions.create({
      name: "No cut",
      baseRevision: app.versions.currentRevision(),
      requestId: randomUUID(),
    });
    expect(app.versions.previewTargets(version.id).compositions).toEqual([]);
    await expect(
      app.versions.snapshotForPreview(version.id),
    ).rejects.toMatchObject({ code: "request.notFound" });
  });

  it("rejects changed source bytes at capture and after capture", async () => {
    const { app, version, source } = await fixture();
    const snapshot = await app.versions.snapshotForPreview(version.id);
    await writeFile(source, "changed synthetic source!");
    expect(() => snapshot.assertCurrent()).toThrow();
    await expect(
      app.versions.snapshotForPreview(version.id),
    ).rejects.toMatchObject({ code: "media.missing" });
  });

  it.each([
    "composition",
    "settings",
    "assets",
    "sourceReferences",
    "record",
    "project",
  ] as const)(
    "owns returned %s values and rejects mutation without poisoning a fresh capture",
    async (field) => {
      const { app, version } = await fixture();
      const snapshot = await app.versions.snapshotForPreview(version.id);
      const identity = snapshot.identity;
      if (field === "composition") snapshot.composition.duration = 99;
      else if (field === "settings") snapshot.project.settings.width = 1;
      else if (field === "assets") snapshot.assets[0]!.name = "mutated";
      else if (field === "sourceReferences")
        snapshot.sourceReferences[0]!.sha256 = "0".repeat(64);
      else if (field === "record") snapshot.record.projectHash = "0".repeat(64);
      else snapshot.project.title = "mutated";
      expect(() => snapshot.assertCurrent()).toThrow();
      const fresh = await app.versions.snapshotForPreview(version.id);
      expect(fresh.identity).toBe(identity);
      expect(fresh.project.title).toBe("Saved film");
      expect(fresh.assets[0]!.name).toBe("Saved source");
      expect(() => fresh.assertCurrent()).not.toThrow();
    },
  );

  it("keeps payload identity and an existing guard valid across metadata rename", async () => {
    const { app, directory, version } = await fixture();
    const snapshot = await app.versions.snapshotForPreview(version.id);
    const targets = app.versions.previewTargets(version.id);
    const before = payload(directory, version.id);
    app.versions.rename(version.id, {
      name: "Renamed saved cut",
      description: "Metadata only",
    });
    expect(() => snapshot.assertCurrent()).not.toThrow();
    const renamed = await app.versions.snapshotForPreview(version.id);
    expect(renamed.identity).toBe(snapshot.identity);
    expect(renamed.record.name).toBe("Renamed saved cut");
    expect(app.versions.previewTargets(version.id)).toMatchObject({
      identity: targets.identity,
      name: "Renamed saved cut",
    });
    expect(payload(directory, version.id)).toEqual(before);
  });

  it.each(["project.json", "database.sqlite", "record.json"])(
    "rejects corrupt %s in capture, metadata and an existing publication guard",
    async (file) => {
      const { app, directory, version } = await fixture();
      const snapshot = await app.versions.snapshotForPreview(version.id);
      const path = join(directory, "versions", version.id, file);
      const bytes = readFileSync(path);
      bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      writeFileSync(path, bytes);
      expect(() => snapshot.assertCurrent()).toThrow();
      expect(() => app.versions.previewTargets(version.id)).toThrow();
      await expect(
        app.versions.snapshotForPreview(version.id),
      ).rejects.toThrow();
    },
  );

  it("rejects deleted versions and missing payload files after capture", async () => {
    const { app, directory, version } = await fixture();
    const snapshot = await app.versions.snapshotForPreview(version.id);
    const path = join(directory, "versions", version.id, "project.json");
    const manifest = readFileSync(path);
    await rm(path);
    expect(() => snapshot.assertCurrent()).toThrow();
    await expect(app.versions.snapshotForPreview(version.id)).rejects.toThrow();
    await writeFile(path, manifest);
    app.versions.remove(version.id, {
      baseRevision: app.versions.currentRevision(),
      confirmed: true,
    });
    expect(() => snapshot.assertCurrent()).toThrow();
    expect(() => app.versions.previewTargets(version.id)).toThrow();
    await expect(
      app.versions.snapshotForPreview(version.id),
    ).rejects.toMatchObject({ code: "request.notFound" });
  });

  it("preserves AbortError for pre-abort and cancellation while verifying a real large source", async () => {
    const { app, version } = await fixture({ large: true });
    const already = new AbortController();
    already.abort();
    await expect(
      app.versions.snapshotForPreview(version.id, undefined, {
        signal: already.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const controller = new AbortController();
    const pending = app.versions.snapshotForPreview(version.id, undefined, {
      signal: controller.signal,
    });
    const timer = setTimeout(() => controller.abort(), 5);
    try {
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      clearTimeout(timer);
    }
    expect((await app.versions.snapshotForPreview(version.id)).versionId).toBe(
      version.id,
    );
  });

  it("rebases saved managed media after a project move without rewriting saved bytes", async () => {
    const { app, root, directory, version } = await fixture({ managed: true });
    const before = payload(directory, version.id);
    app.close();
    cleanup.pop();
    const movedDirectory = join(root, "moved.openfilm");
    await rename(directory, movedDirectory);
    const moved = await OpenFilmApplication.open(movedDirectory);
    cleanup.push(() => moved.close());
    const activeManifest = readFileSync(join(movedDirectory, "project.json"));
    const activeRevision = moved.catalog.logicalRevision();
    const snapshot = await moved.versions.snapshotForPreview(version.id);
    expect(snapshot.assets[0]!.uri).toBe(
      pathToFileURL(join(movedDirectory, "sources", "synthetic.bin")).href,
    );
    expect(snapshot.project.mediaLibraries[0]!.uri).toBe(
      pathToFileURL(join(movedDirectory, "sources")).href,
    );
    expect(() => snapshot.assertCurrent()).not.toThrow();
    expect(payload(movedDirectory, version.id)).toEqual(before);
    expect(readFileSync(join(movedDirectory, "project.json"))).toEqual(
      activeManifest,
    );
    expect(moved.catalog.logicalRevision()).toBe(activeRevision);
  });

  it("reads an authentic v5 saved catalog without migrating its immutable payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-version-preview-v5-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const bytes = gunzipSync(
      Buffer.from(
        readFileSync(
          new URL(
            "./fixtures/named-version-v5-61a4659.json.gz.b64",
            import.meta.url,
          ),
          "utf8",
        ).trim(),
        "base64",
      ),
    );
    expect(sha(bytes)).toBe(
      "8596f6d84d71a69ff7f79e41c01be8c897df6e94972e7940af3bd8d643863730",
    );
    const fixture = JSON.parse(bytes.toString("utf8")) as {
      versionId: string;
      files: Array<{ path: string; bytes: string }>;
    };
    const directory = join(root, "legacy.openfilm");
    for (const file of fixture.files) {
      const path = join(directory, file.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, Buffer.from(file.bytes, "base64"), { mode: 0o600 });
    }
    const app = await OpenFilmApplication.open(directory);
    cleanup.push(() => app.close());
    const before = payload(directory, fixture.versionId);
    expect(app.versions.previewTargets(fixture.versionId).versionId).toBe(
      fixture.versionId,
    );
    // The historical package has no Composition; metadata remains available.
    await expect(
      app.versions.snapshotForPreview(fixture.versionId),
    ).rejects.toMatchObject({ code: "request.notFound" });
    expect(payload(directory, fixture.versionId)).toEqual(before);
  });
});
