import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import {
  CATALOG_SCHEMA_VERSION,
  createPortableCatalogSnapshot,
  inspectCatalogSnapshot,
} from "@openfilm/catalog";
import type { MediaAsset } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { graphicScene } from "../../../tests/fixtures/graphic-scene.js";
import { OpenFilmApplication } from "../src/index.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));

interface Manifest {
  files: { path: string; size: number; sha256: string }[];
  assets: { id: string; path: string; originalUriDigest: string }[];
  fonts: {
    path: string;
    sha256: string;
    bindings: { family: string; weight: number }[];
  }[];
  rights: { resourceId: string; basis: string; licenseName?: string }[];
}

let root: string;
let source: MediaAsset;
let sequence = 0;
const applications = new Set<OpenFilmApplication>();
beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "openfilm-collect-review-"));
  const path = join(root, "synthetic.mp4");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=10:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    "-c:a",
    "aac",
    "-shortest",
    path,
  ]);
  source = await inspectMedia({
    path,
    uri: pathToFileURL(path).href,
    name: "Synthetic.mp4",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const app of applications) app.close({ requireSave: false });
  applications.clear();
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const directory = join(root, `case-${++sequence}`);
  await fs.mkdir(directory);
  const app = await OpenFilmApplication.create(
    join(directory, "source.openfilm"),
    "Synthetic review film",
  );
  applications.add(app);
  app.project.settings = { width: 160, height: 90, frameRate: 10 };
  app.catalog.upsertAsset(source);
  app.project.stories = [
    {
      id: "story",
      title: "Synthetic",
      beats: [
        {
          id: "beat",
          title: "Synthetic",
          candidateAssetIds: [source.id],
          selectedAssetIds: [source.id],
        },
      ],
    },
  ];
  app.project.timelines = [
    {
      id: "first",
      storyId: "story",
      duration: 1,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: source.id,
              timelineStart: 0,
              timelineDuration: 1,
              sourceIn: 0,
              sourceOut: 1,
            },
          ],
        },
      ],
    },
  ];
  return { app, directory };
}

async function collect(app: OpenFilmApplication, destination: string) {
  await app.save();
  const selection = { scope: "entire-project" as const };
  const preview = await app.collectMedia.plan(selection);
  const rightsDeclarations = preview.items.map(({ resourceId }) => ({
    resourceId,
    basis: "owned" as const,
    confirmed: true as const,
  }));
  const plan = await app.collectMedia.plan({
    ...selection,
    rightsDeclarations,
  });
  expect(plan.complete).toBe(true);
  await app.collectMedia.create({
    ...selection,
    rightsDeclarations,
    planId: plan.id,
    baseRevision: plan.revision,
    destination,
    format: "directory",
  });
  return destination;
}

async function manifestAt(path: string): Promise<Manifest> {
  return JSON.parse(
    await fs.readFile(join(path, "collect-manifest.json"), "utf8"),
  ) as Manifest;
}

async function writeManifest(path: string, manifest: Manifest) {
  await fs.writeFile(
    join(path, "collect-manifest.json"),
    JSON.stringify(manifest),
  );
}

async function updateFileReceipt(
  path: string,
  manifest: Manifest,
  name: string,
) {
  const file = manifest.files.find((item) => item.path === name)!;
  file.size = (await fs.lstat(join(path, name))).size;
  file.sha256 = await hashFile(join(path, name));
}

describe("Collect Media review regressions", () => {
  it("verifies and reopens a generated 360-video package", async () => {
    const { app, directory } = await fixture();
    // Raw 360 sources remain non-renderable; a Story may retain one alongside
    // the saved Composition's flat export without invalidating its package.
    const rawPath = join(directory, "synthetic-360.mp4");
    await fs.copyFile(new URL(source.uri), rawPath);
    const rawAsset = {
      ...source,
      id: "synthetic-360",
      mediaType: "360-video" as const,
      uri: pathToFileURL(rawPath).href,
    };
    app.catalog.upsertAsset(rawAsset);
    app.project.stories[0]!.beats[0]!.candidateAssetIds!.push(rawAsset.id);
    const path = await collect(app, join(directory, "collected.openfilm"));
    expect(await app.collectMedia.verify(path)).toMatchObject({
      verified: true,
      sourceCount: 2,
    });
    const reopened = await OpenFilmApplication.open(path);
    applications.add(reopened);
    expect(reopened.catalog.getAsset(rawAsset.id)?.mediaType).toBe("360-video");
  });

  it.each([
    "secret-project.mp4",
    "password-memories.mp4",
    "credential-archive.mp4",
    "api-key-demo.mp4",
  ])("accepts the valid generated display name %s", async (name) => {
    const { app, directory } = await fixture();
    app.catalog.upsertAsset({ ...source, name });
    const path = await collect(app, join(directory, "collected.openfilm"));
    expect(await app.collectMedia.verify(path)).toMatchObject({
      verified: true,
    });
    const reopened = await OpenFilmApplication.open(path);
    applications.add(reopened);
    expect(reopened.catalog.getAsset(source.id)?.name).toBe(name);
  });

  it.each(["story", "later-composition"] as const)(
    "rejects an omitted asset still referenced by a %s",
    async (location) => {
      const { app, directory } = await fixture();
      const omittedPath = join(directory, "omitted.mp4");
      await fs.copyFile(new URL(source.uri), omittedPath);
      const omitted = {
        ...source,
        id: "omitted-asset",
        uri: pathToFileURL(omittedPath).href,
      };
      app.catalog.upsertAsset(omitted);
      if (location === "story")
        app.project.stories[0]!.beats[0]!.candidateAssetIds!.push(omitted.id);
      else {
        const later = structuredClone(app.project.timelines[0]!);
        later.id = "later";
        later.tracks[0]!.clips[0]!.assetId = omitted.id;
        app.project.timelines.push(later);
      }
      const path = await collect(app, join(directory, "collected.openfilm"));
      const manifest = await manifestAt(path);
      manifest.assets = manifest.assets.filter(
        (asset) => asset.id !== omitted.id,
      );
      manifest.rights = manifest.rights.filter(
        (right) => right.resourceId !== `asset:${omitted.id}`,
      );
      const catalogPath = join(path, "database.sqlite");
      const catalog = await fs.readFile(catalogPath);
      const assets = inspectCatalogSnapshot(
        catalog,
        CATALOG_SCHEMA_VERSION,
      ).assets.filter((asset) => asset.id !== omitted.id);
      await fs.writeFile(
        catalogPath,
        createPortableCatalogSnapshot(catalog, CATALOG_SCHEMA_VERSION, assets),
      );
      await updateFileReceipt(path, manifest, "database.sqlite");
      await writeManifest(path, manifest);
      await expect(app.collectMedia.verify(path)).rejects.toMatchObject({
        code: "export.failed",
      });
    },
  );

  it.each(["title", "caption", "graphic"] as const)(
    "requires a packaged font binding for persisted %s text in a later Composition",
    async (kind) => {
      const { app, directory } = await fixture();
      const later = structuredClone(app.project.timelines[0]!);
      later.id = "later";
      if (kind === "title")
        later.tracks[0]!.clips[0]!.title = "Synthetic title";
      else if (kind === "caption")
        later.captionTracks = [
          {
            version: 1,
            id: "captions",
            name: "Synthetic",
            style: { version: 1, role: "subtitle" },
            cues: [
              {
                version: 1,
                id: "cue",
                startMs: 0,
                endMs: 900,
                text: "Synthetic caption",
                source: { kind: "manual" },
                manualRevision: 0,
              },
            ],
          },
        ];
      else
        later.graphicScenes = [
          graphicScene({
            duration: 1,
            nodes: [
              {
                id: "nested-text",
                type: "group",
                x: 0,
                y: 0,
                width: 120,
                height: 40,
                opacity: 1,
                zIndex: 0,
                start: 0,
                end: 1,
                children: [
                  {
                    id: "text",
                    type: "text",
                    text: "Synthetic graphic",
                    fontSize: 16,
                    x: 0,
                    y: 0,
                    width: 120,
                    height: 40,
                    opacity: 1,
                    zIndex: 0,
                    start: 0,
                    end: 1,
                  },
                ],
              },
            ],
          }),
        ];
      app.project.timelines.push(later);
      const path = await collect(app, join(directory, "collected.openfilm"));
      const manifest = await manifestAt(path);
      expect(manifest.fonts.length).toBeGreaterThan(0);
      for (const font of manifest.fonts) await fs.rm(join(path, font.path));
      manifest.files = manifest.files.filter(
        (file) => !file.path.startsWith("fonts/"),
      );
      manifest.rights = manifest.rights.filter(
        (right) => !right.resourceId.startsWith("font:"),
      );
      manifest.fonts = [];
      await writeManifest(path, manifest);
      await expect(app.collectMedia.verify(path)).rejects.toMatchObject({
        code: "request.invalid",
      });
      await expect(OpenFilmApplication.open(path)).rejects.toMatchObject({
        code: "request.invalid",
      });
    },
  );

  it.each(["binding", "font-file"] as const)(
    "rejects reopening when a required %s is missing",
    async (missing) => {
      const { app, directory } = await fixture();
      app.project.timelines[0]!.tracks[0]!.clips[0]!.title = "Synthetic title";
      const path = await collect(app, join(directory, "collected.openfilm"));
      const manifest = await manifestAt(path);
      if (missing === "binding") {
        for (const font of manifest.fonts) font.bindings = [];
        await writeManifest(path, manifest);
      } else await fs.rm(join(path, manifest.fonts[0]!.path));
      const opening = OpenFilmApplication.open(path).then((reopened) => {
        applications.add(reopened);
        return reopened;
      });
      await expect(opening).rejects.toMatchObject({ code: "request.invalid" });
    },
  );

  it.each(["licensed", "cc0", "public-domain", "other"])(
    "rejects a received %s declaration without a license name",
    async (basis) => {
      const { app, directory } = await fixture();
      const path = await collect(app, join(directory, "collected.openfilm"));
      const manifest = await manifestAt(path);
      manifest.rights[0]!.basis = basis;
      await writeManifest(path, manifest);
      await expect(app.collectMedia.verify(path)).rejects.toMatchObject({
        code: "request.invalid",
      });
    },
  );

  it.each(["dimensions", "embedded-audio"] as const)(
    "rejects an otherwise valid render with incorrect %s",
    async (defect) => {
      const { app, directory } = await fixture();
      const path = await collect(app, join(directory, "collected.openfilm"));
      const originalExport = OpenFilmApplication.prototype.exportMp4;
      vi.spyOn(OpenFilmApplication.prototype, "exportMp4").mockImplementation(
        async function (this: OpenFilmApplication, ...args) {
          const output = await originalExport.apply(this, args);
          const changed = `${output.path}.changed.mp4`;
          await runProcess("ffmpeg", [
            "-v",
            "error",
            "-i",
            output.path,
            ...(defect === "dimensions"
              ? ["-vf", "scale=80:46", "-c:a", "copy"]
              : ["-an"]),
            "-c:v",
            "libx264",
            "-threads",
            "1",
            changed,
          ]);
          await fs.rename(changed, output.path);
          const receiptPath = `${output.path}.manifest.json`;
          const receipt = JSON.parse(
            await fs.readFile(receiptPath, "utf8"),
          ) as { outputSha256: string };
          receipt.outputSha256 = await hashFile(output.path);
          await fs.writeFile(receiptPath, JSON.stringify(receipt));
          return output;
        },
      );
      await expect(app.collectMedia.verify(path)).rejects.toMatchObject({
        code: "render.failed",
      });
    },
  );

  it("preserves original provenance when recollecting relocated packages", async () => {
    const { app, directory } = await fixture();
    const first = await collect(app, join(directory, "first.openfilm"));
    const expectedDigest = (await manifestAt(first)).assets[0]!
      .originalUriDigest;
    for (const name of ["relocated-a", "relocated-b"]) {
      const relocated = join(directory, `${name}.openfilm`);
      await fs.cp(first, relocated, { recursive: true });
      const reopened = await OpenFilmApplication.open(relocated);
      applications.add(reopened);
      const recollected = await collect(
        reopened,
        join(directory, `${name}-recollected.openfilm`),
      );
      expect((await manifestAt(recollected)).assets[0]!.originalUriDigest).toBe(
        expectedDigest,
      );
      expect(await app.collectMedia.verify(recollected)).toMatchObject({
        verified: true,
      });
    }
  });

  it.each(["source", "isolated"] as const)(
    "stops hashing promptly when cancelled during the %s directory scan",
    async (scan) => {
      const { app, directory } = await fixture();
      const bytes = join(directory, "synthetic-large.bmp");
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=1440x1024",
        "-frames:v",
        "1",
        "-c:v",
        "bmp",
        "-threads",
        "1",
        bytes,
      ]);
      app.catalog.upsertAsset({
        ...source,
        mediaType: "image",
        uri: pathToFileURL(bytes).href,
        contentHash: await hashFile(bytes),
        metadata: {},
      });
      const path = await collect(app, join(directory, "collected.openfilm"));
      const controller = new AbortController();
      const originalOpen = fs.open;
      let bytesRead = 0;
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await originalOpen(...args);
        const filePath = String(args[0]);
        if (
          filePath.includes("/sources/") &&
          (scan === "source"
            ? filePath.startsWith(`${path}/`)
            : filePath.includes("openfilm-collect-verify-"))
        ) {
          const originalStream = handle.createReadStream.bind(handle);
          vi.spyOn(handle, "createReadStream").mockImplementation((options) => {
            const stream = originalStream(options);
            stream.on("data", (chunk) => {
              bytesRead += Buffer.byteLength(chunk);
              controller.abort();
            });
            return stream;
          });
        }
        return handle;
      });
      await expect(
        app.collectMedia.verify(path, controller.signal),
      ).rejects.toMatchObject({ code: "export.failed", status: 409 });
      expect(bytesRead).toBeGreaterThan(0);
      expect(bytesRead).toBeLessThan(512 * 1024);
      expect((await fs.lstat(path)).isDirectory()).toBe(true);
    },
  );
});
