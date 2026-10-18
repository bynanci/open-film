// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; this derivative as a whole is GPL-3.0-only. See LICENSE/NOTICE.
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { photoPresentationFilters } from "./photo-filters.js";
import { filmLookFilters } from "./look-filters.js";
import { audioAutomationFilters } from "./audio-filters.js";
import { createTitleOverlay } from "./titles.js";
import { resolveRenderQuality, type RenderQuality } from "./quality.js";
export type { RenderQuality } from "./quality.js";
import {
  publishRenderPair,
  validateRenderTargets,
  RenderPublicationRecoveryError,
} from "./publication.js";
import {
  captureRenderSources,
  verifyRenderSources,
  writeRenderManifest,
  type RenderFontEvidence,
  type RenderProjectEvidence,
  type RenderLookEvidence,
} from "./manifest.js";
export {
  createTitleOverlay,
  resolveTitleFont,
  titleOverlayCacheKey,
} from "./titles.js";
import {
  resolveClipGeometry,
  resolveFilmLook,
  resolveTitleFadeFrames,
  validateFilmLook,
  filmLookMatrix,
  type FilmLook,
  frameAlignedDuration,
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
  localMediaInputOptions,
} from "@openfilm/media";

export interface RenderSettings {
  width: number;
  height: number;
  frameRate: number;
}
export interface RenderOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  project?: RenderProjectEvidence;
  /** Null or omitted preserves each clip's saved film, scene and clip choices. */
  lookOverride?: FilmLook | null;
  /** Preview preserves the existing encoder; lossless is intended for intermediates. */
  quality?: RenderQuality;
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
    options: RenderOptions = {},
  ): Promise<string> {
    checkAbort(options.signal);
    const encoding = resolveRenderQuality(options.quality);
    const scaling = encoding.lanczos ? ":flags=lanczos" : "";
    composition = structuredClone(composition);
    assets = structuredClone(assets);
    settings = { ...settings };
    const project = options.project ? { ...options.project } : undefined;
    const lookOverride =
      options.lookOverride == null
        ? null
        : validateFilmLook(structuredClone(options.lookOverride));
    if (composition.defaultLook) validateFilmLook(composition.defaultLook);
    for (const entry of composition.beatLooks ?? [])
      validateFilmLook(entry.look);
    for (const track of composition.tracks)
      for (const clip of track.clips)
        if (clip.look) validateFilmLook(clip.look);
    const resolvedLooks = new Map<Clip, FilmLook>();
    const looks: RenderLookEvidence[] = [];
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
    const outputDuration = frameAlignedDuration(
      composition.duration,
      settings.frameRate,
    );
    const outputFrameRate = Number(number(settings.frameRate));
    if (outputDuration <= 0)
      throw new Error("Composition must last at least one output frame");
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const usedIds = new Set(
      composition.tracks
        .filter((track) => track.type !== "titles")
        .flatMap((track) =>
          track.clips.flatMap((clip) => [
            clip.assetId,
            ...(clip.layout?.secondary ? [clip.layout.secondary.assetId] : []),
          ]),
        ),
    );
    const fonts: RenderFontEvidence[] = [];
    const warnings: string[] = [];
    const output = resolve(outputPath);
    for (const asset of assets) {
      if (
        [output, `${output}.manifest.json`].includes(
          resolve(localPath(asset.uri)),
        )
      )
        throw new Error("Render output cannot overwrite original media");
    }
    // Capability checks precede source IO, preserving actionable unsupported-360
    // errors even when the original source has not been mounted.
    for (const track of composition.tracks)
      for (const clip of track.clips) {
        if (track.type === "titles") {
          if (clip.layout || clip.motion || clip.audioAutomation)
            throw new Error(
              `Clip ${clip.id}: title tracks do not support photo layout, photo motion or audio automation.`,
            );
          continue;
        }
        const asset = assetMap.get(clip.assetId);
        if (!asset)
          throw new Error(
            `Clip ${clip.id} references missing asset ${clip.assetId}`,
          );
        if (
          track.type !== "audio" &&
          track.type !== "music" &&
          asset.mediaType !== "audio"
        ) {
          const effective = resolveFilmLook(composition, clip, lookOverride);
          resolvedLooks.set(clip, effective.look);
          looks.push({
            clipId: clip.id,
            assetIds: [
              clip.assetId,
              ...(clip.layout?.secondary
                ? [clip.layout.secondary.assetId]
                : []),
            ],
            source: effective.source,
            preset: effective.look.preset,
            strength: effective.look.strength,
            matrix: filmLookMatrix(effective.look),
          });
        }
        const issue = previewIssue(asset);
        if (issue) throw new Error(`${asset.name}: ${issue}`);
        if (
          (clip.layout || clip.motion) &&
          (asset.mediaType !== "image" || track.type !== "video")
        )
          throw new Error(
            `Clip ${clip.id}: photo layout and motion require a still image on a story video track.`,
          );
        if (clip.audioAutomation && !hasAudio(asset))
          throw new Error(
            `Clip ${clip.id}: audio automation requires an audio stream.`,
          );
      }
    const sources = await captureRenderSources(
      assets.filter((asset) => usedIds.has(asset.id)),
      options.signal,
    );
    await mkdir(dirname(output), { recursive: true });
    await validateRenderTargets(output);
    // Different paths can still name one original file (hard links or a parent
    // directory alias). Check file identity before publishing either output.
    for (const target of [output, `${output}.manifest.json`]) {
      let destination;
      try {
        destination = await stat(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const asset of assets) {
        const source = localPath(asset.uri);
        try {
          const original = await stat(source);
          if (
            (destination.ino !== 0 &&
              destination.dev === original.dev &&
              destination.ino === original.ino) ||
            (await realpath(target)) === (await realpath(source))
          )
            throw new Error(
              "Render output cannot overwrite original media through a filesystem alias",
            );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    const work = join(dirname(output), `.render-${randomUUID()}`);
    await mkdir(work);
    const temporaryOutput = join(work, "preview.mp4");
    const args: string[] = [
      "-v",
      "error",
      "-nostdin",
      "-threads",
      "1",
      "-progress",
      "pipe:1",
      "-nostats",
    ];
    const filters: string[] = [
      `color=c=black:s=${settings.width}x${settings.height}:r=${number(settings.frameRate)}:d=${number(composition.duration)},format=rgba[base]`,
    ];
    const audioLabels: string[] = [];
    let videoLabel = "base";
    let inputIndex = 0;
    let sequence = 0;
    let retainWork = false;
    const pendingTitles: Array<() => Promise<void>> = [];
    try {
      for (const track of composition.tracks) {
        const clips = [...track.clips].sort(
          (a, b) => a.timelineStart - b.timelineStart,
        );
        for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
          const clip = clips[clipIndex]!;
          validateClip(clip, composition.duration);
          const start = clip.timelineStart;
          const startFrame = Math.round(start * outputFrameRate);
          // Gate by rounded output ticks: 111/30 can compare below literal 3.7.
          // FFmpeg 6 evaluates enable on both inputs, whose n counters differ;
          // their shifted timestamps share the same output timeline.
          const outputFrame = `round(t*${number(settings.frameRate)})`;
          const endFrame = (length: number) =>
            startFrame + Math.ceil((length - 1e-9) * outputFrameRate);
          const duration = clip.timelineDuration;
          const suffix = sequence++;
          const addTitle = async () => {
            if (!clip.title) return;
            const titleFile = join(work, `title-${suffix}.png`);
            const title = await createTitleOverlay(
              clip.title,
              clip.titleStyle,
              settings,
              titleFile,
            );
            fonts.push({
              family: title.font.family,
              postscriptName: title.font.postscriptName,
              sha256: title.font.sha256,
            });
            warnings.push(...title.warnings);
            args.push(
              "-loop",
              "1",
              "-framerate",
              number(settings.frameRate),
              "-threads",
              "1",
              "-i",
              titleFile,
            );
            const titleInput = inputIndex++;
            const titleLabel = `title${suffix}`;
            const { fadeInFrames, fadeOutFrames, frameCount } =
              resolveTitleFadeFrames(
                clip.titleStyle,
                duration,
                outputFrameRate,
              );
            const alpha = ["format=rgba"];
            if (fadeInFrames)
              alpha.push(`fade=t=in:s=0:n=${fadeInFrames}:alpha=1`);
            if (fadeOutFrames)
              alpha.push(
                `fade=t=out:s=${frameCount - 1 - fadeOutFrames}:n=${fadeOutFrames}:alpha=1`,
              );
            // Count local raster frames before moving the title onto the timeline.
            // Media trim/speed must not alter an attached caption's fade clock.
            filters.push(
              `[${titleInput}:v]${alpha.join(",")},setpts=PTS-STARTPTS+${startFrame}[title-source${suffix}]`,
            );
            filters.push(
              `[${videoLabel}][title-source${suffix}]overlay=x=0:y=0:format=rgb:eval=init:eof_action=pass:repeatlast=0:enable='gte(${outputFrame},${startFrame})*lt(${outputFrame},${endFrame(duration)})'[${titleLabel}]`,
            );
            videoLabel = titleLabel;
          };
          if (track.type === "titles") {
            if (clip.layout || clip.motion || clip.audioAutomation)
              throw new Error(
                `Clip ${clip.id}: title tracks do not support photo layout, photo motion or audio automation.`,
              );
            pendingTitles.push(addTitle);
            continue;
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
          if (
            (clip.layout || clip.motion) &&
            (track.type !== "video" || asset.mediaType !== "image")
          )
            throw new Error(
              `Clip ${clip.id}: photo layout and motion require a still image on a story video track.`,
            );
          if (clip.audioAutomation && !hasAudio(asset))
            throw new Error(
              `Clip ${clip.id}: audio automation requires an audio stream.`,
            );
          if (asset.mediaType === "image")
            args.push("-loop", "1", "-framerate", number(settings.frameRate));
          args.push(
            "-threads",
            "1",
            ...(await localMediaInputOptions(
              localPath(asset.uri),
              options.signal,
            )),
            "-i",
            localPath(asset.uri),
          );
          const input = inputIndex++;
          if (visual) {
            const label = `visual${suffix}`;
            const geometry = resolveClipGeometry(clip.transform);
            const presentedPhoto =
              asset.mediaType === "image" && !!(clip.layout || clip.motion);
            const transform: string[] = presentedPhoto
              ? []
              : [
                  ...(await previewVideoFilters(asset, options.signal)),
                  ...filmLookFilters(resolvedLooks.get(clip)),
                ];
            // Contain-fit the decoded display aspect, including non-square pixels.
            // Missing SAR means square pixels. Explicit dimensions + setsar=1
            // avoid version-specific scale reset_sar and an intermediate resize.
            const displayAspect = "iw/ih*if(gt(sar,0),sar,1)";
            transform.push(
              `scale=w='min(${settings.width},${settings.height}*(${displayAspect}))':h='min(${settings.height},${settings.width}/(${displayAspect}))'${scaling}`,
            );
            if (geometry.scale !== 1)
              transform.push(
                `scale=ceil(iw*${number(geometry.scale)}):ceil(ih*${number(geometry.scale)})${scaling}`,
              );
            // Rotation must happen in an alpha-capable format. Otherwise transparent
            // rotated corners become black and diverge from the browser preview.
            transform.push("setsar=1", "format=rgba");
            if (geometry.rotation)
              transform.push(
                `rotate=${number((geometry.rotation * Math.PI) / 180)}:ow=rotw(${number((geometry.rotation * Math.PI) / 180)}):oh=roth(${number((geometry.rotation * Math.PI) / 180)}):c=none`,
              );
            transform.push(`fps=${number(settings.frameRate)}:round=near`);
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
            let visualInput = `${input}:v`;
            if (presentedPhoto) {
              const presentation = await photoPresentationFilters(
                clip,
                assetMap,
                settings,
                {
                  primaryInput: input,
                  nextInput: inputIndex,
                  suffix,
                  duration: displayedDuration,
                  signal: options.signal,
                  look: resolvedLooks.get(clip),
                  lanczos: encoding.lanczos,
                },
              );
              args.push(...presentation.args);
              inputIndex += presentation.addedInputs;
              filters.push(...presentation.filters);
              warnings.push(...presentation.warnings);
              visualInput = presentation.label;
            }
            if (fade > 0)
              transform.push(`fade=t=in:st=0:d=${number(fade)}:alpha=1`);
            const trim =
              asset.mediaType === "image"
                ? `trim=duration=${number(displayedDuration)}`
                : `trim=start=${number(sourceIn)}:end=${number(sourceOut)}`;
            filters.push(
              `[${visualInput}]${trim},setpts=(PTS-STARTPTS)/${number(presentedPhoto ? 1 : speed)},${transform.join(",")},tpad=stop_mode=clone:stop_duration=${number(displayedDuration)},trim=duration=${number(displayedDuration)},setpts=PTS-STARTPTS+${startFrame}[${label}]`,
            );
            const merged = `merged${suffix}`;
            filters.push(
              `[${videoLabel}][${label}]overlay=x=round((W-w)/2+${number(geometry.x)}):y=round((H-h)/2+${number(geometry.y)}):eval=init:format=rgb:eof_action=pass:repeatlast=0:enable='gte(${outputFrame},${startFrame})*lt(${outputFrame},${endFrame(displayedDuration)})'[${merged}]`,
            );
            videoLabel = merged;
          }
          pendingTitles.push(addTitle);
          if (hasAudio(asset)) {
            const label = `audio${suffix}`;
            const audioFilters = [
              `atrim=start=${number(sourceIn)}:end=${number(sourceOut)}`,
              "asetpts=PTS-STARTPTS",
              ...tempo(speed),
              `volume=${number(clip.transform?.volume ?? 1)}`,
              "apad",
              `atrim=duration=${number(duration)}`,
              ...audioAutomationFilters(clip.audioAutomation, duration),
              `adelay=${Math.round(start * 1000)}:all=1`,
            ];
            filters.push(`[${input}:a]${audioFilters.join(",")}[${label}]`);
            audioLabels.push(label);
          }
        }
      }
      for (const addTitle of pendingTitles) await addTitle();
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
        encoding.preset,
        "-crf",
        String(encoding.crf),
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
      let progressBuffer = "";
      let lastProgress = -1;
      const publishProgress = (value: number) => {
        const bounded = Math.min(1, Math.max(0, value));
        if (bounded < 1 && bounded - lastProgress < 0.01) return;
        lastProgress = bounded;
        try {
          options.onProgress?.(bounded);
        } catch {
          /* Progress observers do not own the render operation. */
        }
      };
      await runProcess("ffmpeg", args, {
        signal: options.signal,
        timeoutMs: 1800000,
        cwd: work,
        onStdout: (chunk) => {
          progressBuffer += chunk.toString("utf8");
          const lines = progressBuffer.split(/\r?\n/u);
          progressBuffer = lines.pop() ?? "";
          for (const line of lines) {
            const separator = line.indexOf("=");
            if (separator < 0) continue;
            const key = line.slice(0, separator);
            const value = line.slice(separator + 1);
            if (key === "progress" && value === "end") {
              publishProgress(1);
              continue;
            }
            if (key === "out_time_us" || key === "out_time_ms") {
              const microseconds = Number(value);
              if (Number.isFinite(microseconds) && microseconds >= 0)
                publishProgress(microseconds / 1_000_000 / outputDuration);
            }
          }
        },
      });
      checkAbort(options.signal);
      await verifyRenderSources(sources);
      const manifestPath = join(work, "manifest.json");
      await writeRenderManifest(
        manifestPath,
        temporaryOutput,
        composition,
        settings,
        sources,
        fonts,
        warnings,
        options.signal,
        project,
        { override: lookOverride, clips: looks },
        encoding,
      );
      await publishRenderPair(temporaryOutput, manifestPath, output, work);
      return output;
    } catch (error) {
      retainWork = error instanceof RenderPublicationRecoveryError;
      throw error;
    } finally {
      if (!retainWork) await rm(work, { recursive: true, force: true });
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
  options?: RenderOptions,
): Promise<string> {
  return new FFmpegRenderer().render(
    composition,
    assets,
    outputPath,
    settings,
    options,
  );
}
