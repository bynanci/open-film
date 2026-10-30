// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PRIMARY_COLOR_IDENTITY,
  resolveClipSourceRange,
  resolvePrimaryColor,
  validatePrimaryColorCorrection,
  type Clip,
  type MediaAsset,
  type PrimaryColorCorrection,
} from "@openfilm/core";
import {
  hashFile,
  inspectMedia,
  localPath,
  safeProjectCachePath,
  withVerifiedSourceFile,
} from "@openfilm/media";
import {
  measurePrimaryColorPixels,
  primaryColorMatchScore,
  samplePrimaryColorFrame,
  suggestPrimaryColor,
  type PrimaryColorStatistics,
  type RenderCatalogColorMetadata,
} from "@openfilm/render";
import { TimelineEditor, TimelineEditorError } from "./editor.js";
import type { OpenFilmApplication } from "./index.js";

type Variant = "reference" | "before" | "after";
export interface PrimaryColorReviewInput {
  baseRevision: string;
  targetClipId: string;
  referenceClipId: string;
}
export interface PrimaryColorReviewReport {
  version: 1;
  id: string;
  projectId: string;
  compositionId: string;
  baseRevision: string;
  contextSha256: string;
  algorithm: "encoded-sdr-statistics-v1";
  createdAt: string;
  expiresAt: string;
  targetClipId: string;
  referenceClipId: string;
  sources: {
    assetId: string;
    sha256: string;
    color: RenderCatalogColorMetadata;
  }[];
  samples: {
    variant: Variant;
    index: number;
    sourceTime: number;
    sha256: string;
  }[];
  currentCorrection: PrimaryColorCorrection;
  suggestedCorrection: PrimaryColorCorrection | null;
  reference: PrimaryColorStatistics;
  before: PrimaryColorStatistics;
  after: PrimaryColorStatistics | null;
  warnings: string[];
  canApply: boolean;
}
interface Cached {
  report: PrimaryColorReviewReport;
  root: string;
  composition: string;
  settings: string;
  uris: Map<string, string>;
  bytes: number;
}
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const stale = () =>
  new TimelineEditorError(
    "Primary color review is stale, expired or changed. Measure again.",
    409,
  );
const statistics = (frames: Uint8Array[]) =>
  measurePrimaryColorPixels(
    Uint8Array.from(frames.flatMap((frame) => [...frame])),
  );
function color(asset: MediaAsset): RenderCatalogColorMetadata {
  const value = asset.metadata["openfilm.color"];
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const text = (key: string) =>
    typeof data[key] === "string" ? (data[key] as string) : null;
  return {
    hdr: asset.hdr ?? null,
    primaries: text("primaries"),
    transfer: text("transfer"),
    matrix: text("matrix"),
    range: text("range"),
    pixelFormat: text("pixelFormat"),
    bitDepth: typeof data.bitDepth === "number" ? data.bitDepth : null,
  };
}
/** Private bounded statistical proposals; never mutates project or catalog. */
export class PrimaryColorReviewService {
  private reports = new Map<string, Cached>();
  private running?: AbortController;
  private disposed = false;
  constructor(private readonly app: OpenFilmApplication) {}
  private async assertCurrent(cached: Cached, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (
      this.disposed ||
      Date.now() > Date.parse(cached.report.expiresAt) ||
      this.app.project.id !== cached.report.projectId
    )
      throw stale();
    const current = new TimelineEditor(this.app).get(
      cached.report.compositionId,
    );
    const projectPath = join(this.app.directory, "project.json");
    const info = await lstat(projectPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024)
      throw stale();
    const disk = JSON.parse(await readFile(projectPath, "utf8")) as {
      id: string;
      timelines: unknown[];
      settings: unknown;
    };
    if (
      current.revision !== cached.report.baseRevision ||
      JSON.stringify(current.composition) !== cached.composition ||
      JSON.stringify(this.app.project.settings) !== cached.settings ||
      disk.id !== cached.report.projectId ||
      JSON.stringify(
        disk.timelines.find(
          (c) =>
            !!c &&
            typeof c === "object" &&
            "id" in c &&
            c.id === cached.report.compositionId,
        ),
      ) !== cached.composition ||
      JSON.stringify(disk.settings) !== cached.settings
    )
      throw stale();
    for (const [id, uri] of cached.uris)
      if (this.app.getSourceAsset(id)?.uri !== uri) throw stale();
  }
  private async verify(cached: Cached, signal?: AbortSignal) {
    await this.assertCurrent(cached, signal);
    const signatures: { path: string; signature: string }[] = [];
    const signature = (s: Awaited<ReturnType<typeof lstat>>) =>
      `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    for (const source of cached.report.sources) {
      const asset = this.app.getSourceAsset(source.assetId);
      if (!asset) throw stale();
      const path = localPath(asset.uri),
        before = await lstat(path);
      if (
        before.isSymbolicLink() ||
        !before.isFile() ||
        (await hashFile(path, signal)) !== source.sha256
      )
        throw stale();
      const after = await lstat(path);
      if (signature(before) !== signature(after)) throw stale();
      signatures.push({ path, signature: signature(after) });
    }
    for (const sample of cached.report.samples) {
      const path = await safeProjectCachePath(
        this.app.directory,
        "primary-color-review",
        cached.report.id,
        `${sample.variant}-${sample.index}.png`,
      );
      const info = await lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 1024 * 1024 ||
        (await hashFile(path, signal)) !== sample.sha256
      )
        throw stale();
    }
    await this.assertCurrent(cached, signal);
    for (const source of signatures)
      if (signature(await lstat(source.path)) !== source.signature)
        throw stale();
  }
  private async expire(rootParent: string) {
    for (const [id, cached] of this.reports)
      if (Date.now() > Date.parse(cached.report.expiresAt))
        await this.discard(id);
    for (const entry of await readdir(rootParent, { withFileTypes: true })) {
      if (
        !/^[a-f0-9-]{36}$/.test(entry.name) ||
        !entry.isDirectory() ||
        this.reports.has(entry.name)
      )
        continue;
      const path = join(rootParent, entry.name),
        info = await lstat(path);
      if (
        !info.isSymbolicLink() &&
        Date.now() - info.mtimeMs > 2 * 60 * 60 * 1000
      )
        await rm(path, { recursive: true, force: true });
    }
  }
  async run(
    compositionId: string,
    input: PrimaryColorReviewInput,
    signal?: AbortSignal,
  ): Promise<PrimaryColorReviewReport> {
    signal?.throwIfAborted();
    if (this.running || this.disposed)
      throw new TimelineEditorError(
        "A primary color review is already active or the project closed.",
        409,
      );
    const controller = new AbortController();
    this.running = controller;
    try {
      return await this.measure(
        compositionId,
        input,
        signal
          ? AbortSignal.any([signal, controller.signal])
          : controller.signal,
      );
    } finally {
      if (this.running === controller) this.running = undefined;
    }
  }
  private async measure(
    compositionId: string,
    input: PrimaryColorReviewInput,
    combined: AbortSignal,
  ): Promise<PrimaryColorReviewReport> {
    if (
      !input ||
      Object.keys(input).some(
        (k) => !["baseRevision", "targetClipId", "referenceClipId"].includes(k),
      ) ||
      [input.baseRevision, input.targetClipId, input.referenceClipId].some(
        (v) => typeof v !== "string" || !v.trim() || v.length > 256,
      ) ||
      input.targetClipId === input.referenceClipId
    )
      throw new TimelineEditorError(
        "Choose distinct target and reference clips.",
      );
    const state = new TimelineEditor(this.app).get(compositionId);
    if (state.revision !== input.baseRevision) throw stale();
    const pick = (id: string) => {
      const track = state.composition.tracks.find(
        (t) =>
          ["video", "overlay"].includes(t.type) &&
          t.clips.some((c) => c.id === id),
      );
      const clip = track?.clips.find((c) => c.id === id);
      const asset = clip && this.app.getSourceAsset(clip.assetId);
      if (
        !clip ||
        !asset ||
        !["image", "video"].includes(asset.mediaType) ||
        clip.layout?.preset === "diptych" ||
        asset.state.rejected
      )
        throw new TimelineEditorError(
          "Statistical review requires two supported opaque photo or flat video clips.",
        );
      return { clip, asset };
    };
    const target = pick(input.targetClipId),
      reference = pick(input.referenceClipId),
      id = randomUUID();
    const first = await safeProjectCachePath(
        this.app.directory,
        "primary-color-review",
        id,
        "before-0.png",
      ),
      root = dirname(first);
    await chmod(root, 0o700);
    await this.expire(dirname(root));

    const currentCorrection = resolvePrimaryColor(
      state.composition,
      target.clip,
    ).correction;
    const report: PrimaryColorReviewReport = {
      version: 1,
      id,
      projectId: this.app.project.id,
      compositionId,
      baseRevision: input.baseRevision,
      targetClipId: input.targetClipId,
      referenceClipId: input.referenceClipId,
      contextSha256: digest({
        composition: state.composition,
        settings: this.app.project.settings,
        assets: [target.asset, reference.asset],
      }),
      algorithm: "encoded-sdr-statistics-v1",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      sources: [],
      samples: [],
      currentCorrection,
      suggestedCorrection: null,
      reference: null!,
      before: null!,
      after: null,
      warnings: ["statistical-suggestion"],
      canApply: false,
    };
    const cached: Cached = {
      report,
      root,
      composition: JSON.stringify(state.composition),
      settings: JSON.stringify(this.app.project.settings),
      bytes: 0,
      uris: new Map([
        [target.asset.id, target.asset.uri],
        [reference.asset.id, reference.asset.uri],
      ]),
    };
    try {
      await this.assertCurrent(cached, combined);
      const assets = [
        ...new Map(
          [target.asset, reference.asset].map((a) => [a.id, a]),
        ).values(),
      ];
      const snapshots = new Map<string, MediaAsset>();
      const capture = async (index: number): Promise<void> => {
        if (index < assets.length) {
          const asset = assets[index]!;
          await withVerifiedSourceFile(
            localPath(asset.uri),
            asset.contentHash,
            async (path, sha256) => {
              const inspected = await inspectMedia(
                { path, uri: pathToFileURL(path).href, name: asset.name },
                combined,
              );
              if (
                !inspected.dimensions ||
                inspected.dimensions.width > 8192 ||
                inspected.dimensions.height > 8192 ||
                inspected.mediaType !== asset.mediaType
              )
                throw new TimelineEditorError(
                  "Statistical review source exceeds its supported dimensions/type.",
                );
              snapshots.set(asset.id, {
                ...asset,
                uri: pathToFileURL(path).href,
                dimensions: inspected.dimensions,
              });
              report.sources.push({
                assetId: asset.id,
                sha256,
                color: color(asset),
              });
              await capture(index + 1);
            },
            {
              signal: combined,
              temporaryRoot: root,
              maximumBytes: 512 * 1024 * 1024,
            },
          );
          return;
        }
        const times = (clip: Clip, asset: MediaAsset) => {
          if (asset.mediaType === "image") return [0];
          const range = resolveClipSourceRange(clip, asset),
            rate = asset.frameRate ?? 30;
          return [
            ...new Set(
              [0.2, 0.5, 0.8].map((p) =>
                Math.max(
                  range.sourceIn,
                  Math.min(
                    range.sourceOut - 1 / rate,
                    Math.floor(
                      (range.sourceIn +
                        (range.sourceOut - range.sourceIn) * p) *
                        rate,
                    ) / rate,
                  ),
                ),
              ),
            ),
          ];
        };
        const sample = async (
          kind: Variant | "neutral",
          selection: typeof target,
          recipe: PrimaryColorCorrection,
        ) => {
          const frames: Uint8Array[] = [];
          for (const [i, time] of times(
            selection.clip,
            selection.asset,
          ).entries()) {
            combined.throwIfAborted();
            const result = await samplePrimaryColorFrame(
              snapshots.get(selection.asset.id)!,
              time,
              recipe,
              { outputPath: join(root, `${kind}-${i}.png`), signal: combined },
            );
            frames.push(result.pixels);
            if (kind !== "neutral")
              report.samples.push({
                variant: kind,
                index: i,
                sourceTime: time,
                sha256: result.sha256,
              });
            else await rm(join(root, `${kind}-${i}.png`), { force: true });
          }
          return frames;
        };
        const neutral = await sample("neutral", target, PRIMARY_COLOR_IDENTITY);
        report.before = statistics(
          await sample("before", target, currentCorrection),
        );
        report.reference = statistics(
          await sample(
            "reference",
            reference,
            resolvePrimaryColor(state.composition, reference.clip).correction,
          ),
        );
        if (
          [report.before, report.reference].some(
            (s) =>
              s.p50Y < 8 ||
              s.p50Y > 247 ||
              s.p90Y - s.p10Y < 8 ||
              s.clippedFraction > 0.2,
          )
        ) {
          report.warnings.push("insufficient-evidence");
          return;
        }
        const candidate = suggestPrimaryColor(
          neutral,
          report.reference,
          currentCorrection,
        );
        combined.throwIfAborted();
        report.after = statistics(await sample("after", target, candidate));
        report.suggestedCorrection = candidate;
        const before = primaryColorMatchScore(report.before, report.reference),
          after = primaryColorMatchScore(report.after, report.reference);
        report.canApply =
          before - after >= 0.005 &&
          before - after >= before * 0.05 &&
          report.after.clippedFraction - report.before.clippedFraction <=
            0.02 &&
          !target.clip.locked &&
          !target.asset.state.locked;
        if (!report.canApply) report.warnings.push("no-useful-match");
      };
      await capture(0);
      await this.verify(cached, combined);
      combined.throwIfAborted();
      for (const sample of report.samples)
        cached.bytes += (
          await lstat(join(root, `${sample.variant}-${sample.index}.png`))
        ).size;
      if (cached.bytes > 40 * 1024 * 1024)
        throw new Error("Primary color evidence exceeds its storage bound.");
      while (
        this.reports.size >= 5 ||
        cached.bytes +
          [...this.reports.values()].reduce(
            (sum, value) => sum + value.bytes,
            0,
          ) >
          40 * 1024 * 1024
      )
        await this.discard(this.reports.keys().next().value!);
      this.reports.set(id, cached);
      return structuredClone(report);
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  async media(id: string, variant: Variant, index: number): Promise<string> {
    const cached = this.reports.get(id);
    if (
      !cached ||
      !Number.isInteger(index) ||
      !cached.report.samples.some(
        (s) => s.variant === variant && s.index === index,
      )
    )
      throw stale();
    await this.verify(cached);
    if (this.reports.get(id) !== cached) throw stale();
    return safeProjectCachePath(
      this.app.directory,
      "primary-color-review",
      id,
      `${variant}-${index}.png`,
    );
  }
  async validateAcceptance(
    id: string,
    compositionId: string,
    baseRevision: string,
    clipId: string,
    correction: PrimaryColorCorrection,
  ): Promise<void> {
    const cached = this.reports.get(id),
      parsed = validatePrimaryColorCorrection(correction),
      suggested = cached?.report.suggestedCorrection;
    if (
      !cached?.report.canApply ||
      cached.report.compositionId !== compositionId ||
      cached.report.baseRevision !== baseRevision ||
      cached.report.targetClipId !== clipId ||
      !suggested ||
      (["temperature", "exposureEv", "contrast"] as const).some(
        (field) => suggested[field] !== parsed[field],
      )
    )
      throw stale();
    await this.verify(cached);
    if (this.reports.get(id) !== cached) throw stale();
  }
  async discard(id: string) {
    const cached = this.reports.get(id);
    if (cached) {
      this.reports.delete(id);
      await rm(cached.root, { recursive: true, force: true });
    }
  }
  async dispose() {
    this.disposed = true;
    this.running?.abort();
    for (const id of [...this.reports.keys()]) await this.discard(id);
  }
}
