import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import { startServer } from "../../apps/server/src/server.js";

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const storyId = "story # & 記憶";
const beatId = "beat / 日本語";
const originalNarration = "我們慢慢走，記住這一天。";
const exec = promisify(execFile);

async function fixture(execution: "local" | "remote" = "local") {
  const root = await mkdtemp(join(tmpdir(), "openfilm-script-api-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "Film # & 記憶.openfilm");
  const app = await OpenFilmApplication.create(directory, "Our story", {
    projectContentLocale: "zh-TW",
  });
  app.project.stories.push({
    id: storyId,
    title: "平凡的日子",
    targetDuration: 30,
    maxDuration: 40,
    beats: [
      {
        id: beatId,
        title: "一起走過",
        intent: "Preserve the supplied memory; invent no facts.",
        targetDuration: 12,
        script: {
          narration: originalNarration,
          visualDirection: "先停留在照片，再接現場聲音。",
        },
      },
    ],
  });
  await app.save();
  app.close();
  const prompts: string[] = [];
  const provider: LanguageProvider = {
    id: "script-only-text-provider",
    name: "Deterministic script fixture, not a language model",
    kind: "language",
    execution,
    ...(execution === "remote"
      ? { endpoint: "https://script.example.invalid/generate" }
      : {}),
    dataKinds: ["text"],
    async generate(prompt) {
      prompts.push(prompt);
      const input = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
      return JSON.stringify({
        suggestions: [
          {
            beatId: input.beat.id,
            field: input.field,
            after: `${input.text} [reviewed fixture]`,
            reason: "Explicit fixture suggestion; no language-quality claim.",
          },
        ],
      });
    },
  };
  const runtime = await startServer({
    port: 0,
    project: directory,
    userDataDirectory: join(root, "user"),
    languageProvider: provider,
  });
  cleanups.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}/api`;
  const request = (path: string, data?: unknown, method?: string) =>
    fetch(`${base}${path}`, {
      method: method ?? (data === undefined ? "GET" : "POST"),
      ...(data === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          }),
    });
  return { request, prompts, directory, provider };
}

async function waitForJob(
  request: Awaited<ReturnType<typeof fixture>>["request"],
  jobId: string,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await request("/jobs");
    expect(response.status).toBe(200);
    const { jobs } = await response.json();
    const job = jobs.find((item: { id: string }) => item.id === jobId);
    expect(job).toBeDefined();
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    await delay(20);
  }
  throw new Error("The deterministic script review did not finish.");
}

describe("scene-script review HTTP boundary", () => {
  it("recognizes a text-only provider for scripts without advertising transcript review", async () => {
    const { request, prompts } = await fixture();
    const script = await request("/review/provider?workflow=scene-script");
    expect(script.status).toBe(200);
    expect(await script.json()).toMatchObject({
      configured: true,
      available: true,
      provider: { dataKinds: ["text"] },
    });
    expect(await (await request("/review/provider")).json()).toMatchObject({
      available: false,
    });
    expect(prompts).toEqual([]);
  });

  it("runs a bounded script job and saves an explicit decision without changing film timing", async () => {
    const { request, prompts, directory } = await fixture();
    const before = await (await request("/project")).json();
    const route = `/stories/${encodeURIComponent(storyId)}/script-review`;
    const started = await request(route, { beatId, field: "narration" });
    expect(started.status).toBe(202);
    const { job } = await started.json();
    expect((await waitForJob(request, job.id)).status).toBe("completed");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain(directory);
    const query = new URLSearchParams({ beatId, field: "narration" });
    const listing = await request(`${route}/suggestions?${query}`);
    expect(listing.status).toBe(200);
    const state = await listing.json();
    expect(state.suggestions).toHaveLength(1);
    expect(state.suggestions[0]).toMatchObject({
      before: originalNarration,
      status: "pending",
      reason: "Explicit fixture suggestion; no language-quality claim.",
    });
    expect((await (await request("/project")).json()).project).toEqual(
      before.project,
    );
    const id = encodeURIComponent(state.suggestions[0].id);
    const receipt = { baseRevision: state.revision, requestId: "api-accept-1" };
    const accepted = await request(
      `/script-review/suggestions/${id}/accept`,
      receipt,
    );
    expect(accepted.status).toBe(200);
    const { story } = await accepted.json();
    expect(story.beats[0].script).toEqual({
      narration: `${originalNarration} [reviewed fixture]`,
      visualDirection:
        before.project.stories[0].beats[0].script.visualDirection,
    });
    expect(
      (await request(`/script-review/suggestions/${id}/accept`, receipt))
        .status,
    ).toBe(200);
    const after = (await (await request("/project")).json()).project;
    expect(after.timelines).toEqual(before.project.timelines);
    expect(after.stories[0].beats[0].targetDuration).toBe(12);
    expect((await request("/project/close", {})).status).toBe(200);
    expect((await request("/project/open", { path: directory })).status).toBe(
      200,
    );
    expect(
      (await (await request("/project")).json()).project.stories[0],
    ).toEqual(story);
  });

  it("requires the exact remote disclosure and shares consent without calling an unconsented provider", async () => {
    const { request, provider, prompts } = await fixture("remote");
    const route = `/stories/${encodeURIComponent(storyId)}/script-review`;
    const settings = { beatId, field: "narration" };
    expect((await request(route, settings)).status).toBe(400);
    expect(prompts).toEqual([]);
    const disclosed = {
      allow: true,
      workflow: "scene-script",
      providerId: provider.id,
      endpoint: provider.endpoint,
      dataKinds: provider.dataKinds,
    };
    expect(
      (
        await request("/review/consent", {
          ...disclosed,
          endpoint: "https://changed.example.invalid",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/review/consent", {
          ...disclosed,
          dataKinds: ["text", "images"],
        })
      ).status,
    ).toBe(400);
    expect(prompts).toEqual([]);
    const granted = await request("/review/consent", disclosed);
    expect(granted.status).toBe(200);
    expect(await granted.json()).toMatchObject({ available: true });
    // This provider has no transcript capability; script consent must remain valid.
    expect(await (await request("/review/provider")).json()).toMatchObject({
      available: false,
    });
    const started = await request(route, settings);
    expect(started.status).toBe(202);
    expect(
      (await waitForJob(request, (await started.json()).job.id)).status,
    ).toBe("completed");
    expect(prompts).toHaveLength(1);
    expect(
      (
        await request("/review/consent", {
          allow: false,
          workflow: "scene-script",
        })
      ).status,
    ).toBe(200);
    expect((await request(route, settings)).status).toBe(400);
    expect(prompts).toHaveLength(1);
  });

  it("rejects old suggestions after a saved manual edit without replacing newer words", async () => {
    const { request } = await fixture();
    const route = `/stories/${encodeURIComponent(storyId)}/script-review`;
    const started = await request(route, { beatId, field: "narration" });
    await waitForJob(request, (await started.json()).job.id);
    const query = new URLSearchParams({ beatId, field: "narration" });
    const state = await (await request(`${route}/suggestions?${query}`)).json();
    const before = (await (await request("/project")).json()).project;
    const beats = structuredClone(before.stories[0].beats);
    beats[0].script.narration = "這是我後來親手寫的新文字。";
    expect(
      (
        await request(
          `/stories/${encodeURIComponent(storyId)}`,
          { beats },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    const accepted = await request(
      `/script-review/suggestions/${encodeURIComponent(state.suggestions[0].id)}/accept`,
      {
        baseRevision: state.revision,
        requestId: "stale-accept",
      },
    );
    expect(accepted.status).toBe(409);
    const after = (await (await request("/project")).json()).project;
    expect(after.stories[0].beats[0].script.narration).toBe(
      beats[0].script.narration,
    );
    expect(after.timelines).toEqual(before.timelines);
    const listing = await (
      await request(`${route}/suggestions?${query}`)
    ).json();
    expect(listing.suggestions[0].status).toBe("stale");
  });

  it("preserves an independently edited visual direction while accepting narration", async () => {
    const { request } = await fixture();
    const route = `/stories/${encodeURIComponent(storyId)}/script-review`;
    const started = await request(route, { beatId, field: "narration" });
    await waitForJob(request, (await started.json()).job.id);
    const query = new URLSearchParams({ beatId, field: "narration" });
    const state = await (await request(`${route}/suggestions?${query}`)).json();
    const before = (await (await request("/project")).json()).project;
    const beats = structuredClone(before.stories[0].beats);
    beats[0].script.visualDirection = "先看海，再保留五秒現場聲音。";
    expect(
      (
        await request(
          `/stories/${encodeURIComponent(storyId)}`,
          { beats },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    const accepted = await request(
      `/script-review/suggestions/${encodeURIComponent(state.suggestions[0].id)}/accept`,
      {
        baseRevision: state.revision,
        requestId: "other-field-is-independent",
      },
    );
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).story.beats[0].script).toEqual({
      narration: `${originalNarration} [reviewed fixture]`,
      visualDirection: beats[0].script.visualDirection,
    });
  });

  it("keeps a skipped decision durable and deduplicates a repeated provider result", async () => {
    const { request, directory } = await fixture();
    const route = `/stories/${encodeURIComponent(storyId)}/script-review`;
    const settings = { beatId, field: "visualDirection" };
    const query = new URLSearchParams(settings);
    const started = await request(route, settings);
    await waitForJob(request, (await started.json()).job.id);
    const state = await (await request(`${route}/suggestions?${query}`)).json();
    const before = (await (await request("/project")).json()).project;
    const skipped = await request(
      `/script-review/suggestions/${encodeURIComponent(state.suggestions[0].id)}/skip`,
      {},
    );
    expect(skipped.status).toBe(200);
    expect((await skipped.json()).suggestion.status).toBe("skipped");
    expect((await (await request("/project")).json()).project).toEqual(before);
    const repeated = await request(route, settings);
    await waitForJob(request, (await repeated.json()).job.id);
    expect((await request("/project/close", {})).status).toBe(200);
    expect((await request("/project/open", { path: directory })).status).toBe(
      200,
    );
    const after = await (await request(`${route}/suggestions?${query}`)).json();
    expect(after.total).toBe(1);
    expect(after.suggestions[0]).toMatchObject({
      id: state.suggestions[0].id,
      status: "skipped",
    });
  });

  it("rejects unsupported targets, injection fields and unbounded pages before provider invocation", async () => {
    const { request, prompts } = await fixture();
    const route = `/stories/${encodeURIComponent(storyId)}/script-review`;
    expect((await request(route, { beatId, field: "duration" })).status).toBe(
      400,
    );
    expect(
      (await request(route, { beatId: "missing", field: "narration" })).status,
    ).toBe(400);
    expect(
      (
        await request(route, {
          beatId,
          field: "narration",
          endpoint: "https://injected.example.invalid",
        })
      ).status,
    ).toBe(400);
    const query = new URLSearchParams({
      beatId,
      field: "narration",
      limit: "1000",
    });
    expect((await request(`${route}/suggestions?${query}`)).status).toBe(400);
    expect((await request(`${route}/suggestions?field=narration`)).status).toBe(
      400,
    );
    expect((await request("/review/provider?workflow=unknown")).status).toBe(
      400,
    );
    expect(prompts).toEqual([]);
  });

  it("shares persisted review decisions with headless CLI without requiring a provider for acceptance", async () => {
    const { request, directory } = await fixture();
    const route = `/stories/${encodeURIComponent(storyId)}/script-review`;
    const started = await request(route, { beatId, field: "narration" });
    await waitForJob(request, (await started.json()).job.id);
    expect((await request("/project/close", {})).status).toBe(200);
    const cli = (...args: string[]) =>
      exec(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/cli/src/index.ts",
          "script-review",
          ...args,
          "--project",
          directory,
        ],
        { cwd: process.cwd() },
      );
    const state = JSON.parse(
      (await cli("list", storyId, "--beat", beatId, "--field", "narration"))
        .stdout,
    );
    expect(state.suggestions).toHaveLength(1);
    const args = [
      "accept",
      state.suggestions[0].id,
      "--base-revision",
      state.revision,
      "--request-id",
      "cli-accept-1",
    ];
    const accepted = JSON.parse((await cli(...args)).stdout);
    expect(accepted.story.beats[0].script.narration).toBe(
      `${originalNarration} [reviewed fixture]`,
    );
    expect(JSON.parse((await cli(...args)).stdout).story).toEqual(
      accepted.story,
    );
    const after = JSON.parse(
      (
        await cli(
          "list",
          storyId,
          "--beat",
          beatId,
          "--field",
          "narration",
          "--status",
          "accepted",
        )
      ).stdout,
    );
    expect(after.total).toBe(1);
  });
});
