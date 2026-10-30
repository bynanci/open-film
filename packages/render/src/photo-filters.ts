// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import {
  assetDisplayDimensions,
  resolvePhotoPlan,
  type Clip,
  type FilmLook,
  type PrimaryColorCorrection,
  type FrameSize,
  type MediaAsset,
} from "@openfilm/core";
import {
  localMediaInputOptions,
  localPath,
  previewVideoFilters,
} from "@openfilm/media";
import { primaryColorFilters } from "./primary-color-filters.js";
import { filmLookFilters } from "./look-filters.js";

const n = (value: number) => String(Number(value.toFixed(8)));
/** Adapter expressions use the endpoints and safety decisions of the shared plan. */
export async function photoPresentationFilters(
  clip: Clip,
  assets: Map<string, MediaAsset>,
  frame: FrameSize & { frameRate: number },
  options: {
    primaryInput: number;
    nextInput: number;
    suffix: number;
    duration: number;
    signal?: AbortSignal;
    look?: FilmLook;
    primaryColor?: PrimaryColorCorrection;
  },
): Promise<{
  args: string[];
  filters: string[];
  addedInputs: number;
  label: string;
  warnings: string[];
}> {
  const sources = Object.fromEntries(
    [...assets.values()].flatMap((asset) => {
      const dimensions = assetDisplayDimensions(asset);
      return dimensions ? [[asset.id, dimensions]] : [];
    }),
  );
  const plan = resolvePhotoPlan(clip, sources, frame);
  const args: string[] = [];
  const filters = [
    `color=c=black:s=${frame.width}x${frame.height}:r=${n(frame.frameRate)}:d=${n(options.duration)},format=rgba[photo-base${options.suffix}]`,
  ];
  let label = `photo-base${options.suffix}`;
  let addedInputs = 0;
  for (const [index, layer] of plan.layers.entries()) {
    const asset = assets.get(layer.assetId);
    if (!asset || asset.mediaType !== "image")
      throw new Error(`Photo layout requires a still image: ${layer.assetId}`);
    let input = options.primaryInput;
    if (index > 0) {
      input = options.nextInput + addedInputs++;
      args.push(
        "-loop",
        "1",
        "-framerate",
        n(frame.frameRate),
        "-threads",
        "1",
        ...(await localMediaInputOptions(localPath(asset.uri), options.signal)),
        "-i",
        localPath(asset.uri),
      );
    }
    const source = `photo-source${options.suffix}-${index}`;
    const merged = `photo-merged${options.suffix}-${index}`;
    const decode = await previewVideoFilters(asset, options.signal);
    filters.push(
      `[${input}:v]setpts=PTS-STARTPTS,${[...decode, ...primaryColorFilters(options.primaryColor), ...filmLookFilters(options.look), `scale=${Math.max(1, Math.round(layer.width))}:${Math.max(1, Math.round(layer.height))}`, "setsar=1", "format=rgba"].join(",")}[${source}]`,
    );
    filters.push(
      `[${label}][${source}]overlay=x=${Math.round(layer.x)}:y=${Math.round(layer.y)}:format=rgb:eval=init:shortest=1[${merged}]`,
    );
    label = merged;
  }
  const { from, to, easing } = plan.motion;
  const stationary =
    from.scale === to.scale && from.x === to.x && from.y === to.y;
  if (stationary && from.scale === 1 && from.x === 0 && from.y === 0)
    return { args, filters, addedInputs, label, warnings: plan.warnings };
  // Perspective's output count starts at one; the shared timeline starts at zero.
  const p = `min(1,max(0,(on-1)/${n(frame.frameRate)}/${n(clip.timelineDuration)}))`;
  const e = easing === "ease-in-out" ? `((${p})*(${p})*(3-2*(${p})))` : p;
  const interpolate = (key: "scale" | "x" | "y") =>
    stationary
      ? n(from[key])
      : `(${n(from[key])}+(${n(to[key] - from[key])})*(${e}))`;
  const zoom = interpolate("scale"),
    x = interpolate("x"),
    y = interpolate("y");
  const output = `photo-motion${options.suffix}`;
  // A floating-point affine map preserves subpixel movement. Even twofold
  // zoompan sampling rounds the crop and produces visible half-pixel steps
  // during a slow camera move. Perspective evaluates these destination corners
  // on each frame and interpolates pixels without rounding the camera position.
  const left = `(W*(1-${zoom})/2+${x})`;
  const right = `(W*(1+${zoom})/2+${x})`;
  const top = `(H*(1-${zoom})/2+${y})`;
  const bottom = `(H*(1+${zoom})/2+${y})`;
  filters.push(
    `[${label}]format=gbrp,perspective=x0='${left}':y0='${top}':x1='${right}':y1='${top}':x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}':sense=destination:eval=${stationary ? "init" : "frame"}:interpolation=cubic,format=rgba[${output}]`,
  );
  return { args, filters, addedInputs, label: output, warnings: plan.warnings };
}
