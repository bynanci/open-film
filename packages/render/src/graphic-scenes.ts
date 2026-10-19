// Modified by OpenFilm contributors on 2026-10-19. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { open, readFile, stat, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ApplicationError,
  GRAPHIC_SCENE_LIMITS as limits,
  evaluateGraphicSceneAtTime,
  graphicSceneAssetIds,
  validateGraphicScenes,
  type Composition,
  type EvaluatedGraphicNode,
  type GraphicNode,
  type MediaAsset,
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
  frame(sceneId: string | null, outputFrame: number): Promise<Buffer>;
  verifySources(): Promise<void>;
  assertSourceIdentities(): Promise<void>;
}

/** Shared byte/codec admission for rendering and measurable Visual QA findings. */
export async function inspectGraphicImage(
  asset: MediaAsset,
  work: string,
  options: { signal?: AbortSignal } = {},
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
    if (asset.contentHash && sha256 !== asset.contentHash)
      fail("Graphic image changed; restore or relink its source.");
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

/** One pure evaluator and raster producer for Monitor and output, never project code. */
export async function prepareGraphicScenes(
  composition: Composition,
  assets: readonly MediaAsset[],
  settings: RenderSettings,
  work: string,
  options: { signal?: AbortSignal } = {},
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
  let texturePixels = 0;
  let textureBytes = 0;
  let index = 0;
  let sourceBytes = 0;
  const admitted = new Map<string, { path: string; format: string }>();
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
  if (
    ranges.reduce((sum, range) => sum + textureCost(range.scene.nodes), 0) >
    limits.texturePixels
  )
    fail("Graphic textures exceed the pixel budget.", true);

  for (const id of graphicSceneAssetIds(composition.graphicScenes ?? [])) {
    checkAbort(options.signal);
    const asset = assetMap.get(id);
    if (!asset) fail("Graphic image is unavailable in the local catalog.");
    const image = await inspectGraphicImage(asset, work, options);
    sourceBytes += image.byteLength;
    if (sourceBytes > limits.sourceBytes * 2)
      fail("Graphic sources exceed the combined byte budget.", true);
    admitted.set(id, { path: image.path, format: image.format });
    sources.push({ assetId: id, path: image.sourcePath, hash: image.sha256 });
  }
  const visit = async (
    sceneId: string,
    nodes: GraphicNode[],
  ): Promise<void> => {
    for (const node of nodes) {
      checkAbort(options.signal);
      if (node.type === "group") {
        await visit(sceneId, node.children);
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
        const title = await createTitleOverlay(
          node.text,
          {
            version: 1,
            role: "scene-statement",
            fontSize: node.fontSize,
            fontFamily: node.fontFamily,
            fontWeight: node.fontWeight,
            background: "none",
            position: "center",
            maxWidth: width,
            safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
          },
          { width, height },
          path,
        );
        fonts.push({
          family: title.font.family,
          postscriptName: title.font.postscriptName,
          sha256: title.font.sha256,
        });
        warnings.push(...title.warnings);
      } else {
        const image = admitted.get(node.assetId)!;
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
    }
  };
  for (const { scene } of ranges) await visit(scene.id, scene.nodes);
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
            const content =
              node.type === "group"
                ? (node.children ?? []).map(render).join("")
                : node.type === "shape"
                  ? node.shape === "rect"
                    ? `<rect x="${numeric(-node.baseWidth / 2)}" y="${numeric(-node.baseHeight / 2)}" width="${numeric(node.baseWidth)}" height="${numeric(node.baseHeight)}" fill="${node.fill}"/>`
                    : `<ellipse cx="0" cy="0" rx="${numeric(node.baseWidth / 2)}" ry="${numeric(node.baseHeight / 2)}" fill="${node.fill}"/>`
                  : `<image x="${numeric(-node.baseWidth / 2)}" y="${numeric(-node.baseHeight / 2)}" width="${numeric(node.baseWidth)}" height="${numeric(node.baseHeight)}" href="data:image/png;base64,${textures.get(`${scene.id}/${node.id}`)!}"/>`;
            return `<g transform="translate(${numeric(node.x)} ${numeric(node.y)}) scale(${numeric(node.width / node.baseWidth)} ${numeric(node.height / node.baseHeight)})" opacity="${numeric(node.opacity)}">${content}</g>`;
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
