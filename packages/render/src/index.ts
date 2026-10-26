// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  graphicFrameRanges,
  prepareGraphicScenes,
  writeGraphicSequences,
} from "./graphic-scenes.js";
export {
  inspectGraphicImage,
  prepareGraphicScenes,
  graphicFrameRanges,
} from "./graphic-scenes.js";
import { photoPresentationFilters } from "./photo-filters.js";
import { filmLookFilters } from "./look-filters.js";
import { audioAutomationFilters } from "./audio-filters.js";
import { createTitleOverlay } from "./titles.js";
import { resolveRenderQuality, type RenderQuality } from "./quality.js";
export {
  resolveRenderQuality,
  type RenderQuality,
  type RenderQualityProfile,
} from "./quality.js";
export {
  publishRenderPair,
  validateRenderTargets,
  RenderPublicationRecoveryError,
} from "./publication.js";
import {
  publishRenderPair,
  validateRenderTargets,
  RenderPublicationRecoveryError,
} from "./publication.js";
import {
  captureRenderSources,
  verifyRenderSources,
  writeRenderManifest,
  canonicalRenderFonts,
  canonicalRenderFontBindings,
  type RenderFontBinding,
  type RenderFontEvidence,
  type RenderProjectEvidence,
  type RenderLookEvidence,
} from "./manifest.js";
export {
  canonicalRenderFonts,
  canonicalRenderFontBindings,
  type RenderFontEvidence,
  type RenderFontBinding,
  type RenderFontUsage,
} from "./manifest.js";
export {
  createTitleOverlay,
  validateTitleOutputDimensions,
  inspectTitleOverlay,
  resolveTitleFont,
  titleOverlayCacheKey,
} from "./titles.js";
import {
  graphicSceneAssetIds,
  projectFrameRate,
  resolveClipSourceRange,
  resolveClipGeometry,
  resolveFilmLook,
  validateFilmLook,
  filmLookMatrix,
  CAPTION_LIMITS,
  isCaptionTextValid,
  type FilmLook,
  type ExportProfile,
  validateExportProfile,
  type AudioAutomation,
  frameAlignedDuration,
  captionFrameRange,
  type Clip,
  type Composition,
  type MediaAsset,
  type ProjectTimebaseV1,
  type TitleStyle,
} from "@openfilm/core";
import {
  checkAbort,
  hashFile,
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
  timebase?: ProjectTimebaseV1;
}
/** An application-approved immutable plan, checked again at publication. */
export interface RenderSnapshot {
  compositionSha256: string;
  settingsSha256: string;
  assetsSha256: string;
  sources?: ReadonlyArray<{ assetId: string; sha256: string; size: number }>;
  /** A reviewed picture approves visual inputs; a delivered MP4 also captures audio. */
  sourceScope?: "visual";
  /** Actual reviewed font files/faces; paths may change when media is collected. */
  fonts?: ReadonlyArray<RenderFontEvidence>;
  /** Actual file/face for every title, caption cue and scene text node. */
  fontBindings?: ReadonlyArray<RenderFontBinding>;
  assertCurrent: () => void;
}
export interface RenderOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  project?: RenderProjectEvidence;
  /** Null or omitted preserves each clip's saved film, scene and clip choices. */
  lookOverride?: FilmLook | null;
  /** Omitted preserves the existing standard compression profile. */
  quality?: RenderQuality;
  /** Renders one native caption language; omitted selects the first saved track. */
  captionTrackId?: string | null;
  /** Optional package-local font resolver; callers must supply hash-verified paths. */
  fontPathForStyle?: (style: TitleStyle | undefined) => string | undefined;

  /** Render-only output framing; saved Composition geometry is not changed. */
  exportProfile?: ExportProfile;
  /** Exports the exact existing audio mix graph as PCM WAV. */
  audioOnly?: boolean;
  /** Internal picture-only intermediate for frame previews and PNG delivery. */
  videoOnly?: boolean;
  /** Optional role filter for a separate WAV stem. */
  audioRole?: AudioAutomation["role"];
  /** Internal snapshot binding for a reviewed preview and its delivered pixels. */
  snapshot?: RenderSnapshot;
}
export const RENDER_CAPTION_CUE_LIMIT = 5_000;
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

function clipAudioRole(
  trackType: Composition["tracks"][number]["type"],
  clip: Clip,
): AudioAutomation["role"] {
  return (
    clip.audioAutomation?.role ?? (trackType === "music" ? "music" : "dialogue")
  );
}

/** Sources consumed by the audio graph, shared with application preflight. */
export function audioSourceAssetIds(
  composition: Composition,
  assets: MediaAsset[],
  role?: AudioAutomation["role"],
): Set<string> {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  return new Set(
    composition.tracks
      .filter((track) => track.type !== "titles")
      .flatMap((track) =>
        track.clips.flatMap((clip) => {
          const asset = assetMap.get(clip.assetId);
          return asset &&
            (clip.transform?.volume ?? 1) !== 0 &&
            hasAudio(asset) &&
            (!role || clipAudioRole(track.type, clip) === role)
            ? [clip.assetId]
            : [];
        }),
      ),
  );
}

/** Sources consumed by the picture graph, shared with frame-export preflight. */
export function visualSourceAssetIds(
  composition: Composition,
  assets: MediaAsset[],
): Set<string> {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  return new Set([
    ...composition.tracks
      .filter(
        (track) =>
          track.type !== "titles" &&
          track.type !== "audio" &&
          track.type !== "music",
      )
      .flatMap((track) =>
        track.clips.flatMap((clip) =>
          assetMap.get(clip.assetId)?.mediaType === "audio"
            ? []
            : [
                clip.assetId,
                ...(clip.layout?.secondary
                  ? [clip.layout.secondary.assetId]
                  : []),
              ],
        ),
      ),
    ...graphicSceneAssetIds(composition.graphicScenes ?? []),
  ]);
}

function outputFrameFilters(profile: ExportProfile): string[] {
  if (profile.framing === "contain")
    return [
      `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease`,
      `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "setsar=1",
    ];
  return [
    `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=increase`,
    `crop=${profile.width}:${profile.height}`,
    "setsar=1",
  ];
}

/** Static source/track capabilities shared by rendering and render-required review. */
export function validateRenderClipCapabilities(
  composition: Composition,
  assets: readonly MediaAsset[],
  options: Pick<RenderOptions, "audioOnly" | "videoOnly" | "audioRole"> = {},
): void {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  for (const track of composition.tracks)
    for (const clip of track.clips) {
      if (options.audioOnly && track.type === "titles") continue;
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
        options.videoOnly &&
        (track.type === "audio" ||
          track.type === "music" ||
          asset.mediaType === "audio")
      )
        continue;
      if (
        options.audioOnly &&
        ((clip.transform?.volume ?? 1) === 0 ||
          !hasAudio(asset) ||
          (options.audioRole &&
            clipAudioRole(track.type, clip) !== options.audioRole))
      )
        continue;
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
    const normalizedSettings = {
      ...settings,
      frameRate: projectFrameRate(settings),
    };
    graphicFrameRanges(composition, normalizedSettings);
    composition = structuredClone(composition);
    assets = structuredClone(assets);
    settings = { ...settings };
    const snapshot = options.snapshot
      ? {
          ...options.snapshot,
          sources:
            options.snapshot.sources &&
            structuredClone(options.snapshot.sources),
          fonts:
            options.snapshot.fonts && structuredClone(options.snapshot.fonts),
          fontBindings:
            options.snapshot.fontBindings &&
            structuredClone(options.snapshot.fontBindings),
        }
      : undefined;
    snapshot?.assertCurrent();
    if (snapshot?.fonts && !snapshot.fontBindings)
      throw new Error(
        "Crop approval has no font usage bindings; render a new export frame.",
      );
    const sha256 = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    if (
      snapshot &&
      (snapshot.compositionSha256 !== sha256(composition) ||
        snapshot.settingsSha256 !== sha256(settings) ||
        snapshot.assetsSha256 !== sha256(assets))
    )
      throw new Error(
        "Render plan changed after crop approval; review a new export frame.",
      );
    settings = normalizedSettings;
    const exportProfile = options.exportProfile
      ? validateExportProfile(structuredClone(options.exportProfile))
      : undefined;
    const encoding = resolveRenderQuality(
      exportProfile?.quality ?? options.quality,
    );
    const audioOnly = options.audioOnly ?? false;
    const videoOnly = options.videoOnly ?? false;
    if (audioOnly && videoOnly)
      throw new Error("A render cannot be both audio-only and picture-only.");
    if (exportProfile?.format === "png")
      throw new Error(
        "Still PNG export requires an application-selected frame time.",
      );
    if (
      (exportProfile?.format === "wav" ||
        exportProfile?.format === "audio-stems") !== audioOnly
    )
      throw new Error(
        "WAV and stem profiles require the audio-only export path.",
      );
    if (options.audioRole && !audioOnly)
      throw new Error("Audio role filtering is only available for WAV stems.");
    const project = options.project ? { ...options.project } : undefined;
    const lookOverride =
      options.lookOverride == null
        ? null
        : validateFilmLook(structuredClone(options.lookOverride));
    const nativeCaptionTracks = composition.captionTracks ?? [];
    const selectedCaptionTrackId = audioOnly
      ? undefined
      : options.captionTrackId === undefined
        ? nativeCaptionTracks[0]?.id
        : (options.captionTrackId ?? undefined);
    const selectedCaptionTrack = selectedCaptionTrackId
      ? nativeCaptionTracks.find((track) => track.id === selectedCaptionTrackId)
      : undefined;
    if (selectedCaptionTrackId && !selectedCaptionTrack)
      throw new Error(`Caption track ${selectedCaptionTrackId} was not found.`);
    if (selectedCaptionTrack) {
      if (selectedCaptionTrack.style.role !== "subtitle")
        throw new Error(
          "Native caption tracks require the subtitle text role.",
        );
      if (selectedCaptionTrack.cues.length > RENDER_CAPTION_CUE_LIMIT)
        throw new Error(
          `Native caption rendering supports at most ${RENDER_CAPTION_CUE_LIMIT} cues per track.`,
        );
      for (const cue of selectedCaptionTrack.cues)
        if (
          !Number.isSafeInteger(cue.startMs) ||
          !Number.isSafeInteger(cue.endMs) ||
          cue.startMs < 0 ||
          cue.endMs <= cue.startMs ||
          cue.endMs > CAPTION_LIMITS.timeMs ||
          cue.endMs > composition.duration * 1000 + 1e-7 ||
          !isCaptionTextValid(cue.text) ||
          !cue.text.trim()
        )
          throw new Error(`Caption cue ${cue.id} has invalid text or timing.`);
    }
    if (composition.defaultLook) validateFilmLook(composition.defaultLook);
    for (const entry of composition.beatLooks ?? [])
      validateFilmLook(entry.look);
    for (const track of composition.tracks)
      for (const clip of track.clips)
        if (clip.look) validateFilmLook(clip.look);
    const resolvedLooks = new Map<Clip, FilmLook>();
    const looks: RenderLookEvidence[] = [];
    finite(composition.duration, "Composition duration", true);
    for (const key of ["width", "height", "frameRate"] as const)
      finite(settings[key], key, true);
    if (
      !Number.isInteger(settings.width) ||
      !Number.isInteger(settings.height) ||
      settings.width % 2 ||
      settings.height % 2
    )
      throw new Error("Render dimensions must be even integers");
    const outputFrameRate = Number(
      number(exportProfile?.frameRate ?? settings.frameRate),
    );
    const renderFrameRate = settings.frameRate;
    const outputDuration = audioOnly
      ? composition.duration
      : frameAlignedDuration(composition.duration, outputFrameRate);
    if (outputDuration <= 0)
      throw new Error("Composition must last at least one output frame");
    const outputFrameCount = Math.max(
      1,
      Math.round(outputDuration * outputFrameRate),
    );
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const usedIds = audioOnly
      ? audioSourceAssetIds(composition, assets, options.audioRole)
      : videoOnly
        ? visualSourceAssetIds(composition, assets)
        : new Set(
            composition.tracks
              .filter((track) => track.type !== "titles")
              .flatMap((track) =>
                track.clips.flatMap((clip) => {
                  return [
                    clip.assetId,
                    ...(clip.layout?.secondary
                      ? [clip.layout.secondary.assetId]
                      : []),
                  ];
                }),
              ),
          );
    if (!audioOnly)
      for (const id of graphicSceneAssetIds(composition.graphicScenes ?? [])) {
        if (!assetMap.has(id))
          throw new Error("Graphic image is unavailable in the local catalog.");
        usedIds.add(id);
      }
    const fonts: RenderFontEvidence[] = [];
    const fontBindings: RenderFontBinding[] = [];
    const warnings: string[] = [];
    if (!audioOnly && exportProfile) {
      const savedRatio = settings.width / settings.height;
      const outputRatio = exportProfile.width / exportProfile.height;
      if (Math.abs(savedRatio - outputRatio) > 0.00001)
        warnings.push(
          exportProfile.framing === "contain"
            ? "Profile letterboxes the saved Composition frame with black padding."
            : "Explicit center crop may trim protected subjects or subtitle safe areas; review the export frame.",
        );
    }
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
    validateRenderClipCapabilities(composition, assets, {
      audioOnly,
      videoOnly,
      audioRole: options.audioRole,
    });
    for (const track of composition.tracks)
      for (const clip of track.clips) {
        if (track.type === "titles") continue;
        const asset = assetMap.get(clip.assetId)!;
        if (
          videoOnly &&
          (track.type === "audio" ||
            track.type === "music" ||
            asset.mediaType === "audio")
        )
          continue;
        if (
          audioOnly &&
          ((clip.transform?.volume ?? 1) === 0 ||
            !hasAudio(asset) ||
            (options.audioRole &&
              clipAudioRole(track.type, clip) !== options.audioRole))
        )
          continue;
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
      }
    const sources = await captureRenderSources(
      assets.filter((asset) => usedIds.has(asset.id)),
      options.signal,
    );
    if (snapshot?.sources) {
      const expected = new Map(
        snapshot.sources.map((source) => [source.assetId, source]),
      );
      const visualIds =
        snapshot.sourceScope === "visual"
          ? visualSourceAssetIds(composition, assets)
          : undefined;
      const approvedSources = visualIds
        ? sources.filter((source) => visualIds.has(source.assetId))
        : sources;
      if (
        expected.size !== snapshot.sources.length ||
        expected.size !== approvedSources.length ||
        approvedSources.some((source) => {
          const approved = expected.get(source.assetId);
          return (
            !approved ||
            approved.sha256 !== source.sha256 ||
            approved.size !== source.size
          );
        })
      )
        throw new Error(
          "Source changed after crop approval; review a new export frame.",
        );
    }
    snapshot?.assertCurrent();
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
    const temporaryOutput = join(work, audioOnly ? "mix.wav" : "preview.mp4");
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
    const filters: string[] = audioOnly
      ? []
      : [
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
        if (audioOnly && track.type === "titles") continue;
        const clips = [...track.clips].sort(
          (a, b) => a.timelineStart - b.timelineStart,
        );
        for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
          const clip = clips[clipIndex]!;
          validateClip(clip, composition.duration);
          const start = clip.timelineStart;
          const startFrame = Math.round(start * renderFrameRate);
          // Gate by rounded output ticks: 111/30 can compare below literal 3.7.
          // FFmpeg 6 evaluates enable on both inputs, whose n counters differ;
          // their shifted timestamps share the same output timeline.
          const outputFrame = `round(t*${number(settings.frameRate)})`;
          const endFrame = (length: number) =>
            startFrame + Math.ceil((length - 1e-9) * renderFrameRate);
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
              {
                fontPath: options.fontPathForStyle?.(clip.titleStyle),
              },
            );
            fonts.push({
              family: title.font.family,
              postscriptName: title.font.postscriptName,
              sha256: title.font.sha256,
            });
            fontBindings.push({
              ...fonts.at(-1)!,
              usage: ["title", track.id, clip.id],
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
            const fadeOut = Math.min(title.layout.style.fadeOut, duration);
            const titleFilters = ["format=rgba"];
            if (fadeOut > 0)
              titleFilters.push(
                `fade=t=out:st=${number(duration - fadeOut)}:d=${number(fadeOut)}:alpha=1`,
              );
            // The title raster contains only glyphs and its optional scrim.
            // Fade in clip-local timeline time before shifting the input onto
            // its rounded output start tick; source media remains untouched.
            titleFilters.push(`setpts=PTS-STARTPTS+${startFrame}`);
            filters.push(
              `[${titleInput}:v]${titleFilters.join(",")}[title-source${suffix}]`,
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
          if (
            videoOnly &&
            (track.type === "audio" ||
              track.type === "music" ||
              asset.mediaType === "audio")
          ) {
            pendingTitles.push(addTitle);
            continue;
          }
          if (
            audioOnly &&
            ((clip.transform?.volume ?? 1) === 0 ||
              !hasAudio(asset) ||
              (options.audioRole &&
                clipAudioRole(track.type, clip) !== options.audioRole))
          )
            continue;
          const issue = previewIssue(asset);
          if (issue) throw new Error(`${asset.name}: ${issue}`);
          const { sourceIn, sourceOut, speed } = resolveClipSourceRange(
            clip,
            asset,
          );
          const visual =
            !audioOnly &&
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
          if (!audioOnly) pendingTitles.push(addTitle);
          if (!videoOnly && hasAudio(asset)) {
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
      if (!audioOnly) {
        for (const addTitle of pendingTitles) await addTitle();
        const graphics = await prepareGraphicScenes(
          composition,
          assets,
          settings,
          work,
          {
            signal: options.signal,
            fontPathForStyle: options.fontPathForStyle,
          },
        );
        for (const source of graphics.sources)
          if (
            sources.find((item) => item.assetId === source.assetId)?.sha256 !==
            source.sha256
          )
            throw new Error(
              "Graphic source changed between manifest capture and image preparation.",
            );
        fonts.push(...graphics.fonts);
        fontBindings.push(...graphics.fontBindings);
        warnings.push(...graphics.warnings);
        for (const [index, sequence] of (
          await writeGraphicSequences(graphics, work, options)
        ).entries()) {
          args.push(
            "-framerate",
            number(settings.frameRate),
            "-threads",
            "1",
            "-i",
            sequence.pattern,
          );
          const input = inputIndex++;
          const label = `graphic${index}`;
          filters.push(
            `[${input}:v]format=rgba,setpts=PTS-STARTPTS+${sequence.start}[${label}-source]`,
          );
          filters.push(
            `[${videoLabel}][${label}-source]overlay=x=0:y=0:format=rgb:eval=init:eof_action=pass:repeatlast=0:enable='gte(round(t*${number(settings.frameRate)}),${sequence.start})*lt(round(t*${number(settings.frameRate)}),${sequence.end})'[${label}]`,
          );
          videoLabel = label;
        }
        await graphics.verifySources();
      }
      if (!audioOnly && selectedCaptionTrack) {
        const outputFrame = `round(t*${number(settings.frameRate)})`;
        const cues = [...selectedCaptionTrack.cues].sort(
          (first, second) =>
            first.startMs - second.startMs || first.endMs - second.endMs,
        );
        for (let index = 0; index < cues.length; index++) {
          checkAbort(options.signal);
          const cue = cues[index]!;
          const { startFrame, endFrame } = captionFrameRange(
            cue.startMs,
            cue.endMs,
            settings.frameRate,
          );
          if (endFrame <= startFrame) {
            warnings.push(
              `Caption cue ${cue.id} is shorter than one output frame and was not rendered.`,
            );
            continue;
          }
          const suffix = `caption${index}`;
          const title = await createTitleOverlay(
            cue.text,
            selectedCaptionTrack.style,
            settings,
            join(work, `${suffix}.png`),
            {
              fontPath: options.fontPathForStyle?.(selectedCaptionTrack.style),
            },
          );
          fonts.push({
            family: title.font.family,
            postscriptName: title.font.postscriptName,
            sha256: title.font.sha256,
          });
          fontBindings.push({
            ...fonts.at(-1)!,
            usage: ["caption", selectedCaptionTrack.id, cue.id],
          });
          warnings.push(...title.warnings);
          for (const warning of cue.warnings ?? [])
            warnings.push(
              warning === "timing-estimated"
                ? `Caption cue ${cue.id} uses estimated segment timing; review its appearance manually.`
                : `Caption cue ${cue.id} has stale transcript alignment; review its appearance manually.`,
            );
          args.push(
            "-loop",
            "1",
            "-framerate",
            number(settings.frameRate),
            "-threads",
            "1",
            "-i",
            title.path,
          );
          const captionInput = inputIndex++;
          filters.push(
            `[${captionInput}:v]format=rgba,setpts=PTS-STARTPTS+${startFrame}[${suffix}-source]`,
          );
          filters.push(
            `[${videoLabel}][${suffix}-source]overlay=x=0:y=0:format=rgb:eval=init:eof_action=pass:repeatlast=0:enable='gte(${outputFrame},${startFrame})*lt(${outputFrame},${endFrame})'[${suffix}]`,
          );
          videoLabel = suffix;
        }
      }
      if (!audioOnly) {
        const finalVideoFilters = exportProfile
          ? [
              // Pad before fps rounds the composed EOF: FFmpeg 6 can otherwise
              // discard the only frame. Trim keeps the exact complete count.
              "tpad=stop_mode=clone:stop=-1",
              `fps=${number(outputFrameRate)}:round=near`,
              ...outputFrameFilters(exportProfile),
              "format=yuv420p",
              `trim=end_frame=${outputFrameCount}`,
            ]
          : ["format=yuv420p"];
        filters.push(`[${videoLabel}]${finalVideoFilters.join(",")}[vout]`);
      }
      if (!videoOnly && audioLabels.length)
        filters.push(
          `${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95,apad,atrim=duration=${number(composition.duration)}[aout]`,
        );
      else if (!videoOnly)
        filters.push(
          `anullsrc=r=48000:cl=stereo,atrim=duration=${number(composition.duration)}[aout]`,
        );
      args.push(
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        filters.join(";"),
      );
      if (!audioOnly)
        args.push(
          "-map",
          "[vout]",
          "-c:v",
          encoding.video,
          "-threads",
          "1",
          "-preset",
          encoding.preset,
          "-crf",
          String(encoding.crf),
          "-pix_fmt",
          "yuv420p",
          "-r",
          number(outputFrameRate),
        );
      if (!videoOnly) args.push("-map", "[aout]");
      if (audioOnly)
        args.push(
          "-vn",
          "-c:a",
          "pcm_s24le",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-t",
          number(outputDuration),
          "-y",
          temporaryOutput,
        );
      else
        args.push(
          ...(videoOnly ? ["-an"] : ["-c:a", "aac", "-ar", "48000"]),
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
      if (
        snapshot?.fontBindings &&
        sha256(canonicalRenderFontBindings(fontBindings)) !==
          sha256(canonicalRenderFontBindings(snapshot.fontBindings))
      )
        throw new Error(
          "Rendered font assignments changed after crop approval; render a new export frame.",
        );
      if (
        snapshot?.fonts &&
        sha256(canonicalRenderFonts(fonts)) !==
          sha256(canonicalRenderFonts(snapshot.fonts))
      )
        throw new Error(
          "Rendered fonts changed after crop approval; render a new export frame.",
        );
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
        {
          format: audioOnly ? "wav" : "mp4",
          fontBindings,
          ...(videoOnly ? { videoOnly } : {}),
          ...(exportProfile ? { exportProfile } : {}),
          ...(options.audioRole ? { audioRole: options.audioRole } : {}),
        },
      );
      if (snapshot?.sources)
        for (const source of sources)
          if (
            (await hashFile(localPath(source.uri), options.signal)) !==
            source.sha256
          )
            throw new Error(`Source changed during render: ${source.name}`);
      await publishRenderPair(temporaryOutput, manifestPath, output, work, {
        assertCurrent:
          snapshot &&
          (() => {
            checkAbort(options.signal);
            snapshot.assertCurrent();
            for (const source of sources) {
              const current = statSync(localPath(source.uri));
              if (
                current.size !== source.size ||
                current.mtime.toISOString() !== source.modifiedAt
              )
                throw new Error(`Source changed during render: ${source.name}`);
            }
          }),
      });
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

export * from "./audio-quality.js";
