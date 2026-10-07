import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  resolveClipGeometry,
  type Clip,
  type Composition,
  type MediaAsset,
} from "@openfilm/core";
import {
  checkAbort,
  localPath,
  runProcess,
  previewVideoFilters,
  previewIssue,
} from "@openfilm/media";

export interface RenderSettings {
  width: number;
  height: number;
  frameRate: number;
}
const defaults: RenderSettings = { width: 1280, height: 720, frameRate: 30 };
const number = (value: number): string => String(Number(value.toFixed(8)));

function finite(value: number, field: string, positive = false): void {
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0))
    throw new Error(
      `${field} must be ${positive ? "positive" : "nonnegative"} and finite`,
    );
}

function tempo(speed: number): string[] {
  const filters: string[] = [];
  while (speed > 2) {
    filters.push("atempo=2");
    speed /= 2;
  }
  while (speed < 0.5) {
    filters.push("atempo=0.5");
    speed /= 0.5;
  }
  filters.push(`atempo=${number(speed)}`);
  return filters;
}

function hasAudio(asset: MediaAsset): boolean {
  if (asset.mediaType === "audio") return true;
  const probe = asset.metadata["openfilm.ffprobe"] as
    { streams?: { codec_type?: string }[] } | undefined;
  return Boolean(
    probe?.streams?.some((stream) => stream.codec_type === "audio"),
  );
}

/** A preview adapter; originals are inputs and all editing is expressed as filters. */
export class FFmpegRenderer {
  async render(
    composition: Composition,
    assets: MediaAsset[],
    outputPath: string,
    settings: RenderSettings = defaults,
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    checkAbort(options.signal);
    finite(composition.duration, "Composition duration", true);
    for (const [key, value] of Object.entries(settings))
      finite(value, key, true);
    if (
      !Number.isInteger(settings.width) ||
      !Number.isInteger(settings.height) ||
      settings.width % 2 ||
      settings.height % 2
    )
      throw new Error("Render dimensions must be even integers");
    const outputDuration =
      Math.floor((composition.duration + 1e-9) * settings.frameRate) /
      settings.frameRate;
    if (outputDuration <= 0)
      throw new Error("Composition must last at least one output frame");
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const output = resolve(outputPath);
    for (const asset of assets) {
      if (resolve(localPath(asset.uri)) === output)
        throw new Error("Render output cannot overwrite original media");
    }
    await mkdir(dirname(output), { recursive: true });
    try {
      const target = await lstat(output);
      if (target.isSymbolicLink() || !target.isFile())
        throw new Error("Render output must be a regular file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const work = join(dirname(output), `.render-${randomUUID()}`);
    await mkdir(work);
    const temporaryOutput = join(work, "preview.mp4");
    const args: string[] = ["-v", "error", "-nostdin", "-threads", "1"];
    const filters: string[] = [
      `color=c=black:s=${settings.width}x${settings.height}:r=${number(settings.frameRate)}:d=${number(composition.duration)}[base]`,
    ];
    const audioLabels: string[] = [];
    let videoLabel = "base";
    let inputIndex = 0;
    let sequence = 0;
    try {
      for (const track of composition.tracks) {
        const clips = [...track.clips].sort(
          (a, b) => a.timelineStart - b.timelineStart,
        );
        for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
          const clip = clips[clipIndex]!;
          validateClip(clip, composition.duration);
          const start = clip.timelineStart;
          const duration = clip.timelineDuration;
          const suffix = sequence++;
          if (track.type === "titles" || clip.title !== undefined) {
            if (!clip.title) continue;
            const titleFile = join(work, `title-${suffix}.txt`);
            await writeFile(titleFile, clip.title, "utf8");
            const titleLabel = `title${suffix}`;
            filters.push(
              `[${videoLabel}]drawtext=textfile=title-${suffix}.txt:expansion=none:fontcolor=white:fontsize=${Math.round(settings.height / 16)}:x=(w-text_w)/2:y=h*0.8-text_h/2:box=1:boxcolor=black@0.55:boxborderw=16:enable='gte(t,${number(start)})*lt(t,${number(start + duration)})'[${titleLabel}]`,
            );
            videoLabel = titleLabel;
            if (track.type === "titles") continue;
          }
          const asset = assetMap.get(clip.assetId);
          if (!asset)
            throw new Error(
              `Clip ${clip.id} references missing asset ${clip.assetId}`,
            );
          const issue = previewIssue(asset);
          if (issue) throw new Error(`${asset.name}: ${issue}`);
          const sourceIn = clip.sourceIn ?? 0;
          const speed = clip.transform?.speed ?? 1;
          const sourceOut =
            clip.sourceOut ??
            (asset.duration
              ? Math.min(asset.duration, sourceIn + duration * speed)
              : sourceIn + duration * speed);
          if (sourceOut <= sourceIn)
            throw new Error(`Clip ${clip.id} has an empty source range`);
          if (asset.duration && sourceOut > asset.duration + 0.05)
            throw new Error(`Clip ${clip.id} trim exceeds the source duration`);
          const visual =
            track.type !== "audio" &&
            track.type !== "music" &&
            asset.mediaType !== "audio";
          if (asset.mediaType === "image")
            args.push("-loop", "1", "-framerate", number(settings.frameRate));
          args.push("-threads", "1", "-i", localPath(asset.uri));
          const input = inputIndex++;
          if (visual) {
            const label = `visual${suffix}`;
            const geometry = resolveClipGeometry(clip.transform);
            const transform: string[] = await previewVideoFilters(
              asset,
              options.signal,
            );
            // Contain-fit the decoded display aspect, including non-square pixels.
            // Missing SAR means square pixels. Explicit dimensions + setsar=1
            // avoid version-specific scale reset_sar and an intermediate resize.
            const displayAspect = "iw/ih*if(gt(sar,0),sar,1)";
            transform.push(
              `scale=w='min(${settings.width},${settings.height}*(${displayAspect}))':h='min(${settings.height},${settings.width}/(${displayAspect}))'`,
            );
            if (geometry.scale !== 1)
              transform.push(
                `scale=ceil(iw*${number(geometry.scale)}):ceil(ih*${number(geometry.scale)})`,
              );
            // Rotation must happen in an alpha-capable format. Otherwise transparent
            // rotated corners become black and diverge from the browser preview.
            transform.push("setsar=1", "format=rgba");
            if (geometry.rotation)
              transform.push(
                `rotate=${number((geometry.rotation * Math.PI) / 180)}:ow=rotw(${number((geometry.rotation * Math.PI) / 180)}):oh=roth(${number((geometry.rotation * Math.PI) / 180)}):c=none`,
              );
            transform.push(`fps=${number(settings.frameRate)}`);
            const fade = clip.transition?.duration ?? 0;
            // Extending the outgoing frame through the next fade creates a real overlap
            // without shifting the editable timeline or changing its duration.
            const next = clips[clipIndex + 1];
            const outgoingTail =
              next?.transition?.type === "crossfade" &&
              Math.abs(next.timelineStart - start - duration) < 0.05
                ? Math.min(
                    next.transition.duration,
                    composition.duration - start - duration,
                  )
                : 0;
            const displayedDuration = duration + outgoingTail;
            if (fade > 0)
              transform.push(`fade=t=in:st=0:d=${number(fade)}:alpha=1`);
            const trim =
              asset.mediaType === "image"
                ? `trim=duration=${number(displayedDuration)}`
                : `trim=start=${number(sourceIn)}:end=${number(sourceOut)}`;
            filters.push(
              `[${input}:v]${trim},setpts=(PTS-STARTPTS)/${number(speed)},${transform.join(",")},tpad=stop_mode=clone:stop_duration=${number(displayedDuration)},trim=duration=${number(displayedDuration)},setpts=PTS+${number(start)}/TB[${label}]`,
            );
            const merged = `merged${suffix}`;
            filters.push(
              `[${videoLabel}][${label}]overlay=x=(W-w)/2+${number(geometry.x)}:y=(H-h)/2+${number(geometry.y)}:eof_action=pass:repeatlast=0:enable='gte(t,${number(start)})*lt(t,${number(start + displayedDuration)})'[${merged}]`,
            );
            videoLabel = merged;
          }
          if (hasAudio(asset)) {
            const label = `audio${suffix}`;
            const audioFilters = [
              `atrim=start=${number(sourceIn)}:end=${number(sourceOut)}`,
              "asetpts=PTS-STARTPTS",
              ...tempo(speed),
              `volume=${number(clip.transform?.volume ?? 1)}`,
              "apad",
              `atrim=duration=${number(duration)}`,
              `adelay=${Math.round(start * 1000)}:all=1`,
            ];
            filters.push(`[${input}:a]${audioFilters.join(",")}[${label}]`);
            audioLabels.push(label);
          }
        }
      }
      filters.push(`[${videoLabel}]format=yuv420p[vout]`);
      if (audioLabels.length)
        filters.push(
          `${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95,apad,atrim=duration=${number(composition.duration)}[aout]`,
        );
      else
        filters.push(
          `anullsrc=r=48000:cl=stereo,atrim=duration=${number(composition.duration)}[aout]`,
        );
      args.push(
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-r",
        number(settings.frameRate),
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-t",
        number(outputDuration),
        "-movflags",
        "+faststart",
        "-y",
        temporaryOutput,
      );
      await runProcess("ffmpeg", args, {
        signal: options.signal,
        timeoutMs: 1800000,
        cwd: work,
      });
      checkAbort(options.signal);
      await rename(temporaryOutput, output);
      return output;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

function validateClip(clip: Clip, duration: number): void {
  finite(clip.timelineStart, "Clip start");
  finite(clip.timelineDuration, "Clip duration", true);
  if (clip.timelineStart + clip.timelineDuration > duration + 0.00001)
    throw new Error(`Clip ${clip.id} exceeds the composition duration`);
  finite(clip.sourceIn ?? 0, "Source in");
  finite(clip.sourceOut ?? 1, "Source out", true);
  finite(clip.transform?.speed ?? 1, "Speed", true);
  finite(clip.transform?.scale ?? 1, "Scale", true);
  finite(clip.transform?.volume ?? 1, "Volume");
  for (const key of ["x", "y", "rotation"] as const)
    if (
      clip.transform?.[key] !== undefined &&
      !Number.isFinite(clip.transform[key])
    )
      throw new Error(`Transform ${key} must be finite`);
  if (
    clip.transition &&
    (clip.transition.type !== "crossfade" ||
      !Number.isFinite(clip.transition.duration) ||
      clip.transition.duration < 0 ||
      clip.transition.duration > clip.timelineDuration)
  )
    throw new Error("Crossfade must fit within the clip duration");
}

export async function renderComposition(
  composition: Composition,
  assets: MediaAsset[],
  outputPath: string,
  settings?: RenderSettings,
  options?: { signal?: AbortSignal },
): Promise<string> {
  return new FFmpegRenderer().render(
    composition,
    assets,
    outputPath,
    settings,
    options,
  );
}
