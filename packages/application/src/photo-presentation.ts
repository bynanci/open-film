import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ApplicationError, migrateProject } from "@openfilm/core";
import { checkAbort, safeProjectCachePath } from "@openfilm/media";
import { preparePhotoAmbientFills } from "@openfilm/render";
import type { OpenFilmApplication } from "./index.js";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface PhotoAmbientInput {
  projectId: string;
  baseRevision: string;
  signal?: AbortSignal;
}
interface Task {
  key: string;
  controller: AbortController;
  waiters: number;
  run: () => Promise<Buffer>;
  promise: Promise<Buffer>;
  resolve: (value: Buffer) => void;
  reject: (error: unknown) => void;
}

/** One bounded, project-owned PNG worker. No prepared paths enter saved data. */
export class PhotoPresentationService {
  private closed = false;
  private running = false;
  private tasks = new Map<string, Task>();
  private queue: Task[] = [];

  constructor(
    private readonly host: OpenFilmApplication,
    private readonly revision: (id: string) => string,
  ) {}

  close(): void {
    this.closed = true;
    for (const task of this.tasks.values()) task.controller.abort();
  }

  async ambient(
    compositionId: string,
    clipId: string,
    input: PhotoAmbientInput,
  ): Promise<Buffer> {
    checkAbort(input.signal);
    if (
      Object.keys(input).some(
        (key) => !["projectId", "baseRevision", "signal"].includes(key),
      )
    )
      throw new ApplicationError(
        "request.invalid",
        "Ambient preview accepts only its saved project and revision.",
        400,
      );
    const stale = () => {
      throw new ApplicationError(
        "timeline.conflict",
        "Photo preview changed. Wait for the current edit to save.",
        409,
      );
    };
    if (
      this.closed ||
      input.projectId !== this.host.project.id ||
      input.baseRevision !== this.revision(compositionId)
    )
      stale();
    const composition = structuredClone(
      this.host.project.timelines.find((item) => item.id === compositionId),
    );
    const clip = composition?.tracks
      .filter((track) => track.type === "video")
      .flatMap((track) => track.clips)
      .find((item) => item.id === clipId);
    if (!composition || !clip || clip.layout?.version !== 2)
      throw new ApplicationError(
        "media.previewUnavailable",
        "This photo has no supported ambient fill to preview.",
        422,
      );
    const settings = structuredClone(this.host.project.settings);
    const story = structuredClone(
      this.host.project.stories.find((item) => item.id === composition.storyId),
    );
    const ids = [
      clip.assetId,
      ...(clip.layout.secondary ? [clip.layout.secondary.assetId] : []),
    ];
    const assets = ids.map((id) => {
      const asset = this.host.getSourceAsset(id);
      if (!asset)
        throw new ApplicationError(
          "media.previewUnavailable",
          "Photo source is unavailable. Relink it before previewing.",
          422,
        );
      return structuredClone(asset);
    });
    const key = digest({
      projectId: input.projectId,
      compositionId,
      clipId,
      revision: input.baseRevision,
      settings,
      fill: clip.layout,
      assets,
    });
    let task = this.tasks.get(key);
    if (task?.controller.signal.aborted) task = undefined;
    if (!task) {
      if (this.queue.length >= 4)
        throw new ApplicationError(
          "jobs.busy",
          "Wait for an ambient preview before retrying.",
          409,
        );
      const controller = new AbortController();
      const assertCurrent = async () => {
        checkAbort(controller.signal);
        if (this.closed || input.projectId !== this.host.project.id) stale();
        const path = join(this.host.directory, "project.json");
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) stale();
        const disk = migrateProject(JSON.parse(await readFile(path, "utf8")));
        checkAbort(controller.signal);
        if (
          this.closed ||
          input.projectId !== this.host.project.id ||
          disk.id !== input.projectId ||
          input.baseRevision !== this.revision(compositionId) ||
          digest(disk.timelines.find((item) => item.id === compositionId)) !==
            digest(composition) ||
          digest(
            this.host.project.timelines.find(
              (item) => item.id === compositionId,
            ),
          ) !== digest(composition) ||
          digest(disk.settings) !== digest(settings) ||
          digest(this.host.project.settings) !== digest(settings) ||
          digest(
            disk.stories.find((item) => item.id === composition.storyId),
          ) !== digest(story) ||
          digest(
            this.host.project.stories.find(
              (item) => item.id === composition.storyId,
            ),
          ) !== digest(story) ||
          assets.some(
            (asset) =>
              digest(this.host.getSourceAsset(asset.id)) !== digest(asset),
          )
        )
          stale();
      };
      let resolve!: Task["resolve"], reject!: Task["reject"];
      const promise = new Promise<Buffer>((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
      // A cancelled last waiter must not leave an unobserved task rejection.
      void promise.catch(() => undefined);
      task = {
        key,
        controller,
        promise,
        resolve,
        reject,
        waiters: 0,
        run: async () => {
          let work: string | undefined;
          let finalSources: (() => Promise<void>) | undefined;
          let result: Buffer;
          try {
            await assertCurrent();
            const guard = await safeProjectCachePath(
              this.host.directory,
              "photo-presentation",
              randomUUID(),
              "frame.guard",
            );
            work = dirname(guard);
            await chmod(work, 0o700);
            const prepared = await preparePhotoAmbientFills(
              [clip],
              assets,
              settings,
              work,
              { signal: controller.signal },
            );
            const output = prepared.fills.get(clip.id);
            if (!output)
              throw new ApplicationError(
                "media.previewUnavailable",
                "Photo ambient fill could not be prepared.",
                422,
              );
            if ((await lstat(output.path)).size > 64 * 1024 * 1024)
              throw new ApplicationError(
                "request.tooLarge",
                "Photo ambient fill exceeds its byte budget.",
                413,
              );
            result = await readFile(output.path);
            await prepared.verifySources();
            finalSources = prepared.assertSourceIdentities;
            await assertCurrent();
          } catch (error) {
            if (controller.signal.aborted) throw error;
            if (error instanceof ApplicationError) {
              if (error.code === "graphics.resourceLimit")
                throw new ApplicationError(
                  "request.tooLarge",
                  error.message,
                  413,
                );
              if (error.code.startsWith("graphics."))
                throw new ApplicationError(
                  "media.previewUnavailable",
                  error.message,
                  422,
                );
            }
            if (
              error instanceof Error &&
              /exceeds its temporary storage bound/iu.test(error.message)
            )
              throw new ApplicationError(
                "request.tooLarge",
                error.message,
                413,
              );
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
              throw new ApplicationError(
                "media.previewUnavailable",
                "Photo source is unavailable. Relink it before previewing.",
                422,
              );
            throw error;
          } finally {
            if (work) await rm(work, { recursive: true, force: true });
          }
          await assertCurrent();
          await finalSources?.();
          checkAbort(controller.signal);
          return result!;
        },
      };
      this.tasks.set(key, task);
      this.queue.push(task);
    }
    if (task.waiters >= 32)
      throw new ApplicationError(
        "jobs.busy",
        "Too many ambient preview requests. Retry shortly.",
        409,
      );
    task.waiters++;
    const owned = task;
    const result = new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        input.signal?.removeEventListener("abort", abort);
        owned.waiters--;
        if (!owned.waiters) owned.controller.abort();
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          checkAbort(input.signal);
        } catch (error) {
          reject(error);
        }
      };
      input.signal?.addEventListener("abort", abort, { once: true });
      owned.promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      );
      if (input.signal?.aborted) abort();
    });
    void this.next();
    return result;
  }

  private async next(): Promise<void> {
    if (this.running) return;
    const task = this.queue.shift();
    if (!task) return;
    this.running = true;
    try {
      task.resolve(await task.run());
    } catch (error) {
      task.reject(error);
    } finally {
      if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
      this.running = false;
      void this.next();
    }
  }
}
