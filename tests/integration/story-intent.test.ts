import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import type { Story } from "@openfilm/core";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import { startServer } from "../../apps/server/src/server.js";

it("saves blank story intents and preserves explicit clearing through language changes and reopening", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-story-intent-"));
  const project = join(root, "film.openfilm");
  let closeServer: (() => Promise<void>) | undefined;
  try {
    const sources = join(root, "media");
    await generateSampleMedia(sources);
    const app = await OpenFilmApplication.create(project, "Optional intent", {
      projectContentLocale: "en-US",
    });
    let blank: Story;
    let proposal: Story;
    try {
      await app.importFiles([join(sources, "01-photo.png")]);
      blank = app.generateStory({
        template: "blank",
        targetDuration: 4,
        maxDuration: 8,
      });
      proposal = app.generateStory({
        template: "proposal-film",
        targetDuration: 18,
        maxDuration: 30,
      });
    } finally {
      app.close();
    }
    const server = await startServer({ port: 0, project });
    closeServer = server.close;
    const base = `http://127.0.0.1:${server.port}/api`;
    const send = (path: string, data: unknown, method = "POST") =>
      fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    expect(blank.beats[0]!.intent).toBeUndefined();
    const renamed = await send(
      `/stories/${blank.id}`,
      {
        beats: blank.beats.map((beat, index) =>
          index ? beat : { ...beat, title: "自分で書いた題名", intent: "" },
        ),
      },
      "PATCH",
    );
    expect(renamed.status).toBe(200);
    const savedBlank = (await renamed.json()).story as Story;
    expect(savedBlank.beats[0]).toMatchObject({
      title: "自分で書いた題名",
      titleSource: "user",
    });
    expect(savedBlank.beats[0]!.intent).toBeUndefined();

    expect(proposal.beats[0]!.intent).toBeTruthy();
    const cleared = await send(
      `/stories/${proposal.id}`,
      {
        beats: proposal.beats.map((beat, index) =>
          index ? beat : { ...beat, intent: " \t\n " },
        ),
      },
      "PATCH",
    );
    expect(cleared.status).toBe(200);
    const savedProposal = (await cleared.json()).story as Story;
    expect(savedProposal.beats[0]!.intent).toBeUndefined();
    expect(savedProposal.beats[0]!.intentSource).toBe("user");

    const beforeInvalid = await readFile(join(project, "project.json"));
    const invalid = await send(
      `/stories/${blank.id}`,
      { beats: savedBlank.beats.map((beat) => ({ ...beat, intent: 42 })) },
      "PATCH",
    );
    expect(invalid.status).toBe(400);
    expect(await readFile(join(project, "project.json"))).toEqual(
      beforeInvalid,
    );
    expect(
      (await send("/project", { projectContentLocale: "ja-JP" }, "PATCH"))
        .status,
    ).toBe(200);
    expect((await send("/project/close", {})).status).toBe(200);
    const reopened = await send("/project/open", { path: project });
    expect(reopened.status).toBe(200);
    const stories = (await reopened.json()).project.stories as Story[];
    expect(
      stories.find((story) => story.id === blank.id)!.beats[0],
    ).toMatchObject({ title: "自分で書いた題名", titleSource: "user" });
    expect(
      stories.find((story) => story.id === blank.id)!.beats[0]!.intent,
    ).toBeUndefined();
    const clearedBeat = stories.find((story) => story.id === proposal.id)!
      .beats[0]!;
    expect(clearedBeat.intent).toBeUndefined();
    expect(clearedBeat.intentSource).toBe("user");
    expect(clearedBeat.title).not.toBe(proposal.beats[0]!.title);
  } finally {
    await closeServer?.();
    await rm(root, { recursive: true, force: true });
  }
});
