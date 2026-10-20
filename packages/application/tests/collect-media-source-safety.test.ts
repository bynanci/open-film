import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import * as media from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));
vi.mock("@openfilm/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openfilm/media")>()),
}));
const fakeCredentials = Buffer.from(
  "[synthetic-only]\naws_access_key_id=OPENFILM_FAKE_NOT_A_KEY\naws_secret_access_key=OPENFILM_FAKE_NOT_A_SECRET\n",
);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
let root: string;
let video: MediaAsset;
let image: MediaAsset;
let sequence = 0;
const apps = new Set<OpenFilmApplication>();
beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "openfilm-collect-source-safety-"));
  const videoPath = join(root, "flat.mp4");
  await media.runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=10:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "1",
    videoPath,
  ]);
  video = await media.inspectMedia({
    path: videoPath,
    uri: pathToFileURL(videoPath).href,
    name: "flat.mp4",
  });
  const imagePath = join(root, "still.png");
  await media.runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=96x54",
    "-frames:v",
    "1",
    "-threads",
    "1",
    imagePath,
  ]);
  image = await media.inspectMedia({
    path: imagePath,
    uri: pathToFileURL(imagePath).href,
    name: "still.png",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const app of apps) app.close({ requireSave: false });
  apps.clear();
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const directory = join(root, `case-${++sequence}`);
  await fs.mkdir(directory);
  const app = await OpenFilmApplication.create(
    join(directory, "source.openfilm"),
    "Synthetic source boundary",
  );
  apps.add(app);
  app.project.settings = { width: 160, height: 90, frameRate: 10 };
  app.catalog.upsertAsset(video);
  app.project.stories = [
    {
      id: "story",
      title: "Synthetic",
      beats: [
        {
          id: "beat",
          title: "Synthetic",
          candidateAssetIds: [video.id],
          selectedAssetIds: [video.id],
        },
      ],
    },
  ];
  app.project.timelines = [
    {
      id: "film",
      storyId: "story",
      duration: 1,
      tracks: [
        {
          id: "video",
          type: "video",
          clips: [
            {
              id: "clip",
              assetId: video.id,
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
function addCandidate(
  app: OpenFilmApplication,
  path: string,
  bytes: Buffer,
  mediaType: MediaAsset["mediaType"] = "image",
) {
  const asset: MediaAsset = {
    id: "story-only",
    name: "photo.png",
    uri: pathToFileURL(path).href,
    mediaType,
    contentHash: sha(bytes),
    metadata: {},
    tags: [],
    state: {},
  };
  app.catalog.upsertAsset(asset);
  app.project.stories[0]!.beats[0]!.candidateAssetIds!.push(asset.id);
  return asset;
}
async function plan(app: OpenFilmApplication) {
  await app.save();
  const selection = {
    scope: "current-film" as const,
    compositionId: "film",
    rightsDeclarations: app.catalog.listAssets().map((asset) => ({
      resourceId: `asset:${asset.id}`,
      basis: "owned" as const,
      confirmed: true as const,
    })),
  };
  return { selection, plan: await app.collectMedia.plan(selection) };
}
async function collect(app: OpenFilmApplication, destination: string) {
  const prepared = await plan(app);
  expect(prepared.plan.complete).toBe(true);
  await app.collectMedia.create({
    ...prepared.selection,
    planId: prepared.plan.id,
    baseRevision: prepared.plan.revision,
    destination,
    format: "directory",
  });
  return prepared;
}

describe("Collect Media source file safety", () => {
  it("retains a single-frame supported video", async () => {
    const { app, directory } = await fixture();
    const path = join(directory, "single-frame.mp4");
    await media.runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      new URL(video.uri).pathname,
      "-frames:v",
      "1",
      "-an",
      "-c:v",
      "copy",
      path,
    ]);
    addCandidate(app, path, await fs.readFile(path), "video");
    expect((await plan(app)).plan.complete).toBe(true);
  });

  it("retains supported audio with embedded cover art", async () => {
    const { app, directory } = await fixture();
    const path = join(directory, "cover.mp3");
    await media.runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-i",
      new URL(image.uri).pathname,
      "-map",
      "0:a",
      "-map",
      "1:v",
      "-c:a",
      "libmp3lame",
      "-c:v",
      "mjpeg",
      "-threads",
      "1",
      "-disposition:v",
      "attached_pic",
      "-id3v2_version",
      "3",
      path,
    ]);
    addCandidate(app, path, await fs.readFile(path), "audio");
    expect((await plan(app)).plan.complete).toBe(true);
  });

  it.each([".aws/credentials", ".aws/config", ".ssh/id_rsa", ".env", ".npmrc"])(
    "rejects synthetic credential path %s before opening its bytes",
    async (name) => {
      const { app, directory } = await fixture();
      const path = join(directory, name);
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, fakeCredentials);
      addCandidate(app, path, fakeCredentials);
      const opened: string[] = [];
      const original = fs.open;
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        opened.push(String(args[0]));
        return original(...args);
      });
      const prepared = await plan(app);
      expect(prepared.plan.complete).toBe(false);
      expect(
        prepared.plan.items.find(
          (item) => item.resourceId === "asset:story-only",
        ),
      ).toMatchObject({ status: "blocked", rightsDeclared: true });
      expect(opened).not.toContain(path);
      const destination = join(directory, "blocked.openfilm");
      await expect(
        app.collectMedia.create({
          ...prepared.selection,
          planId: prepared.plan.id,
          baseRevision: prepared.plan.revision,
          destination,
          format: "directory",
        }),
      ).rejects.toMatchObject({ code: "export.failed" });
      await expect(fs.lstat(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it.each(["plain-text", "truncated-png", "playlist"] as const)(
    "blocks Story-only %s disguised with an image name and type",
    async (kind) => {
      const { app, directory } = await fixture();
      const path = join(directory, "disguised.png");
      const bytes =
        kind === "truncated-png"
          ? Buffer.concat([
              Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
              fakeCredentials,
            ])
          : kind === "playlist"
            ? Buffer.from(
                `ffconcat version 1.0\nfile '${new URL(video.uri).pathname}'\n`,
              )
            : fakeCredentials;
      await fs.writeFile(path, bytes);
      addCandidate(app, path, bytes);
      const prepared = await plan(app);
      expect(prepared.plan.complete).toBe(false);
      expect(
        prepared.plan.items.find(
          (item) => item.resourceId === "asset:story-only",
        )?.status,
      ).toBe("blocked");
    },
  );

  it.each(["image-as-audio", "video-as-image"] as const)(
    "checks actual stream type for %s",
    async (kind) => {
      const { app, directory } = await fixture();
      const asset = kind === "image-as-audio" ? image : video;
      const path = join(directory, "candidate-media");
      await fs.copyFile(new URL(asset.uri), path);
      addCandidate(
        app,
        path,
        await fs.readFile(new URL(asset.uri)),
        kind === "image-as-audio" ? "audio" : "image",
      );
      expect((await plan(app)).plan.complete).toBe(false);
    },
  );

  it("fences a source changed after planning to a symlink into synthetic credentials", async () => {
    const { app, directory } = await fixture();
    const path = join(directory, "photo.png");
    await fs.copyFile(new URL(image.uri), path);
    addCandidate(app, path, await fs.readFile(path));
    const prepared = await plan(app);
    expect(prepared.plan.complete).toBe(true);
    const credentialPath = join(directory, ".aws", "credentials");
    await fs.mkdir(dirname(credentialPath));
    await fs.writeFile(credentialPath, fakeCredentials);
    await fs.rm(path);
    await fs.symlink(credentialPath, path);
    const destination = join(directory, "changed.openfilm");
    await expect(
      app.collectMedia.create({
        ...prepared.selection,
        planId: prepared.plan.id,
        baseRevision: prepared.plan.revision,
        destination,
        format: "directory",
      }),
    ).rejects.toMatchObject({ code: "story.planStale" });
    await expect(fs.lstat(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a source replaced during actual media inspection", async () => {
    const { app, directory } = await fixture();
    const path = join(directory, "photo.png");
    const bytes = await fs.readFile(new URL(image.uri));
    await fs.writeFile(path, bytes);
    addCandidate(app, path, bytes);
    const original = media.runProcess;
    vi.spyOn(media, "runProcess").mockImplementation(
      async (command, args, options) => {
        const result = await original(command, args, options);
        if (command === "ffprobe" && args.at(-1) === path)
          await fs.writeFile(path, fakeCredentials);
        return result;
      },
    );
    expect((await plan(app)).plan.complete).toBe(false);
  });

  it("rejects forged package receipts for Story-only non-media before rendering", async () => {
    const { app, directory } = await fixture();
    const source = join(directory, "photo.png");
    const bytes = await fs.readFile(new URL(image.uri));
    await fs.writeFile(source, bytes);
    addCandidate(app, source, bytes);
    const destination = join(directory, "tampered.openfilm");
    await collect(app, destination);
    const manifestPath = join(destination, "collect-manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      assets: { id: string; path: string; sha256: string; size: number }[];
      files: { path: string; sha256: string; size: number }[];
    };
    const receipt = manifest.assets.find((asset) => asset.id === "story-only")!;
    const oldPath = receipt.path;
    const hash = sha(fakeCredentials);
    receipt.path = `sources/${hash.slice(0, 2)}/${hash}.png`;
    receipt.sha256 = hash;
    receipt.size = fakeCredentials.length;
    await fs.mkdir(dirname(join(destination, receipt.path)), {
      recursive: true,
    });
    await fs.writeFile(join(destination, receipt.path), fakeCredentials);
    await fs.rm(join(destination, oldPath));
    const file = manifest.files.find((item) => item.path === oldPath)!;
    Object.assign(file, {
      path: receipt.path,
      sha256: hash,
      size: fakeCredentials.length,
    });
    const catalogPath = join(destination, "database.sqlite");
    const catalog = await fs.readFile(catalogPath);
    const assets = inspectCatalogSnapshot(
      catalog,
      CATALOG_SCHEMA_VERSION,
    ).assets;
    const asset = assets.find((item) => item.id === "story-only")!;
    asset.contentHash = hash;
    Object.assign(asset.metadata["openfilm.reference"] as object, {
      relativePath: receipt.path,
      contentHash: hash,
      fileSize: fakeCredentials.length,
    });
    Object.assign(asset.metadata["openfilm.managedSource"] as object, {
      relativePath: receipt.path,
    });
    const revised = createPortableCatalogSnapshot(
      catalog,
      CATALOG_SCHEMA_VERSION,
      assets,
    );
    await fs.writeFile(catalogPath, revised);
    Object.assign(
      manifest.files.find((item) => item.path === "database.sqlite")!,
      { sha256: sha(revised), size: revised.length },
    );
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const rendered = vi.spyOn(OpenFilmApplication.prototype, "render");
    await expect(app.collectMedia.verify(destination)).rejects.toMatchObject({
      code: "request.invalid",
    });
    expect(rendered).not.toHaveBeenCalled();
  });
});
