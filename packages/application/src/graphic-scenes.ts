// Modified by OpenFilm contributors on 2026-10-19. See LICENSE and NOTICE.
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ApplicationError,
  graphicSceneAssetIds,
  migrateProject,
  projectFrameRate,
} from "@openfilm/core";
import { checkAbort, safeProjectCachePath } from "@openfilm/media";
import { prepareGraphicScenes } from "@openfilm/render";
import type { OpenFilmApplication } from "./index.js";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface GraphicFrameInput {
  projectId: string;
  baseRevision: string;
  frameIndex: number;
  signal?: AbortSignal;
}

/** Private per-request textures; closing a project aborts all pending work. */
export class GraphicSceneService {
  private active?: AbortController;
  private closed = false;
  constructor(
    private readonly host: OpenFilmApplication,
    private readonly revision: (id: string) => string,
  ) {}

  close(): void {
    this.closed = true;
    this.active?.abort();
  }

  async frame(
    compositionId: string,
    input: GraphicFrameInput,
  ): Promise<Buffer> {
    checkAbort(input.signal);
    if (this.closed)
      throw new ApplicationError(
        "graphics.stale",
        "This graphic preview belongs to a closed project.",
        409,
      );
    if (this.active)
      throw new ApplicationError(
        "graphics.busy",
        "Wait for the current graphic frame before retrying.",
        409,
      );
    const controller = new AbortController();
    this.active = controller;
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    const signal = controller.signal;
    let work: string | undefined;
    let result: Buffer | undefined;
    let finalCheck: (() => Promise<void>) | undefined;
    let finalSources: (() => Promise<void>) | undefined;
    try {
      try {
        const composition = structuredClone(
          this.host.project.timelines.find((item) => item.id === compositionId),
        );
        if (!composition)
          throw new ApplicationError(
            "timeline.notFound",
            "Composition not found.",
            404,
          );
        const settings = { ...this.host.project.settings };
        // Preserve saved settings for digest fencing; only the transient render
        // adapter projects a legacy decimal onto the resolved rational rate.
        const renderSettings = {
          ...settings,
          frameRate: projectFrameRate(settings),
        };
        if (
          !Number.isSafeInteger(input.frameIndex) ||
          input.frameIndex < 0 ||
          input.frameIndex >=
            Math.floor(composition.duration * renderSettings.frameRate + 1e-7)
        )
          throw new ApplicationError(
            "graphics.invalid",
            "Graphic frame is outside the saved Composition.",
            400,
          );
        const assetIds = graphicSceneAssetIds(composition.graphicScenes ?? []);
        const assets = assetIds.map((id) => {
          const asset = this.host.getSourceAsset(id);
          if (!asset)
            throw new ApplicationError(
              "graphics.unavailable",
              "Graphic source is unavailable.",
              422,
            );
          return structuredClone(asset);
        });
        const assertCurrent = async () => {
          checkAbort(signal);
          const path = join(this.host.directory, "project.json");
          const info = await lstat(path);
          if (!info.isFile() || info.isSymbolicLink())
            throw new ApplicationError(
              "graphics.stale",
              "Saved graphic project is unavailable.",
              409,
            );
          const disk = migrateProject(JSON.parse(await readFile(path, "utf8")));
          const saved = disk.timelines.find(
            (item) => item.id === compositionId,
          );
          const memory = this.host.project.timelines.find(
            (item) => item.id === compositionId,
          );
          if (
            this.closed ||
            input.projectId !== this.host.project.id ||
            disk.id !== input.projectId ||
            input.baseRevision !== this.revision(compositionId) ||
            digest(saved) !== digest(composition) ||
            digest(memory) !== digest(composition) ||
            digest(disk.settings) !== digest(settings) ||
            digest(this.host.project.settings) !== digest(settings) ||
            digest(
              disk.stories.find((item) => item.id === composition.storyId),
            ) !==
              digest(
                this.host.project.stories.find(
                  (item) => item.id === composition.storyId,
                ),
              ) ||
            assets.some(
              (asset) => this.host.getSourceAsset(asset.id)?.uri !== asset.uri,
            )
          )
            throw new ApplicationError(
              "graphics.stale",
              "Graphic preview changed. Wait for the current edit to save.",
              409,
            );
          checkAbort(signal);
        };
        finalCheck = assertCurrent;
        await assertCurrent();
        const guard = await safeProjectCachePath(
          this.host.directory,
          "graphics",
          randomUUID(),
          "frame.guard",
        );
        work = dirname(guard);
        await chmod(work, 0o700);
        const prepared = await prepareGraphicScenes(
          composition,
          assets,
          renderSettings,
          work,
          {
            signal,
            fontPathForStyle: (style) => this.host.titleFontPath(style),
          },
        );
        finalSources = prepared.assertSourceIdentities;
        const png = await prepared.frame(null, input.frameIndex);
        await prepared.verifySources();
        await assertCurrent();
        checkAbort(signal);
        result = png;
      } finally {
        if (work) await rm(work, { recursive: true, force: true });
      }
      checkAbort(input.signal);
      checkAbort(signal);
      await finalCheck?.();
      await finalSources?.();
      checkAbort(input.signal);
      checkAbort(signal);
      return result!;
    } finally {
      input.signal?.removeEventListener("abort", abort);
      if (this.active === controller) this.active = undefined;
    }
  }
}
