import { resolve } from "node:path";
import { OpenFilmApplication } from "@openfilm/application";
import { startServer } from "../../server/src/server.js";

const usage = `OpenFilm — local media storytelling

Usage:
  openfilm create <film.openfilm> --title "My film"
  openfilm import <folder> --project <film.openfilm> [--no-proxy]
  openfilm list --project <film.openfilm> [--offset 0 --limit 60]
  openfilm analyze --project <film.openfilm>
  openfilm rate <asset-id> --project <film.openfilm> --rating 5 [--favorite --lock]
  openfilm story generate --project <film.openfilm> --template proposal-film --target 270 --max 300
  openfilm compose --project <film.openfilm> [--story <id>]
  openfilm render --project <film.openfilm> [--composition <id>]
  openfilm export --project <film.openfilm> --format otio
  openfilm serve [--project <film.openfilm>] [--port 4310]

Original media stays unchanged. No network service or AI account is required.
Use --unfavorite, --unreject, --unlock to clear state. Use --assets id1,id2
for an explicit story scope in large libraries. Outputs are JSON.
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
  if (command === "create") {
    if (!positional[1]) throw new Error("Specify a new .openfilm directory.");
    const app = await OpenFilmApplication.create(
      resolve(positional[1]),
      value(options, "title") ?? "Untitled film",
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
  const app = await OpenFilmApplication.open(resolve(project));
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
      print({
        path: await app.export(
          format as "json" | "otio" | "fcpxml" | "edl",
          value(options, "composition"),
        ),
      });
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
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode =
    error instanceof Error && error.name === "AbortError" ? 130 : 1;
}
