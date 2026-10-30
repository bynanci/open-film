// Modified by OpenFilm contributors on 2026-10-18. Preexisting portions retain
// Apache-2.0 grants; current OpenFilm first-party code is Apache-2.0. See LICENSE/NOTICE.
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import packageInfo from "../package.json" with { type: "json" };
import {
  ApplicationError,
  errorInfo,
  validateFilmLook,
  createExportProfile,
  validateCollectDeliveryOptions,
  type ExportRatio,
  type ExportFraming,
  type FilmLook,
  type GlossaryInput,
  type TravelContextV1,
  type ReviewDecisionOperation,
} from "@openfilm/core";
import type { TranscriptMutationInput } from "@openfilm/catalog";
import {
  OpenFilmApplication,
  TimelineEditor,
  resolveUserDataDirectory,
  resolveRenderQuality,
  type ScenePlanAcceptance,
  type DirectionReviewPlan,
  type CollectRightsDeclaration,
  type SourceSelectionInput,
  parseGpxTrack,
} from "@openfilm/application";
import { startServer } from "../../server/src/server.js";

const usage = `OpenFilm — local media storytelling

Usage:
  openfilm create <film.openfilm> --title "My film"
  openfilm import <folder> --project <film.openfilm> [--no-proxy]
  openfilm import-batch add --project <film.openfilm> --manifest <sources-v1.json>
  openfilm import-batch scan|create --project <film.openfilm> [--request-id <id>]
  openfilm import-batch status <batch-id> --project <film.openfilm>
  openfilm analysis-run create --project <film.openfilm> --manifest <verified-manifest-id> [--scope selected-sources|project-catalog --confirm-project-catalog] [--visual-samples] [--travel-gpx <route.gpx> --travel-assets <asset-id,...> --clock-offset-minutes <minutes> --time-zone <IANA-zone>]
  openfilm analysis-run status|retry <run-id> --project <film.openfilm> [--request-id <id>]
  openfilm analysis-review search|preview|accept <run-id> --project <film.openfilm> [--query <text> --operation <operation.json> --preview-file <preview.json> --request-id <id> --supersedes-decision <id>]
  openfilm list --project <film.openfilm> [--offset 0 --limit 60]
  openfilm analyze --project <film.openfilm>
  openfilm transcribe <asset-id> --project <film.openfilm> [--language auto|zh|en|ja] [--execution auto|cpu|gpu] [--model <local-model-folder>]
  openfilm waveform <asset-id> --project <film.openfilm>
  openfilm proxy status|enqueue|run|cancel|resume|verify --project <film.openfilm> [--assets <id,...> --jobs <id,...> --request-id <id>]
  openfilm proxy policy --project <film.openfilm> --base-revision <number> --quota-bytes <number>
  openfilm proxy cleanup-preview --project <film.openfilm> [--assets <id,...>]
  openfilm proxy cleanup-accept --project <film.openfilm> --preview-file <review.json> --confirm
  openfilm proxy recover --project <film.openfilm> --fingerprint <sha256> --confirm-stopped
  openfilm scenes <asset-id> --project <film.openfilm>
  openfilm intelligence jobs --project <film.openfilm>
  openfilm intelligence recovery <job-id> --project <film.openfilm>
  openfilm intelligence recover <job-id> --project <film.openfilm> --confirm-stopped
  openfilm transcript get <asset-id> --project <film.openfilm> [--offset 0 --limit 100]
  openfilm transcript edit <asset-id> --project <film.openfilm> --commands <request.json>
  openfilm transcript search <asset-id> --project <film.openfilm> --query "literal text" [--case-sensitive|--case-insensitive]
  openfilm transcript revisions <asset-id> --project <film.openfilm>
  openfilm transcript undo|redo|select <asset-id> --project <film.openfilm> --base-revision <id> --request-id <id> [--revision <id>]
  openfilm glossary list|add|update|delete --project <film.openfilm> [--scope project|global] [--id <id>] [--source "term" --replacement "preferred term"] [--case-sensitive|--case-insensitive]
  openfilm review run <asset-id> --project <film.openfilm> [--source glossary|language] [--batch-size 50]
  openfilm review list <asset-id> --project <film.openfilm> [--status pending]
  openfilm review accept <suggestion-id> --project <film.openfilm> --base-revision <id> --request-id <id>
  openfilm review skip <suggestion-id> --project <film.openfilm>
  openfilm review batches|retry-batch|skip-batch <job-id> --project <film.openfilm> [--index 0]
  openfilm review recover <job-id> --project <film.openfilm> --confirm-stopped
  openfilm script-review list <story-id> --project <film.openfilm> --beat <beat-id> --field narration|visualDirection [--status pending]
  openfilm script-review run <story-id> --project <film.openfilm> --beat <beat-id> --field narration|visualDirection
  openfilm script-review accept <suggestion-id> --project <film.openfilm> --base-revision <id> --request-id <id>
  openfilm script-review skip <suggestion-id> --project <film.openfilm>
  openfilm script-review provider --project <film.openfilm>
  openfilm marker <asset-id> --project <film.openfilm> --time <source-seconds>
  openfilm rate <asset-id> --project <film.openfilm> --rating 5 [--favorite --lock]
  openfilm story generate --project <film.openfilm> --template proposal-film --target 270 --max 300
  openfilm scene-plan preview --project <film.openfilm> --group-by category|chronology --target 270 --max 300 [--brief "Film intention" --transition cut|crossfade --assets id1,id2]
  openfilm scene-plan accept --project <film.openfilm> --plan <preview.json>
  openfilm direction-review preview <composition-id> --project <film.openfilm> --beat <beat-id> (--clips <clip-id,...> | --clips-json <JSON-array>) [--replace-existing]
  openfilm direction-review accept <composition-id> --project <film.openfilm> --plan <preview.json> --request-id <id> [--actions <action-id,...> | --actions-json <JSON-array>]
  openfilm compose --project <film.openfilm> [--story <id>]
  openfilm render --project <film.openfilm> [--composition <id>] [--caption-track <id>] [--look <preset> --look-strength 0..1] [--quality standard|high-detail]
  openfilm motion providers|preview|receipt|accept|import|restore|revoke|clear --project <film.openfilm> [--id <candidate-id>]
  openfilm motion preview --project <film.openfilm> --composition <id> --clip <id> --request-id <uuid> --motion-consent --motion-prompt <text> --motion-negative <constraints> [--motion-provider local-motion-fixture|local-motion-import] [--motion-count 2|3] [--motion-candidates <id,id>] [--contains-people|--environment-only] [--motion-scene <id>]
  openfilm audio-quality --project <film.openfilm> --composition <id> --clip <id>
  openfilm handoff review --project <film.openfilm> --composition <id> [--mode preserve-editability|preserve-visual-fidelity] [--bake-audio] [--caption-track <id> | --no-captions]
  openfilm handoff export --project <film.openfilm> --review <review.json>
  openfilm visual-qa --project <film.openfilm> [--composition <id>]
  openfilm export --project <film.openfilm> --format mp4 [--ratio 16:9|9:16|1:1 --framing contain|crop --confirm-crop --crop-preview-token <token>] [--fps <number> --width <even-px> --height <even-px>] [--caption-track <id>] [--look <preset> --look-strength 0..1] [--quality standard|high-detail]
  openfilm export --project <film.openfilm> --format png --ratio 16:9|9:16|1:1 --time <seconds> [--framing contain|crop --preview --confirm-crop --crop-preview-token <token> --request-id <id>] [--quality standard|high-detail]
  openfilm export --project <film.openfilm> --format wav|audio-stems [--request-id <id>]
  openfilm export --project <film.openfilm> --format otio
  openfilm captions prepare --project <film.openfilm> --composition <id> --track <id>
  openfilm captions get <snapshot-id> --project <film.openfilm> [--offset 0 --limit 100] [--issue-offset 0 --issue-limit 200] [--source-offset 0 --source-limit 200] [--clip-offset 0 --clip-limit 200]
  openfilm captions add-track <snapshot-id> --project <film.openfilm> --name "繁體中文" [--language zh-TW --track-id stable-id]
  openfilm captions export <snapshot-id> --project <film.openfilm> --format srt|vtt
  openfilm versions revision|list --project <film.openfilm>
  openfilm versions create --project <film.openfilm> --name "Version name" [--description "..."] [--base-revision <sha256>] [--request-id <uuid>]
  openfilm versions inspect <version-id> --project <film.openfilm>
  openfilm versions diff <before-id> <after-id> --project <film.openfilm>
  openfilm versions rename <version-id> --project <film.openfilm> --name "New name" [--description "..."|--clear-description]
  openfilm versions delete <version-id> --project <film.openfilm> --base-revision <sha256> --confirm
  openfilm versions restore <version-id> --project <film.openfilm> --base-revision <sha256> --request-id <uuid> --confirm
  openfilm collect plan --project <film.openfilm> --scope current-film|entire-project [--composition <id>] [--rights <declarations.json>]
  openfilm collect coverage --project <film.openfilm> --scope current-film|entire-project [--composition <id> --delivery-mode originals|trimmed-originals|offline-proxies --handles 2 --base-revision <sha256>] (read-only planning)
  openfilm collect create --project <film.openfilm> --scope current-film|entire-project --plan-id <sha256> --base-revision <sha256> --format directory|zip --destination <new-path> [--composition <id>] [--rights <declarations.json>]
  openfilm collect verify --project <film.openfilm> --package <directory-or-zip>
  openfilm serve [--project <film.openfilm>] [--port 4310]

Original media stays unchanged. No network service or AI account is required.
Use --unfavorite, --unreject, --unlock to clear state. Use --assets id1,id2
for an explicit story scope in large libraries. Outputs are JSON.
Use --user-data-dir <folder> for trusted global glossary storage (or OPENFILM_USER_DATA_DIR).
Film look presets: none, soft-film, americana, clean-camera, retro, natural, sport.
Omit --look to preserve saved film/scene/clip choices. A look override changes only this MP4/preview.
--commands reads a JSON object {baseRevision,requestId,commands} of at most 1 MiB.
--quality changes compression only, not the saved frame, timing, audio or source detail.
For crop output, run PNG --preview, review its returned local path, then export with --confirm-crop --crop-preview-token <token> and identical render settings within ten minutes.
Review suggestions never change text until accepted. No language provider is configured by default.
Transcript reads also accept transcript <asset-id> when the ID is not an action name.
Use transcript get <asset-id> for all IDs, including edit, search, revisions, undo, redo, select and get.
`;

type Options = Record<string, string | boolean>;
function parse(args: string[]) {
  const positional: string[] = [];
  const options: Options = {};
  const booleans = new Set([
    "help",
    "version",
    "no-proxy",
    "favorite",
    "unfavorite",
    "reject",
    "unreject",
    "lock",
    "unlock",
    "json",
    "case-sensitive",
    "case-insensitive",
    "enable",
    "disable",
    "confirm-stopped",
    "confirm-project-catalog",
    "confirm",
    "clear-description",
    "replace-existing",
    "motion-consent",
    "contains-people",
    "environment-only",
    "reviewed",
    "bake-audio",
    "no-captions",
    "visual-samples",

    "confirm-crop",
    "preview",
  ]);
  const values = new Set([
    "project",
    "clip",
    "motion-provider",
    "motion-count",
    "motion-candidates",
    "motion-prompt",
    "motion-negative",
    "motion-scene",
    "review",
    "mode",
    "caption-track",
    "title",
    "name",
    "description",
    "offset",
    "limit",
    "issue-offset",
    "issue-limit",
    "source-offset",
    "source-limit",
    "clip-offset",
    "clip-limit",
    "rating",
    "template",
    "group-by",
    "brief",
    "transition",
    "plan",
    "target",
    "max",
    "story",
    "composition",
    "track",
    "format",
    "port",
    "assets",
    "language",
    "execution",
    "model",
    "time",
    "commands",
    "base-revision",
    "request-id",
    "query",
    "revision",
    "scope",
    "source",
    "replacement",
    "id",
    "status",
    "batch-size",
    "beat",
    "field",
    "index",
    "user-data-dir",
    "clips",
    "clips-json",
    "actions",
    "actions-json",
    "look",
    "look-strength",
    "quality",
    "destination",
    "rights",
    "plan-id",
    "package",
    "manifest",

    "ratio",
    "framing",
    "fps",
    "width",
    "height",
    "crop-preview-token",
    "travel-gpx",
    "travel-assets",
    "clock-offset-minutes",
    "time-zone",
    "operation",
    "preview-file",
    "supersedes-decision",
    "jobs",
    "quota-bytes",
    "fingerprint",
    "delivery-mode",
    "handles",
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (booleans.has(key)) {
      options[key] = true;
      continue;
    }
    if (!values.has(key))
      throw new Error(`Unknown option ${arg}. Run openfilm --help.`);
    const value = args[++i];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`${arg} needs a value.`);
    options[key] = value;
  }
  if (options["case-sensitive"] && options["case-insensitive"])
    throw new Error("Choose either --case-sensitive or --case-insensitive.");
  return { positional, options };
}
const value = (options: Options, key: string) =>
  typeof options[key] === "string" ? (options[key] as string) : undefined;
function directionIdentifiers(
  options: Options,
  key: "clips" | "actions",
): string[] | undefined {
  const commaSeparated = value(options, key);
  const json = value(options, `${key}-json`);
  if (commaSeparated !== undefined && json !== undefined)
    throw new Error(`Choose either --${key} or --${key}-json.`);
  if (json === undefined) return commaSeparated?.split(",");
  const message = `--${key}-json must be a JSON array of nonempty identifiers.`;
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new Error(message);
  }
  if (
    !Array.isArray(decoded) ||
    !decoded.length ||
    !decoded.every(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    )
  )
    throw new Error(message);
  return decoded;
}
function positive(options: Options, key: string): number | undefined {
  const input = value(options, key);
  if (input === undefined) return undefined;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`--${key} must be a positive number.`);
  return parsed;
}
const print = (result: unknown) => console.log(JSON.stringify(result, null, 2));

function renderLook(options: Options): FilmLook | undefined {
  const preset = value(options, "look");
  const rawStrength = value(options, "look-strength");
  if (preset === undefined && rawStrength === undefined) return undefined;
  if (preset === undefined)
    throw new ApplicationError(
      "request.invalid",
      "--look-strength requires --look <preset>.",
    );
  try {
    if (rawStrength !== undefined && !rawStrength.trim())
      throw new Error("Look strength cannot be empty.");
    return validateFilmLook({
      version: 1,
      preset,
      strength: rawStrength === undefined ? 1 : Number(rawStrength),
    });
  } catch (error) {
    throw new ApplicationError(
      "request.invalid",
      "Choose a supported --look preset and a --look-strength between 0 and 1.",
      400,
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function commandFile(
  path: string | undefined,
): Promise<TranscriptMutationInput> {
  if (!path)
    throw new Error(
      "Use --commands <request.json> with baseRevision, requestId and commands.",
    );
  const file = resolve(path),
    info = await stat(file);
  if (!info.isFile() || info.size > 1024 * 1024)
    throw new Error("Command JSON must be a regular file of at most 1 MiB.");
  const bytes = await readFile(file);
  if (bytes.length > 1024 * 1024)
    throw new Error("Command JSON exceeds 1 MiB.");
  return JSON.parse(bytes.toString("utf8")) as TranscriptMutationInput;
}

async function reviewJsonFile(
  path: string | undefined,
  label: string,
): Promise<Record<string, unknown>> {
  if (!path) throw new Error(`Specify --${label} <review-${label}.json>.`);
  const file = resolve(path);
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile() || info.size > 1024 * 1024)
    throw new Error(
      `Review ${label} JSON must be a regular, non-symlink file under 1 MiB.`,
    );
  const bytes = await readFile(file);
  if (bytes.length > 1024 * 1024)
    throw new Error(`Review ${label} JSON exceeds 1 MiB.`);
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Review ${label} JSON must be an object.`);
  return value as Record<string, unknown>;
}

async function sourceManifestFile(
  path: string | undefined,
): Promise<SourceSelectionInput[]> {
  if (!path) throw new Error("Use --manifest <sources-v1.json>.");
  const file = resolve(path);
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile() || info.size > 4 * 1024 * 1024)
    throw new Error(
      "Source manifest must be a regular, non-symlink JSON file under 4 MiB.",
    );
  const bytes = await readFile(file);
  if (bytes.length > 4 * 1024 * 1024)
    throw new Error("Source manifest exceeds 4 MiB.");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Source manifest must contain valid JSON.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["schemaVersion", "sources"].includes(key),
    )
  )
    throw new Error("Source manifest has unsupported fields.");
  const manifest = value as { schemaVersion?: unknown; sources?: unknown };
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.sources) ||
    !manifest.sources.length ||
    manifest.sources.length > 10_000
  )
    throw new Error(
      "Source manifest must use schemaVersion 1 and contain 1–10,000 sources.",
    );
  return manifest.sources.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`Source ${index + 1} is invalid.`);
    const source = item as Record<string, unknown>;
    if (
      Object.keys(source).some(
        (key) =>
          ![
            "kind",
            "displayName",
            "accessClass",
            "accessRef",
            "recursive",
          ].includes(key),
      )
    )
      throw new Error(`Source ${index + 1} has unsupported fields.`);
    if (
      (source.kind !== "file" && source.kind !== "folder") ||
      typeof source.displayName !== "string" ||
      source.accessClass !== "native-path" ||
      typeof source.accessRef !== "string" ||
      (source.recursive !== undefined && typeof source.recursive !== "boolean")
    )
      throw new Error(
        `Source ${index + 1} must be a native file or folder path.`,
      );
    return {
      kind: source.kind,
      displayName: source.displayName,
      accessClass: "native-path",
      accessRef: source.accessRef,
      ...(source.recursive === undefined
        ? {}
        : { recursive: source.recursive }),
    } satisfies SourceSelectionInput;
  });
}
async function main() {
  const { positional, options } = parse(process.argv.slice(2));
  const command = positional[0];
  if (
    (Object.hasOwn(options, "delivery-mode") ||
      Object.hasOwn(options, "handles")) &&
    !(command === "collect" && positional[1] === "coverage")
  )
    throw new ApplicationError(
      "request.invalid",
      "Delivery options require read-only collect coverage; package creation still includes full originals.",
    );
  if (options.version) {
    console.log(`OpenFilm ${packageInfo.version}`);
    return;
  }
  if (!command || options.help) {
    console.log(usage);
    return;
  }
  const lookOutput =
    command === "render" ||
    (command === "export" &&
      ["mp4", "png"].includes(value(options, "format") ?? ""));
  if (
    !lookOutput &&
    (Object.hasOwn(options, "look") || Object.hasOwn(options, "look-strength"))
  )
    throw new ApplicationError(
      "request.invalid",
      "Film look overrides require render or export --format mp4/png; interchange keeps saved looks as metadata.",
    );
  const lookOverride = lookOutput ? renderLook(options) : undefined;
  if (!lookOutput && Object.hasOwn(options, "quality"))
    throw new ApplicationError(
      "request.invalid",
      "Compression quality requires render or export --format mp4/png.",
    );
  const quality = lookOutput
    ? resolveRenderQuality(value(options, "quality")).quality
    : undefined;
  const runtimeOptions = {
    userDataDirectory: resolveUserDataDirectory(
      value(options, "user-data-dir"),
    ),
  };
  if (command === "create") {
    if (!positional[1]) throw new Error("Specify a new .openfilm directory.");
    const app = await OpenFilmApplication.create(
      resolve(positional[1]),
      value(options, "title") ?? "Untitled film",
      {},
      runtimeOptions,
    );
    try {
      print({ project: app.project, path: app.directory });
    } finally {
      app.close();
    }
    return;
  }
  if (command === "serve") {
    const runtime = await startServer({
      port: positive(options, "port") ?? 4310,
      project: value(options, "project"),
      ...runtimeOptions,
    });
    print({ event: "server.ready", host: "127.0.0.1", port: runtime.port });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void runtime.close().then(() => {
          process.exitCode = 0;
        });
      });
    return;
  }
  const project = value(options, "project") ?? process.env.OPENFILM_PROJECT;
  if (!project)
    throw new Error("Use --project <film.openfilm> to select a project.");
  // Deriving exports must not save the source project or recover other jobs.
  const app =
    command === "proxy" ||
    (command === "collect" && positional[1] === "coverage") ||
    command === "captions" ||
    command === "handoff" ||
    command === "export" ||
    ((command === "scene-plan" || command === "direction-review") &&
      positional[1] === "preview")
      ? await OpenFilmApplication.openForExport(
          resolve(project),
          runtimeOptions,
        )
      : await OpenFilmApplication.open(resolve(project), runtimeOptions);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (command === "proxy") {
      const projectId = app.project.id;
      const action = positional[1];
      const assetIds = value(options, "assets")?.split(",");
      const jobIds = value(options, "jobs")?.split(",");
      const requestId = value(options, "request-id") ?? randomUUID();
      if (action === "status")
        print({
          health: await app.proxyCache.health({
            projectId,
            offset: positive(options, "offset"),
            limit: positive(options, "limit"),
          }),
        });
      else if (action === "enqueue")
        print({
          jobs: app.proxyCache.enqueue({
            projectId,
            requestId,
            assetIds: assetIds ?? [],
          }),
        });
      else if (action === "run")
        print(
          await app.proxyCache.runPending({
            projectId,
            signal: controller.signal,
          }),
        );
      else if (action === "cancel")
        print({ jobs: app.proxyCache.cancel({ projectId, jobIds }) });
      else if (action === "resume")
        print({
          jobs: app.proxyCache.resume({
            projectId,
            requestId,
            jobIds: jobIds ?? [],
          }),
        });
      else if (action === "verify")
        print(
          await app.proxyCache.verify({
            projectId,
            assetIds: assetIds ?? [],
            signal: controller.signal,
          }),
        );
      else if (action === "policy")
        print({
          policy: await app.proxyCache.setPolicy({
            projectId,
            baseRevision: Number(value(options, "base-revision")),
            quotaBytes: Number(value(options, "quota-bytes")),
          }),
        });
      else if (action === "cleanup-preview")
        print(
          await app.proxyCache.previewCleanup({
            projectId,
            assetIds,
            signal: controller.signal,
          }),
        );
      else if (action === "cleanup-accept")
        print(
          await app.proxyCache.acceptSavedCleanup({
            projectId,
            preview: (await reviewJsonFile(
              value(options, "preview-file"),
              "preview-file",
            )) as unknown as import("@openfilm/core").ProxyCleanupPreview,
            confirmed: options.confirm === true,
            signal: controller.signal,
          }),
        );
      else if (action === "recover")
        print({
          recovered: app.proxyCache.recover({
            projectId,
            fingerprint: value(options, "fingerprint") ?? "",
            confirmedStopped: options["confirm-stopped"] === true,
          }),
        });
      else
        throw new ApplicationError(
          "request.invalid",
          "Choose proxy status, enqueue, run, cancel, resume, verify, policy, cleanup-preview, cleanup-accept or recover.",
        );
    } else if (command === "collect") {
      const action = positional[1];
      if (action === "verify") {
        const packagePath = value(options, "package");
        if (!packagePath)
          throw new Error("Specify --package <directory-or-zip>.");
        print(
          await app.collectMedia.verify(
            resolve(packagePath),
            controller.signal,
          ),
        );
      } else {
        const scope = value(options, "scope");
        if (scope !== "current-film" && scope !== "entire-project")
          throw new Error("Choose --scope current-film or entire-project.");
        const compositionId = value(options, "composition");
        if (scope === "current-film" && !compositionId)
          throw new Error("current-film scope requires --composition <id>.");
        let rightsDeclarations: CollectRightsDeclaration[] | undefined;
        const rightsPath = value(options, "rights");
        if (rightsPath) {
          const parsed: unknown = JSON.parse(
            await readFile(resolve(rightsPath), "utf8"),
          );
          if (!Array.isArray(parsed))
            throw new Error(
              "--rights must point to a JSON array of confirmed declarations.",
            );
          rightsDeclarations = parsed as CollectRightsDeclaration[];
        }
        const base = {
          scope,
          ...(compositionId ? { compositionId } : {}),
          ...(rightsDeclarations ? { rightsDeclarations } : {}),
        } as const;
        if (action === "coverage") {
          const delivery = validateCollectDeliveryOptions({
            version: 1,
            mode: value(options, "delivery-mode") ?? "trimmed-originals",
            handlesSeconds: Number(value(options, "handles") ?? 2),
          });
          print(
            await app.collectMedia.coverage(
              {
                ...base,
                projectId: app.project.id,
                delivery,
                ...(value(options, "base-revision") === undefined
                  ? {}
                  : { expectedRevision: value(options, "base-revision") }),
              },
              controller.signal,
            ),
          );
        } else if (action === "plan") {
          print(await app.collectMedia.plan(base, controller.signal));
        } else if (action === "create") {
          const planId = value(options, "plan-id");
          const baseRevision = value(options, "base-revision");
          const destination = value(options, "destination");
          const format = value(options, "format");
          if (!planId || !baseRevision || !destination)
            throw new Error(
              "create requires --plan-id, --base-revision, and --destination.",
            );
          if (format !== "directory" && format !== "zip")
            throw new Error("Choose --format directory or zip.");
          print(
            await app.collectMedia.create({
              ...base,
              planId,
              baseRevision,
              destination: resolve(destination),
              format,
              signal: controller.signal,
              onProgress(progress) {
                console.error(
                  JSON.stringify({ event: "collect.progress", progress }),
                );
              },
            }),
          );
        } else {
          throw new Error("Choose collect plan|create|verify.");
        }
      }
    } else if (command === "versions") {
      const action = positional[1];
      if (action === "revision") {
        print({
          projectId: app.project.id,
          revision: app.versions.currentRevision(),
        });
      } else if (action === "list") {
        print({ versions: app.versions.list() });
      } else if (action === "create") {
        const name = value(options, "name");
        if (!name) throw new Error("Specify --name for the named version.");
        print({
          version: await app.versions.create({
            name,
            ...(value(options, "description") === undefined
              ? {}
              : { description: value(options, "description")! }),
            baseRevision:
              value(options, "base-revision") ?? app.versions.currentRevision(),
            requestId: value(options, "request-id") ?? randomUUID(),
          }),
        });
      } else if (action === "inspect") {
        if (!positional[2]) throw new Error("Specify a version ID to inspect.");
        print(app.versions.inspect(positional[2]));
      } else if (action === "diff") {
        if (!positional[2] || !positional[3])
          throw new Error("Specify before and after version IDs.");
        print({ diff: app.versions.diff(positional[2], positional[3]) });
      } else if (action === "rename") {
        const id = positional[2];
        const name = value(options, "name");
        if (!id || !name) throw new Error("Specify a version ID and --name.");
        print({
          version: app.versions.rename(id, {
            name,
            ...(options["clear-description"] === true
              ? { description: null }
              : value(options, "description") === undefined
                ? {}
                : { description: value(options, "description")! }),
          }),
        });
      } else if (action === "delete") {
        const id = positional[2];
        const baseRevision = value(options, "base-revision");
        if (!id || !baseRevision)
          throw new Error("Specify a version ID and --base-revision.");
        if (options.confirm !== true)
          throw new Error("Deleting requires the explicit --confirm flag.");
        print(app.versions.remove(id, { baseRevision, confirmed: true }));
      } else if (action === "restore") {
        const id = positional[2];
        const baseRevision = value(options, "base-revision");
        if (!id || !baseRevision || !value(options, "request-id"))
          throw new Error(
            "Specify a version ID, --base-revision and --request-id.",
          );
        if (options.confirm !== true)
          throw new Error("Restoring requires the explicit --confirm flag.");
        print(
          await app.versions.restore(id, {
            baseRevision,
            requestId: value(options, "request-id")!,
            confirmed: true,
          }),
        );
      } else {
        throw new Error(
          "Choose versions revision|list|create|inspect|diff|rename|delete|restore.",
        );
      }
    } else if (command === "import") {
      if (!positional[1]) throw new Error("Specify a source folder to import.");
      const result = await app.importFolder(resolve(positional[1]), {
        signal: controller.signal,
        proxies: !options["no-proxy"],
        onProgress(job) {
          console.error(JSON.stringify({ event: "job.progress", ...job }));
        },
      });
      print(result);
      if (result.job.status === "cancelled") process.exitCode = 130;
      else if (result.job.status === "failed") process.exitCode = 1;
    } else if (command === "import-batch") {
      const action = positional[1];
      if (action === "add") {
        const sources = await sourceManifestFile(value(options, "manifest"));
        const draft = app.sourceDraft.get();
        const updated = app.sourceDraft.add({
          projectId: app.project.id,
          baseRevision: draft.revision,
          requestId: value(options, "request-id") ?? randomUUID(),
          sources,
        });
        print({
          projectId: updated.projectId,
          revision: updated.revision,
          added: sources.length,
          selections: updated.selections.map(
            ({ id, kind, displayName, recursive }) => ({
              id,
              kind,
              displayName,
              recursive,
            }),
          ),
        });
      } else if (action === "status") {
        const id = positional[2];
        if (!id) throw new Error("Specify an import batch ID.");
        const batch = app.catalog.multiSource.getImportBatch(id);
        if (!batch || batch.projectId !== app.project.id)
          throw new Error("Import batch was not found in this project.");
        print({
          batch,
          expectedManifest: app.catalog.multiSource.getExpectedManifest(
            batch.expectedManifestId,
          ),
          verifiedManifest:
            app.catalog.multiSource.getVerifiedManifestByExpectedId(
              batch.expectedManifestId,
            ),
        });
      } else if (
        action === "scan" ||
        action === "create" ||
        action === "retry"
      ) {
        const draft = app.sourceDraft.get();
        const selections = draft.selections.filter(
          ({ accessClass }) => accessClass === "native-path",
        );
        if (!selections.length)
          throw new Error(
            "Add at least one native source with import-batch add --manifest.",
          );
        let previousBatchId: string | undefined;
        if (action === "retry") {
          previousBatchId = positional[2];
          if (!previousBatchId)
            throw new Error(
              "Specify a failed, partial or cancelled batch ID to retry.",
            );
          const previous =
            app.catalog.multiSource.getImportBatch(previousBatchId);
          if (
            !previous ||
            previous.projectId !== app.project.id ||
            !["failed", "partial", "cancelled"].includes(previous.status)
          )
            throw new Error(
              "Only a failed, partial or cancelled batch in this project can be refreshed.",
            );
          if (previous.draftRevision !== draft.revision)
            throw new ApplicationError(
              "import.draftStale",
              "The source draft changed; start a new import batch instead.",
              409,
            );
        }
        const requestId = value(options, "request-id") ?? randomUUID();
        const selectionIds = selections.map(({ id }) => id);
        const summary = await app.sourceDiscovery.scan({
          projectId: app.project.id,
          baseRevision: draft.revision,
          requestId: randomUUID(),
          selectionIds,
          signal: controller.signal,
          onProgress: (progress) =>
            console.error(
              JSON.stringify({ event: "import.discovery", ...progress }),
            ),
        });
        if (action === "scan") {
          print({ summary });
          if (summary.cancelled) process.exitCode = 130;
          else if (summary.failed) process.exitCode = 1;
        } else if (summary.cancelled || summary.failed) {
          print({ summary, sealed: false });
          process.exitCode = summary.cancelled ? 130 : 1;
        } else {
          const result = await app.sourceBatches.createAndSeal({
            projectId: app.project.id,
            baseRevision: draft.revision,
            requestId,
            selectionIds,
            partialPolicy: "require-all",
            signal: controller.signal,
            onProgress: (progress) =>
              console.error(
                JSON.stringify({ event: "import.sealing", ...progress }),
              ),
          });
          print({
            ...(previousBatchId
              ? {
                  refreshedFromBatchId: previousBatchId,
                  refreshedSnapshot: true,
                }
              : {}),
            result,
          });
          if (result.status === "cancelled") process.exitCode = 130;
          else if (result.status !== "sealed") process.exitCode = 1;
        }
      } else if (action === "cancel") {
        throw new Error(
          "Cancel the active local command with Ctrl+C; it will persist a cancelled batch status.",
        );
      } else {
        throw new Error(
          "Choose import-batch add|scan|create|status|retry|cancel.",
        );
      }
    } else if (command === "analysis-run") {
      const action = positional[1];
      if (action === "status") {
        const id = positional[2];
        if (!id) throw new Error("Specify a source analysis run ID.");
        print(app.sourceAnalysis.getRun(id));
      } else if (action === "create") {
        const manifestId = value(options, "manifest");
        if (!manifestId)
          throw new Error("Specify --manifest <verified-manifest-id>.");
        const scopeMode = value(options, "scope") ?? "selected-sources";
        if (scopeMode !== "selected-sources" && scopeMode !== "project-catalog")
          throw new Error(
            "Choose --scope selected-sources or project-catalog.",
          );
        let travelContext: TravelContextV1 | undefined;
        const travelPath = value(options, "travel-gpx");
        const offsetInput = value(options, "clock-offset-minutes");
        const timeZone = value(options, "time-zone");
        if (
          !travelPath &&
          (offsetInput !== undefined ||
            timeZone !== undefined ||
            value(options, "travel-assets") !== undefined)
        )
          throw new Error(
            "Clock settings and asset assignment require --travel-gpx.",
          );
        if (travelPath) {
          const routePath = resolve(travelPath);
          const routeInfo = await lstat(routePath);
          if (
            routeInfo.isSymbolicLink() ||
            !routeInfo.isFile() ||
            routeInfo.size > 5 * 1024 * 1024
          )
            throw new Error(
              "GPX route must be a regular non-symlink file under 5 MiB.",
            );
          const routeBytes = await readFile(routePath);
          if (routeBytes.length > 5 * 1024 * 1024)
            throw new Error("GPX route exceeds 5 MiB.");
          const track = parseGpxTrack(`gpx-${randomUUID()}`, routeBytes);
          const manifest =
            app.catalog.multiSource.getVerifiedManifest(manifestId);
          if (!manifest) throw new Error("Verified manifest was not found.");
          const manifestAssetIds = [
            ...new Set(manifest.members.map(({ assetId }) => assetId)),
          ].sort();
          const requestedAssets = value(options, "travel-assets")
            ?.split(",")
            .map((id) => id.trim())
            .filter(Boolean);
          const assetIds = requestedAssets
            ? [...new Set(requestedAssets)].sort()
            : manifestAssetIds;
          const offsetMinutes =
            offsetInput === undefined ? 0 : Number(offsetInput);
          if (!Number.isFinite(offsetMinutes) || Math.abs(offsetMinutes) > 1440)
            throw new Error(
              "Clock adjustment must be between -1440 and 1440 minutes.",
            );
          const offsetMilliseconds = Math.round(offsetMinutes * 60_000);
          travelContext = {
            version: 1,
            algorithmVersion: "travel-v1",
            tracks: [track],
            clockMappings:
              offsetMilliseconds !== 0 || timeZone
                ? [
                    {
                      id: `clock-${randomUUID()}`,
                      assetIds,
                      offsetMilliseconds,
                      ...(timeZone ? { timeZone } : {}),
                      source: "manual",
                    },
                  ]
                : [],
            assignments: [{ trackId: track.id, assetIds }],
          };
        }
        const result = await app.sourceAnalysis.createRun({
          projectId: app.project.id,
          verifiedManifestId: manifestId,
          scopeMode,
          ...(options["confirm-project-catalog"] === true
            ? { confirmProjectCatalog: true }
            : {}),
          ...(travelContext ? { travelContext } : {}),
          ...(options["visual-samples"] === true
            ? {
                visualSampling: {
                  version: 1 as const,
                  algorithmVersion: "representative-frames-v1" as const,
                },
              }
            : {}),
          requestId: value(options, "request-id") ?? randomUUID(),
          signal: controller.signal,
          onProgress: (progress) =>
            console.error(
              JSON.stringify({ event: "analysis.progress", ...progress }),
            ),
        });
        print({ result });
        if (result.run.status === "cancelled") process.exitCode = 130;
        else if (result.run.status !== "completed") process.exitCode = 1;
      } else if (action === "retry") {
        const runId = positional[2];
        if (!runId)
          throw new Error("Specify a source analysis run ID to retry.");
        const result = await app.sourceAnalysis.retryRun({
          projectId: app.project.id,
          runId,
          requestId: value(options, "request-id") ?? randomUUID(),
          signal: controller.signal,
          onProgress: (progress) =>
            console.error(
              JSON.stringify({ event: "analysis.retry", ...progress }),
            ),
        });
        print({ result });
        if (result.run.status === "cancelled") process.exitCode = 130;
        else if (result.run.status !== "completed") process.exitCode = 1;
      } else if (action === "cancel") {
        throw new Error(
          "Cancel the active local analysis command with Ctrl+C; a different process's owner cannot be assumed dead.",
        );
      } else {
        throw new Error("Choose analysis-run create|status|retry|cancel.");
      }
    } else if (command === "analysis-review") {
      const action = positional[1];
      const runId = positional[2];
      if (!runId) throw new Error("Specify a source analysis run ID.");
      if (action === "search") {
        const result = app.sourceAnalysisReview.search({
          runId,
          query: value(options, "query") ?? "",
          offset: Number(value(options, "offset") ?? 0),
          limit: Number(value(options, "limit") ?? 50),
        });
        print({
          ...result,
          decisions: app.sourceAnalysisReview.decisions(runId),
        });
      } else if (action === "preview") {
        const raw = await reviewJsonFile(
          value(options, "operation"),
          "operation",
        );
        const operation = raw.operation ?? raw;
        print({
          preview: app.sourceAnalysisReview.preview({
            runId,
            operation: operation as ReviewDecisionOperation,
          }),
        });
      } else if (action === "accept") {
        const rawOperation = await reviewJsonFile(
          value(options, "operation"),
          "operation",
        );
        const operation = rawOperation.operation ?? rawOperation;
        const rawPreview = await reviewJsonFile(
          value(options, "preview-file"),
          "preview",
        );
        const preview = (
          rawPreview.preview &&
          typeof rawPreview.preview === "object" &&
          !Array.isArray(rawPreview.preview)
            ? rawPreview.preview
            : rawPreview
        ) as Record<string, unknown>;
        if (
          typeof preview.manifestId !== "string" ||
          typeof preview.beforeFingerprint !== "string" ||
          typeof preview.operationFingerprint !== "string"
        )
          throw new Error(
            "Review preview file is missing its exact decision preconditions.",
          );
        const result = await app.sourceAnalysisReview.accept({
          projectId: app.project.id,
          runId,
          operation: operation as ReviewDecisionOperation,
          expectedManifestId: preview.manifestId,
          expectedBeforeFingerprint: preview.beforeFingerprint,
          expectedOperationFingerprint: preview.operationFingerprint,
          ...(typeof preview.storyRevision === "string"
            ? { expectedStoryRevision: preview.storyRevision }
            : {}),
          requestId: value(options, "request-id") ?? randomUUID(),
          ...(value(options, "supersedes-decision")
            ? { supersedesDecisionId: value(options, "supersedes-decision") }
            : {}),
        });
        print({ decision: result });
      } else {
        throw new Error("Choose analysis-review search|preview|accept.");
      }
    } else if (command === "list") {
      const offset = Number(value(options, "offset") ?? 0);
      const limit = Number(value(options, "limit") ?? 60);
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 1000
      )
        throw new Error("List requires offset >= 0 and limit 1–1000.");
      print({
        assets: app.catalog.listAssets({ offset, limit }),
        total: app.catalog.countAssets(),
      });
    } else if (command === "analyze") print(app.analyze());
    else if (command === "rate") {
      const id = positional[1];
      if (!id || !app.catalog.getAsset(id))
        throw new Error("Specify an existing media asset ID.");
      const state: {
        favorite?: boolean;
        rejected?: boolean;
        locked?: boolean;
      } = {};
      for (const [flag, key, enabled] of [
        ["favorite", "favorite", true],
        ["unfavorite", "favorite", false],
        ["reject", "rejected", true],
        ["unreject", "rejected", false],
        ["lock", "locked", true],
        ["unlock", "locked", false],
      ] as const)
        if (options[flag]) state[key] = enabled;
      const ratingText = value(options, "rating");
      const rating = ratingText === undefined ? undefined : Number(ratingText);
      if (
        rating !== undefined &&
        (!Number.isFinite(rating) || rating < 0 || rating > 5)
      )
        throw new Error("Rating must be 0–5.");
      app.catalog.updateAsset(id, {
        ...(rating !== undefined ? { rating } : {}),
        state,
      });
      print({ asset: app.catalog.getAsset(id) });
    } else if (["transcribe", "waveform", "scenes"].includes(command)) {
      const id = positional[1];
      if (!id) throw new Error("Specify a media asset ID.");
      const language = value(options, "language") ?? "auto";
      const execution = value(options, "execution") ?? "auto";
      if (
        !["auto", "zh", "en", "ja"].includes(language) ||
        !["auto", "cpu", "gpu"].includes(execution)
      )
        throw new Error(
          "Choose a supported transcription language and processing device.",
        );
      const job = await app.analyzeIntelligence(id, {
        operation: command as "transcribe" | "waveform" | "scenes",
        language: language as "auto" | "zh" | "en" | "ja",
        execution: execution as "auto" | "cpu" | "gpu",
        modelPath: value(options, "model"),
        signal: controller.signal,
        onJob: (job) =>
          console.error(JSON.stringify({ event: "job.progress", ...job })),
      });
      print({ job });
      if (job.status === "cancelled") process.exitCode = 130;
      else if (job.status === "failed") process.exitCode = 1;
    } else if (command === "intelligence") {
      const action = positional[1],
        id = positional[2];
      if (action === "jobs") {
        print({
          jobs: app.catalog
            .listJobs()
            .filter((job) =>
              ["transcribe", "waveform", "scenes"].includes(job.type),
            ),
        });
      } else if (action === "recovery" && id) {
        print(app.intelligence.analysisRecoveryStatus(id));
      } else if (action === "recover" && id) {
        if (options["confirm-stopped"] !== true)
          throw new Error(
            "Use --confirm-stopped only after confirming the previous analysis process has stopped.",
          );
        const recovery = app.intelligence.analysisRecoveryStatus(id);
        print({
          job: app.intelligence.manualRecoverAnalysis(id, {
            confirmStopped: true,
            checkpoint: recovery.checkpoint,
            ownerToken: recovery.ownerToken,
          }),
        });
      } else {
        throw new Error(
          "Choose intelligence jobs, recovery <job-id>, or recover <job-id> --confirm-stopped.",
        );
      }
    } else if (command === "transcript") {
      const action = positional[1];
      const actions = [
        "get",
        "edit",
        "search",
        "revisions",
        "undo",
        "redo",
        "select",
      ];
      const id = action && actions.includes(action) ? positional[2] : action;
      if (!id) throw new Error("Specify a media asset ID.");
      const paging = {
        offset: Number(value(options, "offset") ?? 0),
        limit: Number(value(options, "limit") ?? 100),
      };
      if (action === "edit")
        print(
          await app.transcriptEditor.edit(
            id,
            await commandFile(value(options, "commands")),
          ),
        );
      else if (action === "search")
        print(
          await app.transcriptEditor.search(id, {
            ...paging,
            query: value(options, "query") ?? "",
            caseSensitive: options["case-sensitive"] === true,
          }),
        );
      else if (action === "revisions")
        print(await app.transcriptEditor.revisions(id, paging));
      else if (action === "undo" || action === "redo" || action === "select") {
        const input = {
          baseRevision: value(options, "base-revision") ?? "",
          requestId: value(options, "request-id") ?? "",
        };
        print(
          action === "select"
            ? await app.transcriptEditor.selectRevision(id, {
                ...input,
                revisionId: value(options, "revision") ?? "",
              })
            : await app.transcriptEditor[action](id, input),
        );
      } else {
        const intelligence = await app.intelligence.read(id, paging);
        const transcript = await app.transcriptEditor.get(id, paging);
        print({
          ...intelligence,
          ...transcript,
          // Keep legacy reads compatible, with text and revision from one page.
          transcript: transcript.document,
          transcriptTotal: transcript.total,
          transcriptOffset: transcript.offset,
        });
      }
    } else if (command === "glossary") {
      const action = positional[1],
        scope =
          value(options, "scope") ??
          (action === "list" ? "effective" : "project");
      if (
        !["global", "project", "effective"].includes(scope) ||
        (action !== "list" && scope === "effective")
      )
        throw new Error(
          "Choose global or project scope for changes; effective is read-only.",
        );
      if (action === "list")
        print({
          entries: app.knowledge.glossaryList(
            scope as "global" | "project" | "effective",
          ),
        });
      else if (action === "delete") {
        const id = value(options, "id");
        if (!id) throw new Error("Specify --id for the glossary entry.");
        print({
          ok: app.knowledge.glossaryDelete(id, scope as "global" | "project"),
        });
      } else if (action === "add" || action === "update") {
        const id = value(options, "id");
        const existing =
          action === "update"
            ? app.knowledge
                .glossaryList(scope as "global" | "project")
                .find((entry) => entry.id === id)
            : undefined;
        if (action === "update" && !existing)
          throw new Error("Specify an existing --id for glossary update.");
        if (options.enable && options.disable)
          throw new Error("Choose either --enable or --disable.");
        const input: GlossaryInput = {
          scope: scope as "global" | "project",
          source: value(options, "source") ?? existing?.source ?? "",
          replacement:
            value(options, "replacement") ?? existing?.replacement ?? "",
          ...(id ? { id } : {}),
          enabled: options.disable
            ? false
            : options.enable
              ? true
              : (existing?.enabled ?? true),
          ...(options["case-sensitive"]
            ? { caseSensitive: true }
            : options["case-insensitive"]
              ? { caseSensitive: false }
              : {}),
        };
        print({ entry: app.knowledge.glossaryUpsert(input) });
      } else throw new Error("Choose glossary list, add, update or delete.");
    } else if (command === "review") {
      const action = positional[1],
        id = positional[2];
      if (!id) throw new Error("Specify a media, suggestion or review job ID.");
      if (action === "list") {
        const status = value(options, "status");
        if (
          status !== undefined &&
          !["pending", "accepted", "skipped", "stale"].includes(status)
        )
          throw new Error("Choose a valid suggestion status.");
        print(
          await app.knowledge.suggestionsList(id, {
            offset: Number(value(options, "offset") ?? 0),
            limit: Number(value(options, "limit") ?? 100),
            status: status as
              "pending" | "accepted" | "skipped" | "stale" | undefined,
          }),
        );
      } else if (action === "accept")
        print(
          await app.knowledge.acceptSuggestion(id, {
            baseRevision: value(options, "base-revision") ?? "",
            requestId: value(options, "request-id") ?? "",
          }),
        );
      else if (action === "skip")
        print({ suggestion: app.knowledge.skipSuggestion(id) });
      else if (action === "batches")
        print({ batches: app.knowledge.batches(id) });
      else if (action === "recover") {
        if (options["confirm-stopped"] !== true)
          throw new Error(
            "Use --confirm-stopped only after confirming the previous review process is no longer running.",
          );
        const recovery = app.knowledge.reviewRecoveryStatus(id);
        print({
          job: app.knowledge.manualRecoverReview(id, {
            confirmStopped: true,
            ownerToken: recovery.ownerToken,
            updatedAt: recovery.updatedAt,
          }),
        });
      } else if (action === "skip-batch") {
        const index = Number(value(options, "index"));
        if (
          value(options, "index") === undefined ||
          !Number.isSafeInteger(index) ||
          index < 0
        )
          throw new Error("Use --index with a nonnegative batch index.");
        print({ batch: app.knowledge.skipBatch(id, index) });
      } else if (action === "run" || action === "retry-batch") {
        const settings = {
          signal: controller.signal,
          onJob: (job: unknown) =>
            console.error(JSON.stringify({ event: "job.progress", job })),
        };
        let job;
        if (action === "run") {
          const source = value(options, "source") ?? "glossary";
          if (source !== "glossary" && source !== "language")
            throw new Error("Choose glossary or language review.");
          job = await app.runKnowledgeReview(id, {
            ...settings,
            source,
            batchSize: positive(options, "batch-size"),
            segmentIds: value(options, "assets")?.split(","),
          });
        } else {
          const index = Number(value(options, "index"));
          if (
            value(options, "index") === undefined ||
            !Number.isSafeInteger(index) ||
            index < 0
          )
            throw new Error("Use --index with a nonnegative batch index.");
          job = await app.retryKnowledgeReview(id, index, settings);
        }
        print({ job });
        if (job.status === "cancelled") process.exitCode = 130;
        else if (job.status === "failed") process.exitCode = 1;
      } else
        throw new Error(
          "Choose review run, list, accept, skip, batches, recover, retry-batch or skip-batch.",
        );
    } else if (command === "script-review") {
      const action = positional[1];
      const id = positional[2];
      if (action === "provider")
        print(app.knowledge.languageProvider(["text"]));
      else {
        if (!id) throw new Error("Specify a Story or script suggestion ID.");
        if (action === "accept")
          print({
            story: app.sceneScriptReview.accept(id, {
              baseRevision: value(options, "base-revision") ?? "",
              requestId: value(options, "request-id") ?? "",
            }),
          });
        else if (action === "skip")
          print({ suggestion: app.sceneScriptReview.skip(id) });
        else if (action === "list" || action === "run") {
          const beatId = value(options, "beat");
          const field = value(options, "field");
          if (!beatId || (field !== "narration" && field !== "visualDirection"))
            throw new Error(
              "Specify --beat and --field narration|visualDirection.",
            );
          if (action === "run") {
            const job = await app.runSceneScriptReview(id, {
              beatId,
              field,
              signal: controller.signal,
              onJob: (job) =>
                console.error(JSON.stringify({ event: "job.progress", job })),
            });
            print(job);
            if (job.status === "cancelled") process.exitCode = 130;
            else if (job.status === "failed") process.exitCode = 1;
          } else {
            const status = value(options, "status");
            if (
              status !== undefined &&
              !["pending", "accepted", "skipped", "stale"].includes(status)
            )
              throw new Error("Choose a valid script suggestion status.");
            print(
              app.sceneScriptReview.list(id, {
                beatId,
                field,
                offset: Number(value(options, "offset") ?? 0),
                limit: Number(value(options, "limit") ?? 100),
                status: status as
                  "pending" | "accepted" | "skipped" | "stale" | undefined,
              }),
            );
          }
        } else
          throw new Error(
            "Choose script-review provider, list, run, accept or skip.",
          );
      }
    } else if (command === "captions") {
      const action = positional[1];
      const projectId = app.project.id;
      if (action === "prepare") {
        const compositionId = value(options, "composition") ?? "";
        const state = new TimelineEditor(app).get(compositionId);
        print(
          await app.captions.prepare(
            {
              projectId,
              compositionId,
              trackId: value(options, "track") ?? "",
              baseRevision: state.revision,
            },
            { signal: controller.signal },
          ),
        );
      } else if (action === "get") {
        print(
          await app.captions.get(
            positional[2] ?? "",
            {
              projectId,
              offset: Number(value(options, "offset") ?? 0),
              limit: Number(value(options, "limit") ?? 100),
              issueOffset: Number(value(options, "issue-offset") ?? 0),
              issueLimit: Number(value(options, "issue-limit") ?? 200),
              sourceOffset: Number(value(options, "source-offset") ?? 0),
              sourceLimit: Number(value(options, "source-limit") ?? 200),
              clipOffset: Number(value(options, "clip-offset") ?? 0),
              clipLimit: Number(value(options, "clip-limit") ?? 200),
            },
            { signal: controller.signal },
          ),
        );
      } else if (action === "export") {
        const format = value(options, "format");
        if (format !== "srt" && format !== "vtt")
          throw new Error("Choose --format srt or vtt.");
        print(
          await app.captions.export(positional[2] ?? "", format, {
            projectId,
            signal: controller.signal,
          }),
        );
      } else if (action === "add-track") {
        print(
          await app.captions.addNativeTrack(
            {
              projectId,
              snapshotId: positional[2] ?? "",
              name: value(options, "name") ?? "",
              language: value(options, "language"),
              trackId: value(options, "track-id"),
              requestId: value(options, "request-id"),
            },
            { signal: controller.signal },
          ),
        );
      } else
        throw new Error(
          "Choose captions prepare, get, add-track, or export. Run openfilm --help.",
        );
    } else if (command === "marker") {
      const id = positional[1];
      const time = Number(value(options, "time"));
      if (
        !id ||
        value(options, "time") === undefined ||
        !Number.isFinite(time) ||
        time < 0
      )
        throw new Error(
          "Specify an asset ID and nonnegative --time in source seconds.",
        );
      print({ marker: await app.intelligence.addMarker(id, time) });
    } else if (command === "story" && positional[1] === "generate") {
      print({
        story: app.generateStory({
          title: value(options, "title"),
          template: value(options, "template"),
          targetDuration: positive(options, "target"),
          maxDuration: positive(options, "max"),
          assetIds: value(options, "assets")?.split(",").filter(Boolean),
        }),
      });
    } else if (command === "direction-review") {
      const compositionId = positional[2];
      if (!compositionId)
        throw new Error("Specify the composition ID to review.");
      const editor = new TimelineEditor(app);
      if (positional[1] === "preview") {
        const beatId = value(options, "beat");
        const clips = directionIdentifiers(options, "clips");
        if (!beatId || !clips)
          throw new Error(
            "Specify --beat and --clips or --clips-json for the reviewed scene.",
          );
        print({
          plan: editor.previewDirection(compositionId, {
            beatId,
            clipIds: clips,
            replaceExisting: options["replace-existing"] === true,
          }),
        });
      } else if (positional[1] === "accept") {
        const path = value(options, "plan");
        const requestId = value(options, "request-id");
        if (!path || !requestId)
          throw new Error(
            "Specify --plan <preview.json> and one stable --request-id for retries.",
          );
        const file = resolve(path);
        const info = await stat(file);
        if (!info.isFile() || info.size > 16 * 1024 * 1024)
          throw new Error(
            "Direction review JSON must be a regular file of at most 16 MiB.",
          );
        const bytes = await readFile(file);
        if (bytes.length > 16 * 1024 * 1024)
          throw new Error("Direction review JSON exceeds 16 MiB.");
        const input = JSON.parse(bytes.toString("utf8")) as {
          plan?: DirectionReviewPlan;
        };
        const plan = input.plan;
        if (!plan || !Array.isArray(plan.actions))
          throw new Error("Provide a saved {plan} direction preview.");
        const selected = directionIdentifiers(options, "actions");
        print(
          await editor.acceptDirection(compositionId, {
            planId: plan.id,
            baseRevision: plan.baseRevision,
            contextSignature: plan.contextSignature,
            options: plan.options,
            actionIds:
              selected === undefined
                ? plan.actions.map((action) => action.id)
                : selected,
            requestId,
          }),
        );
      } else throw new Error("Choose direction-review preview or accept.");
    } else if (command === "scene-plan") {
      if (positional[1] === "preview") {
        print({
          plan: app.previewScenePlan({
            title: value(options, "title"),
            groupBy: (value(options, "group-by") ?? "category") as
              "category" | "chronology",
            targetDuration:
              positive(options, "target") ??
              app.project.filmSettings?.targetDuration ??
              270,
            maxDuration:
              positive(options, "max") ??
              app.project.filmSettings?.maxDuration ??
              300,
            brief: value(options, "brief"),
            transition: value(options, "transition") as
              "cut" | "crossfade" | undefined,
            assetIds: value(options, "assets")?.split(",").filter(Boolean),
          }),
        });
      } else if (positional[1] === "accept") {
        const path = value(options, "plan");
        if (!path)
          throw new Error(
            "Use --plan <preview.json> with a saved scene-plan preview.",
          );
        const file = resolve(path);
        const info = await stat(file);
        if (!info.isFile() || info.size > 16 * 1024 * 1024)
          throw new Error(
            "Scene-plan JSON must be a regular file of at most 16 MiB.",
          );
        const bytes = await readFile(file);
        if (bytes.length > 16 * 1024 * 1024)
          throw new Error("Scene-plan JSON exceeds 16 MiB.");
        const input = JSON.parse(bytes.toString("utf8")) as {
          plan: ScenePlanAcceptance;
        };
        print(app.acceptScenePlan(input.plan));
      } else
        throw new Error(
          "Choose scene-plan preview or accept. Run openfilm --help.",
        );
    } else if (command === "compose")
      print({ composition: app.compose(value(options, "story")) });
    else if (command === "motion") {
      const action = positional[1],
        id = value(options, "id");
      if (action === "providers") print(app.motionGeneration.list());
      else if (action === "clear") {
        await app.motionGeneration.clearPreviews();
        print({ cleared: true });
      } else if (action === "preview") {
        const compositionId = value(options, "composition"),
          clipId = value(options, "clip"),
          requestId = value(options, "request-id");
        if (!compositionId || !clipId || !requestId)
          throw new Error(
            "Choose --composition, --clip and a stable --request-id UUID.",
          );
        print(
          await app.runMotionGeneration(
            {
              projectId: app.project.id,
              compositionId,
              clipId,
              requestId,
              baseRevision: new TimelineEditor(app).get(compositionId).revision,
              providerId:
                value(options, "motion-provider") ?? "local-motion-fixture",
              count: Number(value(options, "motion-count") ?? "2"),
              ...(value(options, "motion-candidates")
                ? {
                    candidateAssetIds: value(
                      options,
                      "motion-candidates",
                    )!.split(","),
                  }
                : {}),
              ...(value(options, "motion-scene")
                ? { sceneId: value(options, "motion-scene") }
                : {}),
              prompt: value(options, "motion-prompt") ?? "",
              negativeConstraints: value(options, "motion-negative") ?? "",
              consent: options["motion-consent"] === true,
              containsPeople:
                options["environment-only"] !== true ||
                options["contains-people"] === true,
            },
            controller.signal,
          ),
        );
      } else {
        if (!id)
          throw new Error("Provide --id for the motion candidate or request.");
        if (action === "receipt") print(await app.motionGeneration.receipt(id));
        else if (action === "accept")
          print(
            await app.motionGeneration.accept(id, options.reviewed === true),
          );
        else if (action === "revoke") {
          await app.motionGeneration.revoke(id);
          print({ revoked: true });
        } else if (action === "import" || action === "restore") {
          const editor = new TimelineEditor(app);
          const state =
            action === "import"
              ? await app.motionGeneration.importCandidate(id, editor)
              : await app.motionGeneration.restore(id, editor);
          print({
            revision: state.revision,
            receipt: await app.motionGeneration.receipt(id),
          });
        } else throw new Error("Choose a supported motion action.");
      }
    } else if (command === "audio-quality") {
      const compositionId =
        value(options, "composition") ?? app.project.timelines[0]?.id;
      const clipId = value(options, "clip");
      if (!compositionId || !clipId)
        throw new Error("Choose --composition and --clip for audio review.");
      const revision = new TimelineEditor(app).get(compositionId).revision;
      print(
        await app.runAudioQuality(
          compositionId,
          clipId,
          revision,
          controller.signal,
        ),
      );
    } else if (command === "visual-qa") {
      const report = await app.runVisualQa(
        value(options, "composition") ?? positional[1],
        {
          signal: controller.signal,
          onProgress(progress) {
            console.error(
              JSON.stringify({ event: "visual-qa.progress", progress }),
            );
          },
        },
      );
      print(report);
      if (report.status !== "complete") process.exitCode = 1;
    } else if (command === "render")
      print({
        path: await app.render(value(options, "composition"), {
          signal: controller.signal,
          lookOverride,
          quality,
          ...(value(options, "caption-track")
            ? { captionTrackId: value(options, "caption-track") }
            : {}),
        }),
      });
    else if (command === "handoff") {
      if (options["no-captions"] && value(options, "caption-track"))
        throw new Error("Choose --caption-track or --no-captions");
      if (positional[1] === "review")
        print(
          app.reviewHandoff(
            value(options, "composition") ??
              app.project.timelines.at(-1)?.id ??
              "",
            {
              mode: (value(options, "mode") ??
                "preserve-editability") as import("@openfilm/exporters").HandoffMode,
              bakeAudio: options["bake-audio"] === true,
              ...(options["no-captions"]
                ? { captionTrackId: null }
                : value(options, "caption-track")
                  ? { captionTrackId: value(options, "caption-track") }
                  : {}),
            },
          ),
        );
      else if (positional[1] === "export") {
        const path = value(options, "review");
        if (!path) throw new Error("Provide --review <review.json>");
        const info = await stat(path);
        if (!info.isFile() || info.size > 16 * 1024 * 1024)
          throw new Error("Review must be regular JSON of at most 16 MiB");
        const bytes = await readFile(path);
        if (bytes.length > 16 * 1024 * 1024)
          throw new Error("Review JSON exceeds 16 MiB");
        const review = JSON.parse(
          bytes.toString("utf8"),
        ) as import("@openfilm/application").HandoffReview;
        print(
          await app.exportHandoff(
            {
              projectId: review.projectId,
              compositionId: review.plan.compositionId,
              revision: review.revision,
              mode: review.plan.mode,
              bakeAudio: review.plan.bakeAudio,
              captionTrackId: review.plan.captionTrackId,
            },
            controller.signal,
          ),
        );
      } else throw new Error("Choose handoff review or export");
    } else if (command === "export") {
      const format = value(options, "format") ?? "json";
      if (options["preview"] && format !== "png")
        throw new Error("--preview applies only to --format png.");
      if (
        value(options, "crop-preview-token") &&
        format !== "png" &&
        format !== "mp4"
      )
        throw new Error("--crop-preview-token applies only to MP4/PNG.");
      const ratioInput = value(options, "ratio");
      const framingInput = value(options, "framing");
      const fps = positive(options, "fps") ?? app.project.settings.frameRate;
      const width = positive(options, "width");
      const height = positive(options, "height");
      const profileFlags = ["ratio", "framing", "fps", "width", "height"].some(
        (key) => Object.hasOwn(options, key),
      );
      if (format === "mp4") {
        if (
          options["confirm-crop"] &&
          (!profileFlags || framingInput !== "crop")
        )
          throw new Error(
            "--confirm-crop requires --framing crop on an MP4 profile.",
          );
        const exportProfile = profileFlags
          ? createExportProfile({
              ratio: (ratioInput ?? "16:9") as ExportRatio,
              frameRate: fps,
              ...(width === undefined ? {} : { width }),
              ...(height === undefined ? {} : { height }),
              framing: (framingInput ?? "contain") as ExportFraming,
              format: "mp4",
              quality: quality ?? "standard",
            })
          : undefined;
        if (value(options, "time") !== undefined)
          throw new Error("--time applies only to --format png.");
        print(
          await app.exportMp4(value(options, "composition"), {
            signal: controller.signal,
            lookOverride,
            quality,
            ...(exportProfile ? { exportProfile } : {}),
            ...(options["confirm-crop"] ? { confirmCrop: true } : {}),
            ...(value(options, "crop-preview-token")
              ? { cropPreviewToken: value(options, "crop-preview-token") }
              : {}),
            ...(value(options, "caption-track")
              ? { captionTrackId: value(options, "caption-track") }
              : {}),
          }),
        );
      } else if (
        format === "png" ||
        format === "wav" ||
        format === "audio-stems"
      ) {
        if (format === "png" && value(options, "time") === undefined)
          throw new Error("--format png requires --time <seconds>.");
        if (format !== "png" && value(options, "time") !== undefined)
          throw new Error("--time applies only to --format png.");
        if (
          format === "png" &&
          options["confirm-crop"] &&
          framingInput !== "crop"
        )
          throw new Error("--confirm-crop requires --framing crop.");
        if (
          format !== "png" &&
          (quality !== undefined ||
            lookOverride !== undefined ||
            value(options, "caption-track") !== undefined ||
            options["confirm-crop"])
        )
          throw new Error(
            "Quality, looks, captions and crop confirmation apply only to MP4/PNG.",
          );
        const exportProfile = createExportProfile({
          ratio: (ratioInput ?? "16:9") as ExportRatio,
          frameRate: fps,
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
          framing: (framingInput ?? "contain") as ExportFraming,
          format,
          quality: quality ?? "standard",
        });
        const requestId = value(options, "request-id") ?? randomUUID();
        if (format === "png") {
          const time = Number(value(options, "time"));
          if (!Number.isFinite(time) || time < 0)
            throw new Error("--time must be a nonnegative number of seconds.");
          if (options["preview"]) {
            const preview = await app.previewExportFrame({
              compositionId: value(options, "composition"),
              profile: exportProfile,
              time,
              lookOverride,
              ...(value(options, "caption-track")
                ? { captionTrackId: value(options, "caption-track") }
                : {}),
              signal: controller.signal,
            });
            print({
              ...preview,
              path: await app.exportProfiles.previewPath(preview.token),
            });
            return;
          }
          print(
            await app.exportStill({
              compositionId: value(options, "composition"),
              profile: exportProfile,
              time,
              requestId,
              confirmCrop: Boolean(options["confirm-crop"]),
              cropPreviewToken: value(options, "crop-preview-token"),
              lookOverride,
              ...(value(options, "caption-track")
                ? { captionTrackId: value(options, "caption-track") }
                : {}),
              signal: controller.signal,
            }),
          );
        } else {
          print(
            await app.exportProfileAudio({
              compositionId: value(options, "composition"),
              profile: exportProfile,
              requestId,
              signal: controller.signal,
            }),
          );
        }
      } else {
        if (
          profileFlags ||
          value(options, "time") !== undefined ||
          options["confirm-crop"] ||
          value(options, "request-id")
        )
          throw new Error(
            "Profile export options require --format mp4, png, wav or audio-stems.",
          );
        if (!["json", "otio", "fcpxml", "edl"].includes(format))
          throw new Error(
            "Choose mp4, png, wav, audio-stems, json, otio, fcpxml, or edl.",
          );
        print(
          await app.exportWithReport(
            format as "json" | "otio" | "fcpxml" | "edl",
            value(options, "composition"),
          ),
        );
      }
    } else throw new Error(`Unknown command ${command}. Run openfilm --help.`);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    app.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      event: "command.failed",
      ...errorInfo(error),
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode =
    error instanceof Error && error.name === "AbortError" ? 130 : 1;
}
