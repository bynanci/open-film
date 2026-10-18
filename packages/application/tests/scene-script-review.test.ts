import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageProvider } from "@openfilm/plugin-sdk";
import type { Job } from "@openfilm/core";
import { createReviewOwner, OpenFilmApplication } from "../src/index.js";

type Field = "narration" | "visualDirection";
interface ReviewPrompt {
  task: string;
  language: string;
  story: { id: string; title: string };
  beat: {
    id: string;
    title: string;
    intent?: string;
    timingTarget: {
      targetDuration?: number;
      minDuration?: number;
      maxDuration?: number;
    };
  };
  field: Field;
  text: string;
}

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});
function provider(
  generate: LanguageProvider["generate"],
  overrides: Partial<LanguageProvider> = {},
): LanguageProvider {
  return {
    id: "explicit-scene-language",
    name: "Deterministic scene script fixture, not real AI",
    kind: "language",
    execution: "local",
    dataKinds: ["text"],
    generate,
    ...overrides,
  };
}
function payload(prompt: string): ReviewPrompt {
  return JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as ReviewPrompt;
}
function output(prompt: string, after?: string) {
  const context = payload(prompt);
  return JSON.stringify({
    suggestions: [
      {
        beatId: context.beat.id,
        field: context.field,
        after: after ?? `${context.text} Revised.`,
        reason: "Explicit deterministic fixture",
      },
    ],
  });
}
function register(
  app: OpenFilmApplication,
  generate: LanguageProvider["generate"] = async (prompt) => output(prompt),
) {
  const spy = vi.fn<LanguageProvider["generate"]>(generate);
  app.knowledge.registerLanguageProvider(provider(spy));
  return spy;
}
function story(app: OpenFilmApplication) {
  return app.project.stories.find((item) => item.id === "story")!;
}
function beat(app: OpenFilmApplication) {
  return story(app).beats.find((item) => item.id === "beat")!;
}
async function review(app: OpenFilmApplication, field: Field = "narration") {
  expect(
    (await app.runSceneScriptReview("story", { beatId: "beat", field })).status,
  ).toBe("completed");
  return app.sceneScriptReview.list("story", { beatId: "beat", field })
    .suggestions[0]!;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-scene-script-review-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = { userDataDirectory: join(root, "user-data") };
  let app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Script review",
    {},
    runtime,
  );
  let closed = false;
  cleanup.push(() => {
    if (!closed) app.close();
  });
  app.project.stories.push({
    id: "story",
    title: "Our journey",
    targetDuration: 12,
    maxDuration: 15,
    beats: [
      {
        id: "beat",
        title: "Arriving",
        intent: "Recall arrival",
        targetDuration: 6,
        minDuration: 4,
        maxDuration: 8,
        script: {
          narration: "We arrived at dawn.",
          visualDirection: "Open on the quiet harbour.",
        },
        candidateAssetIds: [],
      },
    ],
  });
  await app.save();
  return {
    root,
    get app() {
      return app;
    },
    close() {
      app.close();
      closed = true;
    },
    async reopen() {
      const directory = app.directory;
      app.close();
      app = await OpenFilmApplication.open(directory, runtime);
    },
  };
}

describe("scene script review application", () => {
  it("uses a text-only language provider and accepts only its selected planning field", async () => {
    const context = await fixture();
    const generate = vi.fn<LanguageProvider["generate"]>(async (prompt) =>
      output(prompt, "We reached the harbour at dawn."),
    );
    context.app.knowledge.registerLanguageProvider(provider(generate));
    const before = structuredClone(context.app.project.stories[0]!);
    expect(
      context.app.sceneScriptReview.status("story").provider,
    ).toMatchObject({ available: true });
    expect(
      (
        await context.app.runSceneScriptReview("story", {
          beatId: "beat",
          field: "narration",
        })
      ).status,
    ).toBe("completed");
    const page = context.app.sceneScriptReview.list("story", {
      beatId: "beat",
      field: "narration",
    });
    expect(page.total).toBe(1);
    const suggestion = page.suggestions[0]!;
    expect(suggestion).toMatchObject({
      before: "We arrived at dawn.",
      after: "We reached the harbour at dawn.",
      status: "pending",
      target: { storyId: "story", beatId: "beat", field: "narration" },
    });
    expect(context.app.project.stories[0]).toEqual(before);
    const accepted = context.app.sceneScriptReview.accept(suggestion.id, {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "accept-narration",
    });
    expect(accepted.beats[0]?.script).toEqual({
      narration: "We reached the harbour at dawn.",
      visualDirection: "Open on the quiet harbour.",
    });
    await context.reopen();
    expect(context.app.project.stories[0]?.beats[0]?.script?.narration).toBe(
      "We reached the harbour at dawn.",
    );
    expect(
      context.app.sceneScriptReview.list("story", {}).suggestions[0]?.status,
    ).toBe("accepted");
  });

  it.each(["en-US", "zh-TW", "ja-JP"] as const)(
    "sends only the selected field and declared planning context in the %s project language",
    async (language) => {
      const { app } = await fixture();
      app.project.projectContentLocale = language;
      beat(app).candidateAssetIds = ["private-asset-id"];
      beat(app).selectedAssetIds = ["private-selection"];
      await app.save();
      const generate = register(app);
      await review(app);
      const prompt = generate.mock.calls[0]![0];
      expect(prompt.startsWith("scene-script-review")).toBe(true);
      expect(payload(prompt)).toEqual({
        task: "scene-script-review",
        language,
        story: { id: "story", title: "Our journey" },
        beat: {
          id: "beat",
          title: "Arriving",
          intent: "Recall arrival",
          timingTarget: { targetDuration: 6, minDuration: 4, maxDuration: 8 },
        },
        field: "narration",
        text: "We arrived at dawn.",
      });
      expect(prompt).not.toMatch(
        /private-asset-id|private-selection|quiet harbour|file:|project\.json/,
      );
    },
  );

  it("makes no remote call before text consent and requires no transcript consent", async () => {
    const { app } = await fixture();
    const generate = vi.fn<LanguageProvider["generate"]>(async (prompt) =>
      output(prompt),
    );
    const remote = provider(generate, {
      execution: "remote",
      endpoint: "https://review.example.invalid",
    });
    app.knowledge.registerLanguageProvider(remote);
    expect(app.sceneScriptReview.status("story").provider).toMatchObject({
      configured: true,
      available: false,
    });
    await expect(
      app.runSceneScriptReview("story", { beatId: "beat", field: "narration" }),
    ).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
    expect(app.catalog.listJobs()).toHaveLength(0);
    app.knowledge.grantConsent({
      providerId: remote.id,
      dataKinds: ["text"],
      grantedAt: "2026-10-16T00:00:00Z",
    });
    await review(app);
    expect(generate).toHaveBeenCalledOnce();
    app.knowledge.revokeConsent(remote.id);
    expect(app.sceneScriptReview.status("story").provider.available).toBe(
      false,
    );
  });

  it("does not invoke or reserve a job without a configured provider", async () => {
    const { app } = await fixture();
    expect(app.sceneScriptReview.status("story").provider).toMatchObject({
      configured: false,
      available: false,
    });
    await expect(
      app.runSceneScriptReview("story", { beatId: "beat", field: "narration" }),
    ).rejects.toThrow();
    expect(app.catalog.listJobs()).toHaveLength(0);
  });

  it.each([
    "not JSON",
    JSON.stringify({ suggestions: [], execute: "change timeline" }),
    JSON.stringify({
      suggestions: [{ after: "Changed", reason: "Missing target" }],
    }),
    JSON.stringify({
      suggestions: [
        {
          beatId: "other",
          field: "narration",
          after: "Changed",
          reason: "Wrong beat",
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          beatId: "beat",
          field: "visualDirection",
          after: "Changed",
          reason: "Wrong field",
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          beatId: "beat",
          field: "narration",
          after: "We arrived at dawn.",
          reason: "Unchanged",
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          beatId: "beat",
          field: "narration",
          after: "Changed",
          reason: "",
          confidence: 0.5,
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          beatId: "beat",
          field: "narration",
          after: "\ud800",
          reason: "Invalid Unicode",
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          beatId: "beat",
          field: "narration",
          after: "Changed",
          reason: "Change",
          confidence: 5,
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          beatId: "beat",
          field: "narration",
          after: "Changed",
          reason: "Change",
          timeline: { delete: true },
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        {
          beatId: "beat",
          field: "narration",
          after: "x".repeat(8001),
          reason: "Too long",
        },
      ],
    }),
    JSON.stringify({
      suggestions: [
        { beatId: "beat", field: "narration", after: "First", reason: "One" },
        { beatId: "beat", field: "narration", after: "Second", reason: "Two" },
      ],
    }),
  ])(
    "rejects strict invalid provider output without creating evidence: %#",
    async (response) => {
      const { app } = await fixture();
      const before = structuredClone(app.project);
      register(app, async () => response);
      const job = await app.runSceneScriptReview("story", {
        beatId: "beat",
        field: "narration",
      });
      expect(job.status).toBe("failed");
      expect(job.errors?.[0]?.code).toBe("review.invalidOutput");
      expect(app.sceneScriptReview.list("story", {}).total).toBe(0);
      expect(app.project).toEqual(before);
      expect(app.hasActiveJobs).toBe(false);
    },
  );

  it("allows an empty suggestion set and a boundary of 8,000 Unicode codepoints", async () => {
    const { app } = await fixture();
    register(app, async () => JSON.stringify({ suggestions: [] }));
    expect(
      (
        await app.runSceneScriptReview("story", {
          beatId: "beat",
          field: "narration",
        })
      ).status,
    ).toBe("completed");
    expect(app.sceneScriptReview.list("story", {}).total).toBe(0);
    register(app, async (prompt) => output(prompt, "😀".repeat(8000)));
    const suggestion = await review(app);
    expect(Array.from(suggestion.after)).toHaveLength(8000);
  });

  it("uses target-specific revisions and preserves all unselected project content", async () => {
    const { app } = await fixture();
    app.project.stories.push({
      id: "other-story",
      title: "Other story",
      beats: [
        {
          id: "other-beat",
          title: "Untouched",
          script: {
            narration: "Other narration",
            visualDirection: "Other direction",
          },
        },
      ],
    });
    await app.save();
    register(app);
    const suggestion = await review(app);
    const initialRevision = app.sceneScriptReview.currentRevision(
      "story",
      "beat",
      "narration",
    );
    expect(initialRevision).toBe(suggestion.sourceRevisionId);
    beat(app).script!.visualDirection = "A manual change to the other field.";
    app.project.stories[1]!.title = "User's new title for another story";
    await app.save();
    expect(
      app.sceneScriptReview.currentRevision("story", "beat", "narration"),
    ).toBe(initialRevision);
    const before = structuredClone(app.project);
    const accepted = app.sceneScriptReview.accept(suggestion.id, {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "isolated-accept",
    });
    const expected = structuredClone(before);
    expected.stories[0]!.beats[0]!.script!.narration = suggestion.after;
    expect(app.project.stories).toEqual(expected.stories);
    expect(app.project.timelines).toEqual(before.timelines);
    expect(accepted).toEqual(expected.stories[0]);
  });

  it("rejects stale acceptance after an edit to its selected field", async () => {
    const { app } = await fixture();
    register(app);
    const suggestion = await review(app);
    beat(app).script!.narration = "My manually edited narration.";
    await app.save();
    expect(
      app.sceneScriptReview.currentRevision("story", "beat", "narration"),
    ).not.toBe(suggestion.sourceRevisionId);
    expect(() =>
      app.sceneScriptReview.accept(suggestion.id, {
        baseRevision: suggestion.sourceRevisionId,
        requestId: "stale-accept",
      }),
    ).toThrow();
    expect(beat(app).script!.narration).toBe("My manually edited narration.");
    expect(app.sceneScriptReview.list("story", {}).suggestions[0]?.status).toBe(
      "stale",
    );
  });

  it("discards in-flight output when its selected field changes before the provider returns", async () => {
    const { app } = await fixture();
    let release!: (value: string) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let prompt = "";
    register(app, (value) => {
      prompt = value;
      began();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const work = app.runSceneScriptReview("story", {
      beatId: "beat",
      field: "narration",
    });
    await started;
    beat(app).script!.narration = "Edited while the provider is working.";
    await app.save();
    release(output(prompt));
    expect((await work).status).toBe("failed");
    expect(app.sceneScriptReview.list("story", {}).total).toBe(0);
    expect(beat(app).script!.narration).toBe(
      "Edited while the provider is working.",
    );
  });

  it("deduplicates repeated evidence and persists skipped suggestions and completed jobs", async () => {
    const context = await fixture();
    const generate = register(context.app);
    const suggestion = await review(context.app);
    await review(context.app);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(context.app.sceneScriptReview.list("story", {}).total).toBe(1);
    context.app.sceneScriptReview.skip(suggestion.id);
    context.app.sceneScriptReview.skip(suggestion.id);
    expect(
      context.app.sceneScriptReview.list("story", { status: "skipped" }).total,
    ).toBe(1);
    await context.reopen();
    expect(
      context.app.sceneScriptReview.list("story", {}).suggestions[0],
    ).toMatchObject({ id: suggestion.id, status: "skipped" });
    expect(context.app.catalog.listJobs()).toHaveLength(2);
    expect(
      context.app.catalog.listJobs().every((job) => job.status === "completed"),
    ).toBe(true);
    expect(() =>
      context.app.sceneScriptReview.accept(suggestion.id, {
        baseRevision: suggestion.sourceRevisionId,
        requestId: "accept-skipped",
      }),
    ).toThrow();
  });

  it("paginates and filters scene evidence without including transcript suggestions", async () => {
    const { app } = await fixture();
    register(app);
    await review(app, "narration");
    await review(app, "visualDirection");
    const page = app.sceneScriptReview.list("story", { offset: 1, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.suggestions).toHaveLength(1);
    expect(
      app.sceneScriptReview.list("story", { field: "narration" }).total,
    ).toBe(1);
    expect(
      app.sceneScriptReview.list("story", {
        beatId: "beat",
        field: "visualDirection",
      }).revision,
    ).toBe(
      app.sceneScriptReview.currentRevision("story", "beat", "visualDirection"),
    );
    expect(app.catalog.knowledge.suggestionsList("source").total).toBe(0);
  });

  it("replays an acceptance receipt against the current story without overwriting later edits", async () => {
    const context = await fixture();
    register(context.app);
    const suggestion = await review(context.app);
    const input = {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "same-acceptance-request",
    };
    context.app.sceneScriptReview.accept(suggestion.id, input);
    beat(context.app).script!.visualDirection = "Later manual direction.";
    beat(context.app).script!.narration = "Later manual narration.";
    await context.app.save();
    const current = structuredClone(story(context.app));
    expect(context.app.sceneScriptReview.accept(suggestion.id, input)).toEqual(
      current,
    );
    expect(story(context.app)).toEqual(current);
    await context.reopen();
    expect(context.app.sceneScriptReview.accept(suggestion.id, input)).toEqual(
      current,
    );
    expect(() =>
      context.app.sceneScriptReview.accept(suggestion.id, {
        ...input,
        baseRevision: "different",
      }),
    ).toThrow();
  });

  it("rejects reusing an acceptance request for different suggestion content", async () => {
    const { app } = await fixture();
    register(app);
    const first = await review(app, "narration");
    const second = await review(app, "visualDirection");
    app.sceneScriptReview.accept(first.id, {
      baseRevision: first.sourceRevisionId,
      requestId: "receipt-collision",
    });
    expect(() =>
      app.sceneScriptReview.accept(second.id, {
        baseRevision: second.sourceRevisionId,
        requestId: "receipt-collision",
      }),
    ).toThrow();
    expect(beat(app).script?.visualDirection).toBe(
      "Open on the quiet harbour.",
    );
  });

  it("rejects a pre-aborted request without invoking its provider or reserving work", async () => {
    const { app } = await fixture();
    const generate = register(app);
    const controller = new AbortController();
    controller.abort();
    await expect(
      app.runSceneScriptReview("story", {
        beatId: "beat",
        field: "narration",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).not.toHaveBeenCalled();
    expect(app.catalog.listJobs()).toHaveLength(0);
    expect(app.hasActiveJobs).toBe(false);
  });

  it("cancels a non-cooperative provider promptly and ignores its late output", async () => {
    const { app } = await fixture();
    const controller = new AbortController();
    let release!: (value: string) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let prompt = "";
    register(app, (value) => {
      prompt = value;
      began();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const updates: string[] = [];
    const work = app.runSceneScriptReview("story", {
      beatId: "beat",
      field: "narration",
      jobId: "cancel-scene",
      signal: controller.signal,
      onJob: (job) => {
        updates.push(job.status);
        job.status = "failed";
      },
    });
    await started;
    expect(app.hasActiveJobs).toBe(true);
    await expect(
      app.runSceneScriptReview("story", {
        beatId: "beat",
        field: "visualDirection",
      }),
    ).rejects.toMatchObject({ code: "jobs.busy" });
    controller.abort();
    expect((await work).status).toBe("cancelled");
    expect(app.hasActiveJobs).toBe(false);
    expect(updates).toContain("running");
    expect(updates).toContain("cancelled");
    release(output(prompt));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(app.sceneScriptReview.list("story", {}).total).toBe(0);
    expect(
      app.catalog.listJobs().find((job) => job.id === "cancel-scene")?.status,
    ).toBe("cancelled");
    expect(beat(app).script?.narration).toBe("We arrived at dawn.");
    register(app);
    await review(app);
    expect(app.hasActiveJobs).toBe(false);
  });

  it("rolls back an acceptance when saving project.json fails and permits a retry", async () => {
    const { app } = await fixture();
    register(app);
    const suggestion = await review(app);
    const original = structuredClone(app.project);
    const path = join(app.directory, "project.json");
    const backup = join(app.directory, "project.json.backup");
    await rename(path, backup);
    await symlink(backup, path);
    const input = {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "save-failure-retry",
    };
    try {
      expect(() =>
        app.sceneScriptReview.accept(suggestion.id, input),
      ).toThrow();
      expect(app.project).toEqual(original);
      expect(
        app.sceneScriptReview.list("story", {}).suggestions[0]?.status,
      ).toBe("pending");
    } finally {
      await rm(path);
      await rename(backup, path);
    }
    app.sceneScriptReview.accept(suggestion.id, input);
    expect(beat(app).script?.narration).toBe(suggestion.after);
  });

  it("rejects acceptance when another application has changed project.json on disk", async () => {
    const context = await fixture();
    const { app } = context;
    register(app);
    const suggestion = await review(app);
    const other = await OpenFilmApplication.open(app.directory);
    cleanup.push(() => other.close());
    beat(other).script!.visualDirection = "Changed in another application.";
    await other.save();
    const disk = await readFile(join(app.directory, "project.json"), "utf8");
    expect(() =>
      app.sceneScriptReview.accept(suggestion.id, {
        baseRevision: suggestion.sourceRevisionId,
        requestId: "disk-conflict",
      }),
    ).toThrow();
    expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
      disk,
    );
    expect(beat(app).script?.narration).toBe("We arrived at dawn.");
    expect(app.sceneScriptReview.list("story", {}).suggestions[0]?.status).toBe(
      "pending",
    );
    await expect(app.save()).rejects.toThrow();
    context.close();
    expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
      disk,
    );
  });

  it("recovers a saved acceptance receipt after a catalog write fails without replaying its edit", async () => {
    const context = await fixture();
    register(context.app);
    const suggestion = await review(context.app);
    const input = {
      baseRevision: suggestion.sourceRevisionId,
      requestId: "recover-catalog-write",
    };
    vi.spyOn(
      context.app.catalog.knowledge,
      "updateSceneScriptSuggestion",
    ).mockImplementationOnce(() => {
      throw new Error("Injected catalog write failure after real project save");
    });
    expect(() =>
      context.app.sceneScriptReview.accept(suggestion.id, input),
    ).toThrow("Injected catalog write failure");
    expect(beat(context.app).script?.narration).toBe(suggestion.after);
    expect(
      context.app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id)
        ?.status,
    ).toBe("pending");
    beat(context.app).script!.narration =
      "A later manual edit after the interrupted acceptance.";
    await context.app.save();
    await context.reopen();
    const current = structuredClone(story(context.app));
    expect(
      context.app.sceneScriptReview.list("story", {}).suggestions[0]?.status,
    ).toBe("accepted");
    expect(context.app.sceneScriptReview.accept(suggestion.id, input)).toEqual(
      current,
    );
    expect(
      context.app.sceneScriptReview.list("story", {}).suggestions[0]?.status,
    ).toBe("accepted");
    expect(story(context.app)).toEqual(current);
    expect(
      context.app.project.sceneScriptReviewReceipts?.filter(
        (receipt) => receipt.suggestionId === suggestion.id,
      ),
    ).toHaveLength(1);
  });

  it.each(["\ud800"])(
    "rejects invalid source text before disclosure or job creation: %#",
    async (text) => {
      const { app } = await fixture();
      beat(app).script!.narration = text;
      await app.save();
      const generate = register(app);
      await expect(
        app.runSceneScriptReview("story", {
          beatId: "beat",
          field: "narration",
        }),
      ).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
      expect(app.catalog.listJobs()).toHaveLength(0);
      expect(beat(app).script?.narration).toBe(text);
    },
  );

  it("rejects an oversized source draft before saving or provider disclosure", async () => {
    const { app } = await fixture();
    const generate = register(app);
    const before = beat(app).script!.narration;
    beat(app).script!.narration = "x".repeat(8001);
    try {
      await expect(app.save()).rejects.toThrow();
      await expect(
        app.runSceneScriptReview("story", {
          beatId: "beat",
          field: "narration",
        }),
      ).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
      expect(app.catalog.listJobs()).toHaveLength(0);
    } finally {
      beat(app).script!.narration = before;
    }
  });

  it.each(["界".repeat(20000), '"'.repeat(30000)])(
    "rejects oversized UTF-8 or JSON-escaped context before invoking a provider: %#",
    async (title) => {
      const { app } = await fixture();
      story(app).title = title;
      await app.save();
      const before = structuredClone(app.project);
      const generate = register(app);
      await expect(
        app.runSceneScriptReview("story", {
          beatId: "beat",
          field: "narration",
        }),
      ).rejects.toMatchObject({ code: "request.tooLarge" });
      expect(generate).not.toHaveBeenCalled();
      expect(app.catalog.listJobs()).toHaveLength(0);
      expect(app.project).toEqual(before);
    },
  );

  it.each(["replace", "revoke"] as const)(
    "discards a provider result when its authorization changes during generation: %s",
    async (action) => {
      const { app } = await fixture();
      let release!: (value: string) => void;
      let began!: () => void;
      const started = new Promise<void>((resolve) => {
        began = resolve;
      });
      let prompt = "";
      const descriptor = provider(
        (value) => {
          prompt = value;
          began();
          return new Promise<string>((resolve) => {
            release = resolve;
          });
        },
        { execution: "remote", endpoint: "https://review.example.invalid" },
      );
      app.knowledge.registerLanguageProvider(descriptor);
      app.knowledge.grantConsent({
        providerId: descriptor.id,
        dataKinds: ["text"],
        grantedAt: "2026-10-16T00:00:00Z",
      });
      const work = app.runSceneScriptReview("story", {
        beatId: "beat",
        field: "narration",
      });
      await started;
      if (action === "replace")
        app.knowledge.registerLanguageProvider(
          provider(async (value) => output(value), {
            id: "replacement-language",
          }),
        );
      else app.knowledge.revokeConsent(descriptor.id);
      release(output(prompt));
      expect((await work).status).toBe("failed");
      expect(app.sceneScriptReview.list("story", {}).total).toBe(0);
      expect(beat(app).script?.narration).toBe("We arrived at dawn.");
      expect(app.hasActiveJobs).toBe(false);
    },
  );

  it("recovers an unknown scene review owner only against the confirmed exact checkpoint", async () => {
    const context = await fixture();
    const job: Job = {
      id: "legacy-scene-job",
      type: "scene-script-review",
      storyId: "story",
      beatId: "beat",
      scriptField: "narration",
      status: "queued",
      updatedAt: "2026-10-16T00:00:00Z",
    };
    context.app.catalog.saveJob(job);
    await context.reopen();
    expect(
      context.app.catalog.listJobs().find((item) => item.id === job.id),
    ).toEqual(job);
    const observed = context.app.knowledge.reviewRecoveryStatus(job.id);
    expect(observed).toMatchObject({
      ownerState: "unknown",
      manualRecoveryAllowed: true,
    });
    expect(() =>
      context.app.knowledge.manualRecoverReview(job.id, {
        confirmStopped: false,
        updatedAt: observed.updatedAt,
      }),
    ).toThrow();
    expect(() =>
      context.app.knowledge.manualRecoverReview(job.id, {
        confirmStopped: true,
        updatedAt: "outdated-checkpoint",
      }),
    ).toThrow();
    const recovered = context.app.knowledge.manualRecoverReview(job.id, {
      confirmStopped: true,
      ownerToken: observed.ownerToken,
      updatedAt: observed.updatedAt,
    });
    expect(recovered).toMatchObject({
      id: job.id,
      status: "failed",
      stage: "interrupted",
    });
    expect(recovered.reviewOwner?.token).toBeTruthy();
    expect(context.app.knowledge.batches(job.id)).toEqual([]);
    expect(context.app.sceneScriptReview.list("story", {}).total).toBe(0);
    expect(
      context.app.knowledge.reviewRecoveryStatus(job.id).manualRecoveryAllowed,
    ).toBe(false);
  });

  it("automatically recovers a scene review only when its actual owner process has exited", async () => {
    const context = await fixture();
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import",
      pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      "--input-type=module",
      "--eval",
      `import {createReviewOwner} from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)};console.log(JSON.stringify(createReviewOwner()));`,
    ]);
    const owner = JSON.parse(stdout.trim()) as ReturnType<
      typeof createReviewOwner
    >;
    expect(() => process.kill(owner.pid, 0)).toThrowError(
      expect.objectContaining({ code: "ESRCH" }),
    );
    const job: Job = {
      id: "dead-scene-job",
      type: "scene-script-review",
      storyId: "story",
      beatId: "beat",
      scriptField: "narration",
      status: "running",
      reviewOwner: owner,
      updatedAt: "2026-10-16T00:00:00Z",
    };
    context.app.catalog.saveJob(job);
    await context.reopen();
    expect(
      context.app.catalog.listJobs().find((item) => item.id === job.id),
    ).toMatchObject({ id: job.id, status: "failed", stage: "interrupted" });
    expect(context.app.knowledge.batches(job.id)).toEqual([]);
    expect(context.app.sceneScriptReview.list("story", {}).total).toBe(0);
    expect(beat(context.app).script?.narration).toBe("We arrived at dawn.");
  });

  it("preserves a live running scene review when another application opens and closes the project", async () => {
    const { app } = await fixture();
    let release!: (value: string) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let prompt = "";
    register(app, (value) => {
      prompt = value;
      began();
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const work = app.runSceneScriptReview("story", {
      beatId: "beat",
      field: "narration",
      jobId: "live-scene-job",
    });
    await started;
    const running = app.catalog
      .listJobs()
      .find((job) => job.id === "live-scene-job")!;
    const other = await OpenFilmApplication.open(app.directory);
    try {
      expect(
        other.catalog.listJobs().find((job) => job.id === running.id),
      ).toEqual(running);
    } finally {
      other.close();
      release(output(prompt));
      await work;
    }
    expect(
      app.catalog.listJobs().find((job) => job.id === running.id)?.status,
    ).toBe("completed");
    expect(app.sceneScriptReview.list("story", {}).total).toBe(1);
  });

  it("binds conflict protection to the loaded project when disk changes before construction finishes", async () => {
    const context = await fixture();
    register(context.app);
    const suggestion = await review(context.app);
    const loaded = structuredClone(context.app.project);
    const directory = context.app.directory;
    context.close();
    const other = await OpenFilmApplication.open(directory);
    beat(other).script!.visualDirection =
      "Saved after the original project snapshot was loaded.";
    await other.save();
    const external = await readFile(join(directory, "project.json"), "utf8");
    other.catalog.close();
    // Supply the actual earlier snapshot at the constructor boundary to model
    // a concurrent save between open() reading the file and construction.
    const stale = Reflect.construct(OpenFilmApplication, [
      directory,
      loaded,
      { userDataDirectory: join(context.root, "user-data") },
    ]) as OpenFilmApplication;
    let closed = false;
    try {
      expect(() =>
        stale.sceneScriptReview.accept(suggestion.id, {
          baseRevision: suggestion.sourceRevisionId,
          requestId: "startup-snapshot-race",
        }),
      ).toThrow();
      await expect(stale.save()).rejects.toThrow();
      stale.close();
      closed = true;
      expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
        external,
      );
    } finally {
      if (!closed) stale.close();
    }
  });

  it("allows saving a local draft after review rejects its unsaved changes", async () => {
    const { app } = await fixture();
    register(app);
    beat(app).script!.narration = "A local draft awaiting its first save.";
    await expect(
      app.runSceneScriptReview("story", { beatId: "beat", field: "narration" }),
    ).rejects.toMatchObject({ code: "story.planConflict" });
    await app.save();
    const suggestion = await review(app);
    expect(suggestion.before).toBe("A local draft awaiting its first save.");
  });

  it("allows saving a migrated legacy project after listing script review evidence", async () => {
    const context = await fixture();
    const directory = context.app.directory;
    const expectedStory = structuredClone(story(context.app));
    context.close();
    const path = join(directory, "project.json");
    const stored = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    stored.schemaVersion = "0.1.0";
    delete stored.settings;
    await writeFile(path, JSON.stringify(stored), "utf8");
    const legacy = await OpenFilmApplication.open(directory, {
      userDataDirectory: join(context.root, "user-data"),
    });
    try {
      expect(legacy.project.schemaVersion).toBe("1.0.0");
      expect(
        legacy.sceneScriptReview.list("story", {
          beatId: "beat",
          field: "narration",
        }).total,
      ).toBe(0);
      await legacy.save();
      const saved = JSON.parse(await readFile(path, "utf8")) as {
        schemaVersion: string;
        settings: unknown;
        stories: unknown[];
      };
      expect(saved.schemaVersion).toBe("1.0.0");
      expect(saved.settings).toEqual(legacy.project.settings);
      expect(saved.stories[0]).toEqual(expectedStory);
    } finally {
      legacy.close();
    }
  });

  it.each(["malformed", "missing"] as const)(
    "preserves an externally %s project after acceptance cannot verify its saved state",
    async (replacement) => {
      const context = await fixture();
      const { app } = context;
      register(app);
      const suggestion = await review(app);
      const path = join(app.directory, "project.json");
      const external =
        '{"schemaVersion":"1.0.0","stories":[ external unfinished edit';
      if (replacement === "malformed") await writeFile(path, external, "utf8");
      else await rm(path);
      expect(() =>
        app.sceneScriptReview.accept(suggestion.id, {
          baseRevision: suggestion.sourceRevisionId,
          requestId: `unverified-${replacement}`,
        }),
      ).toThrow();
      await expect(app.save()).rejects.toMatchObject({
        code: "story.planConflict",
      });
      expect(
        app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id)?.status,
      ).toBe("pending");
      expect(beat(app).script?.narration).toBe(suggestion.before);
      context.close();
      if (replacement === "malformed")
        expect(await readFile(path, "utf8")).toBe(external);
      else
        await expect(readFile(path, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
    },
  );

  it.each(["accept\tcontrol", "accept\ncontrol", "accept\rcontrol"])(
    "rejects a control character in an acceptance request ID before publishing: %j",
    async (requestId) => {
      const { app } = await fixture();
      register(app);
      const suggestion = await review(app);
      const before = structuredClone(app.project);
      const disk = await readFile(join(app.directory, "project.json"), "utf8");
      expect(() =>
        app.sceneScriptReview.accept(suggestion.id, {
          baseRevision: suggestion.sourceRevisionId,
          requestId,
        }),
      ).toThrow();
      expect(app.project).toEqual(before);
      expect(await readFile(join(app.directory, "project.json"), "utf8")).toBe(
        disk,
      );
      expect(
        app.catalog.knowledge.getSceneScriptSuggestion(suggestion.id)?.status,
      ).toBe("pending");
      expect(app.project.sceneScriptReviewReceipts).toBeUndefined();
    },
  );

  it("lists an exact target with one bounded page and one scoped stale update amid unrelated evidence", async () => {
    const { app } = await fixture();
    story(app).beats.push(
      ...Array.from({ length: 250 }, (_, index) => ({
        id: `other-beat-${index}`,
        title: `Other beat ${index}`,
        script: {
          narration: `Other narration ${index}`,
          visualDirection: `Other direction ${index}`,
        },
      })),
    );
    await app.save();
    register(app);
    const suggestion = await review(app);
    for (const other of story(app).beats.slice(1)) {
      app.catalog.knowledge.saveSceneScriptSuggestion({
        ...suggestion,
        id: `other-suggestion-${other.id}`,
        target: { storyId: "story", beatId: other.id, field: "narration" },
        sourceRevisionId: app.sceneScriptReview.currentRevision(
          "story",
          other.id,
          "narration",
        ),
        before: other.script!.narration,
        after: `${other.script!.narration} Revised.`,
      });
    }
    const pageRead = vi.spyOn(
      app.catalog.knowledge,
      "sceneScriptSuggestionsList",
    );
    const staleUpdate = vi.spyOn(
      app.catalog.knowledge,
      "staleSceneScriptSuggestions",
    );
    const page = app.sceneScriptReview.list("story", {
      beatId: "beat",
      field: "narration",
      limit: 1,
    });
    expect(page.total).toBe(1);
    expect(page.suggestions[0]?.id).toBe(suggestion.id);
    expect(pageRead).toHaveBeenCalledTimes(1);
    expect(staleUpdate).toHaveBeenCalledOnce();
    expect(staleUpdate).toHaveBeenCalledWith(
      "story",
      "beat",
      "narration",
      suggestion.sourceRevisionId,
    );
  });
});
