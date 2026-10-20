import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Composition,
  GraphicImageNode,
  GraphicScene,
  MediaAsset,
} from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { FFmpegRenderer, prepareGraphicScenes } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function imageAsset(root: string, id: string, filter: string) {
  const path = join(root, `${id}.png`);
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    filter,
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-pix_fmt",
    "rgba",
    "-y",
    path,
  ]);
  return {
    ...(await inspectMedia({
      path,
      uri: pathToFileURL(path).href,
      name: `${id}.png`,
    })),
    contentHash: await hashFile(path),
  };
}

async function fixture(
  root: string,
  maskFilter = "nullsrc=s=64x48,format=rgba,geq=r='255':g='255':b='255':a='if(between(X,20,43)*between(Y,6,41),255,0)'",
  sourceFilter = "color=c=0x305070:s=64x48,drawbox=x=20:y=6:w=24:h=36:color=0xffcc22:t=fill",
  backgroundFilter = "color=c=0x176b42:s=64x48",
) {
  const original = await imageAsset(root, "source", sourceFilter);
  const mask = await imageAsset(root, "mask", maskFilter);
  const background = await imageAsset(root, "background", backgroundFilter);
  const node: GraphicImageNode = {
    id: "photo-node",
    type: "image",
    assetId: original.id,
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    opacity: 1,
    zIndex: 0,
    start: 0,
    end: 6,
  };
  const scene: GraphicScene = {
    version: 1,
    id: "photo-depth-scene",
    name: "Synthetic depth scene",
    start: 0,
    duration: 6,
    zIndex: 0,
    nodes: [node],
    photoDepth: {
      version: 1,
      id: "photo-depth-recipe",
      nodeId: node.id,
      mode: "parallax",
      duration: 6,
      sourceAssetId: original.id,
      sourceSha256: original.contentHash!,
      maskAssetId: mask.id,
      maskSha256: mask.contentHash!,
      background: {
        kind: "asset",
        assetId: background.id,
        sha256: background.contentHash!,
      },
      protectedRegion: { x: 0.3125, y: 0.125, width: 0.375, height: 0.75 },
      foregroundDepth: 1.2,
      backgroundDepth: 0.25,
      amplitude: 1,
      camera: {
        from: { x: -0.02, y: 0, scale: 1 },
        to: { x: 0.02, y: 0, scale: 1.08 },
      },
      easing: "ease-in-out",
    },
  };
  const assets = [original, mask, background] as MediaAsset[];
  const composition: Composition = {
    id: "photo-depth-film",
    storyId: "story",
    duration: 6,
    tracks: [],
    graphicScenes: [scene],
  };
  return { assets, composition };
}

describe("PhotoDepth rendering", () => {
  it("intersects source and mask alpha in Monitor pixels and the decoded FFmpeg output", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-photo-depth-alpha-"));
    roots.push(root);
    const { assets, composition } = await fixture(
      root,
      "nullsrc=s=64x48,format=rgba,geq=r='255':g='255':b='255':a='if(between(X,20,43)*between(Y,6,41),if(gte(X,36),128,255),0)'",
      "nullsrc=s=64x48,format=rgba,geq=r='255':g='255':b='255':a='if(between(X,24,27),0,if(between(X,28,39),128,255))'",
      "nullsrc=s=64x48,format=rgba,geq=r='0':g='0':b='0':a='0'",
    );
    const sourceHashes = await Promise.all(
      assets.map((asset) => hashFile(fileURLToPath(asset.uri))),
    );
    const recipe = composition.graphicScenes![0]!.photoDepth;
    if (recipe?.mode !== "parallax")
      throw new Error("Expected a parallax recipe");
    recipe.camera = {
      from: { x: 0, y: 0, scale: 1 },
      to: { x: 0, y: 0, scale: 1 },
    };
    const settings = { width: 320, height: 180, frameRate: 8 };
    const prepared = await prepareGraphicScenes(
      composition,
      assets,
      settings,
      root,
    );
    const monitor = await prepared.frame(null, 0);
    const monitorPath = join(root, "monitor-alpha.png");
    await writeFile(monitorPath, monitor);
    const monitorPixels = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        monitorPath,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "pipe:1",
      ])
    ).stdout;
    expect(monitorPixels.length).toBe(320 * 180 * 4);
    const samples = [
      { sourceX: 10, alpha: 0 },
      { sourceX: 22, alpha: 255 },
      { sourceX: 26, alpha: 0 },
      { sourceX: 32, alpha: 128 },
      { sourceX: 38, alpha: 64 },
      { sourceX: 42, alpha: 128 },
    ];
    // The 64x48 source fits into 240x180 pixels with 40px horizontal padding.
    const pixelIndex = (sourceX: number) =>
      90 * 320 + Math.floor(40 + (sourceX + 0.5) * 3.75);
    const monitorAlphas = samples.map(
      ({ sourceX }) => monitorPixels[pixelIndex(sourceX) * 4 + 3]!,
    );
    for (const [index, sample] of samples.entries())
      expect(
        Math.abs(monitorAlphas[index]! - sample.alpha),
      ).toBeLessThanOrEqual(1);

    const output = join(root, "photo-depth-alpha.mp4");
    await new FFmpegRenderer().render(composition, assets, output, settings);
    const decoded = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        output,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ])
    ).stdout;
    expect(decoded.length).toBe(320 * 180 * 3);
    const decodedRgb = samples.map(({ sourceX }) => [
      ...decoded.subarray(pixelIndex(sourceX) * 3, pixelIndex(sourceX) * 3 + 3),
    ]);
    for (const [index, sample] of samples.entries())
      for (const channel of decodedRgb[index]!)
        expect(Math.abs(channel - sample.alpha)).toBeLessThanOrEqual(8);
    const manifest = JSON.parse(
      await readFile(`${output}.manifest.json`, "utf8"),
    );
    expect(manifest.sources).toEqual(
      expect.arrayContaining(
        assets.map((asset, index) =>
          expect.objectContaining({
            assetId: asset.id,
            sha256: sourceHashes[index],
          }),
        ),
      ),
    );
    expect(
      await Promise.all(
        assets.map((asset) => hashFile(fileURLToPath(asset.uri))),
      ),
    ).toEqual(sourceHashes);
    const evidence = process.env.OPENFILM_PHOTO_DEPTH_QA_OUTPUT;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await Promise.all([
        copyFile(output, join(evidence, "photo-depth-alpha.mp4")),
        copyFile(monitorPath, join(evidence, "monitor-alpha.png")),
        copyFile(
          `${output}.manifest.json`,
          join(evidence, "photo-depth-alpha.manifest.json"),
        ),
        writeFile(
          join(evidence, "photo-depth-alpha.measurements.json"),
          JSON.stringify(
            {
              samples,
              monitorAlphas,
              decodedRgb,
              sourceHashes,
              outputSha256: await hashFile(output),
            },
            null,
            2,
          ),
        ),
      ]);
    }
  });

  it("renders arbitrary seeks with independent deterministic layers and source receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-photo-depth-"));
    roots.push(root);
    const { assets, composition } = await fixture(root);
    const before = await Promise.all(
      assets.map((asset) => hashFile(fileURLToPath(asset.uri))),
    );
    const prepared = await prepareGraphicScenes(
      composition,
      assets,
      { width: 320, height: 180, frameRate: 12 },
      root,
    );
    const start = await prepared.frame(null, 0);
    const middle = await prepared.frame(null, 36);
    const end = await prepared.frame(null, 71);
    const shuffled = await prepared.frame(null, 0);
    expect(start).not.toEqual(end);
    expect(middle).not.toEqual(start);
    expect(shuffled).toEqual(start);
    expect(prepared.sources.map(({ assetId }) => assetId).sort()).toEqual(
      assets.map(({ id }) => id).sort(),
    );
    expect(prepared.sources.map(({ sha256 }) => sha256).sort()).toEqual(
      [...before].sort(),
    );
    const after = await Promise.all(
      assets.map((asset) => hashFile(fileURLToPath(asset.uri))),
    );
    expect(after).toEqual(before);
    expect(hash(start)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("applies node opacity once to the combined foreground and background", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-photo-depth-opacity-"));
    roots.push(root);
    const { assets, composition } = await fixture(root);
    const scene = composition.graphicScenes![0]!;
    const recipe = scene.photoDepth;
    if (recipe?.mode !== "parallax")
      throw new Error("Expected a parallax recipe");
    recipe.background = { kind: "source" };
    scene.nodes[0]!.opacity = 0.5;
    const prepared = await prepareGraphicScenes(
      composition,
      assets,
      { width: 320, height: 180, frameRate: 12 },
      root,
    );
    const framePath = join(root, "opacity.png");
    await writeFile(framePath, await prepared.frame(null, 0));
    const pixels = (
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        framePath,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "pipe:1",
      ])
    ).stdout;
    expect(pixels.byteLength).toBe(320 * 180 * 4);
    const subjectAlpha = pixels[(90 * 320 + 160) * 4 + 3]!;
    expect(subjectAlpha).toBeGreaterThanOrEqual(126);
    expect(subjectAlpha).toBeLessThanOrEqual(130);
  });

  it("projects protected bounds through aspect-fit padding for safe motion and source fill", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-photo-depth-aspect-fit-"),
    );
    roots.push(root);
    const maskFilter =
      "nullsrc=s=64x48,format=rgba,geq=r='255':g='255':b='255':a='if(between(X,56,59)*between(Y,17,30),255,0)'";
    const { assets, composition } = await fixture(root, maskFilter);
    const scene = composition.graphicScenes![0]!;
    const recipe = scene.photoDepth;
    if (recipe?.mode !== "parallax")
      throw new Error("Expected a parallax recipe");
    recipe.protectedRegion = { x: 0.875, y: 0.1, width: 0.07, height: 0.8 };
    recipe.background = { kind: "source" };
    scene.nodes[0]!.x = -5;
    await expect(
      prepareGraphicScenes(
        composition,
        assets,
        { width: 320, height: 180, frameRate: 12 },
        root,
      ),
    ).rejects.toMatchObject({ code: "graphics.protectedRegion" });

    const safeRecipe = scene.photoDepth;
    if (safeRecipe?.mode !== "parallax")
      throw new Error("Expected a parallax recipe");
    safeRecipe.background = {
      kind: "asset",
      assetId: assets[2]!.id,
      sha256: assets[2]!.contentHash!,
    };
    scene.nodes[0]!.x = 0;
    scene.nodes[0]!.width = 180;
    scene.nodes[0]!.height = 320;
    safeRecipe.camera = {
      from: { x: 0, y: 0, scale: 1 },
      to: { x: 0, y: 0, scale: 1.02 },
    };
    await expect(
      prepareGraphicScenes(
        composition,
        assets,
        { width: 320, height: 180, frameRate: 12 },
        root,
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a mask whose decoded dimensions differ from its source", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-photo-depth-size-"));
    roots.push(root);
    const { assets, composition } = await fixture(
      root,
      "nullsrc=s=63x48,format=rgba,geq=r='255':g='255':b='255':a='if(between(X,20,43)*between(Y,6,41),255,0)'",
    );
    await expect(
      prepareGraphicScenes(
        composition,
        assets,
        { width: 320, height: 180, frameRate: 12 },
        root,
      ),
    ).rejects.toMatchObject({ code: "graphics.maskMismatch" });
  });

  it("rejects a fully transparent mask instead of silently animating an empty foreground", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-photo-depth-empty-"));
    roots.push(root);
    const { assets, composition } = await fixture(
      root,
      "nullsrc=s=64x48,format=rgba,geq=r='255':g='255':b='255':a='0'",
    );
    await expect(
      prepareGraphicScenes(
        composition,
        assets,
        { width: 320, height: 180, frameRate: 12 },
        root,
      ),
    ).rejects.toMatchObject({ code: "graphics.maskEmpty" });
  });

  it("surfaces typed missing/hash/protected-region errors and cancels stale frame work", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-photo-depth-fences-"));
    roots.push(root);
    const { assets, composition } = await fixture(root);
    const settings = { width: 320, height: 180, frameRate: 12 };
    const recipe = composition.graphicScenes![0]!.photoDepth;
    if (recipe?.mode !== "parallax")
      throw new Error("Expected parallax recipe");
    if (recipe.background.kind !== "asset")
      throw new Error("Expected asset background recipe");
    const backgroundAssetId = recipe.background.assetId;
    await expect(
      prepareGraphicScenes(
        composition,
        assets.filter((asset) => asset.id !== recipe.maskAssetId),
        settings,
        root,
      ),
    ).rejects.toMatchObject({ code: "graphics.maskMissing" });

    await expect(
      prepareGraphicScenes(
        composition,
        assets.filter((asset) => asset.id !== backgroundAssetId),
        settings,
        root,
      ),
    ).rejects.toMatchObject({ code: "graphics.backgroundMissing" });

    const wrongMaskHash = structuredClone(composition);
    const wrongMaskRecipe = wrongMaskHash.graphicScenes![0]!.photoDepth;
    if (wrongMaskRecipe?.mode !== "parallax")
      throw new Error("Expected parallax recipe");
    wrongMaskRecipe.maskSha256 = "d".repeat(64);
    await expect(
      prepareGraphicScenes(wrongMaskHash, assets, settings, root),
    ).rejects.toMatchObject({ code: "graphics.sourceChanged" });

    const wrongBackgroundHash = structuredClone(composition);
    const wrongBackgroundRecipe =
      wrongBackgroundHash.graphicScenes![0]!.photoDepth;
    if (
      wrongBackgroundRecipe?.mode !== "parallax" ||
      wrongBackgroundRecipe.background.kind !== "asset"
    )
      throw new Error("Expected asset background recipe");
    wrongBackgroundRecipe.background.sha256 = "e".repeat(64);
    await expect(
      prepareGraphicScenes(wrongBackgroundHash, assets, settings, root),
    ).rejects.toMatchObject({ code: "graphics.sourceChanged" });

    const sourcePath = fileURLToPath(assets[0]!.uri);
    const originalSource = await readFile(sourcePath);
    try {
      await writeFile(
        sourcePath,
        Buffer.concat([originalSource, Buffer.from("changed")]),
      );
      await expect(
        prepareGraphicScenes(composition, assets, settings, root),
      ).rejects.toMatchObject({ code: "graphics.sourceChanged" });
    } finally {
      await writeFile(sourcePath, originalSource);
    }

    const cropped = structuredClone(composition);
    const croppedRecipe = cropped.graphicScenes![0]!.photoDepth;
    if (croppedRecipe?.mode !== "parallax")
      throw new Error("Expected parallax recipe");
    croppedRecipe.protectedRegion = { x: 0, y: 0, width: 0.05, height: 0.05 };
    await expect(
      prepareGraphicScenes(cropped, assets, settings, root),
    ).rejects.toMatchObject({ code: "graphics.protectedRegion" });

    const controller = new AbortController();
    const prepared = await prepareGraphicScenes(
      composition,
      assets,
      settings,
      root,
      { signal: controller.signal },
    );
    expect(await prepared.frame(null, 0)).toBeInstanceOf(Buffer);
    controller.abort();
    await expect(prepared.frame(null, 1)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects a same-size alpha mask above the decoded pixel budget before RGBA allocation", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "openfilm-photo-depth-resource-"),
    );
    roots.push(root);
    const original = await imageAsset(
      root,
      "large-source",
      "color=c=0x305070:s=3000x3000",
    );
    const mask = await imageAsset(
      root,
      "large-mask",
      "nullsrc=s=3000x3000,format=rgba,geq=r='255':g='255':b='255':a='if(between(X,100,2900)*between(Y,100,2900),255,0)'",
    );
    const node: GraphicImageNode = {
      id: "large-photo-node",
      type: "image",
      assetId: original.id,
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      opacity: 1,
      zIndex: 0,
      start: 0,
      end: 6,
    };
    const scene: GraphicScene = {
      version: 1,
      id: "large-photo-scene",
      name: "Oversize mask",
      start: 0,
      duration: 6,
      zIndex: 0,
      nodes: [node],
      photoDepth: {
        version: 1,
        id: "large-recipe",
        nodeId: node.id,
        mode: "parallax",
        duration: 6,
        sourceAssetId: original.id,
        sourceSha256: original.contentHash!,
        maskAssetId: mask.id,
        maskSha256: mask.contentHash!,
        background: { kind: "source" },
        protectedRegion: { x: 0, y: 0, width: 1, height: 1 },
        foregroundDepth: 1.2,
        backgroundDepth: 0.25,
        amplitude: 0,
        camera: {
          from: { x: 0, y: 0, scale: 1 },
          to: { x: 0, y: 0, scale: 1 },
        },
        easing: "linear",
      },
    };
    const composition: Composition = {
      id: "large-film",
      storyId: "story",
      duration: 6,
      tracks: [],
      graphicScenes: [scene],
    };
    await expect(
      prepareGraphicScenes(
        composition,
        [original, mask],
        { width: 320, height: 180, frameRate: 12 },
        root,
      ),
    ).rejects.toMatchObject({ code: "graphics.resourceLimit" });
  });

  it("renders six seconds of PhotoDepth to a decoded 180-frame MP4 with deterministic seek and source receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "openfilm-photo-depth-mp4-"));
    roots.push(root);
    const { assets, composition } = await fixture(root);
    const sourceHashes = await Promise.all(
      assets.map((asset) => hashFile(fileURLToPath(asset.uri))),
    );
    const settings = { width: 320, height: 180, frameRate: 30 };
    const prepared = await prepareGraphicScenes(
      composition,
      assets,
      settings,
      root,
    );
    const output = join(root, "photo-depth.mp4");
    await new FFmpegRenderer().render(composition, assets, output, settings);

    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,nb_read_frames,duration,avg_frame_rate",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      output,
    ]);
    const stream = JSON.parse(probe.stdout.toString()).streams[0];
    expect(stream).toMatchObject({
      codec_name: "h264",
      width: 320,
      height: 180,
      nb_read_frames: "180",
      duration: "6.000000",
      avg_frame_rate: "30/1",
    });
    expect(
      Number(JSON.parse(probe.stdout.toString()).format.duration),
    ).toBeCloseTo(6, 3);

    const decode = async (videoPath: string, frame: number) =>
      (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          videoPath,
          "-vf",
          `select=eq(n\\,${frame})`,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ])
      ).stdout;
    const frames = new Map<number, Buffer>();
    for (const frame of [0, 90, 179, 35, 140])
      frames.set(frame, await decode(output, frame));
    expect(frames.get(0)).not.toEqual(frames.get(90));
    expect(frames.get(90)).not.toEqual(frames.get(179));
    expect(await decode(output, 179)).toEqual(frames.get(179));
    expect(await decode(output, 0)).toEqual(frames.get(0));
    expect(await decode(output, 90)).toEqual(frames.get(90));

    const recipe = composition.graphicScenes![0]!.photoDepth;
    if (recipe?.mode !== "parallax")
      throw new Error("Expected a parallax recipe");
    const fallbackComposition = structuredClone(composition);
    fallbackComposition.graphicScenes![0]!.photoDepth = {
      version: 1,
      id: recipe.id,
      nodeId: recipe.nodeId,
      mode: "fallback",
      duration: recipe.duration,
      sourceAssetId: recipe.sourceAssetId,
      sourceSha256: recipe.sourceSha256,
      fallbackReason: "mask-unreliable",
    };
    const legacyComposition = structuredClone(composition);
    delete legacyComposition.graphicScenes![0]!.photoDepth;
    const fallbackOutput = join(root, "photo-depth-fallback.mp4");
    const legacyOutput = join(root, "photo-depth-legacy.mp4");
    await new FFmpegRenderer().render(
      fallbackComposition,
      assets,
      fallbackOutput,
      settings,
    );
    await new FFmpegRenderer().render(
      legacyComposition,
      assets,
      legacyOutput,
      settings,
    );
    const fallbackMatchesLegacyFrames: number[] = [];
    const fallbackDiffersFromParallaxFrames: number[] = [];
    for (const frame of [0, 90, 179]) {
      const fallbackPixels = await decode(fallbackOutput, frame);
      expect(fallbackPixels).toEqual(await decode(legacyOutput, frame));
      fallbackMatchesLegacyFrames.push(frame);
      if (frame !== 90) {
        expect(fallbackPixels).not.toEqual(frames.get(frame));
        fallbackDiffersFromParallaxFrames.push(frame);
      }
    }

    const parityErrors: Record<number, number> = {};
    for (const frame of [0, 90, 179]) {
      const pngPath = join(root, `monitor-${frame}.png`);
      await writeFile(pngPath, await prepared.frame(null, frame));
      const expected = (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          pngPath,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ])
      ).stdout;
      const actual = frames.get(frame)!;
      expect(actual.length).toBe(320 * 180 * 3);
      let absoluteError = 0;
      for (let index = 0; index < actual.length; index++)
        absoluteError += Math.abs(actual[index]! - expected[index]!);
      parityErrors[frame] = absoluteError / actual.length;
      expect(parityErrors[frame]).toBeLessThan(12);
    }

    const manifest = JSON.parse(
      await readFile(`${output}.manifest.json`, "utf8"),
    );
    expect(manifest.sources).toEqual(
      expect.arrayContaining(
        assets.map((asset, index) =>
          expect.objectContaining({
            assetId: asset.id,
            sha256: sourceHashes[index],
          }),
        ),
      ),
    );
    expect(
      await Promise.all(
        assets.map((asset) => hashFile(fileURLToPath(asset.uri))),
      ),
    ).toEqual(sourceHashes);

    const evidence = process.env.OPENFILM_PHOTO_DEPTH_QA_OUTPUT;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await Promise.all([
        copyFile(
          fileURLToPath(assets[0]!.uri),
          join(evidence, "synthetic-landscape.png"),
        ),
        copyFile(
          fileURLToPath(assets[1]!.uri),
          join(evidence, "synthetic-alpha-mask.png"),
        ),
        copyFile(
          fileURLToPath(assets[2]!.uri),
          join(evidence, "synthetic-background-fill.png"),
        ),
        copyFile(output, join(evidence, "photo-depth-6s-180f.mp4")),
        copyFile(
          fallbackOutput,
          join(evidence, "photo-depth-fallback-6s-180f.mp4"),
        ),
        copyFile(legacyOutput, join(evidence, "legacy-image-6s-180f.mp4")),
        copyFile(
          `${output}.manifest.json`,
          join(evidence, "photo-depth.manifest.json"),
        ),
      ]);
      for (const frame of [0, 90, 179]) {
        await writeFile(
          join(evidence, `monitor-frame-${frame}.png`),
          await prepared.frame(null, frame),
        );
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          output,
          "-vf",
          `select=eq(n\\,${frame})`,
          "-frames:v",
          "1",
          "-threads",
          "1",
          "-y",
          join(evidence, `decoded-frame-${frame}.png`),
        ]);
      }
      await writeFile(
        join(evidence, "photo-depth.measurements.json"),
        JSON.stringify(
          {
            codec: stream.codec_name,
            width: stream.width,
            height: stream.height,
            frameCount: Number(stream.nb_read_frames),
            frameRate: stream.avg_frame_rate,
            streamDuration: Number(stream.duration),
            sourceSha256: Object.fromEntries(
              assets.map((asset, index) => [asset.id, sourceHashes[index]]),
            ),
            outputSha256: await hashFile(output),
            fallbackOutputSha256: await hashFile(fallbackOutput),
            legacyOutputSha256: await hashFile(legacyOutput),
            fallbackMatchesLegacyDecodedFrames: fallbackMatchesLegacyFrames,
            fallbackDiffersFromParallaxDecodedFrames:
              fallbackDiffersFromParallaxFrames,
            monitorOutputMeanRgbAbsoluteErrors: parityErrors,
            monitorOutputMeanRgbAbsoluteErrorMaximum: 12,
            decodedFrames: [0, 90, 179],
            shuffledDecodeOrder: [0, 90, 179, 35, 140, 179, 0, 90],
          },
          null,
          2,
        ),
      );
    }
  });
});
