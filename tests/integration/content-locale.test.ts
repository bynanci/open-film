import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PROJECT_CONTENT_LOCALES,
  type OpenFilmProject,
  type Story,
} from "@openfilm/core";
import {
  OpenFilmApplication,
  type TimelineEditorState,
} from "@openfilm/application";
import {
  getProposalContent,
  proposalTemplate,
} from "@openfilm/template-proposal";
import { genericBeatText } from "@openfilm/story";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { startServer } from "../../apps/server/src/server.js";

let root: string;
let media: string;
const cleanups: (() => Promise<unknown>)[] = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-content-"));
  media = join(root, "記憶 & Memories #1");
  await generateSampleMedia(media);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function server(project?: string) {
  const runtime = await startServer({ port: 0, project });
  cleanups.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}/api`;
  const send = (method: "POST" | "PATCH", path: string, data: unknown = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${base}${path}`);
    expect(response.ok).toBe(true);
    return response.json() as Promise<T>;
  };
  return { send, get };
}

describe("real content-language lifecycle", () => {
  it.each(PROJECT_CONTENT_LOCALES)(
    "persists %s film setup, authored text, editor history and a subsequent language change",
    async (locale) => {
      const { send, get } = await server();
      const directory = join(root, `${locale}.openfilm`);
      const filmSettings = {
        templateId: "proposal-film",
        targetDuration: 18,
        maxDuration: 30,
      };
      const created = await send("POST", "/project/create", {
        title: "兩人的故事 / 二人の物語 #1 & 2",
        path: directory,
        projectContentLocale: locale,
        filmSettings,
      });
      expect(created.status).toBe(200);
      const initial: OpenFilmProject = (await created.json()).project;
      expect(initial).toMatchObject({
        projectContentLocale: locale,
        filmSettings,
        stories: [],
        timelines: [],
      });
      const imported = await send("POST", "/import", { folder: media });
      expect(imported.status).toBe(202);
      const { jobId } = await imported.json();
      await expect
        .poll(
          async () => {
            const { jobs } = await get<{
              jobs: { id: string; status: string }[];
            }>("/jobs");
            return jobs.find((job) => job.id === jobId)?.status;
          },
          { timeout: 30_000 },
        )
        .toBe("completed");
      const generated = await send("POST", "/stories", {
        title: "An authored story / 自分の物語",
      });
      expect(generated.status).toBe(201);
      let story: Story = (await generated.json()).story;
      expect(story).toMatchObject({
        template: "proposal-film",
        targetDuration: 18,
        maxDuration: 30,
      });
      expect(story.beats[0]).toMatchObject({
        title: getProposalContent(locale).beats["proposal.coldOpen"].title,
        titleSource: "template",
        intentSource: "template",
      });

      const title = "Our first hello / 初次見面 / はじめまして";
      const intent = "Keep our words exactly: 台北 → 東京 #1 & 2";
      const beats = structuredClone(story.beats);
      beats[0]!.title = title;
      beats[1]!.intent = intent;
      beats[3]!.targetDuration = beats[3]!.targetDuration! + 0.25;
      const patched = await send("PATCH", `/stories/${story.id}`, { beats });
      expect(patched.status).toBe(200);
      story = (await patched.json()).story;
      expect(story.beats[0]).toMatchObject({
        titleSource: "user",
        intentSource: "template",
      });
      expect(story.beats[1]).toMatchObject({
        titleSource: "template",
        intentSource: "user",
      });
      expect(story.beats[3]).toMatchObject({
        titleSource: "template",
        intentSource: "template",
      });
      const composed = await send("POST", "/compose", { storyId: story.id });
      expect(composed.status).toBe(200);
      const { composition } = await composed.json();
      const editorPath = `/compositions/${composition.id}`;
      let editor = await get<TimelineEditorState>(`${editorPath}/editor`);
      const timelineTitle = "Our ending stays ours / 私たちの結び";
      const edited = await send("POST", `${editorPath}/edit`, {
        baseRevision: editor.revision,
        commands: [
          {
            type: "beat",
            beatId: story.beats[2]!.id,
            patch: { title: timelineTitle, intent: "" },
          },
        ],
      });
      expect(edited.status).toBe(200);
      editor = await edited.json();
      expect(editor.story.beats[2]).toMatchObject({
        titleSource: "user",
        intentSource: "user",
        title: timelineTitle,
      });
      expect(editor.story.beats[2]!.intent).toBeUndefined();
      const undone = await send("POST", `${editorPath}/undo`, {
        baseRevision: editor.revision,
      });
      expect(undone.status).toBe(200);
      editor = await undone.json();
      expect(editor.story.beats[2]).toEqual(story.beats[2]);
      const redone = await send("POST", `${editorPath}/redo`, {
        baseRevision: editor.revision,
      });
      expect(redone.status).toBe(200);
      editor = await redone.json();

      const nextLocale =
        PROJECT_CONTENT_LOCALES[
          (PROJECT_CONTENT_LOCALES.indexOf(locale) + 1) %
            PROJECT_CONTENT_LOCALES.length
        ]!;
      const changed = await send("PATCH", "/project", {
        projectContentLocale: nextLocale,
      });
      expect(changed.status).toBe(200);
      const updated: OpenFilmProject = (await changed.json()).project;
      expect(updated.projectContentLocale).toBe(nextLocale);
      expect(updated.filmSettings).toEqual(filmSettings);
      expect(updated.title).toBe(initial.title);
      expect(updated.stories[0]!.title).toBe(story.title);
      expect(updated.stories[0]!.beats[0]!.title).toBe(title);
      expect(updated.stories[0]!.beats[1]!.intent).toBe(intent);
      expect(updated.stories[0]!.beats[2]).toMatchObject({
        title: timelineTitle,
        intentSource: "user",
      });
      expect(updated.stories[0]!.beats[2]!.intent).toBeUndefined();
      expect(updated.stories[0]!.beats[3]!.title).toBe(
        getProposalContent(nextLocale).beats["proposal.adventures"].title,
      );
      expect(updated.timelines).toEqual([editor.composition]);
      const stale = await send("POST", `${editorPath}/edit`, {
        baseRevision: editor.revision,
        commands: [
          {
            type: "beat",
            beatId: story.beats[0]!.id,
            patch: { title: "Stale write" },
          },
        ],
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ code: "timeline.conflict" });

      const manifest = JSON.parse(
        await readFile(join(directory, "project.json"), "utf8"),
      );
      expect(manifest).toMatchObject({
        projectContentLocale: nextLocale,
        filmSettings,
        stories: updated.stories,
        timelines: updated.timelines,
      });
      expect((await send("POST", "/project/close")).status).toBe(200);
      const reopened = await send("POST", "/project/open", { path: directory });
      expect(reopened.status).toBe(200);
      expect((await reopened.json()).project).toMatchObject({
        projectContentLocale: nextLocale,
        filmSettings,
        stories: updated.stories,
        timelines: updated.timelines,
      });

      const beforeRejected = await readFile(
        join(directory, "project.json"),
        "utf8",
      );
      const invalidLocale = await send("PATCH", "/project", {
        projectContentLocale: "en-XA",
      });
      expect(invalidLocale.status).toBe(400);
      expect(await invalidLocale.json()).toMatchObject({
        code: "request.invalid",
      });
      const invalidSettings = await send("PATCH", "/project", {
        filmSettings: { ...filmSettings, targetDuration: 31 },
      });
      expect(invalidSettings.status).toBe(400);
      expect(await invalidSettings.json()).toMatchObject({
        code: "story.invalid",
      });
      expect(await readFile(join(directory, "project.json"), "utf8")).toBe(
        beforeRejected,
      );
      const overridden = await send("POST", "/stories", {
        title: "A separate story",
        template: "blank",
        targetDuration: 12,
        maxDuration: 15,
      });
      expect(overridden.status).toBe(201);
      const another: Story = (await overridden.json()).story;
      expect(another.beats[0]!.title).toBe(
        genericBeatText("story.opening", nextLocale)!.title,
      );
      expect(another).toMatchObject({ targetDuration: 12, maxDuration: 15 });
      expect(
        (await get<{ project: OpenFilmProject }>("/project")).project
          .filmSettings,
      ).toEqual(filmSettings);
    },
  );

  it("opens a legacy proposal without attributing any existing text to its template", async () => {
    const directory = join(root, "legacy.openfilm");
    const app = await OpenFilmApplication.create(
      directory,
      "Legacy user title",
    );
    const story = proposalTemplate.create({ title: "Our Story" });
    for (const beat of story.beats) {
      delete beat.templateBeatKey;
      delete beat.titleSource;
      delete beat.intentSource;
    }
    app.project.stories.push(story);
    app.close();
    const { send, get } = await server(directory);
    const before = (await get<{ project: OpenFilmProject }>("/project"))
      .project;
    expect(before.projectContentLocale).toBeUndefined();
    expect(before.filmSettings).toBeUndefined();
    expect(
      (await send("PATCH", "/project", { projectContentLocale: "ja-JP" }))
        .status,
    ).toBe(200);
    expect(
      (await get<{ project: OpenFilmProject }>("/project")).project.stories,
    ).toEqual([story]);
    expect((await send("POST", "/project/close")).status).toBe(200);
    const reopened = await send("POST", "/project/open", { path: directory });
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).project.stories).toEqual([story]);
  });
});
