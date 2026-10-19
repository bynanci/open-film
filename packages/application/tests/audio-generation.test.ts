import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { TimelineEditor, OpenFilmApplication } from "../src/index.js";
import { createAudioQualityFixture } from "../../../tests/fixtures/audio-quality.js";
import { hashFile, localPath } from "@openfilm/media";
import { measureAudioOutput } from "@openfilm/render";
it("previews explicit mock, accepts/imports by saved revision, renders MP4 and preserves history/reopen provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-generation-"));
  const { app } = await createAudioQualityFixture(root);
  let closed = false;
  try {
    const editor = new TimelineEditor(app);
    await editor.edit("film", {
      baseRevision: editor.get("film").revision,
      commands: [{ type: "volume", clipId: "sound", volume: 0 }],
    });
    const before = editor.get("film");
    const input = {
      compositionId: "film",
      baseRevision: before.revision,
      providerId: "local-audio-mock",
      text: "這是虛構的旁白測試。",
      consent: true,
      acknowledgeUnknownCost: false,
    };
    await expect(
      app.audioGeneration.preview({ ...input, consent: false }),
    ).rejects.toMatchObject({ status: 400 });
    const receipt = await app.audioGeneration.preview(input);
    expect(receipt.mock).toBe(true);
    expect(receipt.estimatedCostUsd).toBe(0);
    expect(JSON.stringify(receipt)).not.toContain(input.text);
    expect(app.catalog.countAssets()).toBe(2);
    await expect(
      app.audioGeneration.importTimeline(receipt.id, 0, editor),
    ).rejects.toMatchObject({ status: 409 });
    await app.audioGeneration.accept(receipt.id);
    const imported = await app.audioGeneration.importTimeline(
      receipt.id,
      0,
      editor,
    );
    expect(imported.command.type).toBe("audio.add");
    expect(editor.get("film").canUndo).toBe(true);
    expect(
      imported.assets[0]!.metadata["openfilm.audioGeneration"],
    ).toBeDefined();
    expect(await hashFile(localPath(imported.assets[0]!.uri))).toBe(
      receipt.outputSha256,
    );
    const repeated = await app.audioGeneration.importTimeline(
      receipt.id,
      0,
      editor,
    );
    expect(repeated).toEqual(imported);
    expect(app.catalog.countAssets()).toBe(3);
    expect(
      app.catalog.getAsset(imported.assets[0]!.id)!.metadata[
        "openfilm.audioGeneration"
      ],
    ).toHaveLength(1);
    const assetId = imported.assets[0]!.id;
    const original = await readFile(localPath(imported.assets[0]!.uri));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      localPath(imported.assets[0]!.uri),
      Buffer.concat([original, Buffer.from("tamper")]),
    );
    await expect(
      editor.edit("film", {
        baseRevision: imported.baseRevision,
        commands: [imported.command],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await writeFile(localPath(imported.assets[0]!.uri), original);
    const state = await editor.edit("film", {
      baseRevision: imported.baseRevision,
      requestId: "generated-audio",
      commands: [imported.command],
    });
    expect(
      state.composition.tracks
        .flatMap((t) => t.clips)
        .some((c) => c.id === `generated-${receipt.id}`),
    ).toBe(true);
    await expect(app.audioGeneration.media(receipt.id)).rejects.toMatchObject({
      status: 409,
    });
    const out = await app.render("film");
    const measured = await measureAudioOutput(out);
    expect(measured.duration).toBeCloseTo(4, 1);
    expect(measured.samplePeakDbfs!).toBeGreaterThan(-40);
    expect(
      measured.meterBins.some(
        (b) => b.at < 1.5 && (b.rmsDbfs ?? -Infinity) > -40,
      ),
    ).toBe(true);
    expect(
      measured.meterBins
        .filter((b) => b.at > 2.5)
        .every((b) => (b.rmsDbfs ?? -Infinity) < -80),
    ).toBe(true);
    const manifest = JSON.parse(await readFile(`${out}.manifest.json`, "utf8"));
    expect(
      manifest.sources.some(
        (s: { sha256: string }) => s.sha256 === receipt.outputSha256,
      ),
    ).toBe(true);
    const undone = await editor.undo("film", state.revision);
    expect(undone.composition.tracks).toHaveLength(2);
    expect(undone.canUndo).toBe(true);
    const previousEdit = await editor.undo("film", undone.revision);
    expect(
      previousEdit.composition.tracks[1]!.clips[0]!.transform!.volume,
    ).toBe(0.8);
    const prepared = await editor.redo("film", previousEdit.revision);
    const redone = await editor.redo("film", prepared.revision);
    const previousAsset = app.catalog.getAsset(assetId)!;
    previousAsset.state.locked = true;
    app.catalog.upsertAsset(previousAsset);
    const lockedSnapshot = structuredClone(app.catalog.getAsset(assetId)!);
    const second = await app.audioGeneration.preview({
      ...input,
      baseRevision: editor.get("film").revision,
    });
    await app.audioGeneration.accept(second.id);
    const again = await app.audioGeneration.importTimeline(
      second.id,
      2,
      editor,
    );
    expect(again.assets[0]!.id).not.toBe(assetId);
    expect(app.catalog.getAsset(assetId)).toEqual(lockedSnapshot);
    expect(again.assets[0]!.contentHash).toBe(imported.assets[0]!.contentHash);
    expect(editor.get("film").canUndo).toBe(false); // External source lock changed the context deliberately.
    void redone;

    app.close();
    closed = true;
    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    try {
      expect(reopened.project.timelines[0]!.tracks).toHaveLength(3);
      expect(
        reopened.catalog.getAsset(imported.assets[0]!.id)!.metadata[
          "openfilm.audioGeneration"
        ],
      ).toBeDefined();
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("recovers an accepted imported audio draft after server/project restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-generation-restart-"));
  const { app } = await createAudioQualityFixture(root);
  let closed = false;
  try {
    const editor = new TimelineEditor(app);
    const receipt = await app.audioGeneration.preview({
      compositionId: "film",
      baseRevision: editor.get("film").revision,
      providerId: "local-audio-mock",
      text: "重開後恢復的合成流程",
      consent: true,
      acknowledgeUnknownCost: false,
    });
    await app.audioGeneration.accept(receipt.id);
    const prepared = await app.audioGeneration.importTimeline(
      receipt.id,
      0,
      editor,
    );
    app.close();
    closed = true;
    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    try {
      const restored = new TimelineEditor(reopened);
      expect(restored.get("film").revision).toBe(prepared.baseRevision);
      const state = await restored.edit("film", {
        baseRevision: prepared.baseRevision,
        requestId: "restored-generation-draft",
        commands: [prepared.command],
      });
      expect(state.composition.tracks).toHaveLength(3);
      expect(
        (await restored.undo("film", state.revision)).composition.tracks,
      ).toHaveLength(2);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
