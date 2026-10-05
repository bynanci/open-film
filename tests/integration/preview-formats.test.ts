import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import type { MediaAsset } from "@openfilm/core";
import { hashFile, runProcess } from "@openfilm/media";
import { portableCacheUri } from "../../packages/application/src/portable-cache.js";
import { startServer } from "../../apps/server/src/server.js";

let root: string;
let sourceDirectory: string;
let projectDirectory: string;
let runtime: Awaited<ReturnType<typeof startServer>>;
let assets: MediaAsset[];
const sourceHashes = new Map<string, string>();
const imageFormats = [
  ["gif", "image/gif", false],
  ["bmp", "image/bmp", false],
  ["tif", "image/jpeg", true],
  ["tiff", "image/jpeg", true],
  ["avif", "image/jpeg", true],
] as const;
const audioFormats = [
  ["mp3", "libmp3lame"],
  ["wav", "pcm_s16le"],
  ["m4a", "aac"],
  ["aac", "aac"],
  ["flac", "flac"],
  ["ogg", "libvorbis"],
  ["opus", "libopus"],
] as const;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-preview-formats-"));
  sourceDirectory = join(root, "原始素材 # & preview");
  projectDirectory = join(root, "film.openfilm");
  await mkdir(sourceDirectory);
  for (const [extension] of imageFormats) {
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=teal:s=64x48",
      "-frames:v",
      "1",
      "-threads",
      "1",
      ...(extension === "avif"
        ? ["-c:v", "libaom-av1", "-cpu-used", "8", "-still-picture", "1"]
        : []),
      "-y",
      join(sourceDirectory, `image.${extension}`),
    ]);
  }
  for (const [extension, codec] of audioFormats) {
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.5",
      "-c:a",
      codec,
      "-threads",
      "1",
      "-y",
      join(sourceDirectory, `sound.${extension}`),
    ]);
  }
  const cover = join(root, "album-cover.jpg");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-i",
    join(sourceDirectory, "image.bmp"),
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    cover,
  ]);
  for (const extension of ["mp3", "flac"]) {
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-nostdin",
      "-i",
      join(sourceDirectory, `sound.${extension}`),
      "-i",
      cover,
      "-map",
      "0:a:0",
      "-map",
      "1:v:0",
      "-c",
      "copy",
      "-disposition:v:0",
      "attached_pic",
      "-y",
      join(sourceDirectory, `covered.${extension}`),
    ]);
  }
  const application = await OpenFilmApplication.create(
    projectDirectory,
    "Preview formats",
  );
  try {
    const result = await application.importFolder(sourceDirectory);
    expect(result.failed, JSON.stringify(result.job.errors)).toBe(0);
    expect(result.imported).toBe(imageFormats.length + audioFormats.length + 2);
    assets = application.catalog.listAssets();
    for (const asset of assets)
      sourceHashes.set(asset.id, await hashFile(fileURLToPath(asset.uri)));

    // Route fixture only: HEIC decoding depends on the installed FFmpeg build.
    // A previously decoded HEIC must use its cached JPEG, never raw HEVC bytes.
    const image = assets.find((asset) => asset.name === "image.tiff")!;
    const heicSource = join(sourceDirectory, "catalog-only.heic");
    await writeFile(heicSource, "undecoded HEIC route fixture");
    application.catalog.upsertAsset({
      ...image,
      id: "cached-heic",
      name: "catalog-only.heic",
      uri: pathToFileURL(heicSource).href,
      codec: "hevc",
      contentHash: await hashFile(heicSource),
    });
    application.catalog.upsertAsset({
      ...image,
      id: "unsupported-source",
      name: "unknown.custom",
      uri: pathToFileURL(join(sourceDirectory, "unknown.custom")).href,
      mediaType: "video",
      metadata: {},
    });
  } finally {
    application.close();
  }
  runtime = await startServer({ port: 0, project: projectDirectory });
});
afterAll(async () => {
  await runtime?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

const sourceUrl = (id: string) =>
  `http://127.0.0.1:${runtime.port}/api/source/${id}`;

describe("browser source previews for accepted media formats", () => {
  it.each(imageFormats)(
    "previews .%s with %s and leaves the source unchanged",
    async (extension, mime, derived) => {
      const asset = assets.find((item) => item.name === `image.${extension}`)!;
      const response = await fetch(sourceUrl(asset.id));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(mime);
      const served = Buffer.from(await response.arrayBuffer());
      const expected = derived
        ? await readFile(join(projectDirectory, asset.thumbnailUri!))
        : await readFile(new URL(asset.uri));
      expect(served).toEqual(expected);
      expect(served.length).toBeGreaterThan(40);
      if (derived)
        expect(served.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(await hashFile(join(sourceDirectory, asset.name))).toBe(
        sourceHashes.get(asset.id),
      );
    },
  );

  it.each(audioFormats)(
    "previews real .%s (%s) through a browser-compatible MP3 cache",
    async (extension) => {
      const asset = assets.find((item) => item.name === `sound.${extension}`)!;
      expect(asset.proxyUri).toMatch(/^cache\/proxies\/.+\.mp3$/);
      const response = await fetch(sourceUrl(asset.id));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/mpeg");
      const proxy = join(projectDirectory, asset.proxyUri!);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        await readFile(proxy),
      );
      const probe = JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-show_streams",
            "-of",
            "json",
            proxy,
          ])
        ).stdout.toString(),
      );
      expect(probe.streams[0].codec_name).toBe("mp3");
      // Container durations include AAC/MP3 encoder delay and frame padding.
      expect(
        Math.abs(Number(probe.streams[0].duration) - asset.duration!),
      ).toBeLessThan(0.06);
      expect(await hashFile(join(sourceDirectory, asset.name))).toBe(
        sourceHashes.get(asset.id),
      );
    },
  );

  it.each(["mp3", "flac"])(
    "keeps an actual .%s file with embedded album art classified and previewed as audio",
    async (extension) => {
      const asset = assets.find(
        (item) => item.name === `covered.${extension}`,
      )!;
      const probe = asset.metadata["openfilm.ffprobe"] as {
        streams: Array<{
          codec_type: string;
          disposition?: { attached_pic?: number };
        }>;
      };
      expect(
        probe.streams.some(
          (stream) =>
            stream.codec_type === "video" &&
            stream.disposition?.attached_pic === 1,
        ),
      ).toBe(true);
      expect(asset.mediaType).toBe("audio");
      expect(asset.thumbnailUri).toBeUndefined();
      expect(asset.proxyUri).toMatch(/\.mp3$/);
      const response = await fetch(sourceUrl(asset.id));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/mpeg");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        await readFile(join(projectDirectory, asset.proxyUri!)),
      );
      expect(await hashFile(fileURLToPath(asset.uri))).toBe(
        sourceHashes.get(asset.id),
      );
    },
  );

  it("serves the cached JPEG of a catalog HEIC without applying the raw-HEVC video guard", async () => {
    const response = await fetch(sourceUrl("cached-heic"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 2)).toEqual(
      Buffer.from([0xff, 0xd8]),
    );
  });

  it("gives a recovery action for an unsupported direct source format", async () => {
    const response = await fetch(sourceUrl("unsupported-source"));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(
        /compatible preview.*Import it again.*JPEG, MP4 or MP3/,
      ),
    });
  });

  it("supports byte ranges and gives an actionable error if an audio preview cache disappears", async () => {
    const asset = assets.find((item) => item.name === "sound.aac")!;
    const proxy = join(projectDirectory, asset.proxyUri!);
    const response = await fetch(sourceUrl(asset.id), {
      headers: { Range: "bytes=2-31" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      (await readFile(proxy)).subarray(2, 32),
    );
    const moved = `${proxy}.temporary`;
    await rename(proxy, moved);
    try {
      const missing = await fetch(sourceUrl(asset.id));
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({
        error: expect.stringMatching(/preview proxy missing.*rebuild/i),
      });
    } finally {
      await rename(moved, proxy);
    }
  });

  it("recovers generated audio cache paths after a project moves, including legacy absolute URIs", async () => {
    const asset = assets.find((item) => item.name === "sound.flac")!;
    const originalCache = join(projectDirectory, asset.proxyUri!);
    expect(
      portableCacheUri(asset, pathToFileURL(originalCache).href, "proxies"),
    ).toBe(asset.proxyUri);
    await runtime.close();
    const app = await OpenFilmApplication.open(projectDirectory);
    app.catalog.upsertAsset({
      ...asset,
      proxyUri: pathToFileURL(originalCache).href,
    });
    app.close();
    const movedProject = join(root, "moved-film.openfilm");
    await rename(projectDirectory, movedProject);
    projectDirectory = movedProject;
    runtime = await startServer({ port: 0, project: movedProject });
    const response = await fetch(sourceUrl(asset.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
  });

  it("rebuilds legacy audio imports without previews and keeps complete imports idempotent", async () => {
    const legacyFolder = join(root, "legacy-audio");
    await mkdir(legacyFolder);
    await copyFile(
      join(sourceDirectory, "sound.opus"),
      join(legacyFolder, "legacy.opus"),
    );
    const app = await OpenFilmApplication.create(
      join(root, "legacy.openfilm"),
      "Legacy audio",
    );
    try {
      expect(
        (await app.importFolder(legacyFolder, { proxies: false })).imported,
      ).toBe(1);
      expect(app.catalog.listAssets()[0]!.proxyUri).toBeUndefined();
      expect((await app.importFolder(legacyFolder)).imported).toBe(1);
      expect(app.catalog.listAssets()[0]!.proxyUri).toMatch(/\.mp3$/);
      const asset = app.catalog.listAssets()[0]!;
      delete asset.proxyUri;
      app.catalog.upsertAsset(asset);
      expect((await app.importFolder(legacyFolder)).imported).toBe(1);
      expect(app.catalog.listAssets()[0]!.proxyUri).toMatch(/\.mp3$/);
      expect((await app.importFolder(legacyFolder)).skipped).toBe(1);
    } finally {
      app.close();
    }
  });
});
