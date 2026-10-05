import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { MediaAsset } from "@openfilm/core";
import {
  hashFile,
  referenceFor,
  type PortableReference,
} from "@openfilm/media";
import { generateSampleMedia } from "../../../fixtures/sample-media/generate.mjs";
import {
  MediaRelinker,
  OpenFilmApplication,
  TimelineEditor,
  type RelinkApplyInput,
  type RelinkPlanInput,
} from "../src/index.js";

let sources: string;
const directories: string[] = [];
const applications = new Set<OpenFilmApplication>();
beforeAll(async () => {
  sources = await mkdtemp(join(tmpdir(), "openfilm-relink-samples-"));
  await generateSampleMedia(sources);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of applications) app.close();
  applications.clear();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(sources, { recursive: true, force: true });
});

async function fixture(legacy = false) {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-relink-app-"));
  directories.push(directory);
  const original = join(directory, "originals");
  const moved = join(directory, "moved");
  await mkdir(original);
  const app = await OpenFilmApplication.create(
    join(directory, "film.openfilm"),
    "Relinking",
  );
  applications.add(app);
  app.project.mediaLibraries.push({
    id: "library",
    uri: pathToFileURL(original).href,
    name: "Originals",
  });
  for (const [id, filename, mediaType] of [
    ["photo", "01-photo.png", "image"],
    ["video", "04-motion.mp4", "video"],
  ] as const) {
    const path = join(original, filename);
    await copyFile(join(sources, filename), path);
    const asset: MediaAsset = {
      id,
      uri: pathToFileURL(path).href,
      name: filename,
      mediaType,
      ...(mediaType === "video" ? { duration: 3 } : {}),
      ...(legacy ? {} : { contentHash: await hashFile(path) }),
      tags: ["retain"],
      rating: 3,
      state: {},
      thumbnailUri: `cache/thumbnails/${id}.jpg`,
      metadata: {
        "user.note": { text: "retained" },
        "openfilm.filesystem": { size: (await stat(path)).size },
      },
    };
    if (!legacy)
      asset.metadata["openfilm.reference"] = referenceFor(
        asset,
        app.project.mediaLibraries,
      );
    app.catalog.upsertAsset(asset);
  }
  app.project.stories.push({
    id: "story",
    title: "Keep story",
    beats: [
      { id: "beat", title: "Opening", candidateAssetIds: ["photo", "video"] },
    ],
  });
  app.project.timelines.push({
    id: "timeline",
    storyId: "story",
    duration: 4,
    tracks: [
      {
        id: "track",
        type: "video",
        clips: [
          {
            id: "photo-clip",
            assetId: "photo",
            beatId: "beat",
            timelineStart: 0,
            timelineDuration: 2,
          },
          {
            id: "video-clip",
            assetId: "video",
            beatId: "beat",
            timelineStart: 2,
            timelineDuration: 2,
            sourceIn: 0.5,
            sourceOut: 2.5,
            transform: { volume: 0.7, scale: 1.3 },
            locked: true,
          },
        ],
      },
    ],
  });
  await app.save();
  return { directory, original, moved, app, relinker: new MediaRelinker(app) };
}

describe("media relinking application", () => {
  it("reports missing sources and atomically reconnects a folder while preserving edits and undo history", async () => {
    const { original, moved, app, relinker } = await fixture();
    const editor = new TimelineEditor(app);
    const initial = editor.get("timeline");
    const edited = await editor.edit("timeline", {
      baseRevision: initial.revision,
      commands: [{ type: "duration", clipId: "photo-clip", duration: 3 }],
    });
    const projectBytes = await readFile(join(app.directory, "project.json"));
    const assetsBefore = app.catalog.listAssets();
    expect((await relinker.status()).libraries[0]!.status).toBe("online");
    await rename(original, moved);
    const missing = await relinker.status();
    expect(missing.assets.every((asset) => asset.status === "missing")).toBe(
      true,
    );
    expect(missing.libraries[0]!.status).toBe("offline");
    const plan = await relinker.plan({ libraryId: "library", folder: moved });
    expect(plan.matches.every((match) => match.candidates[0]?.automatic)).toBe(
      true,
    );
    const result = await relinker.apply({
      planId: plan.id,
      selections: plan.matches.map((match) => ({
        assetId: match.assetId,
        candidateId: match.suggestedId!,
      })),
    });
    expect(result.assets).toHaveLength(2);
    for (const asset of result.assets) {
      const previous = assetsBefore.find((item) => item.id === asset.id)!;
      expect(asset).toEqual({
        ...previous,
        uri: pathToFileURL(join(moved, basename(previous.name))).href,
        metadata: {
          ...previous.metadata,
          "openfilm.reference": expect.objectContaining({
            originalUri: previous.uri,
            volumeId: (
              previous.metadata["openfilm.reference"] as PortableReference
            ).volumeId,
            rootUri: pathToFileURL(moved).href,
          }),
        },
      });
    }
    expect(await readFile(join(app.directory, "project.json"))).toEqual(
      projectBytes,
    );
    const online = await relinker.status();
    expect(online.assets.every((asset) => asset.status === "available")).toBe(
      true,
    );
    expect(online.libraries[0]).toMatchObject({
      status: "online",
      roots: [pathToFileURL(moved).href],
    });
    expect(editor.get("timeline").revision).toBe(edited.revision);
    expect(editor.get("timeline").canUndo).toBe(true);
    expect(
      (await editor.undo("timeline", edited.revision)).composition,
    ).toEqual(initial.composition);
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(app.directory);
    applications.add(reopened);
    expect(
      (await new MediaRelinker(reopened).status()).libraries[0]!.status,
    ).toBe("online");
    expect(reopened.catalog.getAssetByUri(result.assets[0]!.uri)?.id).toBe(
      result.assets[0]!.id,
    );
  });

  it("preserves rating and metadata changes made after planning", async () => {
    const { original, moved, app, relinker } = await fixture();
    await rename(original, moved);
    const plan = await relinker.plan({
      assetIds: ["photo"],
      file: join(moved, "01-photo.png"),
    });
    app.catalog.updateAsset("photo", {
      rating: 5,
      tags: ["new tag"],
      state: { locked: true },
    });
    const latest = app.catalog.getAsset("photo")!;
    latest.metadata["user.new"] = "added while selecting";
    app.catalog.upsertAsset(latest);
    const { assets } = await relinker.apply({
      planId: plan.id,
      selections: [
        { assetId: "photo", candidateId: plan.matches[0]!.suggestedId! },
      ],
    });
    expect(assets[0]).toMatchObject({
      id: "photo",
      rating: 5,
      tags: ["new tag"],
      state: { locked: true },
      metadata: { "user.new": "added while selecting" },
    });
  });

  it("requires confirmation for legacy matches and accepts a compatible source without losing metadata", async () => {
    const { original, moved, app, relinker } = await fixture(true);
    await rename(original, moved);
    const plan = await relinker.plan({
      assetIds: ["video"],
      file: join(moved, "04-motion.mp4"),
    });
    const candidate = plan.matches[0]!.candidates[0]!;
    expect(candidate.automatic).toBe(false);
    const selections = [{ assetId: "video", candidateId: candidate.id }];
    await expect(
      relinker.apply({ planId: plan.id, selections }),
    ).rejects.toMatchObject({ status: 400 });
    const { assets } = await relinker.apply({
      planId: plan.id,
      selections: selections.map((selection) => ({
        ...selection,
        confirm: true,
      })),
    });
    expect(assets[0]).toMatchObject({
      id: "video",
      duration: 3,
      metadata: {
        "user.note": { text: "retained" },
        "openfilm.reference": {
          originalUri: pathToFileURL(join(original, "04-motion.mp4")).href,
          contentHash: candidate.contentHash,
        },
      },
    });
    expect(app.project.timelines[0]!.tracks[0]!.clips[1]!.sourceOut).toBe(2.5);
  });

  it("cannot override known hash mismatch with confirmation or a forged candidate", async () => {
    const { relinker, app } = await fixture();
    const before = app.catalog.getAsset("photo");
    const plan = await relinker.plan({
      assetIds: ["photo"],
      file: join(sources, "03-evening.png"),
    });
    expect(plan.matches[0]!.candidates).toEqual([]);
    await expect(
      relinker.apply({
        planId: plan.id,
        selections: [
          { assetId: "photo", candidateId: "forged", confirm: true },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(app.catalog.getAsset("photo")).toEqual(before);
  });

  it("rejects files changed or removed after planning without partially moving other assets", async () => {
    const { original, moved, app, relinker } = await fixture();
    await rename(original, moved);
    const before = app.catalog.listAssets();
    const plan = await relinker.plan({ folder: moved });
    const input = {
      planId: plan.id,
      selections: plan.matches.map((match) => ({
        assetId: match.assetId,
        candidateId: match.suggestedId!,
      })),
    };
    await writeFile(join(moved, "04-motion.mp4"), "changed");
    await expect(relinker.apply(input)).rejects.toMatchObject({ status: 409 });
    expect(app.catalog.listAssets()).toEqual(before);
    await rm(join(moved, "04-motion.mp4"));
    await expect(relinker.apply(input)).rejects.toMatchObject({ status: 409 });
    expect(app.catalog.listAssets()).toEqual(before);
  });

  it("rejects legacy wrong-kind and short-source replacements despite explicit confirmation", async () => {
    const { relinker, app } = await fixture(true);
    const before = app.catalog.getAsset("video");
    const wrong = await relinker.plan({
      assetIds: ["video"],
      file: join(sources, "01-photo.png"),
    });
    await expect(
      relinker.apply({
        planId: wrong.id,
        selections: [
          {
            assetId: "video",
            candidateId: wrong.matches[0]!.candidates[0]!.id,
            confirm: true,
          },
        ],
      }),
    ).rejects.toThrow(/media type/);
    const video = app.catalog.getAsset("video")!;
    video.duration = 5;
    app.catalog.upsertAsset(video);
    const short = await relinker.plan({
      assetIds: ["video"],
      file: join(sources, "04-motion.mp4"),
    });
    await expect(
      relinker.apply({
        planId: short.id,
        selections: [
          {
            assetId: "video",
            candidateId: short.matches[0]!.candidates[0]!.id,
            confirm: true,
          },
        ],
      }),
    ).rejects.toThrow(/too short/);
    expect(app.catalog.getAsset("video")).toEqual({ ...before, duration: 5 });
  });

  it("checks every composition's source trims even when legacy metadata omits duration", async () => {
    const { relinker, app } = await fixture(true);
    const asset = app.catalog.getAsset("video")!;
    delete asset.duration;
    app.catalog.upsertAsset(asset);
    app.project.timelines[0]!.tracks[0]!.clips[1]!.sourceOut = 4;
    const plan = await relinker.plan({
      assetIds: ["video"],
      file: join(sources, "04-motion.mp4"),
    });
    await expect(
      relinker.apply({
        planId: plan.id,
        selections: [
          {
            assetId: "video",
            candidateId: plan.matches[0]!.candidates[0]!.id,
            confirm: true,
          },
        ],
      }),
    ).rejects.toThrow(/too short/);
    expect(app.catalog.getAsset("video")).toEqual(asset);
  });

  it("rejects catalog collisions and stale URIs atomically", async () => {
    const { original, moved, relinker, app } = await fixture();
    await rename(original, moved);
    const plan = await relinker.plan({ folder: moved });
    const destination = pathToFileURL(join(moved, "04-motion.mp4")).href;
    app.catalog.upsertAsset({
      ...app.catalog.getAsset("video")!,
      id: "owner",
      uri: destination,
    });
    const before = app.catalog.listAssets();
    const input = {
      planId: plan.id,
      selections: plan.matches.map((match) => ({
        assetId: match.assetId,
        candidateId: match.suggestedId!,
      })),
    };
    await expect(relinker.apply(input)).rejects.toMatchObject({ status: 409 });
    expect(app.catalog.listAssets()).toEqual(before);
    app.catalog.upsertAsset({
      ...app.catalog.getAsset("photo")!,
      uri: pathToFileURL(join(moved, "elsewhere.png")).href,
    });
    await expect(relinker.apply(input)).rejects.toMatchObject({ status: 409 });
    expect(app.catalog.getAsset("video")).toEqual(
      before.find((asset) => asset.id === "video"),
    );
  });

  it("keeps plans isolated from callers, expires them, and bounds retained plans", async () => {
    const { relinker } = await fixture();
    const file = join(sources, "01-photo.png");
    const first = await relinker.plan({ assetIds: ["photo"], file });
    first.matches[0]!.candidates[0]!.uri = "file:///forged";
    const applied = await relinker.apply({
      planId: first.id,
      selections: [
        { assetId: "photo", candidateId: first.matches[0]!.candidates[0]!.id },
      ],
    });
    expect(applied.assets[0]!.uri).toBe(pathToFileURL(file).href);
    const expired = await relinker.plan({ assetIds: ["photo"], file });
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 16 * 60 * 1000);
    await expect(
      relinker.apply({
        planId: expired.id,
        selections: [
          { assetId: "photo", candidateId: expired.matches[0]!.suggestedId! },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    clock.mockRestore();
    const evicted = await relinker.plan({ assetIds: ["photo"], file });
    for (let index = 0; index < 20; index++)
      await relinker.plan({ assetIds: ["photo"], file });
    await expect(
      relinker.apply({
        planId: evicted.id,
        selections: [
          { assetId: "photo", candidateId: evicted.matches[0]!.suggestedId! },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("validates runtime plan and selection JSON", async () => {
    const { relinker, app } = await fixture();
    const before = app.catalog.listAssets();
    for (const input of [
      null,
      [],
      {},
      { file: 3 },
      { folder: sources, file: "same" },
      { folder: sources, assetIds: "photo" },
      { folder: sources, assetIds: ["photo", "photo"] },
      { folder: sources, unsafe: true },
    ])
      await expect(
        relinker.plan(input as RelinkPlanInput),
      ).rejects.toMatchObject({ status: 400 });
    for (const input of [
      null,
      {},
      { planId: "unknown", selections: [] },
      {
        planId: "unknown",
        selections: [{ assetId: "photo", candidateId: "id", confirm: "true" }],
      },
      {
        planId: "unknown",
        selections: [
          { assetId: "photo", candidateId: "id" },
          { assetId: "photo", candidateId: "id" },
        ],
      },
    ])
      await expect(
        relinker.apply(input as RelinkApplyInput),
      ).rejects.toMatchObject({ status: 400 });
    expect(app.catalog.listAssets()).toEqual(before);
  });

  it("derives library mount status independently of the selected asset page", async () => {
    const { original, directory, app, relinker } = await fixture();
    const empty = join(directory, "empty-library");
    await mkdir(empty);
    app.project.mediaLibraries.push({
      id: "empty",
      name: "Empty",
      uri: pathToFileURL(empty).href,
    });
    expect(
      (await relinker.status([])).libraries.map((library) => library.status),
    ).toEqual(["online", "online"]);
    await rm(join(original, "01-photo.png"));
    const status = await relinker.status(["photo"]);
    expect(status.assets[0]!.status).toBe("missing");
    expect(status.libraries.map((library) => library.status)).toEqual([
      "partial",
      "online",
    ]);
  });

  it("checks catalogs beyond the relink plan limit using current roots and lightweight summaries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-large-status-"));
    directories.push(directory);
    const mounted = join(directory, "current-mount");
    const offline = join(directory, "offline-mount");
    const empty = join(directory, "empty-library");
    await mkdir(mounted);
    await mkdir(empty);
    await writeFile(join(mounted, "asset-0000.jpg"), "status needs no decoder");
    const app = await OpenFilmApplication.create(
      join(directory, "film.openfilm"),
      "Large catalog",
    );
    applications.add(app);
    app.project.mediaLibraries.push(
      {
        id: "mounted",
        name: "Moved",
        uri: pathToFileURL(join(directory, "old-mount")).href,
      },
      {
        id: "offline",
        name: "Offline",
        uri: pathToFileURL(join(directory, "old-offline")).href,
      },
      { id: "empty", name: "Empty", uri: pathToFileURL(empty).href },
    );
    const ids: string[] = [];
    for (let index = 0; index < 2001; index++) {
      const id = `asset-${String(index).padStart(4, "0")}`;
      ids.push(id);
      const libraryId = index < 1000 ? "mounted" : "offline";
      const root = libraryId === "mounted" ? mounted : offline;
      const asset: MediaAsset = {
        id,
        uri: pathToFileURL(join(root, `${id}.jpg`)).href,
        name: `${id}.jpg`,
        mediaType: "image",
        tags: [],
        state: {},
        metadata: { "openfilm.exif": { opaque: "x".repeat(1024) } },
      };
      asset.metadata["openfilm.reference"] = {
        ...referenceFor(asset, []),
        mediaLibraryId: libraryId,
        rootUri: pathToFileURL(root).href,
      };
      app.catalog.upsertAsset(asset);
    }
    const relinker = new MediaRelinker(app);
    const getAsset = vi.spyOn(app.catalog, "getAsset");
    const listAssets = vi.spyOn(app.catalog, "listAssets");
    const media = await import("@openfilm/media");
    const inspectSource = media.sourceStatus;
    let pending = 0;
    let maximum = 0;
    vi.spyOn(media, "sourceStatus").mockImplementation(async (asset) => {
      pending++;
      maximum = Math.max(maximum, pending);
      try {
        return await inspectSource(asset);
      } finally {
        pending--;
      }
    });
    const status = await relinker.status();
    expect(status.assets).toHaveLength(2001);
    expect(
      status.assets.filter((asset) => asset.status === "available"),
    ).toEqual([{ assetId: "asset-0000", status: "available" }]);
    expect(status.libraries).toEqual([
      {
        id: "mounted",
        name: "Moved",
        status: "partial",
        roots: [pathToFileURL(mounted).href],
      },
      {
        id: "offline",
        name: "Offline",
        status: "offline",
        roots: [pathToFileURL(offline).href],
      },
      {
        id: "empty",
        name: "Empty",
        status: "online",
        roots: [pathToFileURL(empty).href],
      },
    ]);
    expect((await relinker.status(ids)).assets).toEqual(status.assets);
    const scoped = await relinker.status(["asset-2000", "asset-0000"]);
    expect(scoped.assets.map((asset) => asset.assetId)).toEqual([
      "asset-2000",
      "asset-0000",
    ]);
    expect(scoped.libraries.map((library) => library.status)).toEqual([
      "online",
      "offline",
      "online",
    ]);
    await expect(relinker.status(["unknown"])).rejects.toMatchObject({
      status: 404,
    });
    expect(getAsset).not.toHaveBeenCalled();
    expect(listAssets).not.toHaveBeenCalled();
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(16);
    await expect(relinker.plan({ folder: mounted })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("2000"),
    });
    await expect(
      relinker.plan({ folder: mounted, assetIds: ids }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("2000"),
    });
  });

  it("rejects direct relinking while jobs are active, including jobs started before commit", async () => {
    const { app, relinker } = await fixture();
    const input = { assetIds: ["photo"], file: join(sources, "01-photo.png") };
    const plan = await relinker.plan(input);
    const selections = [
      { assetId: "photo", candidateId: plan.matches[0]!.suggestedId! },
    ];
    const before = app.catalog.getAsset("photo");
    const active = vi.spyOn(app, "hasActiveJobs", "get").mockReturnValue(true);
    await expect(relinker.plan(input)).rejects.toMatchObject({ status: 409 });
    await expect(
      relinker.apply({ planId: plan.id, selections }),
    ).rejects.toMatchObject({ status: 409 });
    active
      .mockReset()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    await expect(
      relinker.apply({ planId: plan.id, selections }),
    ).rejects.toMatchObject({ status: 409 });
    expect(app.catalog.getAsset("photo")).toEqual(before);
  });

  it("rechecks early candidates after the rest of a batch has been inspected", async () => {
    const { original, moved, app, relinker } = await fixture();
    await rename(original, moved);
    const plan = await relinker.plan({ folder: moved });
    const before = app.catalog.listAssets();
    const get = app.catalog.getAsset.bind(app.catalog);
    let removed = false;
    vi.spyOn(app.catalog, "getAsset").mockImplementation((id) => {
      if (id === "video" && !removed) {
        unlinkSync(join(moved, "01-photo.png"));
        removed = true;
      }
      return get(id);
    });
    await expect(
      relinker.apply({
        planId: plan.id,
        selections: plan.matches.map((match) => ({
          assetId: match.assetId,
          candidateId: match.suggestedId!,
        })),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(app.catalog.listAssets()).toEqual(before);
  });
});
