// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Composition, GraphicImageNode, MediaAsset } from "@openfilm/core";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";

/** Bounded generated source/mask/background; no model, private media or provider. */
export async function renderQaDepthFixture(
  root: string,
): Promise<{ assets: MediaAsset[]; composition: Composition }> {
  const assets: MediaAsset[] = [];
  for (const [id, filter] of [
    [
      "depthSource",
      "color=c=0x305070:s=64x48,drawbox=x=20:y=6:w=24:h=36:color=0xffcc22:t=fill",
    ],
    [
      "depthMask",
      "nullsrc=s=64x48,format=rgba,geq=r='255':g='255':b='255':a='if(between(X,20,43)*between(Y,6,41),255,0)'",
    ],
    ["depthBackground", "color=c=0x176b42:s=64x48"],
  ]) {
    const path = join(root, `${id}.png`);
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      filter!,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-pix_fmt",
      "rgba",
      "-y",
      path,
    ]);
    assets.push({
      ...(await inspectMedia({
        path,
        uri: pathToFileURL(path).href,
        name: id!,
      })),
      contentHash: await hashFile(path),
    });
  }
  const [source, mask, background] = assets;
  const node: GraphicImageNode = {
    id: "photo",
    type: "image",
    assetId: source!.id,
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    opacity: 1,
    zIndex: 0,
    start: 0,
    end: 6,
  };
  return {
    assets,
    composition: {
      id: "qa-depth",
      storyId: "synthetic",
      duration: 6,
      tracks: [],
      graphicScenes: [
        {
          version: 1,
          id: "depth",
          name: "Synthetic depth",
          start: 0,
          duration: 6,
          zIndex: 0,
          nodes: [node],
          photoDepth: {
            version: 1,
            id: "recipe",
            nodeId: node.id,
            mode: "parallax",
            duration: 6,
            sourceAssetId: source!.id,
            sourceSha256: source!.contentHash!,
            maskAssetId: mask!.id,
            maskSha256: mask!.contentHash!,
            background: {
              kind: "asset",
              assetId: background!.id,
              sha256: background!.contentHash!,
            },
            protectedRegion: {
              x: 0.3125,
              y: 0.125,
              width: 0.375,
              height: 0.75,
            },
            foregroundDepth: 1.2,
            backgroundDepth: 0.25,
            amplitude: 1,
            camera: {
              from: { x: -0.02, y: 0, scale: 1 },
              to: { x: 0.02, y: 0, scale: 1.08 },
            },
            easing: "ease-in-out",
          },
        },
      ],
    },
  };
}
