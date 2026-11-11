// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import {
  availableParallelism,
  cpus,
  freemem,
  loadavg,
  platform,
  release,
  totalmem,
} from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEquivalentSources, summarizeStages } from "./media-profile.mjs";

const [sha, outputArg, repetitionsArg = "2", pattern = ".*"] =
  process.argv.slice(2);
const repetitions = Number(repetitionsArg);
if (
  !/^[a-f0-9]{40}$/.test(sha ?? "") ||
  !outputArg ||
  !Number.isInteger(repetitions) ||
  repetitions < 2 ||
  repetitions > 5
) {
  throw new Error(
    "Usage: node scripts/ci/run-media-profile.mjs FIXED_SHA OUTPUT_DIR [2..5 repetitions] [test-name regex]",
  );
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (
  git("rev-parse", "HEAD") !== sha ||
  git("status", "--porcelain", "--untracked-files=no")
) {
  throw new Error(
    "Measurement requires the requested HEAD and no tracked changes; commit the harness first.",
  );
}
const output = resolve(outputArg);
await mkdir(output, { recursive: false });
const bin = join(output, "bin");
await mkdir(bin);
const env = { ...process.env };
const tools = {};
for (const name of ["ffmpeg", "ffprobe"]) {
  const path = execFileSync("which", [name], { encoding: "utf8" }).trim();
  tools[name] = {
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    version: execFileSync(path, ["-version"], { encoding: "utf8" }),
  };
  env[`OPENFILM_PROFILE_REAL_${name.toUpperCase()}`] = path;
  await symlink(
    fileURLToPath(new URL("./media-profile-command.py", import.meta.url)),
    join(bin, name),
  );
}
env.PATH = `${bin}:${process.env.PATH}`;
const files = [
  "packages/application/tests/pipeline-change-impact.test.ts",
  "tests/integration/story-graph-pipeline-e2e-acceptance.test.ts",
];
const vitest = resolve("node_modules/vitest/vitest.mjs");
const config = "vitest.media-profile.config.ts";
const inventory = execFileSync(
  process.execPath,
  [vitest, "list", "--config", config, ...files, "--json"],
  { encoding: "utf8" },
);
await writeFile(join(output, "inventory.json"), inventory);
await writeFile(
  join(output, "tracked-source.txt"),
  git("ls-files", "--stage") + "\n",
);
const context = () => ({
  at: new Date().toISOString(),
  loadavg: loadavg(),
  freeMemoryBytes: freemem(),
});
const metadata = {
  schema: 1,
  sha,
  node: process.version,
  pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
  python: execFileSync("python3", ["--version"], { encoding: "utf8" }).trim(),
  tools,
  host: {
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    availableParallelism: availableParallelism(),
    totalMemoryBytes: totalmem(),
  },
  workerSettings: {
    maxWorkers: 1,
    fileParallelism: false,
    retry: "unchanged default",
    timeout: "unchanged original suite/case settings",
    ffmpegThreads: "unchanged product arguments, retained per command",
  },
  repetitions,
  pattern,
  files,
  started: context(),
  observations: [],
};
await writeFile(
  join(output, "metadata.json"),
  JSON.stringify(metadata, null, 2),
);
let failure = false;
let baselineSources;
for (let repetition = 1; repetition <= repetitions; repetition++) {
  const prefix = join(output, `repeat-${repetition}`);
  const args = [
    vitest,
    "run",
    "--config",
    config,
    ...files,
    "--testNamePattern",
    pattern,
    "--reporter=json",
    `--outputFile=${prefix}.vitest.json`,
  ];
  const started = context();
  const start = performance.now();
  const child = spawn(process.execPath, args, {
    env: {
      ...env,
      OPENFILM_PROFILE_STAGES: `${prefix}.stages.jsonl`,
      OPENFILM_PROFILE_COMMANDS: `${prefix}.commands.jsonl`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (data) => {
    log += data;
    process.stdout.write(data);
  });
  child.stderr.on("data", (data) => {
    log += data;
    process.stderr.write(data);
  });
  const exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  await writeFile(`${prefix}.log`, log);
  const rows = (await readFile(`${prefix}.stages.jsonl`, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const commands = (await readFile(`${prefix}.commands.jsonl`, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (exitCode === 0) {
    baselineSources ??= commands;
    assertEquivalentSources(baselineSources, commands);
  }
  metadata.observations.push({
    repetition,
    command: [process.execPath, ...args],
    started,
    ended: context(),
    wallMs: performance.now() - start,
    exitCode,
    stages: summarizeStages(rows),
  });
  await writeFile(
    join(output, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );
  if (exitCode !== 0) {
    failure = true;
    break;
  }
}
process.exitCode = failure ? 1 : 0;
