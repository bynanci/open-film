import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { hashFile, localPath } from "@openfilm/media";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";
import { createAudioQualityFixture } from "../../../tests/fixtures/audio-quality.js";
import type { TimelineCommand } from "@openfilm/solver";
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
    expect(
      accepted.composition.tracks[1]!.clips[0]!.userOverrides,
    ).toBeUndefined();
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

it("keeps a real measured suggestion ineligible under an ordinary clip lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-locked-audio-review-"));
  const { app } = await createAudioQualityFixture(root);
  try {
    const editor = new TimelineEditor(app);
    const locked = await editor.edit("film", {
      baseRevision: editor.get("film").revision,
      commands: [{ type: "lock", clipId: "sound", locked: true }],
    });
    const file = join(app.directory, "project.json"),
      disk = await readFile(file);
    const report = await app.runAudioQuality("film", "sound", locked.revision);
    expect(report.suggestion!.volume).toBeLessThan(0.8);
    expect(report.canAccept).toBe(false);
    expect(report.issues).toContain("target-locked");
    expect(report.issues).not.toContain("mix-headroom");
    await expect(
      editor.edit("film", {
        baseRevision: locked.revision,
        commands: [
          {
            type: "volume",
            clipId: "sound",
            volume: report.suggestion!.volume,
            audioReviewId: report.id,
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(editor.get("film")).toEqual(locked);
    expect(await readFile(file)).toEqual(disk);
  } finally {
    app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("keeps measured audio ineligible while pinned, then accepts only fresh released evidence without changing source bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-pinned-audio-review-"));
  const { app, audio, video } = await createAudioQualityFixture(root);
  try {
    const editor = new TimelineEditor(app),
      initial = editor.get("film");
    const sourceHashes = await Promise.all(
      [audio, video].map((asset) => hashFile(localPath(asset.uri))),
    );
    const originalReport = await app.runAudioQuality(
      "film",
      "sound",
      initial.revision,
    );
    const pinned = await editor.edit("film", {
      baseRevision: initial.revision,
      commands: [
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: "sound" },
          pinned: true,
        },
      ],
    });
    const file = join(app.directory, "project.json"),
      disk = await readFile(file);
    const accept = (report: typeof originalReport, revision: string) =>
      editor.edit("film", {
        baseRevision: revision,
        commands: [
          {
            type: "volume",
            clipId: "sound",
            volume: report.suggestion!.volume,
            audioReviewId: report.id,
          },
        ],
      });
    await expect(accept(originalReport, pinned.revision)).rejects.toMatchObject(
      { status: 409 },
    );
    const report = await app.runAudioQuality("film", "sound", pinned.revision);
    expect(report.canAccept).toBe(false);
    expect(report.suggestion!.volume).toBeLessThan(0.8);
    expect(report.issues).toContain("user-pinned");
    expect(report.issues).not.toContain("mix-headroom");
    await expect(accept(report, pinned.revision)).rejects.toMatchObject({
      status: 409,
      code: "timeline.pinConflict",
      params: {
        pinTargets: JSON.stringify([{ kind: "clip", clipId: "sound" }]),
      },
    });
    expect(editor.get("film")).toEqual(pinned);
    expect(await readFile(file)).toEqual(disk);
    const released = await editor.edit("film", {
      baseRevision: pinned.revision,
      commands: [
        {
          type: "user-pin.set",
          target: { kind: "clip", clipId: "sound" },
          pinned: false,
        },
      ],
    });
    await expect(accept(report, released.revision)).rejects.toMatchObject({
      status: 409,
    });
    const fresh = await app.runAudioQuality("film", "sound", released.revision);
    expect(fresh.canAccept).toBe(true);
    const accepted = await accept(fresh, released.revision);
    expect(accepted.composition.tracks[1]!.clips[0]!.userOverrides).toEqual({
      version: 1,
      isUserPinned: false,
      lockedAttributes: [],
    });
    expect(accepted.composition.tracks[1]!.clips[0]!.transform!.volume).toBe(
      fresh.suggestion!.volume,
    );
    const undone = await editor.undo("film", accepted.revision);
    expect(undone.composition).toEqual(released.composition);
    const redone = await editor.redo("film", undone.revision);
    expect(redone.composition).toEqual(accepted.composition);
    const manual = await editor.edit("film", {
      baseRevision: redone.revision,
      commands: [{ type: "volume", clipId: "sound", volume: 0.5 }],
    });
    expect(
      manual.composition.tracks[1]!.clips[0]!.userOverrides?.isUserPinned,
    ).toBe(true);
    expect(manual.composition.tracks[1]!.clips[0]!.transform!.volume).toBe(0.5);
    const locked = await editor.edit("film", {
      baseRevision: manual.revision,
      commands: [{ type: "lock", clipId: "sound", locked: true }],
    });
    const lockedDisk = await readFile(file);
    await expect(
      editor.edit("film", {
        baseRevision: locked.revision,
        commands: [{ type: "volume", clipId: "sound", volume: 0.4 }],
      }),
    ).rejects.toThrow(/locked/iu);
    expect(editor.get("film")).toEqual(locked);
    expect(await readFile(file)).toEqual(lockedDisk);
    const reopened = await OpenFilmApplication.open(app.directory);
    try {
      expect(new TimelineEditor(reopened).get("film").composition).toEqual(
        locked.composition,
      );
    } finally {
      reopened.close();
    }
    expect(
      await Promise.all(
        [audio, video].map((asset) => hashFile(localPath(asset.uri))),
      ),
    ).toEqual(sourceHashes);
  } finally {
    app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("rejects measured audio mixed with direct commands in either order before any transaction changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-audio-batches-"));
  const { app, audio } = await createAudioQualityFixture(root);
  try {
    const editor = new TimelineEditor(app),
      before = editor.get("film");
    const report = await app.runAudioQuality("film", "sound", before.revision);
    expect(report.canAccept).toBe(true);
    const measured: TimelineCommand = {
      type: "volume",
      clipId: "sound",
      volume: report.suggestion!.volume,
      audioReviewId: report.id,
    };
    const file = join(app.directory, "project.json"),
      disk = await readFile(file),
      sourceHash = await hashFile(localPath(audio.uri));
    const direct: TimelineCommand[] = [
      { type: "volume", clipId: "sound", volume: 0.5 },
      { type: "trim", clipId: "sound", sourceIn: 0.5, sourceOut: 4 },
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "sound" },
        pinned: true,
      },
      {
        type: "user-pin.set",
        target: { kind: "clip", clipId: "sound" },
        pinned: false,
      },
      { type: "lock", clipId: "sound", locked: true },
      { type: "transform", clipId: "picture", scale: 1.1 },
    ];
    for (const item of direct)
      for (const commands of [
        [measured, item],
        [item, measured],
      ]) {
        await expect(
          editor.edit("film", { baseRevision: before.revision, commands }),
        ).rejects.toThrow(/single-command/iu);
        expect(editor.get("film")).toEqual(before);
        expect(await readFile(file)).toEqual(disk);
      }
    const accepted = await editor.edit("film", {
      baseRevision: before.revision,
      commands: [measured],
    });
    expect(
      accepted.composition.tracks[1]!.clips[0]!.userOverrides,
    ).toBeUndefined();
    expect((await editor.undo("film", accepted.revision)).composition).toEqual(
      before.composition,
    );
    expect(await hashFile(localPath(audio.uri))).toBe(sourceHash);
  } finally {
    app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("keeps saved-project CAS authoritative for a fresh measured audio acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-audio-review-cas-"));
  const { app, audio } = await createAudioQualityFixture(root);
  try {
    const editor = new TimelineEditor(app),
      before = editor.get("film"),
      project = app.project;
    const file = join(app.directory, "project.json"),
      projectHash = await hashFile(file),
      sourceHash = await hashFile(localPath(audio.uri));
    const report = await app.runAudioQuality("film", "sound", before.revision);
    expect(report.canAccept).toBe(true);
    expect(await hashFile(file)).toBe(projectHash);
    const external = JSON.parse(await readFile(file, "utf8"));
    external.title = "Saved independently";
    const bytes = Buffer.from(JSON.stringify(external));
    await writeFile(file, bytes);
    await expect(
      editor.edit("film", {
        baseRevision: before.revision,
        requestId: "review-cas",
        commands: [
          {
            type: "volume",
            clipId: "sound",
            volume: report.suggestion!.volume,
            audioReviewId: report.id,
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, code: "story.planConflict" });
    expect(app.project).toBe(project);
    expect(editor.get("film")).toEqual(before);
    expect(await readFile(file)).toEqual(bytes);
    expect(await hashFile(localPath(audio.uri))).toBe(sourceHash);
    const reopened = await OpenFilmApplication.open(app.directory);
    try {
      expect(reopened.project.title).toBe("Saved independently");
      expect(new TimelineEditor(reopened).get("film").composition).toEqual(
        before.composition,
      );
    } finally {
      reopened.close();
    }
  } finally {
    app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
