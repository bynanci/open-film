import { createHash, randomUUID } from "node:crypto";
import { lstat, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ApplicationError,
  GRAPHIC_SCENE_LIMITS,
  assetDisplayDimensions,
  resolvePhotoPlan,
  type Clip,
  type FrameSize,
  type MediaAsset,
} from "@openfilm/core";
import {
  checkAbort,
  hashFile,
  localMediaInputOptions,
  localPath,
  previewVideoFilters,
  runProcess,
  withVerifiedSourceFile,
} from "@openfilm/media";
import { inspectGraphicImage } from "./graphic-scenes.js";

export interface PreparedPhotoAmbientFills {
  fills: Map<string, { path: string; sha256: string }>;
  assetOverrides: Map<string, MediaAsset>;
  sources: { assetId: string; sha256: string }[];
  verifySources(): Promise<void>;
  assertSourceIdentities(): Promise<void>;
}
function fail(message: string, limit = false): never {
  throw new ApplicationError(
    limit ? "request.tooLarge" : "media.previewUnavailable",
    message,
    limit ? 413 : 422,
  );
}
/** Check before multiplying: even untrusted SAR/display values stay finite. */
function boundedArea(
  size: FrameSize | undefined,
  pixels: number,
  edge: number,
  integer = true,
): boolean {
  if (!size) return false;
  const { width, height } = size;
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= edge &&
    height <= edge &&
    (!integer ||
      (Number.isSafeInteger(width) && Number.isSafeInteger(height))) &&
    width <= pixels / height
  );
}

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Caller owns work and removes it after all consumers release the admitted copies. */
export async function preparePhotoAmbientFills(
  clips: readonly Clip[],
  assets: readonly MediaAsset[],
  frame: FrameSize,
  work: string,
  options: { signal?: AbortSignal } = {},
): Promise<PreparedPhotoAmbientFills> {
  checkAbort(options.signal);
  const fills: PreparedPhotoAmbientFills["fills"] = new Map();
  const assetOverrides = new Map<string, MediaAsset>();
  const sources: PreparedPhotoAmbientFills["sources"] = [];
  const selected = clips.filter((clip) => clip.layout?.version === 2);
  const identities: Array<{
    asset: MediaAsset;
    fingerprint: string;
    path: string;
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    sha256: string;
  }> = [];
  const assertSourceIdentities = async () => {
    checkAbort(options.signal);
    for (const pinned of identities) {
      const current = await lstat(pinned.path);
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.dev !== pinned.dev ||
        current.ino !== pinned.ino ||
        current.size !== pinned.size ||
        current.mtimeMs !== pinned.mtimeMs ||
        current.ctimeMs !== pinned.ctimeMs ||
        digest(pinned.asset) !== pinned.fingerprint
      )
        throw new ApplicationError(
          "source.changed",
          "Photo source identity changed during ambient preparation.",
          409,
        );
    }
    checkAbort(options.signal);
  };
  const verifySources = async () => {
    await assertSourceIdentities();
    for (const pinned of identities)
      if ((await hashFile(pinned.path, options.signal)) !== pinned.sha256)
        throw new ApplicationError(
          "source.changed",
          "Photo source bytes changed during ambient preparation.",
          409,
        );
    await assertSourceIdentities();
  };
  const result = {
    fills,
    assetOverrides,
    sources,
    verifySources,
    assertSourceIdentities,
  };
  if (!selected.length) return result;
  if (
    selected.length > 2000 ||
    !boundedArea(
      frame,
      GRAPHIC_SCENE_LIMITS.pixels,
      GRAPHIC_SCENE_LIMITS.dimension,
    )
  )
    fail("Ambient photo frame exceeds the pixel or clip budget.", true);
  const sourceMap = new Map(assets.map((asset) => [asset.id, asset]));
  const dimensions: Record<string, FrameSize> = Object.create(null);
  for (const clip of selected) {
    for (const id of [
      clip.assetId,
      ...(clip.layout?.secondary ? [clip.layout.secondary.assetId] : []),
    ]) {
      const asset = sourceMap.get(id);
      if (
        !asset ||
        asset.mediaType !== "image" ||
        !asset.uri.startsWith("file:")
      )
        fail("Ambient fill requires a local imported still image.");
      const display = assetDisplayDimensions(asset);
      if (
        !boundedArea(
          asset.dimensions,
          GRAPHIC_SCENE_LIMITS.sourcePixels,
          GRAPHIC_SCENE_LIMITS.sourcePixels,
        ) ||
        !boundedArea(
          display,
          GRAPHIC_SCENE_LIMITS.sourcePixels,
          GRAPHIC_SCENE_LIMITS.sourcePixels,
          false,
        )
      )
        fail(
          "Ambient photo source/display geometry exceeds the pixel budget.",
          true,
        );
      dimensions[id] = display!;
    }
  }
  // Preflight every clip before admitting any source or launching any process.
  // Keep the established centered-cover sampling exactly; unsafe recipes fail
  // explicitly instead of substituting a different crop/scale order.
  const plans = selected.map((clip) => {
    const plan = resolvePhotoPlan(clip, dimensions, frame).ambient!;
    if (
      !Number.isFinite(plan.sigma) ||
      plan.sigma < 0 ||
      plan.sigma > 0.05 * Math.min(frame.width, frame.height) ||
      !Number.isFinite(plan.dim) ||
      plan.dim < 0 ||
      plan.dim > 1
    )
      fail("Ambient photo blur exceeds the bounded preparation budget.", true);
    const geometry = plan.layers.map(({ cell, cover }) => {
      if (
        !boundedArea(
          cell,
          GRAPHIC_SCENE_LIMITS.pixels,
          GRAPHIC_SCENE_LIMITS.dimension,
        ) ||
        !Number.isSafeInteger(cell.x) ||
        !Number.isSafeInteger(cell.y) ||
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x + cell.width > frame.width ||
        cell.y + cell.height > frame.height ||
        ![cover.x, cover.y, cover.width, cover.height].every(Number.isFinite)
      )
        fail(
          "Ambient photo cell/cover geometry exceeds the preparation budget.",
          true,
        );
      const width = Math.max(cell.width, Math.round(cover.width));
      const height = Math.max(cell.height, Math.round(cover.height));
      // Existing texture byte cap applies to each RGBA scale intermediate;
      // two output edges allow bounded overhang while limiting skinny strips.
      if (
        !boundedArea(
          { width, height },
          Math.min(
            GRAPHIC_SCENE_LIMITS.texturePixels,
            GRAPHIC_SCENE_LIMITS.textureBytes / 4,
          ),
          GRAPHIC_SCENE_LIMITS.dimension * 2,
        )
      )
        fail(
          "Ambient photo scaled intermediate exceeds the pixel/byte/edge budget.",
          true,
        );
      const x = Math.max(
        0,
        Math.min(width - cell.width, Math.round(cell.x - cover.x)),
      );
      const y = Math.max(
        0,
        Math.min(height - cell.height, Math.round(cell.y - cover.y)),
      );
      if (![x, y].every(Number.isSafeInteger))
        fail("Ambient photo crop exceeds the checked geometry budget.", true);
      // Blur runs only after crop, on <= one admitted frame, with three fixed
      // recursive passes and sigma <= 5% of the bounded shorter frame edge.
      return { width, height, x, y };
    });
    return { clip, plan, geometry };
  });
  let copiedBytes = 0;
  for (const id of new Set(
    plans.flatMap(({ plan }) => plan.layers.map((layer) => layer.assetId)),
  )) {
    const asset = sourceMap.get(id);
    if (!asset || asset.mediaType !== "image" || !asset.uri.startsWith("file:"))
      fail("Ambient fill requires a local imported still image.");
    const path = localPath(asset.uri);
    const info = await lstat(path);
    copiedBytes += info.size;
    if (copiedBytes > 1024 * 1024 * 1024)
      fail("Ambient source copies exceed the byte budget.", true);
    const admitted = await withVerifiedSourceFile(
      path,
      asset.contentHash,
      async (snapshot, sha256) => {
        const copy = await inspectGraphicImage(
          { ...asset, uri: pathToFileURL(snapshot).href, contentHash: sha256 },
          work,
          { signal: options.signal },
        );
        return { ...copy, sha256 };
      },
      {
        signal: options.signal,
        temporaryRoot: work,
        maximumBytes: GRAPHIC_SCENE_LIMITS.sourceBytes,
      },
    );
    identities.push({
      asset,
      fingerprint: digest(asset),
      path,
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.ctimeMs,
      sha256: admitted.sha256,
    });
    sources.push({ assetId: id, sha256: admitted.sha256 });
    assetOverrides.set(id, {
      ...asset,
      contentHash: admitted.sha256,
      uri: pathToFileURL(admitted.path).href,
    });
  }
  const rendered = new Map<string, { path: string; sha256: string }>();
  let rasterBytes = 0;
  for (const { clip, plan, geometry } of plans) {
    checkAbort(options.signal);
    const key = digest({ plan, sources });
    const prior = rendered.get(key);
    if (prior) {
      fills.set(clip.id, prior);
      continue;
    }
    const path = join(work, `ambient-${randomUUID()}.png`);
    const args = ["-v", "error", "-nostdin", "-threads", "1"];
    const filters = [
      `color=c=black:s=${frame.width}x${frame.height}:r=1:d=1,format=rgba[base]`,
    ];
    let label = "base";
    for (const [index, layer] of plan.layers.entries()) {
      const asset = assetOverrides.get(layer.assetId)!;
      args.push(
        ...(await localMediaInputOptions(localPath(asset.uri), options.signal)),
        "-i",
        localPath(asset.uri),
      );
      const { cell } = layer;
      const { width, height, x, y } = geometry[index]!;
      const decode = await previewVideoFilters(asset, options.signal);
      filters.push(
        `[${index}:v]${[...decode, `scale=${width}:${height}:flags=bicubic`, `crop=${cell.width}:${cell.height}:${x}:${y}:exact=1`, "setsar=1", "format=rgba"].join(",")}[source${index}]`,
      );
      filters.push(
        `color=c=black:s=${cell.width}x${cell.height}:r=1:d=1,format=rgba[black${index}]`,
      );
      filters.push(
        `[black${index}][source${index}]overlay=format=rgb:shortest=1,format=gbrp,${plan.sigma ? `gblur=sigma=${plan.sigma}:steps=3,` : ""}colorchannelmixer=rr=${1 - plan.dim}:gg=${1 - plan.dim}:bb=${1 - plan.dim},format=rgb24[tile${index}]`,
      );
      filters.push(
        `[${label}][tile${index}]overlay=x=${cell.x}:y=${cell.y}:format=rgb:shortest=1[merged${index}]`,
      );
      label = `merged${index}`;
    }
    args.push(
      "-filter_complex_threads",
      "1",
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[${label}]`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-n",
      path,
    );
    await runProcess("ffmpeg", args, {
      signal: options.signal,
      timeoutMs: 30000,
      maxOutputBytes: 1024 * 1024,
    });
    const size = (await stat(path)).size;
    rasterBytes += size;
    if (size > 64 * 1024 * 1024 || rasterBytes > 256 * 1024 * 1024)
      fail("Ambient raster exceeds the byte budget.", true);
    const output = { path, sha256: await hashFile(path, options.signal) };
    rendered.set(key, output);
    fills.set(clip.id, output);
  }
  await verifySources();
  return result;
}
