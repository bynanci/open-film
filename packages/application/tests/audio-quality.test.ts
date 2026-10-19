import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { hashFile, localPath } from "@openfilm/media";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import { createAudioQualityFixture } from "../../../tests/fixtures/audio-quality.js";
it("reviews a real MP4 mix, preserves authored curves on accept/history/reopen and fences stale media", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-audio-review-"));
  const { app, audio } = await createAudioQualityFixture(root);
  let closed = false;
  try {
    const editor = new TimelineEditor(app);
    const before = editor.get("film");
    const automation = structuredClone(
      before.composition.tracks[1]!.clips[0]!.audioAutomation,
    );
    const hash = await hashFile(localPath(audio.uri));
    const report = await app.runAudioQuality("film", "sound", before.revision);
    expect(report.canAccept).toBe(true);
    expect(report.suggestion!.volume).toBeLessThan(0.8);
    expect(report.candidate!.integratedLufs!).toBeCloseTo(-23, 0);
    expect(report.sources.find((s) => s.assetId === audio.id)?.sha256).toBe(
      hash,
    );
    expect(await hashFile(localPath(audio.uri))).toBe(hash);
    expect(editor.get("film").revision).toBe(before.revision);
    expect(await app.audioQuality.media(report.id, "candidate")).toMatch(
      /candidate.mp4$/u,
    );
    const accept = () =>
      editor.edit("film", {
        baseRevision: before.revision,
        requestId: "audio-review-accept",
        commands: [
          {
            type: "volume",
            clipId: "sound",
            volume: report.suggestion!.volume,
            audioReviewId: report.id,
          },
        ],
      });
    const sourcePath = localPath(audio.uri);
    const bytes = await readFile(sourcePath);
    await writeFile(sourcePath, Buffer.concat([bytes, Buffer.from("changed")]));
    await expect(accept()).rejects.toMatchObject({ status: 409 });
    await writeFile(sourcePath, bytes);
    const frameRate = app.project.settings.frameRate;
    app.project.settings.frameRate = 24;
    await expect(accept()).rejects.toMatchObject({ status: 409 });
    app.project.settings.frameRate = frameRate;
    expect(editor.get("film").revision).toBe(before.revision);
    const accepted = await accept();
    expect((await accept()).acknowledgedRevision).toBe(accepted.revision);
    expect(accepted.composition.tracks[1]!.clips[0]!.audioAutomation).toEqual(
      automation,
    );
    await expect(
      app.audioQuality.media(report.id, "original"),
    ).rejects.toMatchObject({ status: 409 });
    const undone = await editor.undo("film", accepted.revision);
    expect(undone.composition.tracks[1]!.clips[0]!.transform!.volume).toBe(0.8);
    const redone = await editor.redo("film", undone.revision);
    expect(redone.composition.tracks[1]!.clips[0]!.audioAutomation).toEqual(
      automation,
    );
    app.close();
    closed = true;
    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    try {
      expect(
        reopened.project.timelines[0]!.tracks[1]!.clips[0]!.transform!.volume,
      ).toBe(report.suggestion!.volume);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
