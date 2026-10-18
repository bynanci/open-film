import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@openfilm/core";
import {
  OpenFilmApplication,
  TimelineEditor,
  type DirectionReviewPlan,
} from "../src/index.js";

const applications = new Set<OpenFilmApplication>();
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of applications) app.close();
  applications.clear();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-direction-"));
  directories.push(directory);
  const app = await OpenFilmApplication.create(
    join(directory, "film.openfilm"),
    "Direction review",
  );
  applications.add(app);
  for (const id of ["photo", "second", "outside"]) {
    const asset: MediaAsset = {
      id,
      uri: `file:///originals/${id}.jpg`,
      mediaType: "image",
      name: id,
      dimensions: { width: 1920, height: 1080 },
      tags: [],
      state: {},
      metadata: {},
    };
    app.catalog.upsertAsset(asset);
  }
  app.project.stories.push({
    id: "story",
    title: "Story",
    maxDuration: 12,
    beats: [
      {
        id: "beat",
        title: "Opening",
        candidateAssetIds: ["photo", "second"],
        script: {
          narration: "Keep narration",
          visualDirection: "contain; slow push-in",
        },
      },
      { id: "other-beat", title: "Elsewhere", candidateAssetIds: ["outside"] },
    ],
  });
  app.project.timelines.push({
    id: "timeline",
    storyId: "story",
    duration: 12,
    tracks: [
      {
        id: "pictures",
        type: "video",
        clips: ["photo", "second", "outside"].map((assetId, index) => ({
          id: `${assetId}-clip`,
          assetId,
          beatId: index === 2 ? "other-beat" : "beat",
          timelineStart: index * 4,
          timelineDuration: 4,
          sourceIn: 0,
          sourceOut: 4,
          title: "Preserved title",
        })),
      },
    ],
  });
  await app.save();
  const editor = new TimelineEditor(app);
  return { app, editor, path: join(app.directory, "project.json") };
}

const options = { beatId: "beat", clipIds: ["photo-clip", "second-clip"] };

function acceptance(plan: DirectionReviewPlan, requestId = "accept-direction") {
  return {
    planId: plan.id,
    baseRevision: plan.baseRevision,
    contextSignature: plan.contextSignature,
    options: plan.options,
    actionIds: plan.actions.map((action) => action.id),
    requestId,
  };
}

describe("reviewed scene direction adoption", () => {
  it("previews deterministic bound evidence without changing the project or saving", async () => {
    const { app, editor, path } = await fixture();
    const initial = structuredClone(app.project);
    const bytes = await readFile(path, "utf8");
    const save = vi.spyOn(app, "save");
    const plan = editor.previewDirection("timeline", options);
    expect(plan).toEqual(editor.previewDirection("timeline", options));
    expect(plan).toMatchObject({
      version: 1,
      compositionId: "timeline",
      storyId: "story",
      beatId: "beat",
      sourceText: "contain; slow push-in",
      beforeDuration: 12,
      afterDuration: 12,
      baseRevision: editor.get("timeline").revision,
    });
    expect(plan.actions).toHaveLength(4);
    expect(plan.preview.composition.tracks[0]?.clips[0]).toMatchObject({
      layout: { version: 1, preset: "contain" },
      motion: { version: 1, preset: "push-in" },
      title: "Preserved title",
    });
    expect(app.project).toEqual(initial);
    expect(await readFile(path, "utf8")).toBe(bytes);
    expect(save).not.toHaveBeenCalled();
  });

  it("accepts a selected subset with one save, one Undo unit, and durable exact audit evidence", async () => {
    const { app, editor } = await fixture();
    const before = editor.get("timeline");
    const plan = editor.previewDirection("timeline", options);
    const input = { ...acceptance(plan), actionIds: [plan.actions[0]!.id] };
    const save = vi.spyOn(app, "save");
    const saved = await editor.acceptDirection("timeline", input);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.canUndo).toBe(true);
    expect(saved.composition.duration).toBe(before.composition.duration);
    expect(saved.story).toEqual(before.story);
    expect(saved.composition.tracks[0]?.clips.slice(1)).toEqual(
      before.composition.tracks[0]?.clips.slice(1),
    );
    expect(app.project.sceneDirectionReceipts).toEqual([
      expect.objectContaining({
        version: 1,
        planId: plan.id,
        requestId: input.requestId,
        acceptedRevision: saved.revision,
        sourceText: plan.sourceText,
        actions: [plan.actions[0]],
      }),
    ]);
    const receipt = structuredClone(app.project.sceneDirectionReceipts);
    const undone = await editor.undo("timeline", saved.revision);
    expect(undone.composition).toEqual(before.composition);
    expect(undone.canUndo).toBe(false);
    expect(app.project.sceneDirectionReceipts).toEqual(receipt);
    const retry = await editor.acceptDirection("timeline", input);
    expect(retry.composition).toEqual(before.composition);
    expect(retry.acknowledgedRevision).toBe(saved.revision);
    const redone = await editor.redo("timeline", undone.revision);
    expect(redone.composition).toEqual(saved.composition);
    expect(app.project.sceneDirectionReceipts).toEqual(receipt);
  });

  it("reconciles a lost response after reopen and later edits without reapplying", async () => {
    const { app, editor } = await fixture();
    const input = acceptance(editor.previewDirection("timeline", options));
    const accepted = await editor.acceptDirection("timeline", input);
    const edited = await editor.edit("timeline", {
      baseRevision: accepted.revision,
      commands: [{ type: "presentation", clipId: "photo-clip", motion: null }],
    });
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    const newEditor = new TimelineEditor(reopened);
    const save = vi.spyOn(reopened, "save");
    const replay = await newEditor.acceptDirection("timeline", input);
    expect(replay.revision).toBe(edited.revision);
    expect(replay.acknowledgedRevision).toBe(accepted.revision);
    expect(replay.composition.tracks[0]?.clips[0]?.motion).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    await expect(
      newEditor.acceptDirection("timeline", {
        ...input,
        actionIds: input.actionIds.slice(1),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      newEditor.acceptDirection("timeline", {
        ...input,
        requestId: "new-request",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      newEditor.acceptDirection("timeline", {
        ...input,
        planId: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("accepts a fresh request for an identical plan after Undo and reopen while preserving both retry receipts", async () => {
    const { app, editor, path } = await fixture();
    const originalPlan = editor.previewDirection("timeline", options);
    const originalInput = acceptance(
      originalPlan,
      "original-direction-request",
    );
    const accepted = await editor.acceptDirection("timeline", originalInput);
    const undone = await editor.undo("timeline", accepted.revision);
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    const newEditor = new TimelineEditor(reopened);
    const freshPlan = newEditor.previewDirection("timeline", options);
    expect(freshPlan.id).toBe(originalPlan.id);
    expect(freshPlan.baseRevision).toBe(undone.revision);
    expect(newEditor.get("timeline").canRedo).toBe(false);
    const oldRetry = await newEditor.acceptDirection("timeline", originalInput);
    expect(oldRetry.composition).toEqual(undone.composition);
    expect(oldRetry.acknowledgedRevision).toBe(accepted.revision);
    const freshInput = acceptance(freshPlan, "fresh-direction-request");
    const save = vi.spyOn(reopened, "save");
    const reapplied = await newEditor.acceptDirection("timeline", freshInput);
    expect(reapplied.composition).toEqual(accepted.composition);
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      reopened.project.sceneDirectionReceipts?.map((receipt) => ({
        planId: receipt.planId,
        requestId: receipt.requestId,
      })),
    ).toEqual([
      { planId: originalPlan.id, requestId: originalInput.requestId },
      { planId: originalPlan.id, requestId: freshInput.requestId },
    ]);
    expect(
      JSON.parse(await readFile(path, "utf8")).sceneDirectionReceipts,
    ).toHaveLength(2);
    const later = await newEditor.edit("timeline", {
      baseRevision: reapplied.revision,
      commands: [{ type: "presentation", clipId: "photo-clip", motion: null }],
    });
    save.mockClear();
    for (const input of [originalInput, freshInput]) {
      const retry = await newEditor.acceptDirection("timeline", input);
      expect(retry.composition).toEqual(later.composition);
      expect(retry.revision).toBe(later.revision);
      expect(retry.acknowledgedRevision).toBe(accepted.revision);
    }
    expect(save).not.toHaveBeenCalled();
    expect(reopened.project.sceneDirectionReceipts).toHaveLength(2);
  });

  it("requires reopen before acknowledging a receipt after another writer changes the saved project", async () => {
    const { app, editor, path } = await fixture();
    const input = acceptance(editor.previewDirection("timeline", options));
    const accepted = await editor.acceptDirection("timeline", input);
    const writer = await OpenFilmApplication.open(app.directory);
    applications.add(writer);
    writer.project.stories[0]!.title = "Another writer's saved story";
    await writer.save();
    const bytes = await readFile(path, "utf8");
    await expect(
      editor.acceptDirection("timeline", input),
    ).rejects.toMatchObject({ code: "story.planConflict", status: 409 });
    expect(await readFile(path, "utf8")).toBe(bytes);
    expect(app.project.stories[0]!.title).toBe("Story");
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    const recovered = new TimelineEditor(reopened);
    const save = vi.spyOn(reopened, "save");
    const retry = await recovered.acceptDirection("timeline", input);
    expect(retry.story.title).toBe("Another writer's saved story");
    expect(retry.acknowledgedRevision).toBe(accepted.revision);
    expect(reopened.project.sceneDirectionReceipts).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "binds a passive moved managed-media preview to its repaired source identity (content changed: %s)",
    async (changed) => {
      const { app } = await fixture();
      const original = app.directory;
      const relativePath = "sources/upload/回憶 frame.png";
      const sourcePath = join(original, relativePath);
      const sourceBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
        "base64",
      );
      const uri = pathToFileURL(sourcePath).href;
      await mkdir(join(original, "sources/upload"), { recursive: true });
      await writeFile(sourcePath, sourceBytes);
      app.catalog.upsertAsset({
        ...app.catalog.getAsset("photo")!,
        uri,
        contentHash: createHash("sha256").update(sourceBytes).digest("hex"),
        metadata: {
          "openfilm.managedSource": { relativePath, uri },
          "openfilm.reference": {
            mediaLibraryId: "managed-library",
            rootUri: pathToFileURL(join(original, "sources")).href,
            relativePath: "upload/回憶 frame.png",
            originalUri: uri,
          },
        },
      });
      app.project.mediaLibraries.push({
        id: "managed-library",
        name: "Managed sources",
        uri: pathToFileURL(join(original, "sources")).href,
      });
      await app.save();
      app.close();
      applications.delete(app);
      const moved = join(original, "..", "moved.openfilm");
      await rename(original, moved);
      const passive = await OpenFilmApplication.openForExport(moved);
      applications.add(passive);
      const passiveEditor = new TimelineEditor(passive);
      const raw = passiveEditor.get("timeline");
      const bytes = await readFile(join(moved, "project.json"), "utf8");
      const originalAsset = passive.catalog.getAsset("photo");
      const plan = passiveEditor.previewDirection("timeline", {
        beatId: "beat",
        clipIds: ["photo-clip"],
      });
      expect(plan.baseRevision).not.toBe(raw.revision);
      expect(passiveEditor.get("timeline").revision).toBe(raw.revision);
      expect(passive.catalog.getAsset("photo")).toEqual(originalAsset);
      expect(await readFile(join(moved, "project.json"), "utf8")).toBe(bytes);
      passive.close();
      applications.delete(passive);
      const workspace = await OpenFilmApplication.open(moved);
      applications.add(workspace);
      const editor = new TimelineEditor(workspace);
      expect(editor.get("timeline").revision).toBe(plan.baseRevision);
      if (changed) {
        const changedBytes = Buffer.concat([
          sourceBytes,
          Buffer.from("changed source content"),
        ]);
        await writeFile(join(moved, relativePath), changedBytes);
        workspace.catalog.upsertAsset({
          ...workspace.catalog.getAsset("photo")!,
          contentHash: createHash("sha256").update(changedBytes).digest("hex"),
        });
        expect(editor.get("timeline").revision).not.toBe(plan.baseRevision);
        const bytesBefore = await readFile(join(moved, "project.json"), "utf8");
        await expect(
          editor.acceptDirection("timeline", acceptance(plan)),
        ).rejects.toMatchObject({ status: 409 });
        expect(workspace.project.sceneDirectionReceipts).toBeUndefined();
        expect(await readFile(join(moved, "project.json"), "utf8")).toBe(
          bytesBefore,
        );
      } else {
        const saved = await editor.acceptDirection(
          "timeline",
          acceptance(plan),
        );
        expect(saved.composition.tracks[0]?.clips[0]?.motion?.preset).toBe(
          "push-in",
        );
        expect(workspace.project.sceneDirectionReceipts).toHaveLength(1);
      }
    },
  );

  it("rolls back both the document and receipt after a failed publication and allows exact retry", async () => {
    const { app, editor, path } = await fixture();
    const before = structuredClone(app.project);
    const bytes = await readFile(path, "utf8");
    const input = acceptance(editor.previewDirection("timeline", options));
    const save = vi
      .spyOn(app, "save")
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(editor.acceptDirection("timeline", input)).rejects.toThrow(
      "disk full",
    );
    expect(app.project).toEqual(before);
    expect(await readFile(path, "utf8")).toBe(bytes);
    expect(editor.get("timeline").canUndo).toBe(false);
    save.mockRestore();
    await editor.acceptDirection("timeline", input);
    expect(app.project.sceneDirectionReceipts).toHaveLength(1);
  });

  it("rejects a preview from a cloned project identity in another directory", async () => {
    const first = await fixture();
    const second = await fixture();
    const plan = first.editor.previewDirection("timeline", options);
    second.app.project = structuredClone(first.app.project);
    expect(second.editor.get("timeline").revision).toBe(plan.baseRevision);
    expect(
      second.editor.previewDirection("timeline", options).contextSignature,
    ).not.toBe(plan.contextSignature);
    await expect(
      second.editor.acceptDirection("timeline", acceptance(plan)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("requires reopen after publication succeeds but its catalog completion fails", async () => {
    const { app, editor, path } = await fixture();
    const before = structuredClone(app.project);
    const input = acceptance(editor.previewDirection("timeline", options));
    const publish = app.catalog.withProjectWrite.bind(app.catalog);
    vi.spyOn(app.catalog, "withProjectWrite").mockImplementationOnce(
      (operation) => {
        // Exercise the real manifest publication, then fail before saveSync can
        // acknowledge its baseline, as a catalog COMMIT failure would do.
        publish(operation);
        throw new Error("catalog completion failed after publication");
      },
    );
    await expect(editor.acceptDirection("timeline", input)).rejects.toThrow(
      "catalog completion failed",
    );
    expect(app.project).toEqual(before);
    expect(editor.get("timeline").canUndo).toBe(false);
    const publishedBytes = await readFile(path, "utf8");
    const published = JSON.parse(publishedBytes) as typeof app.project;
    expect(published.sceneDirectionReceipts).toHaveLength(1);
    expect(published.timelines[0]?.tracks[0]?.clips[0]?.motion?.preset).toBe(
      "push-in",
    );
    await expect(
      editor.acceptDirection("timeline", input),
    ).rejects.toMatchObject({ status: 409 });
    expect(await readFile(path, "utf8")).toBe(publishedBytes);
    const directory = app.directory;
    app.close();
    applications.delete(app);
    const reopened = await OpenFilmApplication.open(directory);
    applications.add(reopened);
    const recovered = new TimelineEditor(reopened);
    const save = vi.spyOn(reopened, "save");
    const replay = await recovered.acceptDirection("timeline", input);
    expect(replay.acknowledgedRevision).toBe(
      published.sceneDirectionReceipts![0]!.acceptedRevision,
    );
    expect(replay.composition).toEqual(published.timelines[0]);
    expect(reopened.project.sceneDirectionReceipts).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("fails closed at receipt capacity while allowing an existing exact retry", async () => {
    const { app, editor } = await fixture();
    const original = acceptance(editor.previewDirection("timeline", options));
    const accepted = await editor.acceptDirection("timeline", original);
    const receipt = app.project.sceneDirectionReceipts![0]!;
    app.project.sceneDirectionReceipts = [
      receipt,
      ...Array.from({ length: 99 }, (_, index) => ({
        ...structuredClone(receipt),
        planId: (index + 1).toString(16).padStart(64, "0"),
        requestId: `historic-request-${index}`,
      })),
    ];
    app.project.stories[0]!.beats[0]!.script!.visualDirection = "hero";
    await app.save();
    const next = editor.previewDirection("timeline", {
      ...options,
      replaceExisting: true,
    });
    const before = structuredClone(app.project);
    const save = vi.spyOn(app, "save");
    await expect(
      editor.acceptDirection("timeline", acceptance(next, "capacity-request")),
    ).rejects.toMatchObject({ status: 409 });
    expect(app.project).toEqual(before);
    const replay = await editor.acceptDirection("timeline", original);
    expect(replay.acknowledgedRevision).toBe(accepted.revision);
    expect(app.project.sceneDirectionReceipts).toHaveLength(100);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a selected motion whose safety depends on an omitted layout action", async () => {
    const { app, editor } = await fixture();
    const asset = app.catalog.getAsset("photo")!;
    app.catalog.upsertAsset({
      ...asset,
      dimensions: { width: 1000, height: 2000 },
    });
    app.project.timelines[0]!.tracks[0]!.clips[0]!.layout = {
      version: 1,
      preset: "hero",
      focalPoint: { x: 0.5, y: 1 },
      protectedRegion: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
    };
    const plan = editor.previewDirection("timeline", {
      beatId: "beat",
      clipIds: ["photo-clip"],
      replaceExisting: true,
    });
    expect(plan.actions.map((action) => action.kind)).toEqual([
      "layout",
      "motion",
    ]);
    const before = structuredClone(app.project);
    const save = vi.spyOn(app, "save");
    await expect(
      editor.acceptDirection("timeline", {
        ...acceptance(plan),
        actionIds: [plan.actions[1]!.id],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(app.project).toEqual(before);
    expect(save).not.toHaveBeenCalled();
    const accepted = await editor.acceptDirection("timeline", acceptance(plan));
    expect(accepted.composition.tracks[0]?.clips[0]).toMatchObject({
      layout: { preset: "contain" },
      motion: { preset: "push-in" },
    });
  });

  it("preserves existing opaque clip identities in generated presentation commands", async () => {
    const { app, editor } = await fixture();
    const clipId = "photo-\u0000" + "x".repeat(300);
    app.project.timelines[0]!.tracks[0]!.clips[0]!.id = clipId;
    const plan = editor.previewDirection("timeline", {
      beatId: "beat",
      clipIds: [clipId],
    });
    const accepted = await editor.acceptDirection("timeline", acceptance(plan));
    expect(accepted.composition.tracks[0]?.clips[0]?.id).toBe(clipId);
    expect(app.project.sceneDirectionReceipts?.[0]?.actions[0]?.clipId).toBe(
      clipId,
    );
  });

  it.each(["settings", "locale", "filmMaximum", "source", "story"])(
    "rejects a stale %s binding",
    async (change) => {
      const { app, editor } = await fixture();
      const input = acceptance(editor.previewDirection("timeline", options));
      if (change === "settings") app.project.settings.width += 2;
      if (change === "locale") app.project.projectContentLocale = "ja-JP";
      if (change === "filmMaximum")
        app.project.filmSettings = {
          templateId: "proposal",
          targetDuration: 10,
          maxDuration: 11,
        };
      if (change === "source")
        app.project.stories[0]!.beats[0]!.script!.visualDirection += " ";
      if (change === "story")
        app.project.stories[0]!.beats[1]!.title = "Changed scene";
      const before = structuredClone(app.project);
      const save = vi.spyOn(app, "save");
      await expect(
        editor.acceptDirection("timeline", input),
      ).rejects.toMatchObject({ status: 409 });
      expect(app.project).toEqual(before);
      expect(save).not.toHaveBeenCalled();
    },
  );

  it("uses the stricter film and story maximum and fails closed when already over it", async () => {
    const { app, editor } = await fixture();
    app.project.filmSettings = {
      templateId: "proposal",
      targetDuration: 8,
      maxDuration: 10,
    };
    expect(() => editor.previewDirection("timeline", options)).toThrow(
      /maximum duration/,
    );
    expect(app.project.sceneDirectionReceipts).toBeUndefined();
  });

  it.each([
    { actionIds: [] },
    { actionIds: ["unknown-action"] },
    { requestId: "" },
    { requestId: "bad\u0000request" },
    { requestId: "bad\u0080request" },
    { commands: [{ type: "delete", clipId: "outside-clip" }] },
    { preview: {} },
  ])("rejects malformed or injected acceptance fields %j", async (patch) => {
    const { app, editor } = await fixture();
    const input = acceptance(editor.previewDirection("timeline", options));
    const save = vi.spyOn(app, "save");
    await expect(
      editor.acceptDirection("timeline", {
        ...input,
        ...patch,
      } as typeof input),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    expect(save).not.toHaveBeenCalled();
    expect(app.project.sceneDirectionReceipts).toBeUndefined();
  });

  it("rejects duplicate action selection and ignores mutated client preview commands", async () => {
    const { app, editor } = await fixture();
    const plan = editor.previewDirection("timeline", options);
    const input = acceptance(plan);
    await expect(
      editor.acceptDirection("timeline", {
        ...input,
        actionIds: [input.actionIds[0]!, input.actionIds[0]!],
      }),
    ).rejects.toThrow();
    plan.actions[0]!.command = { type: "delete", clipId: "outside-clip" };
    plan.preview.composition.tracks[0]!.clips = [];
    const saved = await editor.acceptDirection("timeline", input);
    expect(saved.composition.tracks[0]?.clips).toHaveLength(3);
    expect(
      app.project.sceneDirectionReceipts?.[0]?.actions[0]?.command.type,
    ).toBe("presentation");
  });

  it.each([
    { beatId: "missing", clipIds: ["photo-clip"] },
    { beatId: "beat", clipIds: ["outside-clip"] },
    { beatId: "beat", clipIds: [] },
    { beatId: "beat", clipIds: ["photo-clip", "photo-clip"] },
    {
      beatId: "beat",
      clipIds: Array.from({ length: 51 }, (_, i) => String(i)),
    },
    { beatId: "beat", clipIds: ["photo-clip"], commands: [] },
  ])("rejects unsupported preview options %j", async (input) => {
    const { editor } = await fixture();
    expect(() => editor.previewDirection("timeline", input)).toThrow();
  });
});
