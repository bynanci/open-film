// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { lstat, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  ApplicationError,
  type TitleStyle,
  type TitleTextRuns,
} from "@openfilm/core";
import { checkAbort, safeProjectCachePath } from "@openfilm/media";
import {
  createTitleOverlay,
  inspectTitleOverlay,
  titleOverlayCacheKey,
  type TitleOverlayInspection,
  type TitleRunFontResult,
  type TitleFontIdentity,
} from "@openfilm/render";
import type { OpenFilmApplication } from "./index.js";

export type NativeTextReference =
  | { kind: "title"; clipId: string }
  | { kind: "caption"; trackId: string; cueId: string };
export interface NativeTextOverlayRequest {
  projectId: string;
  compositionId: string;
  revision: string;
  reference: NativeTextReference;
}
type PublicFont = Omit<TitleFontIdentity, "path">;
export type NativeTextInspection =
  | Extract<TitleOverlayInspection, { status: "failed" }>
  | {
      status: "measured";
      layout: Extract<TitleOverlayInspection, { status: "measured" }>["layout"];
      font: PublicFont;
      warnings: string[];
      runFonts: Array<Omit<TitleRunFontResult, "font"> & { font: PublicFont }>;
    };
interface SharedImage {
  promise: Promise<string>;
  controller: AbortController;
  users: number;
}
interface QueueItem {
  start: () => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  abort: () => void;
}
const stale = () =>
  new ApplicationError(
    "timeline.conflict",
    "This text preview is stale or belongs to another project.",
    409,
  );
const publicFont = ({
  family,
  postscriptName,
  sha256,
}: TitleFontIdentity): PublicFont => ({ family, postscriptName, sha256 });

/** One private text-raster owner. No source/project/history mutation. */
export class NativeTextOverlayService {
  private closed = false;
  private running = false;
  private queue: QueueItem[] = [];
  private controllers = new Set<AbortController>();
  private images = new Map<string, SharedImage>();
  constructor(
    private readonly host: OpenFilmApplication,
    private readonly revision: (id: string) => string,
  ) {}
  close(): void {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
  }

  private capture(input: NativeTextOverlayRequest) {
    const plain = (value: unknown, keys: string[]) => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.getOwnPropertySymbols(value).length ||
        Object.keys(value).some((key) => !keys.includes(key))
      )
        throw new ApplicationError(
          "request.invalid",
          "Invalid text preview reference.",
          400,
        );
    };
    plain(input, ["projectId", "compositionId", "revision", "reference"]);
    for (const field of ["projectId", "compositionId", "revision"] as const)
      if (
        typeof input[field] !== "string" ||
        !input[field] ||
        input[field].length > 256
      )
        throw new ApplicationError(
          "request.invalid",
          "Invalid text preview identity.",
          400,
        );
    const reference = input.reference;
    plain(
      reference,
      reference?.kind === "title"
        ? ["kind", "clipId"]
        : ["kind", "trackId", "cueId"],
    );
    if (
      !["title", "caption"].includes(reference.kind) ||
      Object.entries(reference).some(
        ([key, value]) =>
          key !== "kind" &&
          (typeof value !== "string" || !value || value.length > 256),
      )
    )
      throw new ApplicationError(
        "request.invalid",
        "Invalid text preview reference.",
        400,
      );
    const check = () => {
      if (this.closed || this.host.project.id !== input.projectId)
        throw stale();
      if (
        !this.host.project.timelines.some(
          (item) => item.id === input.compositionId,
        )
      )
        throw new ApplicationError(
          "timeline.notFound",
          "Composition not found.",
          404,
        );
      if (this.revision(input.compositionId) !== input.revision) throw stale();
    };
    check();
    const composition = this.host.project.timelines.find(
      (item) => item.id === input.compositionId,
    )!;
    let text: string | undefined,
      style: TitleStyle | undefined,
      textRuns: TitleTextRuns | undefined;
    if (reference.kind === "title") {
      const clip = composition.tracks
        .flatMap((track) => track.clips)
        .find((item) => item.id === reference.clipId);
      text = clip?.title;
      style = clip?.titleStyle;
      textRuns = clip?.titleRuns;
    } else {
      const track = composition.captionTracks?.find(
        (item) => item.id === reference.trackId,
      );
      const cue = track?.cues.find((item) => item.id === reference.cueId);
      text = cue?.text;
      style = track?.style;
      textRuns = cue?.textRuns;
    }
    if (!text)
      throw new ApplicationError(
        "timeline.notFound",
        "Title or caption cue not found.",
        404,
      );
    const settings = structuredClone(this.host.project.settings),
      signature = JSON.stringify(settings);
    return {
      ...structuredClone({ text, style, textRuns, settings }),
      assertCurrent: () => {
        check();
        if (JSON.stringify(this.host.project.settings) !== signature)
          throw stale();
      },
    };
  }

  private enqueue<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    checkAbort(signal);
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem = {
        signal,
        reject,
        abort: () => {
          this.queue = this.queue.filter((queued) => queued !== item);
          reject(new DOMException("Text preview cancelled.", "AbortError"));
        },
        start: () => {
          signal.removeEventListener("abort", item.abort);
          this.running = true;
          void Promise.resolve()
            .then(() => {
              checkAbort(signal);
              return work();
            })
            .then(resolve, reject)
            .finally(() => {
              this.running = false;
              const next = this.queue.shift();
              next?.start();
            });
        },
      };
      if (this.running) {
        if (this.queue.length >= 8) {
          reject(
            new ApplicationError(
              "title.busy",
              "Wait for the current text preview before retrying.",
              429,
            ),
          );
          return;
        }
        this.queue.push(item);
        signal.addEventListener("abort", item.abort, { once: true });
      } else item.start();
    });
  }

  private subscribe(entry: SharedImage, signal?: AbortSignal): Promise<string> {
    checkAbort(signal);
    entry.users++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: unknown, value?: string) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        entry.users--;
        if (entry.users === 0 && error) entry.controller.abort();
        if (error) reject(error);
        else resolve(value!);
      };
      const abort = () =>
        finish(new DOMException("Text preview cancelled.", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      entry.promise.then(
        (value) => finish(undefined, value),
        (error) => finish(error),
      );
    });
  }

  async inspect(
    input: NativeTextOverlayRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<NativeTextInspection> {
    checkAbort(options.signal);
    const captured = this.capture(input),
      controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    this.controllers.add(controller);
    try {
      return await this.enqueue(async () => {
        const inspection = await inspectTitleOverlay(
          captured.text,
          captured.style,
          captured.settings,
          {
            textRuns: captured.textRuns,
            fontPathForStyle: (style) => this.host.titleFontPath(style),
          },
        );
        checkAbort(controller.signal);
        captured.assertCurrent();
        if (inspection.status === "failed") return inspection;
        return {
          ...inspection,
          font: publicFont(inspection.font),
          runFonts: inspection.runFonts.map((run) => ({
            ...run,
            font: publicFont(run.font),
          })),
        };
      }, controller.signal);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }

  async image(
    input: NativeTextOverlayRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    checkAbort(options.signal);
    const captured = this.capture(input);
    const identity = JSON.stringify([input, captured.settings]);
    let entry = this.images.get(identity);
    if (!entry) {
      const controller = new AbortController();
      this.controllers.add(controller);
      const promise = this.enqueue(async () => {
        const inspectOptions = {
          textRuns: captured.textRuns,
          fontPathForStyle: (style: TitleStyle | undefined) =>
            this.host.titleFontPath(style),
        };
        const inspection = await inspectTitleOverlay(
          captured.text,
          captured.style,
          captured.settings,
          inspectOptions,
        );
        checkAbort(controller.signal);
        captured.assertCurrent();
        if (inspection.status === "failed")
          throw new ApplicationError("render.failed", inspection.message, 422);
        const key = titleOverlayCacheKey({
          text: captured.text,
          style: captured.style,
          frame: captured.settings,
          fontSha256: inspection.font.sha256,
          postscriptName: inspection.font.postscriptName,
          textRuns: captured.textRuns,
          runFonts: inspection.runFonts.map((run) => ({
            id: run.id,
            fontSha256: run.font.sha256,
            postscriptName: run.font.postscriptName,
          })),
        });
        const path = await safeProjectCachePath(
          this.host.directory,
          "titles",
          `${key}.png`,
        );
        try {
          if ((await lstat(path)).isFile()) {
            checkAbort(controller.signal);
            captured.assertCurrent();
            return path;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const temporary = await safeProjectCachePath(
          this.host.directory,
          "titles",
          `${key}-${randomUUID()}.tmp.png`,
        );
        try {
          const raster = await createTitleOverlay(
            captured.text,
            captured.style,
            captured.settings,
            temporary,
            inspectOptions,
          );
          if (
            JSON.stringify(raster.runFonts) !==
            JSON.stringify(inspection.runFonts)
          )
            throw stale();
          checkAbort(controller.signal);
          captured.assertCurrent();
          await rename(temporary, path);
          checkAbort(controller.signal);
          captured.assertCurrent();
        } finally {
          await rm(temporary, { force: true });
        }
        const directory = dirname(path);
        const entries = await Promise.all(
          (await readdir(directory))
            .filter(
              (name) =>
                /^[a-f0-9]{64}\.png$/u.test(name) && name !== basename(path),
            )
            .map(async (name) => {
              const target = join(directory, name);
              try {
                return { target, modified: (await lstat(target)).mtimeMs };
              } catch {
                return undefined;
              }
            }),
        );
        const staleEntries = entries
          .filter(
            (item): item is { target: string; modified: number } => !!item,
          )
          .sort((a, b) => b.modified - a.modified)
          .slice(63);
        await Promise.all(
          staleEntries.map((item) => rm(item.target, { force: true })),
        );
        checkAbort(controller.signal);
        captured.assertCurrent();
        return path;
      }, controller.signal).finally(() => {
        this.images.delete(identity);
        this.controllers.delete(controller);
      });
      entry = { promise, controller, users: 0 };
      this.images.set(identity, entry);
    }
    return this.subscribe(entry, options.signal);
  }
}
