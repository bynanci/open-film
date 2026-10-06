import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { constants, createReadStream } from "node:fs";
import {
  copyFile,
  realpath,
  stat,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import {
  resolve,
  relative,
  isAbsolute,
  dirname,
  extname,
  basename,
  join,
} from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  OpenFilmApplication,
  TimelineEditor,
  TimelineEditorError,
  MediaRelinker,
  MediaRelinkError as RelinkError,
  type TimelineEditInput,
  type CreateFilmOptions,
} from "@openfilm/application";
import {
  validateProject,
  migrateProject,
  validateStory,
  ApplicationError,
  errorInfo,
  PROJECT_CONTENT_LOCALES,
  type ApplicationErrorCode,
  type Job,
  type MediaAsset,
  type Story,
} from "@openfilm/core";
import { previewIssue, isSupportedMediaFile } from "@openfilm/media";
import { resolveFilmSettings, preserveUserBeatText } from "@openfilm/story";
import { proposalTemplate } from "@openfilm/template-proposal";

type Body = Record<string, unknown>;
const httpErrorCodes: Partial<Record<number, ApplicationErrorCode>> = {
  400: "request.invalid",
  403: "request.forbidden",
  404: "request.notFound",
  409: "jobs.busy",
  413: "request.tooLarge",
  415: "request.unsupported",
  422: "media.unsupported",
  503: "workspace.closing",
};
class HttpError extends ApplicationError {
  constructor(
    status: number,
    message: string,
    code?: ApplicationErrorCode,
    params?: Record<string, string | number>,
  ) {
    super(
      code ?? httpErrorCodes[status] ?? "operation.failed",
      message,
      status,
      params,
    );
  }
}

function text(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(400, `${key} is required.`);
  return value.trim();
}
function filePath(data: Body, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new HttpError(400, `${key} is required.`);
  return value;
}
function filmOptions(data: Body): CreateFilmOptions {
  if (
    data.projectContentLocale !== undefined &&
    !PROJECT_CONTENT_LOCALES.includes(data.projectContentLocale as never)
  )
    throw new HttpError(400, "Choose a supported film language.");
  if (
    data.filmSettings !== undefined &&
    (!data.filmSettings ||
      typeof data.filmSettings !== "object" ||
      Array.isArray(data.filmSettings))
  )
    throw new HttpError(400, "Film settings must be an object.");
  return {
    ...(data.projectContentLocale === undefined
      ? {}
      : {
          projectContentLocale:
            data.projectContentLocale as CreateFilmOptions["projectContentLocale"],
        }),
    ...(data.filmSettings === undefined
      ? {}
      : {
          filmSettings: data.filmSettings as CreateFilmOptions["filmSettings"],
        }),
  };
}
function paths(data: Body, key: string, maximum = 10000): string[] {
  const value = data[key];
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > maximum ||
    value.some(
      (path) => typeof path !== "string" || !path.trim() || path.includes("\0"),
    )
  )
    throw new HttpError(
      400,
      `${key} must contain between 1 and ${maximum} paths.`,
    );
  return [...new Set(value)] as string[];
}
function safeFilename(name: string): boolean {
  return (
    !!name.trim() &&
    ![...name].some((char) => char.charCodeAt(0) < 32) &&
    !/[\\/]/u.test(name) &&
    name !== "." &&
    name !== ".."
  );
}
function projectFolderTitle(title: string): string {
  const clean = [...title]
    .filter((char) => char.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"/\\|?*]/gu, "-");
  let prefix = "";
  for (const char of clean) {
    if (Buffer.byteLength(prefix + char, "utf8") > 180) break;
    prefix += char;
  }
  return prefix.replace(/[ .]+$/u, "") || "Film";
}
function systemLocale(): string {
  const value =
    process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
  try {
    if (value && value !== "C" && value !== "POSIX")
      return Intl.getCanonicalLocales(
        value.split(".")[0]!.replaceAll("_", "-").split("@")[0]!,
      )[0]!;
  } catch {
    /* Intl uses the platform locale when its environment value is unusable. */
  }
  return new Intl.DateTimeFormat().resolvedOptions().locale;
}

async function inspectCatalog(path: string): Promise<void> {
  // A normal read-only SQLite connection can create WAL sidecars. Recent
  // projects must remain untouched, including projects on read-only volumes.
  let temporary: string | undefined;
  let database: DatabaseSync | undefined;
  try {
    const walPath = `${path}-wal`;
    const wal = await lstat(walPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (wal && (!wal.isFile() || wal.isSymbolicLink()))
      throw new Error("Catalog WAL must be a regular file");
    if (wal?.size) {
      // Immutable connections ignore committed WAL pages. Inspect a disposable
      // copy when another instance or crash recovery has uncheckpointed data.
      temporary = await mkdtemp(join(tmpdir(), "openfilm-recent-catalog-"));
      const snapshot = join(temporary, "database.sqlite");
      await copyFile(path, snapshot, constants.COPYFILE_FICLONE);
      await copyFile(walPath, `${snapshot}-wal`, constants.COPYFILE_FICLONE);
      database = new DatabaseSync(snapshot, { readOnly: true });
    } else {
      const uri = pathToFileURL(path);
      uri.searchParams.set("mode", "ro");
      uri.searchParams.set("immutable", "1");
      database = new DatabaseSync(uri.href, { readOnly: true });
    }
    const version = Number(
      database.prepare("PRAGMA user_version").get()?.user_version ?? 0,
    );
    if (version > 1) throw new Error("Unsupported future catalog schema");
    const integrity = database.prepare("PRAGMA quick_check(1)").get();
    if (integrity?.quick_check !== "ok")
      throw new Error("The project catalog is corrupt");
    database
      .prepare(
        "SELECT id, uri, name, media_type, captured_at, rating, favorite, rejected, locked, data FROM assets LIMIT 1",
      )
      .get();
    database.prepare("SELECT id, created_at, data FROM jobs LIMIT 1").get();
  } finally {
    database?.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
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
  if (info.size === 0)
    throw new HttpError(
      404,
      "Media file is empty or unavailable. Rebuild its preview or relink the original source.",
    );
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
  options: {
    port?: number;
    project?: string;
    projectRoot?: string;
    maxUploadBytes?: number;
  } = {},
) {
  const projectRoot = resolve(
    options.projectRoot ??
      process.env.OPENFILM_PROJECTS_DIR ??
      join(homedir(), "Movies", "OpenFilm"),
  );
  const maxUploadBytes = options.maxUploadBytes ?? 8 * 1024 ** 3;
  const uploads = new Map<
    string,
    { project: OpenFilmApplication; path: string; directory: string }
  >();
  let app: OpenFilmApplication | undefined;
  if (options.project)
    app = await OpenFilmApplication.open(resolve(options.project));
  const active = new Map<string, AbortController>();
  const tasks = new Set<Promise<unknown>>();
  const editors = new WeakMap<OpenFilmApplication, TimelineEditor>();
  const relinkers = new WeakMap<OpenFilmApplication, MediaRelinker>();
  const relinkerFor = (application: OpenFilmApplication) => {
    let relinker = relinkers.get(application);
    if (!relinker) {
      relinker = new MediaRelinker(application);
      relinkers.set(application, relinker);
    }
    return relinker;
  };
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
    if (!app)
      throw new HttpError(
        409,
        "Create or open a project first.",
        "project.required",
      );
    return app;
  };
  const discardUploads = async () => {
    for (const [id, upload] of uploads) {
      await rm(upload.directory, { recursive: true, force: true });
      uploads.delete(id);
    }
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
      let errorContext: ApplicationErrorCode = "operation.failed";
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
        if (
          (method === "POST" || method === "PATCH") &&
          !cancellation &&
          route !== "/api/projects/availability"
        ) {
          if (
            active.size &&
            [
              "/api/project/create",
              "/api/project/open",
              "/api/project/close",
              "/api/media/relink/plan",
              "/api/media/relink/apply",
            ].includes(route)
          )
            throw new HttpError(
              409,
              "Wait for running jobs before switching projects or relinking media.",
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
        if (method === "GET" && route === "/api/workspace") {
          const defaults = resolveFilmSettings(
            { templateId: "proposal-film" },
            [proposalTemplate],
          );
          json(response, 200, {
            systemLocale: systemLocale(),
            defaultProjectRoot: projectRoot,
            defaults: { ...defaults, projectContentLocale: "en-US" },
            templates: [
              resolveFilmSettings({ templateId: "blank" }, [proposalTemplate]),
              defaults,
            ].map(({ templateId, ...settings }) => ({
              id: templateId,
              ...settings,
            })),
            maxUploadBytes,
          });
          return;
        }
        if (method === "POST" && route === "/api/projects/availability") {
          const data = await body(request);
          const requested =
            data.paths === undefined ||
            (Array.isArray(data.paths) && !data.paths.length)
              ? []
              : paths(data, "paths", 50);
          const projects = [];
          for (const path of requested) {
            let status = "available";
            try {
              const directory = await lstat(path);
              if (!directory.isDirectory() || directory.isSymbolicLink())
                status = "invalid";
              else {
                for (const name of ["project.json", "database.sqlite"]) {
                  const info = await lstat(join(path, name));
                  if (!info.isFile() || info.isSymbolicLink())
                    status = "invalid";
                }
                if (status === "available") {
                  const info = await stat(join(path, "project.json"));
                  if (info.size > 16 * 1024 * 1024) status = "invalid";
                  else {
                    migrateProject(
                      JSON.parse(
                        await readFile(join(path, "project.json"), "utf8"),
                      ),
                    );
                    await inspectCatalog(join(path, "database.sqlite"));
                  }
                }
              }
            } catch (error) {
              status =
                (error as NodeJS.ErrnoException).code === "ENOENT"
                  ? "missing"
                  : ["EACCES", "EPERM"].includes(
                        (error as NodeJS.ErrnoException).code ?? "",
                      )
                    ? "inaccessible"
                    : "invalid";
            }
            projects.push({ path, status });
          }
          json(response, 200, { projects });
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
          await discardUploads();
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
          const creating = route.endsWith("/create");
          errorContext = creating
            ? "project.destinationInvalid"
            : "project.unavailable";
          const title = creating ? text(data, "title") : undefined;
          const settings = creating ? filmOptions(data) : undefined;
          if (creating)
            settings!.filmSettings = resolveFilmSettings(
              settings!.filmSettings ?? { templateId: "proposal-film" },
              [proposalTemplate],
            );
          if (creating && settings!.projectContentLocale === undefined)
            settings!.projectContentLocale = "en-US";
          const root =
            data.root === undefined
              ? projectRoot
              : resolve(filePath(data, "root"));
          const folderName = title && projectFolderTitle(title);
          const directory =
            creating && data.path === undefined
              ? join(
                  root,
                  `${folderName || "Film"}-${randomUUID().slice(0, 8)}.openfilm`,
                )
              : resolve(filePath(data, "path"));
          const previousPath = app?.directory;
          await discardUploads();
          app?.close();
          app = undefined;
          let next: OpenFilmApplication;
          try {
            next = creating
              ? await OpenFilmApplication.create(directory, title!, settings)
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
        if (method === "PATCH" && route === "/api/project") {
          const data = await body(request);
          if (
            Object.keys(data).some(
              (key) => !["projectContentLocale", "filmSettings"].includes(key),
            )
          )
            throw new HttpError(400, "Unsupported project edit.");
          const project = application.updateFilm(filmOptions(data));
          json(response, 200, { project, path: application.directory });
          return;
        }
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
            summary: {
              total: application.catalog.countAssets(),
              images: application.catalog.countAssets({ mediaType: "image" }),
              videos:
                application.catalog.countAssets({ mediaType: "video" }) +
                application.catalog.countAssets({ mediaType: "360-video" }),
              audio: application.catalog.countAssets({ mediaType: "audio" }),
            },
          });
          return;
        }
        const assetMatch = /^\/api\/assets\/([^/]+)$/.exec(route);
        if (method === "PATCH" && assetMatch) {
          const id = decodeURIComponent(assetMatch[1]!);
          const data = await body(request);
          if (!application.catalog.getAsset(id))
            throw new HttpError(
              404,
              "Media asset not found.",
              "media.notFound",
            );
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
        if (method === "GET" && route === "/api/media/status") {
          const assetIds = url.searchParams.has("assetIds")
            ? url.searchParams.get("assetIds")!.split(",")
            : undefined;
          json(response, 200, await relinkerFor(application).status(assetIds));
          return;
        }
        if (
          method === "POST" &&
          (route === "/api/media/relink/plan" ||
            route === "/api/media/relink/apply")
        ) {
          if (active.size)
            throw new HttpError(
              409,
              "Wait for import or rendering to finish before relinking media.",
            );
          const data = await body(request);
          const relinker = relinkerFor(application);
          const result = route.endsWith("/plan")
            ? await relinker.plan(data as Parameters<MediaRelinker["plan"]>[0])
            : await relinker.apply(
                data as unknown as Parameters<MediaRelinker["apply"]>[0],
              );
          json(response, 200, result);
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
              "media.notFound",
            );
          const issue = previewIssue(asset);
          if (issue)
            throw new HttpError(422, issue, "media.unsupported", {
              name: asset.name,
            });
          if (!asset.uri.startsWith("file:"))
            throw new HttpError(
              422,
              "Only imported local media can be previewed.",
            );
          const sourceExtension = extname(
            fileURLToPath(asset.uri),
          ).toLowerCase();
          const needsImagePreview =
            asset.mediaType === "image" &&
            (asset.hdr ||
              asset.codec === "hevc" ||
              ![".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].includes(
                sourceExtension,
              ));
          if (needsImagePreview && !asset.thumbnailUri)
            throw new HttpError(
              422,
              "A compatible image preview is missing. Import this media again to rebuild its cached preview.",
              "media.previewUnavailable",
              { name: asset.name },
            );
          const derivedUri = needsImagePreview
            ? asset.thumbnailUri
            : ["video", "audio"].includes(asset.mediaType)
              ? asset.proxyUri
              : undefined;
          const useProxy = !!derivedUri;
          const file = derivedUri
            ? derivedUri.startsWith("file:")
              ? fileURLToPath(derivedUri)
              : resolve(application.directory, derivedUri)
            : fileURLToPath(asset.uri);
          if (!useProxy && (asset.hdr || asset.codec === "hevc"))
            throw new HttpError(
              422,
              "A compatible preview proxy is required for this HDR/HEVC source. Import it again with proxies enabled.",
              "media.previewUnavailable",
              { name: asset.name },
            );
          const mime = (
            {
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".png": "image/png",
              ".webp": "image/webp",
              ".gif": "image/gif",
              ".bmp": "image/bmp",
              ".mp4": "video/mp4",
              ".m4v": "video/mp4",
              ".mov": "video/quicktime",
              ".webm": "video/webm",
              ".mp3": "audio/mpeg",
              ".wav": "audio/wav",
              ".m4a": "audio/mp4",
              ".ogg": "audio/ogg",
              ".opus": "audio/ogg",
              ".flac": "audio/flac",
              ".aac": "audio/aac",
            } as Record<string, string>
          )[extname(file).toLowerCase()];
          if (!mime)
            throw new HttpError(
              422,
              "This source format needs a compatible preview. Import it again with proxies enabled, or add a JPEG, MP4 or MP3 copy.",
            );
          try {
            // The path comes exclusively from this project's catalog, never a request path.
            await streamFile(
              request,
              response,
              file,
              useProxy
                ? resolve(application.directory, "cache")
                : dirname(file),
              mime,
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              throw new HttpError(
                404,
                useProxy
                  ? "Preview proxy missing: import this media again to rebuild its cached preview."
                  : "Missing Media: reconnect the disk or relink this source.",
                useProxy ? "media.previewUnavailable" : "media.missing",
                { name: asset.name },
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
        if (method === "POST" && route === "/api/import/upload") {
          errorContext = "import.failed";
          if (active.size)
            throw new HttpError(
              409,
              "Wait for running jobs before adding files.",
            );
          const name = url.searchParams.get("name") ?? "";
          if (!safeFilename(name))
            throw new HttpError(
              400,
              "Choose a file name without path components.",
            );
          if (!isSupportedMediaFile(name))
            throw new HttpError(
              415,
              `Unsupported media file: ${name}`,
              "media.unsupported",
              { name },
            );
          if (
            !request.headers["content-type"]?.startsWith(
              "application/octet-stream",
            )
          )
            throw new HttpError(
              415,
              "Upload media using application/octet-stream.",
            );
          const declared = Number(request.headers["content-length"]);
          if (Number.isFinite(declared) && declared > maxUploadBytes)
            throw new HttpError(
              413,
              `Media exceeds the ${maxUploadBytes} byte upload limit.`,
            );
          const uploadId = randomUUID();
          const sources = join(application.directory, "sources");
          await mkdir(sources, { recursive: true });
          const rootInfo = await lstat(sources);
          if (
            !rootInfo.isDirectory() ||
            rootInfo.isSymbolicLink() ||
            (await realpath(sources)) !== resolve(sources)
          )
            throw new HttpError(
              403,
              "Managed sources must be inside this project.",
            );
          const directory = join(sources, uploadId);
          await mkdir(directory);
          const temporary = join(directory, ".upload-partial");
          const destination = join(directory, name);
          const controller = new AbortController();
          active.set(uploadId, controller);
          const abort = () => request.destroy();
          controller.signal.addEventListener("abort", abort, { once: true });
          let size = 0;
          try {
            const file = await open(temporary, "wx", 0o600);
            try {
              for await (const chunk of request.iterator({
                destroyOnReturn: false,
              })) {
                const bytes = Buffer.isBuffer(chunk)
                  ? chunk
                  : Buffer.from(chunk);
                size += bytes.length;
                if (size > maxUploadBytes)
                  throw new HttpError(
                    413,
                    `Media exceeds the ${maxUploadBytes} byte upload limit.`,
                  );
                await file.writeFile(bytes);
              }
              if (!size)
                throw new HttpError(400, "The uploaded file is empty.");
              await file.sync();
            } finally {
              await file.close();
            }
            await rename(temporary, destination);
            uploads.set(uploadId, {
              project: application,
              path: destination,
              directory,
            });
            json(response, 201, { uploadId });
          } catch (error) {
            await rm(directory, { recursive: true, force: true });
            request.resume();
            throw error;
          } finally {
            controller.signal.removeEventListener("abort", abort);
            active.delete(uploadId);
          }
          return;
        }
        if (method === "POST" && route === "/api/import/uploads/discard") {
          const data = await body(request);
          const selected = paths(data, "uploads");
          for (const id of selected) {
            const upload = uploads.get(id);
            if (upload?.project === application) {
              await rm(upload.directory, { recursive: true, force: true });
              uploads.delete(id);
            }
          }
          json(response, 200, { ok: true });
          return;
        }
        if (method === "POST" && route === "/api/import") {
          errorContext = "import.failed";
          const data = await body(request);
          if (
            ["folder", "files", "uploads"].filter(
              (key) => data[key] !== undefined,
            ).length !== 1
          )
            throw new HttpError(
              400,
              "Choose a folder, selected files, or completed uploads.",
            );
          const folder =
            data.folder === undefined
              ? undefined
              : resolve(filePath(data, "folder"));
          const files =
            data.files === undefined ? undefined : paths(data, "files");
          const uploaded =
            data.uploads === undefined
              ? undefined
              : paths(data, "uploads").map((id) => {
                  const upload = uploads.get(id);
                  if (!upload || upload.project !== application)
                    throw new HttpError(
                      400,
                      "This upload no longer belongs to the current project.",
                    );
                  return { id, ...upload };
                });
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
          const importOptions = {
            signal: controller.signal,
            jobId: placeholderId,
          };
          const task = uploaded
            ? application.importManagedSources(
                uploaded.map((upload) => upload.path),
                importOptions,
              )
            : files
              ? application.importFiles(files, importOptions)
              : application.importFolder(folder!, importOptions);
          for (const upload of uploaded ?? []) uploads.delete(upload.id);
          const handled = task
            .finally(async () => {
              // Receipts are consumed once, but their managed files remain this
              // job's responsibility until all import workers have settled.
              for (const upload of uploaded ?? []) {
                if (
                  !application.catalog.getAssetByUri(
                    pathToFileURL(upload.path).href,
                  )
                )
                  await rm(upload.directory, { recursive: true, force: true });
              }
            })
            .catch((error: unknown) => {
              application.catalog.saveJob({
                id: placeholderId,
                type: "import",
                status: controller.signal.aborted ? "cancelled" : "failed",
                errors: [
                  {
                    uri: folder ?? "Selected files",
                    stage: "discover",
                    message:
                      error instanceof Error ? error.message : String(error),
                    ...errorInfo(error, "import.failed"),
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
            throw new HttpError(
              409,
              "This job is no longer running.",
              "jobs.notRunning",
            );
          controller.abort();
          json(response, 200, { ok: true });
          return;
        }
        if (method === "POST" && route === "/api/analyze") {
          json(response, 200, application.analyze());
          return;
        }
        if (method === "POST" && route === "/api/stories") {
          errorContext = "story.invalid";
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
        const suggestions =
          /^\/api\/stories\/([^/]+)\/beats\/([^/]+)\/suggestions$/.exec(route);
        if (method === "POST" && suggestions) {
          await body(request);
          json(response, 200, {
            story: application.refreshSuggestions(
              decodeURIComponent(suggestions[1]!),
              decodeURIComponent(suggestions[2]!),
            ),
          });
          return;
        }
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
          const normalized = {
            ...data,
            ...(Array.isArray(data.beats)
              ? {
                  beats: data.beats.map((value: unknown) => {
                    if (
                      !value ||
                      typeof value !== "object" ||
                      Array.isArray(value)
                    )
                      return value;
                    const beat = { ...value } as Record<string, unknown>;
                    if (typeof beat.intent === "string" && !beat.intent.trim())
                      delete beat.intent;
                    return beat;
                  }),
                }
              : {}),
          };
          const edited = validateStory({ ...existing, ...normalized }) as Story;
          edited.beats = edited.beats.map((beat) =>
            preserveUserBeatText(
              existing.beats.find((previous) => previous.id === beat.id),
              beat,
            ),
          );
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
        if (
          method === "POST" &&
          (route === "/api/render" || route === "/api/export")
        ) {
          const data = await body(request);
          const exporting = route === "/api/export";
          errorContext = exporting ? "export.failed" : "render.failed";
          if (exporting && data.format !== "mp4") {
            if (
              !["json", "otio", "fcpxml", "edl"].includes(String(data.format))
            )
              throw new HttpError(
                400,
                "Choose MP4, JSON, OTIO, FCPXML, or EDL.",
              );
            const exported = await application.exportWithReport(
              data.format as "json" | "otio" | "fcpxml" | "edl",
              typeof data.compositionId === "string"
                ? data.compositionId
                : undefined,
            );
            json(response, 200, {
              ...exported,
              filename: basename(exported.path),
            });
            return;
          }
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
          const compositionId =
            typeof data.compositionId === "string"
              ? data.compositionId
              : undefined;
          const renderOptions = { signal: controller.signal, jobId };
          const task = exporting
            ? application.exportMp4(compositionId, renderOptions)
            : application
                .render(compositionId, renderOptions)
                .then((path) => ({ path }));
          const handled = task
            .catch((error: unknown) => {
              const job = application.catalog
                .listJobs()
                .find((item) => item.id === jobId);
              if (job && (job.status === "queued" || job.status === "running"))
                application.catalog.saveJob({
                  ...job,
                  status: controller.signal.aborted ? "cancelled" : "failed",
                  updatedAt: new Date().toISOString(),
                  errors: [
                    {
                      uri: "",
                      stage: "prepare-render",
                      message:
                        error instanceof Error ? error.message : String(error),
                      ...errorInfo(error, errorContext),
                    },
                  ],
                });
              throw error;
            })
            .finally(() => {
              active.delete(jobId);
              tasks.delete(handled);
            });
          tasks.add(handled);
          const result = await handled;
          json(response, 200, {
            ...result,
            ...(exporting ? { filename: basename(result.path) } : {}),
          });
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
        if (method === "GET" && route === "/api/export/file") {
          const name = url.searchParams.get("name") ?? "";
          if (!safeFilename(name))
            throw new HttpError(400, "Choose an exported file name.");
          const root = join(application.directory, "exports");
          response.setHeader(
            "Content-Disposition",
            `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          );
          await streamFile(
            request,
            response,
            join(root, name),
            root,
            extname(name).toLowerCase() === ".mp4"
              ? "video/mp4"
              : "application/octet-stream",
          );
          return;
        }
        throw new HttpError(404, "Endpoint not found.");
      } catch (error) {
        if (response.headersSent || response.destroyed) return;
        response.removeHeader("Content-Disposition");
        const status =
          error instanceof ApplicationError ||
          error instanceof TimelineEditorError ||
          error instanceof RelinkError
            ? error.status
            : 400;
        json(response, status, {
          error: error instanceof Error ? error.message : "Operation failed.",
          ...errorInfo(
            error,
            error instanceof TimelineEditorError
              ? error.status === 409
                ? "timeline.conflict"
                : error.status === 404
                  ? "timeline.notFound"
                  : "timeline.invalidEdit"
              : error instanceof RelinkError
                ? error.status === 409
                  ? "media.relinkConflict"
                  : "media.relinkFailed"
                : errorContext,
          ),
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
    await discardUploads();
    app?.close();
  };
  return { server, port, close };
}
