import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import type { Job } from "@openfilm/core";

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(mode: "completed" | "failed" | "held") {
  const root = await mkdtemp(join(tmpdir(), "openfilm-script-cli-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "Film 記憶.openfilm");
  const userDataDirectory = join(root, "user");
  const app = await OpenFilmApplication.create(
    directory,
    "Our story",
    {},
    { userDataDirectory },
  );
  try {
    app.project.stories.push({
      id: "story",
      title: "Our journey",
      beats: [
        {
          id: "scene",
          title: "Arriving",
          script: {
            narration: "Our original words.",
            visualDirection: "Keep this direction.",
          },
        },
      ],
    });
    await app.save();
  } finally {
    app.close();
  }

  // The stock CLI remains provider-free. This preload supplies a trusted local
  // fixture through the real application runtime, without replacing CLI work.
  const preload = join(root, "language-provider.mjs");
  await writeFile(
    preload,
    `
import { setTimeout as delay } from "node:timers/promises";
import { OpenFilmApplication } from ${JSON.stringify(pathToFileURL(resolve("packages/application/src/index.ts")).href)};
const originalOpen = OpenFilmApplication.open;
OpenFilmApplication.open = function (directory, runtime, options) {
  return originalOpen.call(this, directory, {
    ...runtime,
    languageProvider: {
      id: "cli-script-fixture",
      name: "Deterministic CLI fixture, not a language model",
      kind: "language",
      execution: "local",
      dataKinds: ["text"],
      async generate(prompt, options) {
        process.stderr.write(JSON.stringify({ event: "fixture.provider.started" }) + "\\n");
        if (${JSON.stringify(mode)} === "failed") throw new Error("Deterministic provider failure");
        if (${JSON.stringify(mode)} === "held") {
          options?.signal?.addEventListener("abort", () => {
            process.stderr.write(JSON.stringify({ event: "fixture.provider.aborted" }) + "\\n");
          }, { once: true });
          await delay(2500, undefined, { signal: options?.signal });
        }
        const input = JSON.parse(prompt.slice(prompt.indexOf("\\n") + 1));
        return JSON.stringify({ suggestions: [{
          beatId: input.beat.id,
          field: input.field,
          after: input.text + " [reviewed fixture]",
          reason: "Explicit fixture change; no language-quality claim."
        }] });
      }
    }
  }, options);
};
`,
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      "--import",
      pathToFileURL(preload).href,
      "apps/cli/src/index.ts",
      "script-review",
      "run",
      "story",
      "--beat",
      "scene",
      "--field",
      "narration",
      "--project",
      directory,
      "--user-data-dir",
      userDataDirectory,
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  const completion = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((accept, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => accept({ code, signal }));
  });
  void completion.catch(() => {});
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await completion;
  });
  return {
    child,
    completion,
    stderr: () => stderr,
    job: () => JSON.parse(stdout) as Job,
    async persisted() {
      const reopened = await OpenFilmApplication.openForExport(directory, {
        userDataDirectory,
      });
      try {
        return {
          jobs: reopened.catalog.listJobs(),
          script: reopened.project.stories[0]!.beats[0]!.script,
          suggestions: reopened.sceneScriptReview.list("story", {
            beatId: "scene",
            field: "narration",
          }),
        };
      } finally {
        reopened.close();
      }
    },
  };
}

describe("scene-script review CLI job outcomes", () => {
  it("keeps completed jobs as bare JSON with exit status zero", async () => {
    const cli = await fixture("completed");
    expect(await cli.completion, cli.stderr()).toEqual({
      code: 0,
      signal: null,
    });
    const job = cli.job();
    expect(job).toMatchObject({
      type: "scene-script-review",
      status: "completed",
    });
    expect(job).not.toHaveProperty("job");
    expect(cli.stderr()).toContain('"event":"job.progress"');
    const saved = await cli.persisted();
    expect(saved.jobs).toEqual([job]);
    expect(saved.script).toEqual({
      narration: "Our original words.",
      visualDirection: "Keep this direction.",
    });
    expect(saved.suggestions.total).toBe(1);
  });

  it("returns exit status one for a persisted failed provider job", async () => {
    const cli = await fixture("failed");
    const outcome = await cli.completion;
    const job = cli.job();
    expect(job).toMatchObject({
      type: "scene-script-review",
      status: "failed",
      errors: [{ message: expect.stringContaining("provider failure") }],
    });
    expect((await cli.persisted()).jobs).toEqual([job]);
    expect(outcome, cli.stderr()).toEqual({ code: 1, signal: null });
  });

  it.skipIf(process.platform === "win32").each(["SIGINT", "SIGTERM"] as const)(
    "cancels the held provider on %s and exits with 130",
    async (signal) => {
      const cli = await fixture("held");
      await expect
        .poll(() => cli.stderr().includes('"fixture.provider.started"'), {
          timeout: 10000,
        })
        .toBe(true);
      expect(cli.child.kill(signal)).toBe(true);
      const outcome = await cli.completion;
      const job = cli.job();
      expect(job).toMatchObject({
        type: "scene-script-review",
        status: "cancelled",
      });
      expect(outcome, cli.stderr()).toEqual({ code: 130, signal: null });
      expect(cli.stderr()).toContain('"fixture.provider.aborted"');
      const saved = await cli.persisted();
      expect(saved.jobs).toEqual([job]);
      expect(saved.script).toEqual({
        narration: "Our original words.",
        visualDirection: "Keep this direction.",
      });
      expect(saved.suggestions.total).toBe(0);
    },
  );
});
