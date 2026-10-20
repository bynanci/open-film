import { pipeline } from "node:stream/promises";
// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  createWriteStream,
  readFileSync,
  renameSync,
  lstatSync,
} from "node:fs";
import { lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  graphicSceneAssetIds,
  frameAlignedDuration,
  type Composition,
  type MediaAsset,
  type OpenFilmProject,
} from "@openfilm/core";
import {
  createHandoffPlan,
  exportTimeline,
  serializeCaptions,
  type HandoffOptions,
  type HandoffPlan,
} from "@openfilm/exporters";
import {
  checkAbort,
  hashFile,
  localPath,
  localMediaInputOptions,
  runProcess,
  safeProjectCachePath,
} from "@openfilm/media";
import { archiveHandoff } from "./handoff-archive.js";
export interface HandoffHost {
  directory: string;
  readonly project: OpenFilmProject;
  getSourceAsset(id: string): MediaAsset | undefined;
  render(
    composition: Composition,
    output: string,
    signal?: AbortSignal,
    captionTrackId?: string | null,
  ): Promise<string>;
}
export interface HandoffReview {
  projectId: string;
  revision: string;
  plan: HandoffPlan;
}
export interface HandoffRequest extends HandoffOptions {
  projectId: string;
  compositionId: string;
  revision: string;
}
export interface HandoffPublication {
  version: 1;
  id: string;
  projectId: string;
  revision: string;
  plan: HandoffPlan;
  files: { name: string; sha256: string; bytes: number }[];
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const binding = (p: OpenFilmProject) => ({
  id: p.id,
  settings: p.settings,
  timelines: p.timelines,
});
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function options(input: HandoffOptions): HandoffOptions {
  return {
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.bakeAudio !== undefined ? { bakeAudio: input.bakeAudio } : {}),
    ...(input.captionTrackId !== undefined
      ? { captionTrackId: input.captionTrackId }
      : {}),
  };
}
function hasEmbeddedAudio(asset: MediaAsset): boolean {
  if (!["video", "360-video"].includes(asset.mediaType)) return false;
  const probe = asset.metadata["openfilm.ffprobe"] as
    { streams?: { codec_type?: string }[] } | undefined;
  return probe?.streams?.some((s) => s.codec_type === "audio") ?? false;
}
/** Exclusive bounded streaming transport; owner cancellation closes both handles. */
export async function copyHandoffSource(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  checkAbort(signal);
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    checkAbort(signal);
    await pipeline(
      input.createReadStream({ signal }),
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      { signal },
    );
  } finally {
    await input.close();
  }
}
export class NleHandoffService {
  constructor(private readonly host: HandoffHost) {}
  private snapshot(compositionId: string): {
    composition: Composition;
    revision: string;
  } {
    const path = join(this.host.directory, "project.json");
    // This fence is synchronous so publication cannot interleave with a save.
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Unsafe saved project");
    const saved = JSON.parse(readFileSync(path, "utf8")) as OpenFilmProject;
    if (digest(binding(saved)) !== digest(binding(this.host.project)))
      throw new Error(
        "Stale or unsaved handoff revision; save/reopen before retry",
      );
    const composition = saved.timelines.find((c) => c.id === compositionId);
    if (!composition) throw new Error("Handoff composition not found");
    return {
      composition: structuredClone(composition),
      revision: digest(binding(saved)),
    };
  }
  review(compositionId: string, input: HandoffOptions = {}): HandoffReview {
    const { composition, revision } = this.snapshot(compositionId);
    return {
      projectId: this.host.project.id,
      revision,
      plan: this.plan(composition, input),
    };
  }
  private plan(composition: Composition, input: HandoffOptions): HandoffPlan {
    const plan = createHandoffPlan(
      composition,
      this.host.project.settings.frameRate,
      input,
    );
    const rate = plan.rate.numerator / plan.rate.denominator;
    for (const track of composition.tracks.filter((t) =>
      ["video", "overlay"].includes(t.type),
    ))
      for (const clip of track.clips) {
        const asset = this.host.getSourceAsset(clip.assetId);
        if (!asset || !hasEmbeddedAudio(asset)) continue;
        const manual =
          (clip.transform?.speed ?? 1) !== 1 ||
          (clip.transform?.volume ?? 1) !== 1 ||
          !!clip.audioAutomation;
        plan.items.push({
          ownerId: clip.id,
          feature: "embeddedAudio",
          startFrame: clip.timelineStart * rate,
          endFrame: (clip.timelineStart + clip.timelineDuration) * rate,
          disposition: plan.bakeAudio
            ? "baked"
            : manual
              ? "metadata-only"
              : "native-editable",
          reason: plan.bakeAudio
            ? "Included in explicit rendered full mix"
            : "Embedded source audio is projected to a separate Audio track; retime, gain and automation need manual recreation when authored",
        });
      }
    return plan;
  }
  async publish(
    input: HandoffRequest,
    signal?: AbortSignal,
  ): Promise<HandoffPublication> {
    checkAbort(signal);
    if (
      Object.keys(input).some(
        (k) =>
          ![
            "projectId",
            "compositionId",
            "revision",
            "mode",
            "bakeAudio",
            "captionTrackId",
          ].includes(k),
      )
    )
      throw new Error("Unsupported handoff request");
    const review = this.review(input.compositionId, options(input));
    if (
      review.projectId !== input.projectId ||
      review.revision !== input.revision
    )
      throw new Error("Stale handoff revision");
    const { composition } = this.snapshot(input.compositionId);
    const settings = structuredClone(this.host.project.settings),
      plan = review.plan;
    // Validate all existing exporter bounds and scene contracts before IO/render.
    const ids = [
      ...new Set([
        ...graphicSceneAssetIds(composition.graphicScenes ?? []),
        ...composition.tracks.flatMap((t) =>
          t.clips.flatMap((c) => [
            c.assetId,
            ...(c.layout?.secondary ? [c.layout.secondary.assetId] : []),
          ]),
        ),
      ]),
    ];
    const assets = ids.map((id) => {
      const asset = this.host.getSourceAsset(id);
      if (!asset) throw new Error("Missing handoff source");
      return structuredClone(asset);
    });
    exportTimeline("otio", composition, assets, settings);
    const id = randomUUID();
    const staging = await safeProjectCachePath(
      this.host.directory,
      "nle-handoff",
      id,
    );
    await mkdir(staging, { mode: 0o700 });
    let published = false;
    try {
      const files: string[] = [];
      const write = async (name: string, content: string) => {
        await writeFile(join(staging, name), content, {
          flag: "wx",
          mode: 0o600,
        });
        files.push(name);
      };
      if (assets.length > 256 || composition.duration > 3600)
        throw new Error("Handoff resource limit exceeded");
      const references: { assetId: string; sha256: string; file: string }[] =
        [];
      const originals: MediaAsset[] = [];
      await mkdir(join(staging, "media"), { mode: 0o700 });
      let sourceBytes = 0;
      for (const [index, asset] of assets.entries()) {
        checkAbort(signal);
        const path = localPath(asset.uri);
        const info = await lstat(path);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.size > 2 * 1024 ** 3
        )
          throw new Error("Missing, unsafe or oversized handoff source");
        sourceBytes += info.size;
        if (sourceBytes > 1024 ** 3)
          throw new Error("Handoff source size limit exceeded");
        const sha256 = await hashFile(path, signal);
        if (!asset.contentHash || asset.contentHash !== sha256)
          throw new Error("Handoff source hash mismatch");
        const extension = extname(path).toLowerCase();
        if (
          !/^(?:\.(?:png|jpg|jpeg|webp|gif|bmp|tif|tiff|heic|avif|mp4|mov|mkv|webm|avi|m4v|mts|m2ts|mpg|mpeg|wav|mp3|flac|aac|m4a|ogg|opus|aif|aiff))$/u.test(
            extension,
          )
        )
          throw new Error("Unsupported source extension");
        const sourceProbe = await runProcess(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,duration:format=duration",
            "-of",
            "json",
            ...(await localMediaInputOptions(path, signal)),
            path,
          ],
          { signal },
        );
        const inspected = JSON.parse(sourceProbe.stdout.toString()) as {
          streams: { codec_type: string; duration?: string }[];
          format?: { duration?: string };
        };
        const streams = inspected.streams;
        if (asset.mediaType !== "image") {
          const type = asset.mediaType === "audio" ? "audio" : "video";
          const duration = Number(
            streams.find((s) => s.codec_type === type)?.duration ??
              inspected.format?.duration,
          );
          if (!Number.isFinite(duration) || duration <= 0)
            throw new Error("Source duration cannot be verified");
          for (const clip of composition.tracks
            .flatMap((t) => t.clips)
            .filter((c) => c.assetId === asset.id)) {
            const end =
              clip.sourceOut ??
              (clip.sourceIn ?? 0) +
                clip.timelineDuration * (clip.transform?.speed ?? 1);
            if (end > duration + 1e-5)
              throw new Error("Source bounds exceed inspected media duration");
          }
        }
        if (
          !streams.some(
            (stream) =>
              stream.codec_type ===
              (asset.mediaType === "audio" ? "audio" : "video"),
          )
        )
          throw new Error("Unsupported source stream");
        if (
          ["video", "360-video"].includes(asset.mediaType) &&
          streams.some((stream) => stream.codec_type === "audio") !==
            hasEmbeddedAudio(asset)
        )
          throw new Error(
            "Source audio metadata differs; refresh source inspection before handoff",
          );
        const file = `media/source-${index}${extension}`;
        await copyHandoffSource(path, join(staging, file), signal);
        if ((await hashFile(join(staging, file), signal)) !== sha256)
          throw new Error("Copied source hash mismatch");
        files.push(file);
        references.push({ assetId: asset.id, sha256, file });
        originals.push({
          ...asset,
          uri: file,
          name: `Source ${index + 1}`,
          metadata: {
            "openfilm.reference": {
              id: asset.id,
              uri: file,
              type: "file",
              relativePath: file,
              contentHash: sha256,
            },
          },
        });
      }
      const mappings: {
        kind: string;
        clipId: string;
        sourceOwnerIds: string[];
        startFrame: number;
        endFrame: number;
        file?: string;
      }[] = [];
      const exchange = structuredClone(composition);
      const bakedAssets: MediaAsset[] = [];
      if (!plan.bakeAudio) {
        for (const [trackIndex, track] of composition.tracks
          .filter((t) => ["video", "overlay"].includes(t.type))
          .entries()) {
          const frameRate = plan.rate.numerator / plan.rate.denominator;
          track.clips
            .filter((c) =>
              hasEmbeddedAudio(assets.find((a) => a.id === c.assetId)!),
            )
            .forEach((clip, index) =>
              mappings.push({
                kind: "native-audio",
                clipId: `handoff-${review.revision}-audio-${trackIndex}-${index}`,
                sourceOwnerIds: [clip.id],
                startFrame: clip.timelineStart * frameRate,
                endFrame:
                  (clip.timelineStart + clip.timelineDuration) * frameRate,
              }),
            );
          const clips = track.clips
            .filter((c) =>
              hasEmbeddedAudio(assets.find((a) => a.id === c.assetId)!),
            )
            .map((clip, index) => ({
              id: `handoff-${review.revision}-audio-${trackIndex}-${index}`,
              assetId: clip.assetId,
              timelineStart: clip.timelineStart,
              timelineDuration: clip.timelineDuration,
              sourceIn: clip.sourceIn,
              sourceOut: clip.sourceOut,
              ...(clip.transform
                ? {
                    transform: {
                      speed: clip.transform.speed ?? 1,
                      volume: clip.transform.volume ?? 1,
                    },
                  }
                : {}),
              ...(clip.audioAutomation
                ? { audioAutomation: clip.audioAutomation }
                : {}),
              ...(clip.locked ? { locked: true } : {}),
            }));
          if (clips.length)
            exchange.tracks.push({
              id: `handoff-${review.revision}-source-audio-${trackIndex}`,
              type: "audio",
              clips,
            });
        }
      }

      if (plan.visualRanges.length || plan.bakeAudio) {
        const reference = join(staging, "reference.mp4");
        await this.host.render(
          composition,
          reference,
          signal,
          plan.captionTrackId,
        );
        const manifest = JSON.parse(
          await readFile(`${reference}.manifest.json`, "utf8"),
        ) as {
          warnings: string[];
          fonts: { family: string; postscriptName: string; sha256: string }[];
          outputSha256: string;
          compositionSha256: string;
        };
        if ((await hashFile(reference, signal)) !== manifest.outputSha256)
          throw new Error("Reference output hash mismatch");
        const referenceProof = await this.probe(reference, signal);
        if (
          Number(referenceProof.nb_read_frames) !==
          Math.round(
            frameAlignedDuration(composition.duration, settings.frameRate) *
              settings.frameRate,
          )
        )
          throw new Error("Reference frame count mismatch");
        await write(
          "render-evidence.json",
          JSON.stringify(
            {
              version: 1,
              outputSha256: manifest.outputSha256,
              compositionSha256: manifest.compositionSha256,
              fonts: manifest.fonts,
              warnings: manifest.warnings.map((message) =>
                /Requested font/u.test(message)
                  ? "font.fallback"
                  : /shorter than one output frame/u.test(message)
                    ? "caption.short"
                    : /estimated segment/u.test(message)
                      ? "caption.estimated"
                      : /stale transcript/u.test(message)
                        ? "caption.stale"
                        : "renderer.warning",
              ),
              measured: referenceProof,
              realNleVerified: false,
            },
            null,
            2,
          ) + "\n",
        );
        // Keep actual output and a path-free subset of its manifest as evidence.
        files.push("reference.mp4", "reference.mp4.manifest.json");
        const rate = plan.rate.numerator / plan.rate.denominator;
        for (const [index, range] of plan.visualRanges.entries()) {
          const name = `media/precomp-${index}.mp4`,
            duration = (range.endFrame - range.startFrame) / rate;
          await runProcess(
            "ffmpeg",
            [
              "-v",
              "error",
              "-i",
              reference,
              "-vf",
              `trim=start_frame=${range.startFrame}:end_frame=${range.endFrame},setpts=PTS-STARTPTS`,
              "-an",
              "-r",
              `${plan.rate.numerator}/${plan.rate.denominator}`,
              "-c:v",
              "libx264",
              "-crf",
              "12",
              "-pix_fmt",
              "yuv420p",
              "-threads",
              "1",
              "-y",
              join(staging, name),
            ],
            { signal },
          );
          const proof = await this.probe(join(staging, name), signal);
          if (
            Number(proof.nb_read_frames) !==
              range.endFrame - range.startFrame ||
            Number(proof.width) !== settings.width ||
            Number(proof.height) !== settings.height ||
            proof.avg_frame_rate
              ?.split("/")
              .map(Number)
              .reduce((n, d) => n / d) !== rate ||
            Math.abs(Number(proof.duration) - duration) > 1e-5 ||
            Math.abs(Number(proof.start_time)) > 1e-5
          )
            throw new Error(
              `Baked frame count/dimensions mismatch: ${JSON.stringify(proof)} expected ${range.endFrame - range.startFrame}`,
            );
          files.push(name);
          const assetId = `handoff-${id}-precomp-${index}`;
          mappings.push({
            kind: "visual-precomp",
            clipId: assetId,
            file: name,
            sourceOwnerIds: [
              ...new Set(
                plan.items
                  .filter(
                    (item) =>
                      item.startFrame < range.endFrame &&
                      item.endFrame > range.startFrame,
                  )
                  .map((item) => item.ownerId),
              ),
            ],
            ...range,
          });
          bakedAssets.push({
            id: assetId,
            uri: name,
            name: `Opaque precomp ${index + 1}`,
            mediaType: "video",
            duration,
            contentHash: await hashFile(join(staging, name), signal),
            tags: [],
            state: {},
            metadata: {},
          } as MediaAsset);
          for (const track of exchange.tracks) {
            if (["audio", "music"].includes(track.type)) continue;
            track.clips = track.clips.flatMap((clip) => {
              const start = clip.timelineStart,
                end = start + clip.timelineDuration,
                from = range.startFrame / rate,
                to = range.endFrame / rate;
              if (end <= from + 1e-7 || start >= to - 1e-7) return [clip];
              const parts = [];
              if (start < from - 1e-7) parts.push({ start, end: from });
              if (end > to + 1e-7) parts.push({ start: to, end });
              return parts.map((part, i) => ({
                ...clip,
                id: `${clip.id}-part-${index}-${i}`,
                timelineStart: part.start,
                timelineDuration: part.end - part.start,
                sourceIn:
                  (clip.sourceIn ?? 0) +
                  (part.start - start) * (clip.transform?.speed ?? 1),
                sourceOut:
                  (clip.sourceIn ?? 0) +
                  (part.end - start) * (clip.transform?.speed ?? 1),
              }));
            });
          }
          exchange.tracks.push({
            id: `handoff-${id}-track-${index}`,
            type: "video",
            clips: [
              {
                id: assetId,
                assetId,
                timelineStart: range.startFrame / rate,
                timelineDuration: duration,
                sourceIn: 0,
                sourceOut: duration,
              },
            ],
          });
        }
        if (plan.bakeAudio) {
          const name = "media/full-mix.wav";
          await runProcess(
            "ffmpeg",
            [
              "-v",
              "error",
              "-i",
              reference,
              "-vn",
              "-af",
              `aresample=48000,apad,atrim=end_sample=${Math.round(composition.duration * 48000)},asetpts=PTS-STARTPTS`,
              "-c:a",
              "pcm_s24le",
              "-ar",
              "48000",
              "-y",
              join(staging, name),
            ],
            { signal },
          );
          const measured = await runProcess(
            "ffprobe",
            [
              "-v",
              "error",
              "-select_streams",
              "a:0",
              "-show_entries",
              "stream=duration_ts,time_base,sample_rate,codec_name",
              "-of",
              "json",
              join(staging, name),
            ],
            { signal },
          );
          const audio = (
            JSON.parse(measured.stdout.toString()) as {
              streams: {
                duration_ts: number;
                time_base: string;
                sample_rate: string;
                codec_name: string;
              }[];
            }
          ).streams[0];
          if (
            !audio ||
            audio.duration_ts !== Math.round(composition.duration * 48000) ||
            audio.time_base !== "1/48000" ||
            audio.sample_rate !== "48000" ||
            audio.codec_name !== "pcm_s24le"
          )
            throw new Error("Full mix sample alignment mismatch");
          await write(
            "mix-evidence.json",
            JSON.stringify({ version: 1, ...audio }, null, 2) + "\n",
          );
          files.push(name);
          mappings.push({
            kind: "full-mix",
            clipId: `handoff-${id}-full-mix`,
            file: name,
            sourceOwnerIds: composition.tracks.flatMap((t) =>
              t.clips.map((c) => c.id),
            ),
            startFrame: 0,
            endFrame: plan.durationFrames,
          });
          bakedAssets.push({
            id: `handoff-${id}-full-mix`,
            uri: name,
            name: "Rendered full mix",
            mediaType: "audio",
            duration: composition.duration,
            contentHash: await hashFile(join(staging, name), signal),
            tags: [],
            state: {},
            metadata: {},
          } as MediaAsset);
          exchange.tracks = exchange.tracks.filter(
            (t) => !["audio", "music"].includes(t.type),
          );
          exchange.tracks.push({
            id: `handoff-${id}-mix-track`,
            type: "audio",
            clips: [
              {
                id: `handoff-${id}-full-mix`,
                assetId: `handoff-${id}-full-mix`,
                sourceIn: 0,
                sourceOut: composition.duration,
                timelineStart: 0,
                timelineDuration: composition.duration,
              },
            ],
          });
        }
        if (plan.visualRanges.length) exchange.graphicScenes = [];
        if (plan.visualRanges.length) exchange.graphicSceneTemplates = [];
        // All selected caption cues are included in the visual precomp intervals.
        if (plan.visualRanges.length)
          exchange.captionTracks = (composition.captionTracks ?? []).filter(
            (t) => t.id !== plan.captionTrackId,
          );
      }
      for (const [index, track] of (composition.captionTracks ?? []).entries())
        for (const format of ["srt", "vtt"] as const) {
          if (!track.cues.length) continue;
          await write(
            `captions-${index}.${format}`,
            serializeCaptions(format, track.cues).content,
          );
        }
      const timeline = JSON.parse(
        exportTimeline(
          "otio",
          exchange,
          [...originals, ...bakedAssets],
          settings,
        ).content,
      ) as { metadata: { openfilm: Record<string, unknown> } };
      timeline.metadata.openfilm.originalComposition = composition;
      timeline.metadata.openfilm.handoff = {
        ...review,
        sources: references,
        mappings,
      };
      await write("timeline.otio", JSON.stringify(timeline, null, 2) + "\n");
      await write(
        "provenance.json",
        JSON.stringify(
          {
            version: 1,
            ...review,
            originalComposition: composition,
            sources: references,
            mappings,
          },
          null,
          2,
        ) + "\n",
      );
      // Do not distribute renderer manifests with original absolute source paths.
      if (files.includes("reference.mp4.manifest.json")) {
        await rm(join(staging, "reference.mp4.manifest.json"));
        files.splice(files.indexOf("reference.mp4.manifest.json"), 1);
      }
      const publication: HandoffPublication = {
        version: 1,
        id,
        projectId: review.projectId,
        revision: review.revision,
        plan,
        files: [],
      };
      for (const name of files) {
        checkAbort(signal);
        publication.files.push({
          name,
          sha256: await hashFile(join(staging, name), signal),
          bytes: (await lstat(join(staging, name))).size,
        });
      }
      await writeFile(
        join(staging, "handoff.json"),
        JSON.stringify(publication, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      await archiveHandoff(staging, [...files, "handoff.json"], signal);
      publication.files.push({
        name: "handoff.tar",
        sha256: await hashFile(join(staging, "handoff.tar"), signal),
        bytes: (await lstat(join(staging, "handoff.tar"))).size,
      });
      await writeFile(
        join(staging, "handoff.json"),
        JSON.stringify(publication, null, 2) + "\n",
        { mode: 0o600 },
      );
      for (const asset of assets) {
        const current = this.host.getSourceAsset(asset.id);
        if (
          !current ||
          current.uri !== asset.uri ||
          current.contentHash !== asset.contentHash
        )
          throw new Error("Source mapping changed during handoff");
      }
      for (const asset of assets) {
        if (
          (await hashFile(localPath(asset.uri), signal)) !== asset.contentHash
        )
          throw new Error("Handoff source changed during export");
      }
      const target = await safeProjectCachePath(
        this.host.directory,
        "nle-handoff-published",
        id,
      );
      checkAbort(signal);
      if (this.snapshot(input.compositionId).revision !== review.revision)
        throw new Error("Stale handoff revision");
      renameSync(staging, target);
      published = true;
      return publication;
    } finally {
      if (!published) await rm(staging, { recursive: true, force: true });
    }
  }
  private async probe(
    path: string,
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    const result = await runProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-count_frames",
        "-show_entries",
        "stream=width,height,nb_read_frames,avg_frame_rate,start_time,duration",
        "-of",
        "json",
        path,
      ],
      { signal },
    );
    return (
      (
        JSON.parse(result.stdout.toString()) as {
          streams: Record<string, string>[];
        }
      ).streams[0] ?? {}
    );
  }
  async file(id: string, index: number): Promise<string> {
    if (!uuid.test(id) || !Number.isSafeInteger(index) || index < 0)
      throw new Error("Invalid handoff file");
    const root = await safeProjectCachePath(
      this.host.directory,
      "nle-handoff-published",
      id,
    );
    const manifestPath = join(root, "handoff.json");
    const info = await lstat(manifestPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 4 * 1024 ** 2
    )
      throw new Error("Unsafe handoff manifest");
    const receipt = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as HandoffPublication;
    if (receipt.id !== id || receipt.projectId !== this.host.project.id)
      throw new Error("Wrong handoff owner");
    const name =
      index === receipt.files.length
        ? "handoff.json"
        : receipt.files[index]?.name;
    if (!name || !/^(?:media\/)?[a-z0-9][a-z0-9.-]*$/u.test(name))
      throw new Error("Unsafe handoff file name");
    const path = await safeProjectCachePath(
      this.host.directory,
      "nle-handoff-published",
      id,
      ...name.split("/"),
    );
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error("Unsafe handoff file");
    if (
      index < receipt.files.length &&
      (await hashFile(path)) !== receipt.files[index]!.sha256
    )
      throw new Error("Handoff file hash mismatch");
    return path;
  }
}
