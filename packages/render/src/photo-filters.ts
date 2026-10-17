import {
  assetDisplayDimensions,
  resolvePhotoPlan,
  type Clip,
  type FrameSize,
  type MediaAsset,
} from "@openfilm/core";
import { localPath, previewVideoFilters } from "@openfilm/media";

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
        "-i",
        localPath(asset.uri),
      );
    }
    const source = `photo-source${options.suffix}-${index}`;
    const merged = `photo-merged${options.suffix}-${index}`;
    const decode = await previewVideoFilters(asset, options.signal);
    filters.push(
      `[${input}:v]setpts=PTS-STARTPTS,${[...decode, `scale=${Math.max(1, Math.round(layer.width))}:${Math.max(1, Math.round(layer.height))}`, "setsar=1", "format=rgba"].join(",")}[${source}]`,
    );
    filters.push(
      `[${label}][${source}]overlay=x=${Math.round(layer.x)}:y=${Math.round(layer.y)}:format=rgb:eval=init:shortest=1[${merged}]`,
    );
    label = merged;
  }
  const { from, to, easing } = plan.motion;
  const p = `min(1,max(0,on/${n(frame.frameRate)}/${n(clip.timelineDuration)}))`;
  const e = easing === "ease-in-out" ? `((${p})*(${p})*(3-2*(${p})))` : p;
  const interpolate = (key: "scale" | "x" | "y") =>
    `(${n(from[key])}+(${n(to[key] - from[key])})*(${e}))`;
  const zoom = interpolate("scale"),
    x = interpolate("x"),
    y = interpolate("y");
  const output = `photo-motion${options.suffix}`;
  // Twofold sampling keeps crop quantization below one output pixel. RGB input
  // avoids a 2x2 chroma-grid offset before the final output conversion.
  filters.push(
    `[${label}]scale=${frame.width * 2}:${frame.height * 2},format=gbrp,zoompan=z='${zoom}':x='(iw-iw/zoom)/2-2*${x}/zoom':y='(ih-ih/zoom)/2-2*${y}/zoom':d=1:s=${frame.width}x${frame.height}:fps=${n(frame.frameRate)},format=rgba[${output}]`,
  );
  return { args, filters, addedInputs, label: output, warnings: plan.warnings };
}
