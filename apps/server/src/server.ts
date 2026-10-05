import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import {
  OpenFilmApplication,
  TimelineEditor,
  TimelineEditorError,
  type TimelineEditInput,
} from "@openfilm/application";
import {
  validateProject,
  validateStory,
  type Job,
  type MediaAsset,
  type Story,
} from "@openfilm/core";

type Body = Record<string, unknown>;
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function text(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(400, `${key} is required.`);
  return value.trim();
}
function number(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new HttpError(400, `${name} must be a positive number.`);
  return value;
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<Body> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "Use application/json.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024 * 1024) throw new HttpError(413, "Request exceeds 1 MiB.");
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Body;
  } catch {
    throw new HttpError(400, "Request must contain a JSON object.");
  }
}

async function streamFile(
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  root: string,
  mime: string,
) {
  const [actualFile, actualRoot] = await Promise.all([
    realpath(file),
    realpath(root),
  ]);
  const within = relative(actualRoot, actualFile);
  if (within.startsWith("..") || isAbsolute(within))
    throw new HttpError(403, "Media cache path is outside this project.");
  const info = await stat(actualFile);
  if (!info.isFile()) throw new HttpError(404, "Cached media is unavailable.");
  let start = 0;
  let end = info.size - 1;
  let status = 200;
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      throw new HttpError(416, "Unsupported byte range.");
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= info.size
    )
      throw new HttpError(416, "Byte range exceeds the file.");
    status = 206;
  }
  response.writeHead(status, {
    "Content-Type": mime,
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...(status === 206
      ? { "Content-Range": `bytes ${start}-${end}/${info.size}` }
      : {}),
  });
  await pipeline(createReadStream(actualFile, { start, end }), response);
}

export async function startServer(
  options: { port?: number; project?: string } = {},
) {
  let app: OpenFilmApplication | undefined;
  if (options.project)
    app = await OpenFilmApplication.open(resolve(options.project));
  const active = new Map<string, AbortController>();
  const tasks = new Set<Promise<unknown>>();
  const editors = new WeakMap<OpenFilmApplication, TimelineEditor>();
  const editorFor = (application: OpenFilmApplication) => {
    let editor = editors.get(application);
    if (!editor) {
      editor = new TimelineEditor(application);
      editors.set(application, editor);
    }
    return editor;
  };
  let mutationQueue = Promise.resolve();
  let closing = false;
  const current = () => {
    if (!app) throw new HttpError(409, "Create or open a project first.");
    return app;
  };
  const origins = new Set([
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "http://tauri.localhost",
    "tauri://localhost",
  ]);
  let port = options.port ?? 4310;
  const server = createServer((request, response) => {
    void (async () => {
      let releaseMutation: (() => void) | undefined;
      try {
        if (closing) throw new HttpError(503, "The local service is closing.");
        const origin = request.headers.origin;
        const host = request.headers.host;
        if (
          !host ||
          !new Set([`localhost:${port}`, `127.0.0.1:${port}`]).has(host)
        )
          throw new HttpError(403, "Loopback host is required.");
        if (
          (origin && !origins.has(origin)) ||
          (!origin && request.headers["sec-fetch-site"] === "cross-site")
        )
          throw new HttpError(
            403,
            "This origin cannot access your local media.",
          );
        if (origin) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Vary", "Origin");
        }
        if (request.method === "OPTIONS") {
          response.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          response.end();
          return;
        }
        const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
        const route = url.pathname;
        const method = request.method;
        const cancellation =
          method === "POST" && /^\/api\/jobs\/[^/]+\/cancel$/.test(route);
        // Serialize mutations across body reads and project replacement. Cancellation
        // remains available while a render is awaiting its child process.
        if ((method === "POST" || method === "PATCH") && !cancellation) {
          if (
            active.size &&
            (route === "/api/project/create" || route === "/api/project/open")
          )
            throw new HttpError(
              409,
              "Wait for running jobs before switching projects.",
            );
          const previousMutation = mutationQueue;
          mutationQueue = new Promise<void>((accept) => {
            releaseMutation = accept;
          });
          await previousMutation;
          if (closing)
            throw new HttpError(503, "The local service is closing.");
        }
        if (method === "GET" && route === "/api/health") {
          json(response, 200, { ok: true });
          return;
        }
        if (method === "GET" && route === "/api/project") {
          json(response, 200, {
            project: app?.project ?? null,
            path: app?.directory ?? null,
          });
          return;
        }
        if (method === "POST" && route === "/api/project/close") {
          if (active.size)
            throw new HttpError(
              409,
              "Wait for running jobs before closing this project.",
            );
          app?.close();
          app = undefined;
          json(response, 200, { ok: true });
          return;
        }
        if (
          method === "POST" &&
          (route === "/api/project/create" || route === "/api/project/open")
        ) {
          if (active.size)
            throw new HttpError(
              409,
              "Wait for running jobs before switching projects.",
            );
          const data = await body(request);
          const directory = resolve(text(data, "path"));
          const previousPath = app?.directory;
          app?.close();
          app = undefined;
          let next: OpenFilmApplication;
          try {
            next = route.endsWith("/create")
              ? await OpenFilmApplication.create(directory, text(data, "title"))
              : await OpenFilmApplication.open(directory);
          } catch (error) {
            if (previousPath)
              app = await OpenFilmApplication.open(previousPath);
            throw error;
          }
          app = next;
          json(response, 200, { project: next.project, path: next.directory });
          return;
        }
        const application = current();
        if (method === "GET" && route === "/api/assets") {
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const limit = Number(url.searchParams.get("limit") ?? 60);
          if (
            !Number.isInteger(offset) ||
            offset < 0 ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 200
          )
            throw new HttpError(
              400,
              "Pagination requires offset >= 0 and limit 1–200.",
            );
          const ids = url.searchParams.get("ids")?.split(",").filter(Boolean);
          if (ids && ids.length > 200)
            throw new HttpError(400, "Select at most 200 IDs per request.");
          const mediaType = url.searchParams.get("mediaType");
          const state = url.searchParams.get("state");
          if (
            mediaType &&
            !["image", "video", "audio", "360-video"].includes(mediaType)
          )
            throw new HttpError(400, "Unknown media type.");
          if (state && !["favorite", "rejected", "locked"].includes(state))
            throw new HttpError(400, "Unknown media state.");
          const filter = {
            offset,
            limit,
            ...(ids ? { ids } : {}),
            ...(url.searchParams.get("search")
              ? { search: url.searchParams.get("search")! }
              : {}),
            ...(state ? { state: { [state]: true } } : {}),
            ...(mediaType
              ? { mediaType: mediaType as MediaAsset["mediaType"] }
              : {}),
          };
          const assets = ids
            ? ids.flatMap((id) => {
                const asset = application.catalog.getAsset(id);
                return asset ? [asset] : [];
              })
            : application.catalog.listAssets(filter);
          json(response, 200, {
            assets,
            total: application.catalog.countAssets(filter),
          });
          return;
        }
        const assetMatch = /^\/api\/assets\/([^/]+)$/.exec(route);
        if (method === "PATCH" && assetMatch) {
          const id = decodeURIComponent(assetMatch[1]!);
          const data = await body(request);
          if (!application.catalog.getAsset(id))
            throw new HttpError(404, "Media asset not found.");
          if (
            Object.keys(data).some(
              (key) => !["rating", "state", "tags"].includes(key),
            )
          )
            throw new HttpError(
              400,
              "Only rating, state, and tags can be edited.",
            );
          if (
            data.rating !== undefined &&
            (typeof data.rating !== "number" ||
              data.rating < 0 ||
              data.rating > 5)
          )
            throw new HttpError(400, "Rating must be 0–5.");
          if (
            data.state !== undefined &&
            (!data.state ||
              typeof data.state !== "object" ||
              Array.isArray(data.state) ||
              Object.entries(data.state).some(
                ([key, value]) =>
                  !["favorite", "rejected", "locked"].includes(key) ||
                  typeof value !== "boolean",
              ))
          )
            throw new HttpError(400, "Invalid media state.");
          if (
            data.tags !== undefined &&
            (!Array.isArray(data.tags) ||
              data.tags.some((tag) => typeof tag !== "string"))
          )
            throw new HttpError(400, "Tags must be strings.");
          application.catalog.updateAsset(id, data as Partial<MediaAsset>);
          json(response, 200, { asset: application.catalog.getAsset(id) });
          return;
        }
        const source = /^\/api\/source\/([^/]+)$/.exec(route);
        if (method === "GET" && source) {
          const asset = application.catalog.getAsset(
            decodeURIComponent(source[1]!),
          );
          if (!asset)
            throw new HttpError(
              404,
              "Source asset was not found in this project.",
            );
          if (asset.mediaType === "360-video")
            throw new HttpError(
              422,
              "360 source requires a reframed export before playback.",
            );
          if (!asset.uri.startsWith("file:"))
            throw new HttpError(
              422,
              "Only imported local media can be previewed.",
            );
          const file = fileURLToPath(asset.uri);
          const mime = (
            {
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".png": "image/png",
              ".webp": "image/webp",
              ".mp4": "video/mp4",
              ".mov": "video/quicktime",
              ".webm": "video/webm",
              ".mp3": "audio/mpeg",
              ".wav": "audio/wav",
              ".m4a": "audio/mp4",
              ".ogg": "audio/ogg",
            } as Record<string, string>
          )[extname(file).toLowerCase()];
          if (!mime)
            throw new HttpError(
              422,
              "This source format needs a compatible preview proxy.",
            );
          try {
            // The path comes exclusively from this project's catalog, never a request path.
            await streamFile(request, response, file, dirname(file), mime);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              throw new HttpError(
                404,
                "Missing Media: reconnect the disk or relink this source.",
              );
            throw error;
          }
          return;
        }
        const editorMatch =
          /^\/api\/compositions\/([^/]+)\/(editor|edit|undo|redo)$/.exec(route);
        if (editorMatch) {
          const compositionId = decodeURIComponent(editorMatch[1]!);
          const action = editorMatch[2];
          const editor = editorFor(application);
          if (method === "GET" && action === "editor") {
            json(response, 200, editor.get(compositionId));
            return;
          }
          if (method === "POST" && action !== "editor") {
            const data = await body(request);
            const state =
              action === "edit"
                ? await editor.edit(
                    compositionId,
                    data as unknown as TimelineEditInput,
                  )
                : action === "undo"
                  ? await editor.undo(compositionId, text(data, "baseRevision"))
                  : await editor.redo(
                      compositionId,
                      text(data, "baseRevision"),
                    );
            json(response, 200, state);
            return;
          }
        }
        const thumbnail = /^\/api\/thumbnail\/([^/]+)$/.exec(route);
        if (method === "GET" && thumbnail) {
          const asset = application.catalog.getAsset(
            decodeURIComponent(thumbnail[1]!),
          );
          if (!asset?.thumbnailUri)
            throw new HttpError(404, "Thumbnail is not available yet.");
          const file = asset.thumbnailUri.startsWith("file:")
            ? fileURLToPath(asset.thumbnailUri)
            : resolve(application.directory, asset.thumbnailUri);
          await streamFile(
            request,
            response,
            file,
            resolve(application.directory, "cache"),
            "image/jpeg",
          );
          return;
        }
        if (method === "GET" && route === "/api/jobs") {
          json(response, 200, { jobs: application.catalog.listJobs() });
          return;
        }
        if (method === "POST" && route === "/api/import") {
          const folder = resolve(text(await body(request), "folder"));
          if (active.size)
            throw new HttpError(409, "An import is already running.");
          const controller = new AbortController();
          const placeholderId = randomUUID();
          const initial: Job = {
            id: placeholderId,
            type: "import",
            status: "queued",
            progress: 0,
          };
          application.catalog.saveJob(initial);
          active.set(placeholderId, controller);
          const task = application.importFolder(folder, {
            signal: controller.signal,
            jobId: placeholderId,
          });
          const handled = task
            .catch((error: unknown) => {
              application.catalog.saveJob({
                id: placeholderId,
                type: "import",
                status: controller.signal.aborted ? "cancelled" : "failed",
                errors: [
                  {
                    uri: folder,
                    stage: "discover",
                    message:
                      error instanceof Error ? error.message : String(error),
                  },
                ],
              });
            })
            .finally(() => {
              active.delete(placeholderId);
              tasks.delete(handled);
            });
          tasks.add(handled);
          json(response, 202, { jobId: placeholderId });
          return;
        }
        const cancel = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(route);
        if (method === "POST" && cancel) {
          const controller = active.get(decodeURIComponent(cancel[1]!));
          if (!controller)
            throw new HttpError(409, "This job is no longer running.");
          controller.abort();
          json(response, 200, { ok: true });
          return;
        }
        if (method === "POST" && route === "/api/analyze") {
          json(response, 200, application.analyze());
          return;
        }
        if (method === "POST" && route === "/api/stories") {
          const data = await body(request);
          if (
            data.assetIds !== undefined &&
            (!Array.isArray(data.assetIds) ||
              data.assetIds.some((id) => typeof id !== "string"))
          )
            throw new HttpError(400, "Story scope must contain media IDs.");
          const story = application.generateStory({
            title: typeof data.title === "string" ? data.title : undefined,
            template:
              typeof data.template === "string" ? data.template : undefined,
            targetDuration: number(data.targetDuration, "targetDuration"),
            maxDuration: number(data.maxDuration, "maxDuration"),
            assetIds: data.assetIds as string[] | undefined,
          });
          json(response, 201, { story });
          return;
        }
        const storyMatch = /^\/api\/stories\/([^/]+)$/.exec(route);
        if (method === "PATCH" && storyMatch) {
          const data = await body(request);
          const index = application.project.stories.findIndex(
            (story) => story.id === decodeURIComponent(storyMatch[1]!),
          );
          const existing = application.project.stories[index];
          if (!existing) throw new HttpError(404, "Story not found.");
          if (
            Object.keys(data).some(
              (key) =>
                !["title", "targetDuration", "maxDuration", "beats"].includes(
                  key,
                ),
            )
          )
            throw new HttpError(400, "Unsupported story edit.");
          const edited = validateStory({ ...existing, ...data }) as Story;
          for (const beat of edited.beats)
            for (const id of [
              ...(beat.candidateAssetIds ?? []),
              ...(beat.selectedAssetIds ?? []),
            ])
              if (!application.catalog.getAsset(id))
                throw new HttpError(
                  400,
                  `Story references unknown media ${id}.`,
                );
          const previousProject = application.project;
          const stories = previousProject.stories.map((story, position) =>
            position === index ? edited : story,
          );
          const candidate = validateProject({ ...previousProject, stories });
          application.project = candidate;
          try {
            await application.save();
          } catch (error) {
            application.project = previousProject;
            throw error;
          }
          json(response, 200, { story: edited });
          return;
        }
        if (method === "POST" && route === "/api/compose") {
          const data = await body(request);
          const composition = application.compose(
            typeof data.storyId === "string" ? data.storyId : undefined,
          );
          json(response, 200, { composition });
          return;
        }
        if (method === "POST" && route === "/api/render") {
          const data = await body(request);
          if (active.size)
            throw new HttpError(409, "Wait for running jobs before rendering.");
          const controller = new AbortController();
          const jobId = randomUUID();
          application.catalog.saveJob({
            id: jobId,
            type: "render",
            status: "queued",
            progress: 0,
          });
          active.set(jobId, controller);
          const task = application.render(
            typeof data.compositionId === "string"
              ? data.compositionId
              : undefined,
            { signal: controller.signal, jobId },
          );
          const handled = task.finally(() => {
            active.delete(jobId);
            tasks.delete(handled);
          });
          tasks.add(handled);
          const path = await handled;
          json(response, 200, { path });
          return;
        }
        if (method === "GET" && route === "/api/preview") {
          await streamFile(
            request,
            response,
            resolve(application.directory, "cache/preview.mp4"),
            resolve(application.directory, "cache"),
            "video/mp4",
          );
          return;
        }
        if (method === "POST" && route === "/api/export") {
          const data = await body(request);
          if (!["json", "otio", "fcpxml", "edl"].includes(String(data.format)))
            throw new HttpError(400, "Choose JSON, OTIO, FCPXML, or EDL.");
          const path = await application.export(
            data.format as "json" | "otio" | "fcpxml" | "edl",
            typeof data.compositionId === "string"
              ? data.compositionId
              : undefined,
          );
          json(response, 200, { path });
          return;
        }
        throw new HttpError(404, "Endpoint not found.");
      } catch (error) {
        if (response.headersSent || response.destroyed) return;
        const status =
          error instanceof HttpError || error instanceof TimelineEditorError
            ? error.status
            : 400;
        json(response, status, {
          error: error instanceof Error ? error.message : "Operation failed.",
        });
      } finally {
        releaseMutation?.();
      }
    })();
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  });
  const address = server.address();
  if (address && typeof address !== "string") port = address.port;
  const close = async () => {
    closing = true;
    const stopped = new Promise<void>((accept) => server.close(() => accept()));
    for (const controller of new Set(active.values())) controller.abort();
    await Promise.allSettled(tasks);
    await mutationQueue;
    await stopped;
    app?.close();
  };
  return { server, port, close };
}
