import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { OpenFilmApplication } from "../src/index.js";

it("recovers legacy cached thumbnails and proxies after moving a project with offline sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-portable-cache-"));
  let app: OpenFilmApplication | undefined;
  try {
    const original = join(root, "original.openfilm");
    app = await OpenFilmApplication.create(original, "Moved project");
    await mkdir(join(original, "cache/thumbnails"));
    await mkdir(join(original, "cache/proxies"));
    await writeFile(
      join(original, "cache/thumbnails/video-fingerprint.jpg"),
      "cached thumbnail",
    );
    await writeFile(
      join(original, "cache/proxies/video-fingerprint.mp4"),
      "cached proxy",
    );
    app.catalog.upsertAsset({
      id: "video",
      name: "Memory",
      mediaType: "video",
      duration: 5,
      uri: pathToFileURL(join(root, "offline-disk/memory.mp4")).href,
      thumbnailUri: pathToFileURL(
        join(original, "cache/thumbnails/video-fingerprint.jpg"),
      ).href,
      proxyUri: pathToFileURL(
        join(original, "cache/proxies/video-fingerprint.mp4"),
      ).href,
      state: { locked: true },
      rating: 5,
      tags: ["important"],
      metadata: { note: "Keep this moment" },
    });
    app.close();
    app = undefined;
    const moved = join(root, "moved.openfilm");
    await rename(original, moved);
    app = await OpenFilmApplication.open(moved);
    const asset = app.catalog.getAsset("video")!;
    expect(asset).toMatchObject({
      id: "video",
      rating: 5,
      state: { locked: true },
      metadata: { note: "Keep this moment" },
    });
    expect(asset.thumbnailUri).toBe("cache/thumbnails/video-fingerprint.jpg");
    expect(asset.proxyUri).toBe("cache/proxies/video-fingerprint.mp4");
    expect(await readFile(join(moved, asset.thumbnailUri!), "utf8")).toBe(
      "cached thumbnail",
    );
    expect(await readFile(join(moved, asset.proxyUri!), "utf8")).toBe(
      "cached proxy",
    );
    app.close();
    app = undefined;
    app = await OpenFilmApplication.open(moved);
    expect(app.catalog.getAsset("video")).toEqual(asset);
  } finally {
    app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
