import { resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { errorInfo, type GlossaryInput } from "@openfilm/core";
import type { TranscriptMutationInput } from "@openfilm/catalog";
import {
  OpenFilmApplication,
  resolveUserDataDirectory,
} from "@openfilm/application";
import { startServer } from "../../server/src/server.js";

const usage = `OpenFilm — local media storytelling

Usage:
  openfilm create <film.openfilm> --title "My film"
  openfilm import <folder> --project <film.openfilm> [--no-proxy]
  openfilm list --project <film.openfilm> [--offset 0 --limit 60]
  openfilm analyze --project <film.openfilm>
  openfilm transcribe <asset-id> --project <film.openfilm> [--language auto|zh|en|ja] [--execution auto|cpu|gpu] [--model <local-model-folder>]
  openfilm waveform <asset-id> --project <film.openfilm>
  openfilm scenes <asset-id> --project <film.openfilm>
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
  openfilm marker <asset-id> --project <film.openfilm> --time <source-seconds>
  openfilm rate <asset-id> --project <film.openfilm> --rating 5 [--favorite --lock]
  openfilm story generate --project <film.openfilm> --template proposal-film --target 270 --max 300
  openfilm compose --project <film.openfilm> [--story <id>]
  openfilm render --project <film.openfilm> [--composition <id>]
  openfilm export --project <film.openfilm> --format otio
  openfilm serve [--project <film.openfilm>] [--port 4310]

Original media stays unchanged. No network service or AI account is required.
Use --unfavorite, --unreject, --unlock to clear state. Use --assets id1,id2
for an explicit story scope in large libraries. Outputs are JSON.
Use --user-data-dir <folder> for trusted global glossary storage (or OPENFILM_USER_DATA_DIR).
--commands reads a JSON object {baseRevision,requestId,commands} of at most 1 MiB.
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
  ]);
  const values = new Set([
    "project",
    "title",
    "offset",
    "limit",
    "rating",
    "template",
    "target",
    "max",
    "story",
    "composition",
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
    "index",
    "user-data-dir",
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
function positive(options: Options, key: string): number | undefined {
  const input = value(options, key);
  if (input === undefined) return undefined;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`--${key} must be a positive number.`);
  return parsed;
}
const print = (result: unknown) => console.log(JSON.stringify(result, null, 2));

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
async function main() {
  const { positional, options } = parse(process.argv.slice(2));
  const command = positional[0];
  if (options.version) {
    console.log("OpenFilm 0.1.0");
    return;
  }
  if (!command || options.help) {
    console.log(usage);
    return;
  }
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
  const app = await OpenFilmApplication.open(resolve(project), runtimeOptions);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (command === "import") {
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
      } else print(await app.intelligence.read(id, paging));
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
      else if (action === "skip-batch") {
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
          "Choose review run, list, accept, skip, batches, retry-batch or skip-batch.",
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
    } else if (command === "compose")
      print({ composition: app.compose(value(options, "story")) });
    else if (command === "render")
      print({
        path: await app.render(value(options, "composition"), {
          signal: controller.signal,
        }),
      });
    else if (command === "export") {
      const format = value(options, "format") ?? "json";
      if (!["json", "otio", "fcpxml", "edl"].includes(format))
        throw new Error("Choose json, otio, fcpxml, or edl.");
      print(
        await app.exportWithReport(
          format as "json" | "otio" | "fcpxml" | "edl",
          value(options, "composition"),
        ),
      );
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
