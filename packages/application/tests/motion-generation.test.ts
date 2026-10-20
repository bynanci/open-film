import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createMotionFixture } from "../../../tests/fixtures/motion-generation.js";
it("makes real local candidates without adopting them and gates acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-motion-"));
  const { app, editor } = await createMotionFixture(root);
  try {
    const input = {
      requestId: randomUUID(),
      projectId: app.project.id,
      compositionId: "film",
      clipId: "photo",
      baseRevision: editor.get("film").revision,
      providerId: "local-motion-fixture",
      count: 2,
      prompt: "Synthetic environment",
      negativeConstraints: "No facial or identity changes",
      consent: true,
      containsPeople: false,
    };
    const before = JSON.stringify(app.project);
    const service = app.motionGeneration;
    const receipts = await service.preview(input);
    expect(receipts).toHaveLength(2);
    expect(new Set(receipts.map((r) => r.outputSha256)).size).toBe(2);
    const repeated = await service.preview({
      ...input,
      requestId: randomUUID(),
    });
    expect(repeated.map((r) => r.outputSha256)).toEqual(
      receipts.map((r) => r.outputSha256),
    );
    expect(receipts[0]!.output.frames).toBe(48);
    expect(receipts[0]!.deformationCheck).toBe("manual-required");
    expect(JSON.stringify(app.project)).toBe(before);
    await expect(
      service.importCandidate(receipts[0]!.id, editor),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    await app.motionGeneration.dispose();
    app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("accepts/replaces once, keeps narration and history, reopens and explicitly restores", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-motion-lifecycle-"));
  const { app, editor, image } = await createMotionFixture(root);
  let closed = false;
  try {
    const { hashFile, localPath, runProcess } = await import("@openfilm/media");
    const { OpenFilmApplication, TimelineEditor } =
      await import("../src/index.js");
    const sourceHash = await hashFile(localPath(image.uri));
    const original = structuredClone(app.project.timelines[0]!);
    const input = {
      requestId: randomUUID(),
      projectId: app.project.id,
      compositionId: "film",
      clipId: "photo",
      baseRevision: editor.get("film").revision,
      providerId: "local-motion-fixture",
      count: 2,
      prompt: "Synthetic clouds",
      negativeConstraints: "Preserve identity",
      consent: true,
      containsPeople: false,
    };
    const receipts = await app.motionGeneration.preview(input);
    expect(
      (await app.motionGeneration.preview(input)).map((r) => r.id),
    ).toEqual(receipts.map((r) => r.id));
    expect(JSON.stringify(receipts)).not.toContain(input.prompt);
    const candidate = receipts[0]!;
    const path = await app.motionGeneration.media(candidate.id);
    const decoded = await runProcess("ffmpeg", [
      "-v",
      "error",
      "-i",
      path,
      "-f",
      "framemd5",
      "-",
    ]);
    const frameHashes = decoded.stdout
      .toString()
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));
    expect(frameHashes).toHaveLength(48);
    expect(frameHashes[0]!.split(",").at(-1)).not.toBe(
      frameHashes[47]!.split(",").at(-1),
    );
    await expect(
      app.motionGeneration.accept(candidate.id, false),
    ).rejects.toMatchObject({ status: 400 });
    await app.motionGeneration.accept(candidate.id, true);
    const imported = await app.motionGeneration.importCandidate(
      candidate.id,
      editor,
    );
    const adopted = imported.composition.tracks[0]!.clips[0]!;
    expect(adopted.assetId).not.toBe(image.id);
    expect(imported.composition.duration).toBe(4);
    expect(imported.composition.tracks[1]).toEqual(original.tracks[1]);
    expect(imported.canUndo).toBe(true);
    const repeated = await app.motionGeneration.importCandidate(
      candidate.id,
      editor,
    );
    expect(repeated.revision).toBe(imported.revision);
    const undone = await editor.undo("film", imported.revision);
    expect(undone.composition).toEqual(original);
    const redone = await editor.redo("film", undone.revision);
    expect(redone.composition.tracks[0]!.clips[0]!.assetId).toBe(
      adopted.assetId,
    );
    const output = await app.render("film");
    const proof = await runProcess("ffprobe", [
      "-v",
      "error",
      "-count_frames",
      "-show_entries",
      "stream=codec_type,nb_read_frames:format=duration",
      "-of",
      "json",
      output,
    ]);
    const measured = JSON.parse(proof.stdout.toString());
    expect(
      measured.streams.find(
        (s: { codec_type: string }) => s.codec_type === "video",
      ).nb_read_frames,
    ).toBe("48");
    expect(
      measured.streams.some(
        (s: { codec_type: string }) => s.codec_type === "audio",
      ),
    ).toBe(true);
    expect(Number(measured.format.duration)).toBeCloseTo(4, 2);
    expect(await hashFile(localPath(image.uri))).toBe(sourceHash);
    await app.motionGeneration.dispose();
    app.close();
    closed = true;
    const reopened = await OpenFilmApplication.open(
      join(root, "film.openfilm"),
    );
    try {
      const reopenedEditor = new TimelineEditor(reopened);
      const retry = await reopened.motionGeneration.importCandidate(
        candidate.id,
        reopenedEditor,
      );
      expect(retry.composition.tracks[0]!.clips[0]!.assetId).toBe(
        adopted.assetId,
      );
      const restored = await reopened.motionGeneration.restore(
        candidate.id,
        reopenedEditor,
      );
      expect(restored.composition).toEqual(original);
      expect(
        (await reopened.motionGeneration.restore(candidate.id, reopenedEditor))
          .revision,
      ).toBe(restored.revision);
      expect(await hashFile(localPath(image.uri))).toBe(sourceHash);
    } finally {
      await reopened.motionGeneration.dispose();
      reopened.close();
    }
  } finally {
    if (!closed) {
      await app.motionGeneration.dispose();
      app.close();
    }
    await rm(root, { recursive: true, force: true });
  }
});

it("imports an explicit real external MP4, strips its audio, hashes sources and clears previews without deleting adopted media", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-external-"));
  const { app, editor, image } = await createMotionFixture(root);
  try {
    const { runProcess, hashFile, localPath } = await import("@openfilm/media");
    const { mkdir, access, readFile } = await import("node:fs/promises");
    const folder = join(root, "external");
    await mkdir(folder);
    const video = join(folder, "candidate.mp4");
    await runProcess("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=160x90:r=12:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-shortest",
      video,
    ]);
    await app.importFolder(folder);
    const asset = app.catalog
      .listAssets({ limit: 100 })
      .find((a) => a.mediaType === "video")!;
    const originalHash = await hashFile(localPath(image.uri));
    const receipts = await app.motionGeneration.preview({
      requestId: randomUUID(),
      projectId: app.project.id,
      compositionId: "film",
      clipId: "photo",
      baseRevision: editor.get("film").revision,
      providerId: "local-motion-import",
      candidateAssetIds: [asset.id],
      prompt: "User-declared synthetic external motion",
      negativeConstraints: "Keep source details",
      consent: true,
      containsPeople: false,
    });
    const r = receipts[0]!;
    expect(r.origin).toBe("external-import");
    expect(r.sourceRelation).toBe("user-declared-external");
    expect(r.inputSha256).toBe(await hashFile(video));
    expect(r.output.audioRemoved).toBe(true);
    expect(r.costStatus).toBe("external-cost-unknown");
    const preview = await app.motionGeneration.media(r.id);
    expect(await hashFile(preview)).toBe(r.outputSha256);
    const probe = JSON.parse(
      (
        await runProcess("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type",
          "-of",
          "json",
          preview,
        ])
      ).stdout.toString(),
    );
    expect(
      probe.streams.map((s: { codec_type: string }) => s.codec_type),
    ).toEqual(["video"]);
    await app.motionGeneration.accept(r.id, true);
    const state = await app.motionGeneration.importCandidate(r.id, editor);
    const managed = app.getSourceAsset(
      state.composition.tracks[0]!.clips[0]!.assetId,
    )!;
    await app.motionGeneration.clearPreviews();
    await access(localPath(managed.uri));
    expect(await hashFile(localPath(image.uri))).toBe(originalHash);
    expect(await hashFile(video)).toBe(r.inputSha256);
    expect((await readFile(localPath(managed.uri))).length).toBeGreaterThan(
      1000,
    );
  } finally {
    await app.motionGeneration.dispose();
    app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("atomically replaces/restores the linked M8A scene and retains a Named Version", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-depth-"));
  const { app, editor, image } = await createMotionFixture(root);
  try {
    const scene: import("@openfilm/core").GraphicScene = {
      version: 1,
      id: "depth",
      name: "Synthetic fallback",
      start: 0,
      duration: 4,
      zIndex: 0,
      nodes: [
        {
          id: "photo-node",
          type: "image",
          assetId: image.id,
          x: 0,
          y: 0,
          width: 160,
          height: 90,
          start: 0,
          end: 4,
          opacity: 1,
          zIndex: 0,
        },
      ],
      photoDepth: {
        version: 1,
        id: "recipe",
        nodeId: "photo-node",
        mode: "fallback",
        duration: 4,
        sourceAssetId: image.id,
        sourceSha256: image.contentHash!,
        fallbackReason: "mask-not-available",
      },
    };
    app.project.timelines[0]!.graphicScenes = [scene];
    await app.save();
    const input = {
      requestId: randomUUID(),
      projectId: app.project.id,
      compositionId: "film",
      clipId: "photo",
      baseRevision: editor.get("film").revision,
      providerId: "local-motion-fixture",
      count: 2,
      prompt: "Synthetic environment",
      negativeConstraints: "Preserve proportions",
      consent: true,
      containsPeople: false,
    };
    await expect(app.motionGeneration.preview(input)).rejects.toMatchObject({
      status: 409,
    });
    const [r] = await app.motionGeneration.preview({
      ...input,
      sceneId: "depth",
      requestId: randomUUID(),
    });
    await app.motionGeneration.accept(r!.id, true);
    const adopted = await app.motionGeneration.importCandidate(r!.id, editor);
    expect(adopted.composition.graphicScenes ?? []).toEqual([]);
    const version = await app.versions.create({
      name: "Accepted synthetic motion",
      requestId: randomUUID(),
      baseRevision: app.versions.currentRevision(),
    });
    expect(version.name).toBe("Accepted synthetic motion");
    const restored = await app.motionGeneration.restore(r!.id, editor);
    expect(restored.composition.graphicScenes).toEqual([scene]);
    expect(app.versions.list()).toHaveLength(1);
  } finally {
    await app.motionGeneration.dispose();
    app.close();
    await rm(root, { recursive: true, force: true });
  }
});
