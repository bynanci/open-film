// Modified by OpenFilm contributors on 2026-10-19. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  migrateProject,
  type GraphicNode,
  type Composition,
  type Job,
  type MediaAsset,
  type OpenFilmProject,
  type TitleStyle,
} from "@openfilm/core";
import { ProjectCatalog } from "@openfilm/catalog";
import {
  checkAbort,
  hashFile,
  localPath,
  previewIssue,
  runProcess,
  safeProjectCachePath,
  sourceStatus,
} from "@openfilm/media";
import {
  inspectGraphicImage,
  inspectTitleOverlay,
  prepareGraphicScenes,
} from "@openfilm/render";
import { isInside } from "./path-safety.js";

export type VisualQaIssueCode =
  | "asset.missing"
  | "asset.changed"
  | "asset.unsupported"
  | "graphics.resource-limit"
  | "font.load-failed"
  | "title.overflow"
  | "visual.suspected-blank"
  | "revision.stale"
  | "photo-depth.mask-missing"
  | "photo-depth.background-missing"
  | "photo-depth.mask-invalid"
  | "photo-depth.mask-mismatch"
  | "photo-depth.mask-empty"
  | "photo-depth.mask-holes"
  | "photo-depth.protected-region"
  | "photo-depth.source-changed"
  | "photo-depth.fallback-used"
  | "photo-depth.manual-review";

export type VisualQaIssueSeverity = "error" | "warning" | "manual-review";

export interface VisualQaIssue {
  code: VisualQaIssueCode;
  severity: VisualQaIssueSeverity;
  at: number;
  clipId?: string;
  assetId?: string;
  captionTrackId?: string;
  cueId?: string;
  graphicSceneId?: string;
  nodeId?: string;
  photoDepthPart?: "mask" | "background";
  /** Stable detail key; user-authored title text and filesystem paths are omitted. */
  detail?: "unavailable" | "fallback-used" | "missing-glyph" | "changed";
  manualReview: boolean;
}

export interface VisualQaSample {
  index: number;
  timestamp: number;
  frameIndex: number;
  sha256: string;
  width: number;
  height: number;
  luma: { average: number; low: number; high: number };
}

export interface VisualQaReport {
  version: 1;
  id: string;
  projectId: string;
  compositionId: string;
  compositionRevision: string;
  createdAt: string;
  status: "complete" | "incomplete" | "stale";
  settings: { width: number; height: number; frameRate: number };
  output?: { sha256: string; duration: number; frameCount: number };
  sources: { assetId: string; sha256: string }[];
  samples: VisualQaSample[];
  issues: VisualQaIssue[];
}

export interface VisualQaOptions {
  signal?: AbortSignal;
  jobId?: string;
  onProgress?: (progress: number) => void;
}

export interface VisualQaRenderOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface VisualQaHost {
  readonly directory: string;
  readonly catalog: ProjectCatalog;
  readonly project: OpenFilmProject;
  titleFontPath?(style: TitleStyle | undefined): string | undefined;
  getSourceAsset(assetId: string): MediaAsset | undefined;
  renderForVisualQa(
    compositionId: string,
    outputPath: string,
    options: VisualQaRenderOptions,
  ): Promise<string>;
}

const UUID =
  /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u;
const MAX_SAMPLES = 12;
const MAX_FRAME_WIDTH = 320;

class StaleVisualQaError extends Error {}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function frameTime(time: number, frameRate: number): number {
  return Math.round(time * frameRate) / frameRate;
}

function issue(
  code: VisualQaIssueCode,
  severity: VisualQaIssueSeverity,
  at: number,
  frameRate: number,
  extra: Pick<
    VisualQaIssue,
    | "clipId"
    | "assetId"
    | "captionTrackId"
    | "cueId"
    | "graphicSceneId"
    | "nodeId"
    | "photoDepthPart"
    | "detail"
  > = {},
): VisualQaIssue {
  return {
    code,
    severity,
    at: frameTime(at, frameRate),
    ...extra,
    manualReview: severity === "manual-review",
  };
}

type SourceOccurrence = {
  at: number;
  clipId?: string;
  graphicSceneId?: string;
  nodeId?: string;
  photoDepthPart?: "mask" | "background";
};
function uniqueSources(
  composition: Composition,
): Map<string, SourceOccurrence[]> {
  const times = new Map<string, SourceOccurrence[]>();
  for (const track of composition.tracks) {
    if (track.type === "titles") continue;
    for (const clip of track.clips) {
      for (const assetId of [
        clip.assetId,
        ...(clip.layout?.secondary ? [clip.layout.secondary.assetId] : []),
      ]) {
        const list = times.get(assetId) ?? [];
        list.push({ at: clip.timelineStart, clipId: clip.id });
        times.set(assetId, list);
      }
    }
  }
  for (const scene of composition.graphicScenes ?? []) {
    const visit = (nodes: readonly GraphicNode[], parentStart = 0) => {
      for (const node of nodes) {
        const at = Math.max(parentStart, node.start);
        if (node.type === "image") {
          const list = times.get(node.assetId) ?? [];
          list.push({
            at: scene.start + at,
            graphicSceneId: scene.id,
            nodeId: node.id,
          });
          times.set(node.assetId, list);
        } else if (node.type === "group") visit(node.children, at);
      }
    };
    visit(scene.nodes);
    if (scene.photoDepth?.mode === "parallax") {
      const node = scene.nodes.find(
        (item) => item.id === scene.photoDepth!.nodeId && item.type === "image",
      );
      const at = scene.start + (node?.start ?? 0);
      const addDepthSource = (assetId: string, part: "mask" | "background") => {
        const occurrences = times.get(assetId) ?? [];
        occurrences.push({
          at,
          graphicSceneId: scene.id,
          nodeId: scene.photoDepth!.nodeId,
          photoDepthPart: part,
        });
        times.set(assetId, occurrences);
      };
      addDepthSource(scene.photoDepth.maskAssetId!, "mask");
      if (scene.photoDepth.background?.kind === "asset")
        addDepthSource(scene.photoDepth.background.assetId, "background");
    }
  }
  return times;
}

async function savedProject(directory: string): Promise<OpenFilmProject> {
  const path = join(directory, "project.json");
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error("Saved project file is not a regular file");
  return migrateProject(JSON.parse(await readFile(path, "utf8")));
}

/** Read-only counterpart to safeProjectCachePath: missing parents stay missing. */
async function existingProjectCachePath(
  directory: string,
  ...segments: string[]
): Promise<string | undefined> {
  const projectRoot = await realpath(directory);
  const cacheRoot = join(projectRoot, "cache");
  const target = resolve(cacheRoot, ...segments);
  const rel = relative(cacheRoot, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    return undefined;
  const components = ["cache", ...rel.split(sep)];
  let cursor = projectRoot;
  for (let index = 0; index < components.length; index++) {
    cursor = join(cursor, components[index]!);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (info.isSymbolicLink()) return undefined;
    if (index < components.length - 1 && !info.isDirectory()) return undefined;
  }
  return target;
}

function numberFrom(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}

function rational(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/u.exec(value);
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = match[2] ? Number(match[2]) : 1;
  const result = numerator / denominator;
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function parseProbe(stdout: Buffer): {
  width: number;
  height: number;
  frameRate: number;
  frameCount: number;
  duration: number;
} {
  const value = JSON.parse(stdout.toString("utf8")) as {
    streams?: {
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      nb_read_frames?: string;
      duration?: string;
    }[];
    format?: { duration?: string };
  };
  const stream = value.streams?.[0];
  const frameRate = stream?.avg_frame_rate
    ? rational(stream.avg_frame_rate)
    : undefined;
  const frameCount = numberFrom(stream?.nb_read_frames);
  const duration = numberFrom(stream?.duration ?? value.format?.duration);
  if (
    !stream?.width ||
    !stream.height ||
    !frameRate ||
    !frameCount ||
    !duration
  )
    throw new Error("FFprobe could not verify the Visual QA MP4 stream");
  return {
    width: stream.width,
    height: stream.height,
    frameRate,
    frameCount,
    duration,
  };
}

function parseMetric(stderr: string, name: "YAVG" | "YLOW" | "YHIGH") {
  return [
    ...stderr.matchAll(
      new RegExp(`lavfi\\.signalstats\\.${name}=([\\d.]+)`, "gu"),
    ),
  ].map((match) => Number(match[1]));
}

function pngSize(
  path: string,
  bytes: Buffer,
): { width: number; height: number } {
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw new Error(`FFmpeg did not produce a valid PNG sample: ${path}`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > MAX_FRAME_WIDTH || height > 8192)
    throw new Error("A Visual QA frame has invalid dimensions");
  return { width, height };
}

function sampleIndexes(frameCount: number, duration: number): number[] {
  const count = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(duration / 2)));
  return [
    ...new Set(
      Array.from({ length: count }, (_, index) =>
        Math.min(
          frameCount - 1,
          Math.floor(((index + 0.5) * frameCount) / count),
        ),
      ),
    ),
  ];
}

/** Shared saved-revision QA used by Desktop, HTTP and CLI adapters. */
export class VisualQaService {
  private readonly sourceHashes = new Map<
    string,
    { signature: string; hash: Promise<string> }
  >();

  constructor(private readonly host: VisualQaHost) {}

  /** Reuse hashes only while inode, size and nanosecond change times agree. */
  private async currentSourceHash(
    assetId: string,
    options: { signal?: AbortSignal; rehash?: boolean },
  ): Promise<{ hash: string; verify: () => Promise<void> }> {
    checkAbort(options.signal);
    const asset = this.host.getSourceAsset(assetId);
    if (!asset) throw new StaleVisualQaError();
    const path = localPath(asset.uri);
    const signature = async () => {
      const info = await stat(path, { bigint: true });
      if (!info.isFile()) throw new StaleVisualQaError();
      return `${asset.uri}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    };
    const before = await signature();
    let entry = this.sourceHashes.get(assetId);
    if (options.rehash || entry?.signature !== before) {
      entry = { signature: before, hash: hashFile(path, options.signal) };
      this.sourceHashes.delete(assetId);
      this.sourceHashes.set(assetId, entry);
      // Bound per-project memory; concurrent frame requests share hash work.
      if (this.sourceHashes.size > 4096)
        this.sourceHashes.delete(this.sourceHashes.keys().next().value!);
    }
    try {
      const hash = await entry.hash;
      checkAbort(options.signal);
      const verify = async () => {
        checkAbort(options.signal);
        if (
          (await signature()) !== before ||
          this.host.getSourceAsset(assetId)?.uri !== asset.uri
        )
          throw new StaleVisualQaError();
      };
      await verify();
      return { hash, verify };
    } catch (error) {
      if (this.sourceHashes.get(assetId) === entry)
        this.sourceHashes.delete(assetId);
      throw error;
    }
  }

  /** Every publication/read uses the same saved and in-memory revision fence. */
  private async assertCurrent(
    report: VisualQaReport,
    options: { signal?: AbortSignal; rehash?: boolean } = {},
  ): Promise<void> {
    checkAbort(options.signal);
    await this.assertRevision(report);
    try {
      const verified: Array<() => Promise<void>> = [];
      for (const source of report.sources) {
        const current = await this.currentSourceHash(source.assetId, options);
        if (current.hash !== source.sha256) throw new StaleVisualQaError();
        verified.push(current.verify);
      }
      // Later hashes and saved-project reads can yield for a long time. Recheck
      // all earlier source identities together after those operations finish.
      await this.assertRevision(report);
      await Promise.all(verified.map((verify) => verify()));
    } catch (error) {
      checkAbort(options.signal);
      if ((error as Error)?.name === "AbortError") throw error;
      throw new StaleVisualQaError();
    }
    checkAbort(options.signal);
  }

  private async assertRevision(report: VisualQaReport): Promise<void> {
    const disk = await savedProject(this.host.directory);
    const saved = disk.timelines.find(
      (item) => item.id === report.compositionId,
    );
    const memory = this.host.project.timelines.find(
      (item) => item.id === report.compositionId,
    );
    if (
      disk.id !== report.projectId ||
      this.host.project.id !== report.projectId ||
      !saved ||
      !memory ||
      digest(saved) !== report.compositionRevision ||
      digest(memory) !== report.compositionRevision ||
      digest(disk.settings) !== digest(report.settings) ||
      digest(this.host.project.settings) !== digest(report.settings)
    )
      throw new StaleVisualQaError();
  }

  async run(
    compositionId?: string,
    options: VisualQaOptions = {},
  ): Promise<VisualQaReport> {
    const id = options.jobId ?? randomUUID();
    if (!UUID.test(id))
      throw new Error("Visual QA report ID must be a UUID v4");
    const reportParent = await safeProjectCachePath(
      this.host.directory,
      "visual-qa",
      `${id}.guard`,
    );
    await chmod(dirname(reportParent), 0o700);
    const reportDirectory = join(dirname(reportParent), id);
    await mkdir(reportDirectory, { mode: 0o700 });
    await chmod(reportDirectory, 0o700);
    const reportPath = await safeProjectCachePath(
      this.host.directory,
      "visual-qa",
      id,
      "report.json",
    );
    const project = this.host.project;
    const composition = structuredClone(
      compositionId
        ? project.timelines.find((item) => item.id === compositionId)
        : project.timelines.at(-1),
    );
    if (!composition) {
      await rm(reportDirectory, { recursive: true, force: true });
      throw new Error("Composition not found for Visual QA");
    }
    const frameRate = project.settings.frameRate;
    const report: VisualQaReport = {
      version: 1,
      id,
      projectId: project.id,
      compositionId: composition.id,
      compositionRevision: digest(composition),
      createdAt: new Date().toISOString(),
      status: "incomplete",
      settings: { ...project.settings },
      sources: [],
      samples: [],
      issues: [],
    };
    const job: Job = {
      id,
      type: "visual-qa",
      status: "running",
      progress: 0,
      stage: "preflight",
      createdAt: report.createdAt,
    };
    this.host.catalog.saveJob(job);
    const update = (progress: number, stage: string) => {
      checkAbort(options.signal);
      job.status = "running";
      job.stage = stage;
      job.progress = Math.max(job.progress ?? 0, Math.min(0.98, progress));
      job.updatedAt = new Date().toISOString();
      this.host.catalog.saveJob(job);
      try {
        options.onProgress?.(job.progress);
      } catch {
        /* A progress observer does not own the Visual QA job. */
      }
    };
    const cleanup = async () =>
      rm(reportDirectory, { recursive: true, force: true });
    const save = async () => {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await chmod(reportPath, 0o600);
    };
    const finish = (
      status: Job["status"],
      progress: number,
      failureCode?: string,
    ) => {
      job.status = status;
      job.progress = progress;
      job.stage = status === "completed" ? "complete" : status;
      job.updatedAt = new Date().toISOString();
      if (status === "failed")
        job.errors = [
          {
            uri: "",
            stage: "visual-qa",
            message:
              failureCode === "revision.stale"
                ? "The saved edit changed during Visual QA. Retry on the current edit."
                : "Visual QA could not complete. Retry this saved edit.",
            code: failureCode ?? "visual-qa.failed",
          },
        ];
      this.host.catalog.saveJob(job);
    };
    try {
      const disk = await savedProject(this.host.directory);
      const diskComposition = disk.timelines.find(
        (item) => item.id === composition.id,
      );
      if (
        disk.id !== project.id ||
        !diskComposition ||
        digest(diskComposition) !== report.compositionRevision ||
        digest(disk.settings) !== digest(report.settings)
      )
        throw new StaleVisualQaError();

      const sourceTimes = uniqueSources(composition);
      const assets = new Map<string, MediaAsset>();
      const originalHashes = new Map<string, string>();
      for (const [assetId, times] of sourceTimes) {
        checkAbort(options.signal);
        const asset = this.host.getSourceAsset(assetId);
        if (!asset) {
          for (const time of times)
            report.issues.push(
              issue(
                time.photoDepthPart === "mask"
                  ? "photo-depth.mask-missing"
                  : time.photoDepthPart === "background"
                    ? "photo-depth.background-missing"
                    : "asset.missing",
                "error",
                time.at,
                frameRate,
                {
                  assetId,
                  detail: "unavailable",
                  clipId: time.clipId,
                  graphicSceneId: time.graphicSceneId,
                  nodeId: time.nodeId,
                  photoDepthPart: time.photoDepthPart,
                },
              ),
            );
          continue;
        }
        assets.set(assetId, asset);
        const status = await sourceStatus(asset);
        const unsupported = previewIssue(asset);
        if (status.status !== "available") {
          for (const time of times)
            report.issues.push(
              issue(
                time.photoDepthPart === "mask"
                  ? "photo-depth.mask-missing"
                  : time.photoDepthPart === "background"
                    ? "photo-depth.background-missing"
                    : "asset.missing",
                "error",
                time.at,
                frameRate,
                {
                  assetId,
                  detail: "unavailable",
                  clipId: time.clipId,
                  graphicSceneId: time.graphicSceneId,
                  nodeId: time.nodeId,
                  photoDepthPart: time.photoDepthPart,
                },
              ),
            );
          continue;
        }
        if (unsupported) {
          for (const time of times)
            report.issues.push(
              issue("asset.unsupported", "error", time.at, frameRate, {
                assetId,
                detail: "unavailable",
                clipId: time.clipId,
                graphicSceneId: time.graphicSceneId,
                nodeId: time.nodeId,
              }),
            );
          continue;
        }
        const sha256 = await hashFile(localPath(asset.uri), options.signal);
        if (asset.contentHash && asset.contentHash !== sha256) {
          for (const time of times)
            report.issues.push(
              issue(
                time.photoDepthPart
                  ? "photo-depth.source-changed"
                  : "asset.changed",
                "error",
                time.at,
                frameRate,
                {
                  assetId,
                  detail: "changed",
                  clipId: time.clipId,
                  graphicSceneId: time.graphicSceneId,
                  nodeId: time.nodeId,
                  photoDepthPart: time.photoDepthPart,
                },
              ),
            );
          continue;
        }
        originalHashes.set(assetId, sha256);
        report.sources.push({ assetId, sha256 });
        const graphicTimes = times.filter((time) => time.graphicSceneId);
        if (graphicTimes.length) {
          try {
            const image = await inspectGraphicImage(asset, reportDirectory, {
              signal: options.signal,
            });
            await rm(image.path, { force: true });
            if (image.sha256 !== sha256) throw new StaleVisualQaError();
          } catch (error) {
            checkAbort(options.signal);
            const code = (error as { code?: string }).code;
            if (
              code !== "graphics.unavailable" &&
              code !== "graphics.resourceLimit"
            )
              throw error;
            for (const time of graphicTimes)
              report.issues.push(
                issue("asset.unsupported", "error", time.at, frameRate, {
                  assetId,
                  graphicSceneId: time.graphicSceneId,
                  nodeId: time.nodeId,
                  detail: "unavailable",
                }),
              );
          }
        }
      }

      for (const scene of composition.graphicScenes ?? []) {
        const recipe = scene.photoDepth;
        if (!recipe) continue;
        const at =
          scene.start +
          (scene.nodes.find((node) => node.id === recipe.nodeId)?.start ?? 0);
        if (recipe.mode === "fallback") {
          const sourceSha256 = originalHashes.get(recipe.sourceAssetId);
          if (sourceSha256 && sourceSha256 !== recipe.sourceSha256)
            report.issues.push(
              issue("photo-depth.source-changed", "error", at, frameRate, {
                graphicSceneId: scene.id,
                nodeId: recipe.nodeId,
                assetId: recipe.sourceAssetId,
                detail: "changed",
              }),
            );
          report.issues.push(
            issue("photo-depth.fallback-used", "warning", at, frameRate, {
              graphicSceneId: scene.id,
              nodeId: recipe.nodeId,
              detail: "fallback-used",
            }),
          );
          continue;
        }
        const photoDepthAssetIds = new Set([
          recipe.sourceAssetId,
          recipe.maskAssetId,
          ...(recipe.background?.kind === "asset"
            ? [recipe.background.assetId]
            : []),
        ]);
        const priorSourceFailure = report.issues.some(
          (entry) =>
            entry.graphicSceneId === scene.id &&
            entry.severity === "error" &&
            Boolean(entry.assetId && photoDepthAssetIds.has(entry.assetId)) &&
            [
              "asset.missing",
              "asset.changed",
              "asset.unsupported",
              "photo-depth.mask-missing",
              "photo-depth.background-missing",
              "photo-depth.source-changed",
            ].includes(entry.code),
        );
        if (priorSourceFailure) continue;
        const work = join(reportDirectory, `photo-depth-${randomUUID()}`);
        await mkdir(work, { mode: 0o700 });
        try {
          const prepared = await prepareGraphicScenes(
            {
              ...composition,
              graphicScenes: [
                {
                  ...scene,
                  nodes: scene.nodes.filter(
                    (node) => node.id === recipe.nodeId,
                  ),
                },
              ],
            },
            [...assets.values()],
            report.settings,
            work,
            { signal: options.signal },
          );
          for (const finding of prepared.photoDepthFindings)
            if (finding.significantTransparentHoles)
              report.issues.push(
                issue("photo-depth.mask-holes", "warning", at, frameRate, {
                  graphicSceneId: finding.sceneId,
                  nodeId: finding.nodeId,
                  photoDepthPart: "mask",
                }),
              );
          report.issues.push(
            issue("photo-depth.manual-review", "manual-review", at, frameRate, {
              graphicSceneId: scene.id,
              nodeId: recipe.nodeId,
            }),
          );
        } catch (error) {
          checkAbort(options.signal);
          const code = (error as { code?: string }).code;
          const mapped: Partial<Record<string, VisualQaIssueCode>> = {
            "graphics.maskMissing": "photo-depth.mask-missing",
            "graphics.backgroundMissing": "photo-depth.background-missing",
            "graphics.maskInvalid": "photo-depth.mask-invalid",
            "graphics.resourceLimit": "graphics.resource-limit",
            "graphics.maskMismatch": "photo-depth.mask-mismatch",
            "graphics.maskEmpty": "photo-depth.mask-empty",
            "graphics.protectedRegion": "photo-depth.protected-region",
            "graphics.sourceChanged": "photo-depth.source-changed",
          };
          const issueCode = mapped[code ?? ""];
          if (!issueCode) throw error;
          report.issues.push(
            issue(issueCode, "error", at, frameRate, {
              graphicSceneId: scene.id,
              nodeId: recipe.nodeId,
              ...(issueCode.startsWith("photo-depth.mask-")
                ? {
                    assetId: recipe.maskAssetId,
                    photoDepthPart: "mask" as const,
                  }
                : {}),
            }),
          );
        } finally {
          await rm(work, { recursive: true, force: true });
        }
      }

      const textOverlays: Array<{
        text: string;
        textRuns?: import("@openfilm/core").TitleTextRuns;
        style: TitleStyle | undefined;
        frame?: { width: number; height: number };
        at: number;
        identity: Pick<
          VisualQaIssue,
          "clipId" | "captionTrackId" | "cueId" | "graphicSceneId" | "nodeId"
        >;
      }> = [];
      for (const track of composition.tracks)
        for (const clip of track.clips)
          if (clip.title)
            textOverlays.push({
              text: clip.title,
              textRuns: clip.titleRuns,
              style: clip.titleStyle,
              at: clip.timelineStart,
              identity: { clipId: clip.id },
            });
      // QA uses the renderer's default native language: the first saved track.
      const nativeCaptions = composition.captionTracks?.[0];
      for (const cue of nativeCaptions?.cues ?? [])
        textOverlays.push({
          text: cue.text,
          textRuns: cue.textRuns,
          style: nativeCaptions!.style,
          at: cue.startMs / 1000,
          identity: { captionTrackId: nativeCaptions!.id, cueId: cue.id },
        });
      for (const scene of composition.graphicScenes ?? []) {
        const visit = (nodes: readonly GraphicNode[], parentStart = 0) => {
          for (const node of nodes) {
            const at = Math.max(parentStart, node.start);
            if (node.type === "group") visit(node.children, at);
            else if (node.type === "text") {
              const frame = {
                width: Math.ceil(node.width),
                height: Math.ceil(node.height),
              };
              textOverlays.push({
                text: node.text,
                frame,
                style: {
                  version: 1,
                  role: "scene-statement",
                  fontSize: node.fontSize,
                  fontFamily: node.fontFamily,
                  fontWeight: node.fontWeight,
                  background: "none",
                  position: "center",
                  maxWidth: frame.width,
                  safeArea: { left: 0, right: 0, top: 0, bottom: 0 },
                },
                at: scene.start + at,
                identity: { graphicSceneId: scene.id, nodeId: node.id },
              });
            }
          }
        };
        visit(scene.nodes);
      }
      for (const overlay of textOverlays) {
        checkAbort(options.signal);
        const inspection = await inspectTitleOverlay(
          overlay.text,
          overlay.style,
          overlay.frame ?? report.settings,
          {
            textRuns: overlay.textRuns,
            fontPathForStyle: (style) => this.host.titleFontPath?.(style),
          },
        );
        if (inspection.status === "failed") {
          report.issues.push(
            issue(inspection.kind, "error", overlay.at, frameRate, {
              ...overlay.identity,
              detail:
                inspection.kind === "font.load-failed"
                  ? inspection.detail === "missing-glyph"
                    ? "missing-glyph"
                    : "unavailable"
                  : undefined,
            }),
          );
        } else if (
          inspection.warnings.some((warning) =>
            /unavailable.*using local/iu.test(warning),
          )
        ) {
          report.issues.push(
            issue("font.load-failed", "warning", overlay.at, frameRate, {
              ...overlay.identity,
              detail: "fallback-used",
            }),
          );
        }
      }

      update(0.1, "preflight");
      await this.assertCurrent(report, {
        signal: options.signal,
        rehash: true,
      });
      checkAbort(options.signal);
      if (report.issues.some((entry) => entry.severity === "error")) {
        report.status = "incomplete";
        await save();
        checkAbort(options.signal);
        finish("completed", 1);
        return structuredClone(report);
      }

      const renderPath = await safeProjectCachePath(
        this.host.directory,
        "visual-qa",
        id,
        "render.mp4",
      );
      await this.host.renderForVisualQa(composition.id, renderPath, {
        signal: options.signal,
        onProgress: (progress) => update(0.1 + progress * 0.65, "render"),
      });
      await chmod(renderPath, 0o600);
      await chmod(`${renderPath}.manifest.json`, 0o600);
      checkAbort(options.signal);
      const renderManifest = JSON.parse(
        await readFile(`${renderPath}.manifest.json`, "utf8"),
      ) as {
        compositionSha256?: string;
        outputSha256?: string;
        sources?: { assetId?: string; sha256?: string }[];
      };
      if (renderManifest.compositionSha256 !== report.compositionRevision)
        throw new StaleVisualQaError();
      const outputHash = await hashFile(renderPath, options.signal);
      if (outputHash !== renderManifest.outputSha256)
        throw new Error(
          "Rendered MP4 hash does not match its renderer manifest",
        );
      const rendererSources = new Map(
        (renderManifest.sources ?? []).map((source) => [
          source.assetId,
          source.sha256,
        ]),
      );
      for (const [assetId, originalHash] of originalHashes) {
        checkAbort(options.signal);
        if (rendererSources.get(assetId) !== originalHash)
          throw new StaleVisualQaError();
        const currentAsset = this.host.getSourceAsset(assetId);
        if (
          !currentAsset ||
          (await hashFile(localPath(currentAsset.uri), options.signal)) !==
            originalHash
        )
          throw new StaleVisualQaError();
      }

      const probe = await runProcess(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-count_frames",
          "-show_entries",
          "stream=width,height,avg_frame_rate,nb_read_frames,duration",
          "-of",
          "json",
          renderPath,
        ],
        { signal: options.signal },
      );
      const video = parseProbe(probe.stdout);
      const indexes = sampleIndexes(video.frameCount, video.duration);
      const framesDirectory = join(reportDirectory, "frames");
      await mkdir(framesDirectory, { mode: 0o700 });
      await chmod(framesDirectory, 0o700);
      const selection = indexes.map((index) => `eq(n\\,${index})`).join("+");
      const filter = `select=${selection},scale=w='min(${MAX_FRAME_WIDTH},iw)':h=-2:flags=area,signalstats,metadata=print`;
      const pattern = join(framesDirectory, "frame-%03d.png");
      const extraction = await runProcess(
        "ffmpeg",
        [
          "-v",
          "info",
          "-i",
          renderPath,
          "-an",
          "-vf",
          filter,
          "-fps_mode",
          "passthrough",
          "-frames:v",
          String(indexes.length),
          "-threads",
          "1",
          "-y",
          pattern,
        ],
        { signal: options.signal, timeoutMs: 1800000 },
      );
      const metrics = {
        average: parseMetric(extraction.stderr, "YAVG"),
        low: parseMetric(extraction.stderr, "YLOW"),
        high: parseMetric(extraction.stderr, "YHIGH"),
      };
      if (
        Object.values(metrics).some(
          (entries) => entries.length !== indexes.length,
        )
      )
        throw new Error(
          "FFmpeg did not return luma statistics for every sample",
        );
      const frameFiles = await Promise.all(
        indexes.map(async (_frameIndex, index) => {
          const file = await safeProjectCachePath(
            this.host.directory,
            "visual-qa",
            id,
            "frames",
            `frame-${String(index + 1).padStart(3, "0")}.png`,
          );
          const info = await lstat(file);
          if (info.isSymbolicLink() || !info.isFile())
            throw new Error("Visual QA sample is not a regular cache file");
          await chmod(file, 0o600);
          return { file, bytes: await readFile(file) };
        }),
      );
      report.output = {
        sha256: outputHash,
        duration: video.duration,
        frameCount: video.frameCount,
      };
      report.samples = await Promise.all(
        frameFiles.map(async ({ file, bytes }, index) => {
          const dimensions = pngSize(file, bytes);
          const luma = {
            average: metrics.average[index]!,
            low: metrics.low[index]!,
            high: metrics.high[index]!,
          };
          const sample: VisualQaSample = {
            index,
            timestamp: indexes[index]! / video.frameRate,
            frameIndex: indexes[index]!,
            sha256: await hashFile(file, options.signal),
            ...dimensions,
            luma,
          };
          if (
            luma.high <= 24 ||
            (luma.average <= 22 && luma.high - luma.low <= 3)
          )
            report.issues.push(
              issue(
                "visual.suspected-blank",
                "manual-review",
                sample.timestamp,
                frameRate,
              ),
            );
          return sample;
        }),
      );
      await this.assertCurrent(report, {
        signal: options.signal,
        rehash: true,
      });
      checkAbort(options.signal);
      report.status = "complete";
      await save();
      checkAbort(options.signal);
      finish("completed", 1);
      return structuredClone(report);
    } catch (error) {
      if (options.signal?.aborted || (error as Error)?.name === "AbortError") {
        await cleanup();
        finish("cancelled", job.progress ?? 0);
        throw error;
      }
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (
        error instanceof StaleVisualQaError ||
        code === "source.changed" ||
        code === "media.missing"
      ) {
        await rm(join(reportDirectory, "frames"), {
          recursive: true,
          force: true,
        });
        await rm(join(reportDirectory, "render.mp4"), { force: true });
        await rm(join(reportDirectory, "render.mp4.manifest.json"), {
          force: true,
        });
        report.status = "stale";
        report.output = undefined;
        report.samples = [];
        report.issues.push(issue("revision.stale", "warning", 0, frameRate));
        await save();
        finish("failed", job.progress ?? 0, "revision.stale");
        return structuredClone(report);
      }
      await cleanup();
      const failureCode =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string" &&
        /^[a-zA-Z\d_.-]{1,64}$/u.test((error as { code: string }).code)
          ? (error as { code: string }).code
          : "visual-qa.failed";
      finish("failed", job.progress ?? 0, failureCode);
      throw new Error("Visual QA could not complete. Retry this saved edit.", {
        cause: error,
      });
    }
  }

  async readReport(reportId: string): Promise<VisualQaReport | undefined> {
    if (!UUID.test(reportId)) return undefined;
    try {
      const path = await existingProjectCachePath(
        this.host.directory,
        "visual-qa",
        reportId,
        "report.json",
      );
      if (!path) return undefined;
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isFile()) return undefined;
      const report = JSON.parse(await readFile(path, "utf8")) as VisualQaReport;
      if (
        report.version !== 1 ||
        report.id !== reportId ||
        report.projectId !== this.host.project.id ||
        !Array.isArray(report.samples) ||
        !Array.isArray(report.issues)
      )
        return undefined;
      try {
        await this.assertCurrent(report);
      } catch (error) {
        if (!(error instanceof StaleVisualQaError)) return undefined;
        // Derive a stale view without mutating historical evidence on disk.
        return {
          ...report,
          status: "stale",
          output: undefined,
          samples: [],
          issues: report.issues.some((item) => item.code === "revision.stale")
            ? report.issues
            : [
                ...report.issues,
                issue(
                  "revision.stale",
                  "warning",
                  0,
                  report.settings.frameRate,
                ),
              ],
        };
      }
      return report;
    } catch {
      return undefined;
    }
  }

  async framePath(
    reportId: string,
    sampleIndex: number,
  ): Promise<string | undefined> {
    if (!Number.isSafeInteger(sampleIndex) || sampleIndex < 0) return undefined;
    const report = await this.readReport(reportId);
    if (!report || report.status !== "complete") return undefined;
    const sample = report.samples.find((entry) => entry.index === sampleIndex);
    if (!sample) return undefined;
    try {
      const path = await existingProjectCachePath(
        this.host.directory,
        "visual-qa",
        reportId,
        "frames",
        `frame-${String(sampleIndex + 1).padStart(3, "0")}.png`,
      );
      if (!path) return undefined;
      const info = await lstat(path);
      const directory = dirname(path);
      if (
        info.isSymbolicLink() ||
        !info.isFile() ||
        !isInside(directory, path) ||
        (await hashFile(path)) !== sample.sha256
      )
        return undefined;
      return path;
    } catch {
      return undefined;
    }
  }
}
