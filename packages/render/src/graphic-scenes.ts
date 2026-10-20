// Modified by OpenFilm contributors on 2026-10-19. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { open, readFile, stat, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ApplicationError,
  type ApplicationErrorCode,
  GRAPHIC_SCENE_LIMITS as limits,
  evaluateGraphicSceneAtTime,
  evaluatePhotoDepthAtTime,
  graphicSceneAssetIds,
  validateGraphicScenes,
  type Composition,
  type EvaluatedGraphicNode,
  type GraphicNode,
  type GraphicScene,
  type GraphicImageNode,
  type MediaAsset,
  type PhotoDepthParallaxRecipe,
  type TitleStyle,
} from "@openfilm/core";
import { checkAbort, hashFile, localPath, runProcess } from "@openfilm/media";
import { createTitleOverlay } from "./titles.js";
import type { RenderFontEvidence } from "./manifest.js";
import type { RenderSettings } from "./index.js";

const nativeRequire = createRequire(import.meta.url);
const numeric = (value: number) => String(Number(value.toFixed(8)));
function fail(message: string, resource = false): never {
  throw new ApplicationError(
    resource ? "graphics.resourceLimit" : "graphics.unavailable",
    message,
    422,
  );
}
export function graphicFrameRanges(
  composition: Composition,
  settings: RenderSettings,
) {
  const scenes = validateGraphicScenes(
    composition.graphicScenes ?? [],
    composition.duration,
  );
  if (!scenes.length) return [];
  const pixels = settings.width * settings.height;
  if (
    ![settings.width, settings.height].every(
      (n) => Number.isInteger(n) && n > 0,
    ) ||
    pixels > limits.pixels ||
    !Number.isFinite(settings.frameRate) ||
    settings.frameRate <= 0 ||
    settings.frameRate > 60
  )
    fail("Graphic output exceeds the supported frame budget.", true);
  const complete = Math.floor(composition.duration * settings.frameRate + 1e-7);
  const ranges = scenes.map((scene) => ({
    scene,
    start: Math.ceil(scene.start * settings.frameRate - 1e-9),
    end: Math.min(
      complete,
      Math.ceil((scene.start + scene.duration) * settings.frameRate - 1e-9),
    ),
  }));
  const frames = ranges.reduce(
    (sum, range) => sum + Math.max(0, range.end - range.start),
    0,
  );
  if (frames > limits.frames || frames * pixels > limits.framePixels)
    fail("Graphic scenes exceed the supported frame work budget.", true);
  return ranges.sort((a, b) => a.scene.zIndex - b.scene.zIndex);
}

/** Admit only named still-image codecs; project bytes never become SVG markup. */
function format(bytes: Buffer): string {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    if (
      bytes.length < 24 ||
      bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > limits.sourcePixels
    )
      fail("Graphic image exceeds the pixel limit.", true);
    for (let cursor = 8; cursor + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(cursor);
      if (bytes.toString("ascii", cursor + 4, cursor + 8) === "acTL")
        fail("Animated graphic images are unsupported.");
      cursor += length + 12;
    }
    return "png_pipe";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg_pipe";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    for (let cursor = 12; cursor + 8 <= bytes.length;) {
      const type = bytes.toString("ascii", cursor, cursor + 4);
      if (type === "ANIM" || type === "ANMF")
        fail("Animated graphic images are unsupported.");
      const length = bytes.readUInt32LE(cursor + 4);
      cursor += 8 + length + (length % 2);
    }
    return "webp_pipe";
  }
  return fail("Graphic images must contain local PNG, JPEG or WebP bytes.");
}

async function readSourceBytes(path: string, size: number): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile())
      fail("Graphic source must be a regular file.");
    const buffer = Buffer.alloc(Math.min(size, limits.sourceBytes) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > size || length > limits.sourceBytes)
      fail("Graphic source changed or exceeds its byte budget.", true);
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}

export interface PreparedGraphicScenes {
  ranges: ReturnType<typeof graphicFrameRanges>;
  fonts: RenderFontEvidence[];
  warnings: string[];
  sources: { assetId: string; sha256: string }[];
  photoDepthFindings: {
    sceneId: string;
    nodeId: string;
    significantTransparentHoles: boolean;
  }[];
  frame(sceneId: string | null, outputFrame: number): Promise<Buffer>;
  verifySources(): Promise<void>;
  assertSourceIdentities(): Promise<void>;
}

/** Shared byte/codec admission for rendering and measurable Visual QA findings. */
export async function inspectGraphicImage(
  asset: MediaAsset,
  work: string,
  options: { signal?: AbortSignal; typedSourceHashMismatch?: boolean } = {},
) {
  checkAbort(options.signal);
  if (asset.mediaType !== "image" || !asset.uri.startsWith("file:"))
    fail("Graphic images require a local catalog still image.");
  const sourcePath = localPath(asset.uri);
  const path = join(work, `graphic-source-${randomUUID()}.image`);
  try {
    const info = await stat(sourcePath);
    if (!info.isFile() || info.size > limits.sourceBytes)
      fail("Graphic image exceeds its source byte limit.", true);
    const bytes = await readSourceBytes(sourcePath, info.size);
    const imageFormat = format(bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (asset.contentHash && sha256 !== asset.contentHash) {
      if (options.typedSourceHashMismatch)
        photoDepthFailure(
          "graphics.sourceChanged",
          "PhotoDepth source changed; restore or relink its local source.",
        );
      fail("Graphic image changed; restore or relink its source.");
    }
    // Probe/decode only the exact admitted bytes, never a subsequently replaced input.
    await writeFile(path, bytes, { mode: 0o600 });
    const probe = await runProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-f",
        imageFormat,
        "-show_entries",
        "stream=width,height,codec_name",
        "-of",
        "json",
        path,
      ],
      { signal: options.signal, timeoutMs: 15000 },
    );
    const streams = JSON.parse(probe.stdout.toString()).streams as Array<{
      width?: number;
      height?: number;
      codec_name?: string;
      pix_fmt?: string;
    }>;
    const image = streams?.[0];
    if (
      !image?.width ||
      !image.height ||
      image.width * image.height > limits.sourcePixels ||
      !["png", "mjpeg", "webp"].includes(image.codec_name ?? "")
    )
      fail(
        "Graphic image exceeds the decoded budget or uses an unsupported codec.",
        true,
      );
    checkAbort(options.signal);
    return {
      path,
      sourcePath,
      format: imageFormat,
      sha256,
      byteLength: bytes.length,
      width: image.width,
      height: image.height,
      pixelFormat: image.pix_fmt ?? "",
    };
  } catch (error) {
    await rm(path, { force: true });
    checkAbort(options.signal);
    if (error instanceof ApplicationError) throw error;
    return fail(
      "Graphic image source is unavailable, malformed or unsupported.",
    );
  }
}

function photoDepthFailure(code: ApplicationErrorCode, message: string): never {
  throw new ApplicationError(code, message, 422);
}

interface MatteBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  significantTransparentHoles: boolean;
}

async function inspectPhotoDepthMask(
  mask: Awaited<ReturnType<typeof inspectGraphicImage>>,
  source: Awaited<ReturnType<typeof inspectGraphicImage>>,
  signal?: AbortSignal,
): Promise<MatteBounds> {
  if (mask.format !== "png_pipe")
    photoDepthFailure(
      "graphics.maskInvalid",
      "PhotoDepth foreground mattes must be PNG images.",
    );
  if (mask.width !== source.width || mask.height !== source.height)
    photoDepthFailure(
      "graphics.maskMismatch",
      "PhotoDepth mask dimensions must match the original photo.",
    );
  const pixels = mask.width * mask.height;
  if (pixels > limits.photoMaskPixels)
    photoDepthFailure(
      "graphics.resourceLimit",
      "PhotoDepth mask exceeds the decoded pixel budget.",
    );
  const decoded = await runProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-f",
      mask.format,
      "-noautorotate",
      "-i",
      mask.path,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "pipe:1",
    ],
    { signal, timeoutMs: 15000, maxOutputBytes: pixels * 4 },
  );
  if (decoded.stdout.byteLength !== pixels * 4)
    photoDepthFailure(
      "graphics.maskInvalid",
      "PhotoDepth mask could not be decoded at its admitted dimensions.",
    );
  let left = mask.width;
  let top = mask.height;
  let right = -1;
  let bottom = -1;
  let transparent = 0;
  let opaque = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    const alpha = decoded.stdout[pixel * 4 + 3]!;
    if (alpha === 0) transparent++;
    if (alpha >= 192) opaque++;
    if (alpha > 0) {
      const x = pixel % mask.width;
      const y = Math.floor(pixel / mask.width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top)
    photoDepthFailure(
      "graphics.maskEmpty",
      "PhotoDepth mask contains no visible foreground pixels.",
    );
  if (!transparent || !opaque)
    photoDepthFailure(
      "graphics.maskInvalid",
      "PhotoDepth mask needs both transparent background and opaque subject pixels.",
    );
  const gridWidth = Math.min(mask.width, 512);
  const gridHeight = Math.min(mask.height, 512);
  const gridPixels = gridWidth * gridHeight;
  const foreground = new Uint8Array(gridPixels);
  for (let y = 0; y < gridHeight; y++) {
    const sourceY = Math.min(
      mask.height - 1,
      Math.floor(((y + 0.5) * mask.height) / gridHeight),
    );
    for (let x = 0; x < gridWidth; x++) {
      const sourceX = Math.min(
        mask.width - 1,
        Math.floor(((x + 0.5) * mask.width) / gridWidth),
      );
      foreground[y * gridWidth + x] =
        decoded.stdout[(sourceY * mask.width + sourceX) * 4 + 3]! >= 192
          ? 1
          : 0;
    }
  }
  const visited = new Uint8Array(gridPixels);
  const queue = new Uint32Array(gridPixels);
  const significantHoleThreshold = Math.max(16, Math.ceil(gridPixels * 0.002));
  let significantTransparentHoles = false;
  for (
    let start = 0;
    start < gridPixels && !significantTransparentHoles;
    start++
  ) {
    if (foreground[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let touchesEdge = false;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % gridWidth;
      const y = Math.floor(index / gridWidth);
      if (x === 0 || y === 0 || x === gridWidth - 1 || y === gridHeight - 1)
        touchesEdge = true;
      for (const neighbor of [
        x > 0 ? index - 1 : -1,
        x + 1 < gridWidth ? index + 1 : -1,
        y > 0 ? index - gridWidth : -1,
        y + 1 < gridHeight ? index + gridWidth : -1,
      ]) {
        if (neighbor < 0 || foreground[neighbor] || visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (!touchesEdge && tail >= significantHoleThreshold)
      significantTransparentHoles = true;
  }
  return {
    left: left / mask.width,
    top: top / mask.height,
    right: (right + 1) / mask.width,
    bottom: (bottom + 1) / mask.height,
    significantTransparentHoles,
  };
}

function assertProtectedRegion(
  scene: GraphicScene,
  recipe: PhotoDepthParallaxRecipe,
  node: GraphicImageNode,
  source: { width: number; height: number },
  settings: RenderSettings,
): void {
  const region = recipe.protectedRegion;
  const sourceAspect = source.width / source.height;
  const nodeAspect = node.width / node.height;
  const contentWidth =
    sourceAspect > nodeAspect ? node.width : node.height * sourceAspect;
  const contentHeight =
    sourceAspect > nodeAspect ? node.width / sourceAspect : node.height;
  const contentLeft = -node.width / 2 + (node.width - contentWidth) / 2;
  const contentTop = -node.height / 2 + (node.height - contentHeight) / 2;
  const protectedLeft = contentLeft + region.x * contentWidth;
  const protectedRight = contentLeft + (region.x + region.width) * contentWidth;
  const protectedTop = contentTop + region.y * contentHeight;
  const protectedBottom =
    contentTop + (region.y + region.height) * contentHeight;
  const backgroundBaseLeft =
    recipe.background.kind === "source" ? contentLeft : -node.width / 2;
  const backgroundBaseRight =
    recipe.background.kind === "source"
      ? contentLeft + contentWidth
      : node.width / 2;
  const backgroundBaseTop =
    recipe.background.kind === "source" ? contentTop : -node.height / 2;
  const backgroundBaseBottom =
    recipe.background.kind === "source"
      ? contentTop + contentHeight
      : node.height / 2;
  const frames = Math.ceil(recipe.duration * settings.frameRate);
  for (let frame = 0; frame <= frames; frame++) {
    const time =
      scene.start +
      node.start +
      Math.min(recipe.duration - 1e-9, frame / settings.frameRate);
    const motion = evaluatePhotoDepthAtTime(scene, time);
    if (!motion) continue;
    const left =
      settings.width / 2 +
      node.x +
      motion.foreground.x * settings.width +
      protectedLeft * motion.foreground.scale;
    const right =
      settings.width / 2 +
      node.x +
      motion.foreground.x * settings.width +
      protectedRight * motion.foreground.scale;
    const top =
      settings.height / 2 +
      node.y +
      motion.foreground.y * settings.height +
      protectedTop * motion.foreground.scale;
    const bottom =
      settings.height / 2 +
      node.y +
      motion.foreground.y * settings.height +
      protectedBottom * motion.foreground.scale;
    if (
      left < -0.5 ||
      top < -0.5 ||
      right > settings.width + 0.5 ||
      bottom > settings.height + 0.5
    )
      photoDepthFailure(
        "graphics.protectedRegion",
        "PhotoDepth motion would crop the protected subject region.",
      );
    const backgroundLeft =
      settings.width / 2 +
      node.x +
      motion.background.x * settings.width +
      backgroundBaseLeft * motion.background.scale;
    const backgroundRight =
      settings.width / 2 +
      node.x +
      motion.background.x * settings.width +
      backgroundBaseRight * motion.background.scale;
    const backgroundTop =
      settings.height / 2 +
      node.y +
      motion.background.y * settings.height +
      backgroundBaseTop * motion.background.scale;
    const backgroundBottom =
      settings.height / 2 +
      node.y +
      motion.background.y * settings.height +
      backgroundBaseBottom * motion.background.scale;
    if (
      left < backgroundLeft - 0.5 ||
      right > backgroundRight + 0.5 ||
      top < backgroundTop - 0.5 ||
      bottom > backgroundBottom + 0.5
    )
      photoDepthFailure(
        "graphics.protectedRegion",
        "PhotoDepth background fill cannot cover the protected subject region during motion.",
      );
  }
}

function assertMatteProtectedRegion(
  recipe: PhotoDepthParallaxRecipe,
  matte: MatteBounds,
  width: number,
  height: number,
): void {
  const region = recipe.protectedRegion;
  const toleranceX = 1 / width;
  const toleranceY = 1 / height;
  if (
    matte.left < region.x - toleranceX ||
    matte.top < region.y - toleranceY ||
    matte.right > region.x + region.width + toleranceX ||
    matte.bottom > region.y + region.height + toleranceY
  )
    photoDepthFailure(
      "graphics.protectedRegion",
      "The protected region must contain the full foreground mask.",
    );
}

/** One pure evaluator and raster producer for Monitor and output, never project code. */
export async function prepareGraphicScenes(
  composition: Composition,
  assets: readonly MediaAsset[],
  settings: RenderSettings,
  work: string,
  options: {
    signal?: AbortSignal;
    fontPathForStyle?: (style: TitleStyle | undefined) => string | undefined;
  } = {},
): Promise<PreparedGraphicScenes> {
  // Validate before copying: do not invoke accessors in a caller's scene object.
  const ranges = graphicFrameRanges(composition, settings);
  composition = structuredClone(composition);
  settings = { ...settings };
  const assetMap = new Map(
    assets.map((asset) => [asset.id, structuredClone(asset)]),
  );
  const fonts: RenderFontEvidence[] = [];
  const warnings: string[] = [];
  const sources: Array<{ assetId: string; path: string; hash: string }> = [];
  const textures = new Map<string, string>();
  const photoDepthTextures = new Map<
    string,
    { foreground: string; background: string }
  >();
  const photoDepthFindings: PreparedGraphicScenes["photoDepthFindings"] = [];
  let texturePixels = 0;
  let textureBytes = 0;
  let index = 0;
  let sourceBytes = 0;
  const admitted = new Map<
    string,
    Awaited<ReturnType<typeof inspectGraphicImage>>
  >();
  const photoDepthSourceIds = new Set<string>();
  for (const { scene } of ranges) {
    const recipe = scene.photoDepth;
    if (!recipe) continue;
    photoDepthSourceIds.add(recipe.sourceAssetId);
    if (recipe.mode === "parallax") {
      photoDepthSourceIds.add(recipe.maskAssetId);
      if (recipe.background.kind === "asset")
        photoDepthSourceIds.add(recipe.background.assetId);
    }
  }
  const textureCost = (nodes: readonly GraphicNode[]): number =>
    nodes.reduce(
      (sum, node) =>
        sum +
        (node.type === "group"
          ? textureCost(node.children)
          : node.type === "shape"
            ? 0
            : Math.ceil(node.width) * Math.ceil(node.height)),
      0,
    );
  const depthTextureCost = (scene: GraphicScene) => {
    const recipe = scene.photoDepth;
    if (recipe?.mode !== "parallax") return 0;
    const image = scene.nodes.find(
      (node): node is Extract<GraphicNode, { type: "image" }> =>
        node.id === recipe.nodeId && node.type === "image",
    );
    if (!image) return 0;
    return (
      Math.ceil(image.width) *
      Math.ceil(image.height) *
      (recipe.background?.kind === "asset" ? 2 : 1)
    );
  };
  if (
    ranges.reduce(
      (sum, range) =>
        sum + textureCost(range.scene.nodes) + depthTextureCost(range.scene),
      0,
    ) > limits.texturePixels
  )
    fail("Graphic textures exceed the pixel budget.", true);

  for (const id of graphicSceneAssetIds(composition.graphicScenes ?? [])) {
    checkAbort(options.signal);
    const asset = assetMap.get(id);
    if (!asset) {
      const missingMask = ranges.some(
        ({ scene }) =>
          scene.photoDepth?.mode === "parallax" &&
          scene.photoDepth.maskAssetId === id,
      );
      const missingBackground = ranges.some(
        ({ scene }) =>
          scene.photoDepth?.mode === "parallax" &&
          scene.photoDepth.background.kind === "asset" &&
          scene.photoDepth.background.assetId === id,
      );
      if (missingMask)
        photoDepthFailure(
          "graphics.maskMissing",
          "PhotoDepth foreground mask is unavailable in the local catalog.",
        );
      if (missingBackground)
        photoDepthFailure(
          "graphics.backgroundMissing",
          "PhotoDepth background fill is unavailable in the local catalog.",
        );
      fail("Graphic image is unavailable in the local catalog.");
    }
    const image = await inspectGraphicImage(asset, work, {
      signal: options.signal,
      typedSourceHashMismatch: photoDepthSourceIds.has(id),
    });
    sourceBytes += image.byteLength;
    if (sourceBytes > limits.sourceBytes * 2)
      fail("Graphic sources exceed the combined byte budget.", true);
    admitted.set(id, image);
    sources.push({ assetId: id, path: image.sourcePath, hash: image.sha256 });
  }
  for (const { scene } of ranges) {
    const recipe = scene.photoDepth;
    if (!recipe) continue;
    const source = admitted.get(recipe.sourceAssetId);
    if (!source || source.sha256 !== recipe.sourceSha256)
      photoDepthFailure(
        "graphics.sourceChanged",
        "PhotoDepth original photo hash no longer matches its saved recipe.",
      );
    if (recipe.mode === "fallback") continue;
    const imageNode = scene.nodes.find(
      (node): node is GraphicImageNode =>
        node.id === recipe.nodeId && node.type === "image",
    );
    const mask = admitted.get(recipe.maskAssetId!);
    if (!imageNode || !mask)
      photoDepthFailure(
        "graphics.maskMissing",
        "PhotoDepth source or foreground mask is unavailable.",
      );
    if (mask.sha256 !== recipe.maskSha256)
      photoDepthFailure(
        "graphics.sourceChanged",
        "PhotoDepth mask hash no longer matches its saved recipe.",
      );
    const matte = await inspectPhotoDepthMask(mask, source, options.signal);
    photoDepthFindings.push({
      sceneId: scene.id,
      nodeId: recipe.nodeId,
      significantTransparentHoles: matte.significantTransparentHoles,
    });
    if (matte.significantTransparentHoles)
      warnings.push(
        "PhotoDepth mask contains a significant enclosed transparent region; review mask edges manually.",
      );
    assertMatteProtectedRegion(recipe, matte, mask.width, mask.height);
    if (recipe.background?.kind === "asset") {
      const background = admitted.get(recipe.background.assetId);
      if (!background || background.sha256 !== recipe.background.sha256)
        photoDepthFailure(
          "graphics.sourceChanged",
          "PhotoDepth background hash no longer matches its saved recipe.",
        );
    }
    assertProtectedRegion(scene, recipe, imageNode, source, settings);
  }
  const visit = async (
    scene: GraphicScene,
    nodes: GraphicNode[],
  ): Promise<void> => {
    const sceneId = scene.id;
    for (const node of nodes) {
      checkAbort(options.signal);
      if (node.type === "group") {
        await visit(scene, node.children);
        continue;
      }
      if (node.type === "shape") continue;
      const width = Math.ceil(node.width),
        height = Math.ceil(node.height);
      texturePixels += width * height;
      if (texturePixels > limits.texturePixels)
        fail("Graphic textures exceed the pixel budget.", true);
      const path = join(work, `graphic-texture-${index++}.png`);
      if (node.type === "text") {
        const style: TitleStyle = {
          version: 1,
          role: "scene-statement",
          fontSize: node.fontSize,
          fontFamily: node.fontFamily,
          fontWeight: node.fontWeight,
          background: "none",
          position: "center",
          maxWidth: width,
          safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
        };
        const title = await createTitleOverlay(
          node.text,
          style,
          { width, height },
          path,
          { fontPath: options.fontPathForStyle?.(style) },
        );
        fonts.push({
          family: title.font.family,
          postscriptName: title.font.postscriptName,
          sha256: title.font.sha256,
        });
        warnings.push(...title.warnings);
      } else {
        const image = admitted.get(node.assetId)!;
        const recipe =
          node.type === "image" &&
          scene.photoDepth?.mode === "parallax" &&
          scene.photoDepth.nodeId === node.id
            ? scene.photoDepth
            : undefined;
        await runProcess(
          "ffmpeg",
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-max_pixels",
            String(limits.sourcePixels),
            ...(recipe ? ["-noautorotate"] : []),
            "-f",
            image.format,
            "-i",
            image.path,
            "-vf",
            `scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgba,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
            "-frames:v",
            "1",
            "-threads",
            "1",
            "-y",
            path,
          ],
          { signal: options.signal, timeoutMs: 15000 },
        );
      }
      const bytes = await readFile(path);
      textureBytes += bytes.length;
      if (textureBytes > limits.textureBytes)
        fail("Graphic textures exceed the byte budget.", true);
      textures.set(`${sceneId}/${node.id}`, bytes.toString("base64"));
      const recipe =
        node.type === "image" &&
        scene.photoDepth?.mode === "parallax" &&
        scene.photoDepth.nodeId === node.id
          ? scene.photoDepth
          : undefined;
      if (recipe) {
        const area = width * height;
        texturePixels += area * (recipe.background?.kind === "asset" ? 2 : 1);
        if (texturePixels > limits.texturePixels)
          fail("PhotoDepth layers exceed the texture pixel budget.", true);
        const original = admitted.get(recipe.sourceAssetId)!;
        const mask = admitted.get(recipe.maskAssetId!)!;
        const foregroundPath = join(
          work,
          `photo-depth-foreground-${index++}.png`,
        );
        await runProcess(
          "ffmpeg",
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-max_pixels",
            String(limits.photoMaskPixels),
            "-noautorotate",
            "-f",
            original.format,
            "-i",
            original.path,
            "-noautorotate",
            "-f",
            mask.format,
            "-i",
            mask.path,
            "-filter_complex",
            `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgba,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,split[source][sourceAlpha];[sourceAlpha]alphaextract[sourceMatte];[1:v]format=rgba,alphaextract,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black[matte];[sourceMatte][matte]blend=all_mode=multiply[alpha];[source][alpha]alphamerge[foreground]`,
            "-map",
            "[foreground]",
            "-frames:v",
            "1",
            "-threads",
            "1",
            "-y",
            foregroundPath,
          ],
          { signal: options.signal, timeoutMs: 30000 },
        );
        const foreground = await readFile(foregroundPath);
        textureBytes += foreground.length;
        if (textureBytes > limits.textureBytes)
          fail("PhotoDepth textures exceed the byte budget.", true);
        let background = bytes;
        if (recipe.background?.kind === "asset") {
          const backgroundAsset = admitted.get(recipe.background.assetId)!;
          const backgroundPath = join(
            work,
            `photo-depth-background-${index++}.png`,
          );
          await runProcess(
            "ffmpeg",
            [
              "-v",
              "error",
              "-protocol_whitelist",
              "file,pipe",
              "-max_pixels",
              String(limits.sourcePixels),
              "-f",
              backgroundAsset.format,
              "-i",
              backgroundAsset.path,
              "-vf",
              `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=rgba`,
              "-frames:v",
              "1",
              "-threads",
              "1",
              "-y",
              backgroundPath,
            ],
            { signal: options.signal, timeoutMs: 15000 },
          );
          background = await readFile(backgroundPath);
          textureBytes += background.length;
          if (textureBytes > limits.textureBytes)
            fail("PhotoDepth textures exceed the byte budget.", true);
        }
        photoDepthTextures.set(`${sceneId}/${node.id}`, {
          foreground: foreground.toString("base64"),
          background: background.toString("base64"),
        });
      }
    }
  };
  for (const { scene } of ranges) await visit(scene, scene.nodes);
  const sourceIdentities = new Map<string, string>();
  const sourceIdentity = async (path: string) => {
    try {
      const info = await stat(path, { bigint: true });
      if (!info.isFile()) fail("Graphic source is unavailable.");
      return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    } catch {
      return fail("Graphic source is unavailable or changed.");
    }
  };
  const assertSourceIdentities = async () => {
    await Promise.all(
      sources.map(async (source) => {
        checkAbort(options.signal);
        if (
          (await sourceIdentity(source.path)) !==
          sourceIdentities.get(source.path)
        )
          fail("Graphic image changed while rendering.");
      }),
    );
    checkAbort(options.signal);
  };
  const verifySources = async () => {
    for (const source of sources) {
      checkAbort(options.signal);
      const before = await sourceIdentity(source.path);
      if (
        (await hashFile(source.path, options.signal)) !== source.hash ||
        (await sourceIdentity(source.path)) !== before
      )
        fail("Graphic image changed while rendering.");
      sourceIdentities.set(source.path, before);
    }
    await assertSourceIdentities();
  };
  await verifySources();
  return {
    ranges,
    fonts,
    warnings,
    sources: sources.map((source) => ({
      assetId: source.assetId,
      sha256: source.hash,
    })),
    photoDepthFindings,
    verifySources,
    assertSourceIdentities,
    async frame(sceneId, outputFrame) {
      checkAbort(options.signal);
      if (!Number.isSafeInteger(outputFrame) || outputFrame < 0)
        fail("Graphic output frame must be a nonnegative integer.");
      const selected =
        sceneId === null
          ? ranges.map((range) => range.scene)
          : ranges
              .filter((range) => range.scene.id === sceneId)
              .map((range) => range.scene);
      if (sceneId !== null && !selected.length)
        fail("Graphic scene not found.");
      const layers = selected
        .map((scene) => {
          const tree = evaluateGraphicSceneAtTime(
            scene,
            outputFrame / settings.frameRate,
          );
          const render = (node: EvaluatedGraphicNode): string => {
            if (
              node.type === "image" &&
              scene.photoDepth?.mode === "parallax" &&
              scene.photoDepth.nodeId === node.id
            ) {
              const motion = evaluatePhotoDepthAtTime(
                scene,
                outputFrame / settings.frameRate,
              );
              const layers = photoDepthTextures.get(`${scene.id}/${node.id}`);
              if (motion && layers) {
                const layer = (
                  bytes: string,
                  transform: { x: number; y: number; scale: number },
                ) =>
                  `<g transform="translate(${numeric(node.x + transform.x * settings.width)} ${numeric(node.y + transform.y * settings.height)}) rotate(${numeric(node.rotation ?? 0)}) scale(${numeric((node.width / node.baseWidth) * transform.scale)} ${numeric((node.height / node.baseHeight) * transform.scale)})"><image x="${numeric(-node.baseWidth / 2)}" y="${numeric(-node.baseHeight / 2)}" width="${numeric(node.baseWidth)}" height="${numeric(node.baseHeight)}" href="data:image/png;base64,${bytes}"/></g>`;
                return `<g opacity="${numeric(node.opacity)}">${layer(layers.background, motion.background)}${layer(layers.foreground, motion.foreground)}</g>`;
              }
            }
            const content =
              node.type === "group"
                ? (node.children ?? []).map(render).join("")
                : node.type === "shape"
                  ? node.shape === "rect"
                    ? `<rect x="${numeric(-node.baseWidth / 2)}" y="${numeric(-node.baseHeight / 2)}" width="${numeric(node.baseWidth)}" height="${numeric(node.baseHeight)}" fill="${node.fill}"/>`
                    : `<ellipse cx="0" cy="0" rx="${numeric(node.baseWidth / 2)}" ry="${numeric(node.baseHeight / 2)}" fill="${node.fill}"/>`
                  : `<image x="${numeric(-node.baseWidth / 2)}" y="${numeric(-node.baseHeight / 2)}" width="${numeric(node.baseWidth)}" height="${numeric(node.baseHeight)}" href="data:image/png;base64,${textures.get(`${scene.id}/${node.id}`)!}"/>`;
            return `<g transform="translate(${numeric(node.x)} ${numeric(node.y)}) rotate(${numeric(node.rotation ?? 0)}) scale(${numeric(node.width / node.baseWidth)} ${numeric(node.height / node.baseHeight)})" opacity="${numeric(node.opacity)}">${content}</g>`;
          };
          return tree.nodes.map(render).join("");
        })
        .join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.width}" height="${settings.height}" viewBox="0 0 ${settings.width} ${settings.height}"><g transform="translate(${settings.width / 2} ${settings.height / 2})">${layers}</g></svg>`;
      const { Resvg } = nativeRequire(
        "@resvg/resvg-js",
      ) as typeof import("@resvg/resvg-js");
      const png = Buffer.from(
        new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng(),
      );
      checkAbort(options.signal);
      return png;
    },
  };
}

export async function writeGraphicSequences(
  prepared: PreparedGraphicScenes,
  work: string,
  options: { signal?: AbortSignal } = {},
) {
  let bytes = 0;
  const sequences: Array<{ start: number; end: number; pattern: string }> = [];
  for (let index = 0; index < prepared.ranges.length; index++) {
    const { scene, start, end } = prepared.ranges[index]!;
    if (end <= start) continue;
    const pattern = join(work, `graphic-${index}-%05d.png`);
    for (let frame = start; frame < end; frame++) {
      checkAbort(options.signal);
      const png = await prepared.frame(scene.id, frame);
      bytes += png.length;
      if (bytes > limits.sequenceBytes)
        fail("Graphic image sequences exceed the byte budget.", true);
      await writeFile(
        join(
          work,
          `graphic-${index}-${String(frame - start).padStart(5, "0")}.png`,
        ),
        png,
      );
    }
    sequences.push({ start, end, pattern });
  }
  return sequences;
}
