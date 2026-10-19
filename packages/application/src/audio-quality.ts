// Modified by OpenFilm contributors on 2026-10-19. See LICENSE and NOTICE.
import { randomUUID } from "node:crypto";
import { chmod, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Composition } from "@openfilm/core";
import {
  checkAbort,
  hashFile,
  localPath,
  safeProjectCachePath,
} from "@openfilm/media";
import {
  measureAudioOutput,
  normalizationSuggestion,
  type AudioMeasurement,
  type AudioNormalizationSuggestion,
} from "@openfilm/render";
import type { OpenFilmApplication } from "./index.js";
import { TimelineEditor, TimelineEditorError } from "./editor.js";
export interface AudioQualityReport {
  version: 1;
  id: string;
  projectId: string;
  compositionId: string;
  baseRevision: string;
  clipId: string;
  original: AudioMeasurement;
  stem: AudioMeasurement;
  candidate: AudioMeasurement | null;
  suggestion: AudioNormalizationSuggestion | null;
  issues: ("silence" | "peak" | "limited" | "mix-headroom" | "manual-review")[];
  outputHashes: { original: string; candidate?: string };
  sources: { assetId: string; sha256: string }[];
  canAccept: boolean;
}
/** Private render evidence. No automation, project bytes or originals are changed. */
export class AudioQualityService {
  private reports = new Map<
    string,
    {
      report: AudioQualityReport;
      root: string;
      composition: string;
      settings: string;
    }
  >();
  constructor(
    private readonly app: OpenFilmApplication,
    private readonly render: (
      composition: Composition,
      path: string,
      signal?: AbortSignal,
    ) => Promise<string>,
  ) {}
  private async assertCurrent(
    compositionId: string,
    revision: string,
    composition: string,
    settings: string,
  ) {
    const state = new TimelineEditor(this.app).get(compositionId);
    const disk = JSON.parse(
      await readFile(join(this.app.directory, "project.json"), "utf8"),
    ) as { id: string; timelines: Composition[]; settings: unknown };
    if (
      state.revision !== revision ||
      disk.id !== this.app.project.id ||
      JSON.stringify(disk.timelines.find((c) => c.id === compositionId)) !==
        composition ||
      JSON.stringify(this.app.project.settings) !== settings ||
      JSON.stringify(disk.settings) !== settings
    )
      throw new TimelineEditorError(
        "Audio review is stale. Save and measure again.",
        409,
      );
  }
  async run(
    compositionId: string,
    clipId: string,
    baseRevision: string,
    signal?: AbortSignal,
  ): Promise<AudioQualityReport> {
    const state = new TimelineEditor(this.app).get(compositionId);
    const composition = structuredClone(state.composition);
    const snapshot = JSON.stringify(composition);
    const settings = JSON.stringify(this.app.project.settings);
    await this.assertCurrent(compositionId, baseRevision, snapshot, settings);
    const clip = composition.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);
    const asset = clip && this.app.getSourceAsset(clip.assetId);
    if (
      !clip?.audioAutomation ||
      !asset ||
      asset.state.locked ||
      asset.state.rejected ||
      composition.duration > 3600
    )
      throw new TimelineEditorError(
        "Select an unlocked sound clip with an explicit audio role (maximum one hour).",
        400,
      );
    const id = randomUUID();
    const originalPath = await safeProjectCachePath(
      this.app.directory,
      "audio-quality",
      id,
      "original.mp4",
    );
    const root = dirname(originalPath);
    await chmod(root, 0o700);
    try {
      await this.render(composition, originalPath, signal);
      const original = await measureAudioOutput(originalPath, signal);
      const manifest = JSON.parse(
        await readFile(`${originalPath}.manifest.json`, "utf8"),
      ) as { sources: { assetId: string; sha256: string }[] };
      const sources = manifest.sources.map(({ assetId, sha256 }) => ({
        assetId,
        sha256,
      }));
      const stemComposition = structuredClone(composition);
      for (const track of stemComposition.tracks)
        for (const item of track.clips)
          if (item.id !== clipId)
            item.transform = { ...item.transform, volume: 0 };
      const stemPath = join(root, "stem.mp4");
      await this.render(stemComposition, stemPath, signal);
      const stem = await measureAudioOutput(stemPath, signal);
      const suggestion = normalizationSuggestion(
        stem,
        clip.audioAutomation.role,
        clip.transform?.volume ?? 1,
      );
      let candidate: AudioMeasurement | null = null;
      let candidateHash: string | undefined;
      if (suggestion) {
        clip.transform = { ...clip.transform, volume: suggestion.volume };
        const path = join(root, "candidate.mp4");
        await this.render(composition, path, signal);
        candidate = await measureAudioOutput(path, signal);
        candidateHash = await hashFile(path, signal);
      }
      checkAbort(signal);
      await this.assertCurrent(compositionId, baseRevision, snapshot, settings);
      for (const source of sources) {
        const current = this.app.getSourceAsset(source.assetId);
        if (
          !current ||
          (await hashFile(localPath(current.uri), signal)) !== source.sha256
        )
          throw new TimelineEditorError(
            "Audio sources changed during review.",
            409,
          );
      }
      await this.assertCurrent(compositionId, baseRevision, snapshot, settings);
      const report: AudioQualityReport = {
        version: 1,
        id,
        projectId: this.app.project.id,
        compositionId,
        baseRevision,
        clipId,
        original,
        stem,
        candidate,
        suggestion,
        issues: ["manual-review"],
        sources,
        outputHashes: {
          original: await hashFile(originalPath, signal),
          ...(candidateHash ? { candidate: candidateHash } : {}),
        },
        canAccept:
          !!suggestion &&
          candidate?.truePeakDbtp !== null &&
          candidate !== null &&
          candidate.truePeakDbtp <= -1,
      };
      if (stem.integratedLufs === null) report.issues.push("silence");
      if ((original.truePeakDbtp ?? -Infinity) > -1) report.issues.push("peak");
      if (suggestion?.limited) report.issues.push("limited");
      if (suggestion && !report.canAccept) report.issues.push("mix-headroom");
      this.reports.set(id, { report, root, composition: snapshot, settings });
      while (this.reports.size > 5) {
        const first = this.reports.keys().next().value!;
        const old = this.reports.get(first)!;
        this.reports.delete(first);
        await rm(old.root, { recursive: true, force: true });
      }
      return structuredClone(report);
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  async validateAcceptance(
    id: string,
    compositionId: string,
    revision: string,
    clipId: string,
    volume: number,
  ) {
    const cached = this.reports.get(id);
    if (
      !cached?.report.canAccept ||
      !cached.report.suggestion ||
      cached.report.compositionId !== compositionId ||
      cached.report.baseRevision !== revision ||
      cached.report.clipId !== clipId ||
      cached.report.suggestion.volume !== volume
    )
      throw new TimelineEditorError("Audio review cannot be accepted.", 409);
    await this.media(id, "original");
    await this.media(id, "candidate");
  }
  async media(id: string, variant: "original" | "candidate"): Promise<string> {
    const cached = this.reports.get(id);
    if (!cached || (variant === "candidate" && !cached.report.candidate))
      throw new TimelineEditorError(
        "Audio review not found. Measure again.",
        404,
      );
    await this.assertCurrent(
      cached.report.compositionId,
      cached.report.baseRevision,
      cached.composition,
      cached.settings,
    );
    for (const source of cached.report.sources) {
      const asset = this.app.getSourceAsset(source.assetId);
      if (!asset || (await hashFile(localPath(asset.uri))) !== source.sha256)
        throw new TimelineEditorError("Audio review source changed.", 409);
    }
    const path = await safeProjectCachePath(
      this.app.directory,
      "audio-quality",
      id,
      `${variant}.mp4`,
    );
    if ((await hashFile(path)) !== cached.report.outputHashes[variant])
      throw new TimelineEditorError("Audio review output changed.", 409);
    await this.assertCurrent(
      cached.report.compositionId,
      cached.report.baseRevision,
      cached.composition,
      cached.settings,
    );
    return path;
  }
}
