import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { MotionGenerationProvider } from "@openfilm/plugin-sdk";
import { localPath } from "@openfilm/media";
import { createMotionFixture } from "../../../tests/fixtures/motion-generation.js";
import { localMotionFixture } from "../src/motion-provider.js";
function request(
  f: Awaited<ReturnType<typeof createMotionFixture>>,
  providerId = "local-motion-fixture",
) {
  return {
    requestId: randomUUID(),
    projectId: f.app.project.id,
    compositionId: "film",
    clipId: "photo",
    baseRevision: f.editor.get("film").revision,
    providerId,
    count: 2,
    prompt: "Synthetic test",
    negativeConstraints: "Preserve all details",
    consent: true,
    containsPeople: false,
  };
}
function adapter(
  generateMotion: MotionGenerationProvider["generateMotion"],
): MotionGenerationProvider {
  return {
    id: "fault",
    name: "Local fault fixture",
    kind: "motion-generation",
    execution: "local",
    dataKinds: ["images", "text"],
    generateMotion,
  };
}
async function commitManagedMotionBeforeJournal(
  f: Awaited<ReturnType<typeof createMotionFixture>>,
) {
  delete f.app.project.stories[0]!.beats[0]!.candidateAssetIds;
  await f.app.save();
  const [candidate] = await f.app.motionGeneration.preview(request(f));
  await f.app.motionGeneration.accept(candidate!.id, true);
  const importSources = f.app.importManagedSources.bind(f.app);
  f.app.importManagedSources = async (...args) => {
    await importSources(...args);
    throw new Error("Synthetic crash after managed source commit");
  };
  try {
    await expect(
      f.app.motionGeneration.importCandidate(candidate!.id, f.editor),
    ).rejects.toThrow("Synthetic crash after managed source commit");
  } finally {
    f.app.importManagedSources = importSources;
  }
  return candidate!;
}
for (const status of [429, 500])
  it(`sanitizes provider ${status}, clears partial outputs and permits explicit new retry`, async () => {
    const root = await mkdtemp(join(tmpdir(), "motion-fault-"));
    let calls = 0;
    const f = await createMotionFixture(root, {
      motionGenerationProvider: adapter(async (input, options) => {
        if (calls++ === 0)
          throw Object.assign(new Error("SECRET /private/photo.png"), {
            status,
          });
        return localMotionFixture.generateMotion(input, options);
      }),
    });
    try {
      const input = request(f, "fault");
      await expect(f.app.motionGeneration.preview(input)).rejects.toMatchObject(
        {
          status: status === 429 ? 429 : 502,
          message:
            status === 429
              ? "Motion provider rate limited; retry explicitly."
              : "Motion provider failed; retry explicitly.",
        },
      );
      expect(
        await readdir(join(f.app.directory, "cache/motion-candidates")),
      ).toEqual([]);
      await expect(f.app.motionGeneration.preview(input)).rejects.toMatchObject(
        { status: 409 },
      );
      expect(
        await f.app.motionGeneration.preview({
          ...input,
          requestId: randomUUID(),
        }),
      ).toHaveLength(2);
    } finally {
      await f.app.motionGeneration.dispose();
      f.app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
for (const invalid of ["url", "bytes", "malformed", "oversized"] as const)
  it(`rejects ${invalid} provider result before adoption`, async () => {
    const root = await mkdtemp(join(tmpdir(), "motion-invalid-"));
    const f = await createMotionFixture(root, {
      motionGenerationProvider: adapter(async () => ({
        model: "fixture",
        mock: true,
        bytes:
          invalid === "oversized"
            ? new Uint8Array(64 * 1024 * 1024 + 1)
            : invalid === "url"
              ? ("https://fixture.invalid/video.mp4" as unknown as Uint8Array)
              : invalid === "malformed"
                ? new Uint8Array(
                    Buffer.concat([
                      Buffer.from([0, 0, 0, 32]),
                      Buffer.from("ftyp"),
                      Buffer.alloc(24),
                    ]),
                  )
                : new Uint8Array([1, 2, 3]),
      })),
    });
    try {
      const before = structuredClone(f.app.project);
      await expect(
        f.app.motionGeneration.preview(request(f, "fault")),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.app.project).toEqual(before);
      expect(
        await readdir(join(f.app.directory, "cache/motion-candidates")),
      ).toEqual([]);
    } finally {
      await f.app.motionGeneration.dispose();
      f.app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
it("fences cancellation even when provider ignores abort, deduplicates and rejects conflicting request IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-cancel-"));
  let release!: () => void,
    started!: () => void,
    calls = 0;
  const entered = new Promise<void>((r) => (started = r)),
    gate = new Promise<void>((r) => (release = r));
  const f = await createMotionFixture(root, {
    motionGenerationProvider: adapter(async () => {
      calls++;
      started();
      await gate;
      return { bytes: new Uint8Array([1]), model: "late", mock: true };
    }),
  });
  try {
    const input = request(f, "fault"),
      first = f.app.motionGeneration.preview(input);
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    await entered;
    const duplicate = f.app.motionGeneration.preview(input);
    const duplicateRejected = expect(duplicate).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(
      f.app.motionGeneration.preview({ ...input, prompt: "different" }),
    ).rejects.toMatchObject({ status: 409 });
    await f.app.motionGeneration.revoke(input.requestId);
    await rejected;
    await duplicateRejected;
    expect(calls).toBe(1);
    release();
    await Promise.resolve();
    expect(
      await readdir(join(f.app.directory, "cache/motion-candidates")),
    ).toEqual([]);
    await expect(f.app.motionGeneration.preview(input)).rejects.toMatchObject({
      status: 409,
    });
  } finally {
    release();
    await f.app.motionGeneration.dispose();
    f.app.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("times out an uncooperative provider without publishing late media", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-timeout-"));
  let release!: (value: {
    bytes: Uint8Array;
    model: string;
    mock: boolean;
  }) => void;
  const f = await createMotionFixture(root, {
    motionGenerationTimeoutMs: 100,
    motionGenerationProvider: adapter(() => new Promise((r) => (release = r))),
  });
  try {
    await expect(
      f.app.motionGeneration.preview(request(f, "fault")),
    ).rejects.toMatchObject({ name: "AbortError" });
    release?.({ bytes: new Uint8Array([1]), model: "late", mock: true });
    expect(
      await readdir(join(f.app.directory, "cache/motion-candidates")),
    ).toEqual([]);
  } finally {
    await f.app.motionGeneration.dispose();
    f.app.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("rejects changed originals, locked clips, revocation and foreign projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-stale-"));
  const f = await createMotionFixture(root);
  try {
    const input = request(f);
    await expect(
      f.app.motionGeneration.preview({ ...input, projectId: randomUUID() }),
    ).rejects.toMatchObject({ status: 400 });
    f.app.project.timelines[0]!.tracks[0]!.clips[0]!.locked = true;
    await f.app.save();
    await expect(
      f.app.motionGeneration.preview({
        ...input,
        baseRevision: f.editor.get("film").revision,
      }),
    ).rejects.toMatchObject({ status: 409 });
    delete f.app.project.timelines[0]!.tracks[0]!.clips[0]!.locked;
    await f.app.save();
    const receipts = await f.app.motionGeneration.preview({
      ...input,
      baseRevision: f.editor.get("film").revision,
    });
    await f.app.motionGeneration.revoke(input.requestId);
    await expect(
      f.app.motionGeneration.accept(receipts[0]!.id, true),
    ).rejects.toMatchObject({ status: 409 });
    const fresh = await f.app.motionGeneration.preview({
      ...input,
      requestId: randomUUID(),
      baseRevision: f.editor.get("film").revision,
    });
    const path = localPath(f.image.uri),
      bytes = await readFile(path);
    await writeFile(path, Buffer.concat([bytes, Buffer.from("changed")]));
    await expect(
      f.app.motionGeneration.accept(fresh[0]!.id, true),
    ).rejects.toMatchObject({ status: 409 });
    await f.app.motionGeneration.clearPreviews();
    expect(
      await readdir(join(f.app.directory, "cache/motion-candidates")),
    ).toEqual([]);
  } finally {
    await f.app.motionGeneration.dispose();
    f.app.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const change of [
  "revision",
  "project-generation",
  "source-lock",
  "required",
] as const)
  it(`rejects ${change} after generation without changing the composition`, async () => {
    const root = await mkdtemp(join(tmpdir(), "motion-owner-"));
    const f = await createMotionFixture(root);
    try {
      const [r] = await f.app.motionGeneration.preview(request(f));
      if (change === "revision") {
        f.app.project.timelines[0]!.tracks[0]!.clips[0]!.title = "Changed";
        await f.app.save();
      } else if (change === "project-generation") {
        await f.app.motionGeneration.dispose();
      } else if (change === "source-lock") {
        const asset = f.app.catalog.getAsset(f.image.id)!;
        asset.state.locked = true;
        f.app.catalog.upsertAsset(asset);
      } else {
        f.app.project.stories[0]!.beats[0]!.constraints = [
          { type: "must-include", assetIds: [f.image.id] },
        ];
        await f.app.save();
      }
      const before = structuredClone(f.app.project);
      await expect(
        f.app.motionGeneration.accept(r!.id, true),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.app.project).toEqual(before);
    } finally {
      await f.app.motionGeneration.dispose();
      f.app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
it("fences an in-flight result across a project restore generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-generation-fence-"));
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const f = await createMotionFixture(root, {
    motionGenerationProvider: adapter(async (input, options) => {
      entered();
      await gate;
      return localMotionFixture.generateMotion(input, options);
    }),
  });
  try {
    const work = f.app.motionGeneration.preview(request(f, "fault"));
    const rejected = expect(work).rejects.toMatchObject({ status: 409 });
    await started;
    f.app.acceptRestoredProject(structuredClone(f.app.project));
    release();
    await rejected;
    expect(
      await readdir(join(f.app.directory, "cache/motion-candidates")),
    ).toEqual([]);
  } finally {
    release();
    await f.app.motionGeneration.dispose();
    f.app.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("recovers a prepared precommit import after reopen, and physically expires unadopted media", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-recovery-"));
  const f = await createMotionFixture(root);
  let closed = false;
  try {
    const receipts = await f.app.motionGeneration.preview(request(f));
    const r = receipts[0]!,
      other = receipts[1]!;
    await f.app.motionGeneration.accept(r.id, true);
    const edit = f.editor.edit.bind(f.editor);
    f.editor.edit = async () => {
      throw new Error("Synthetic precommit crash");
    };
    await expect(
      f.app.motionGeneration.importCandidate(r.id, f.editor),
    ).rejects.toThrow("Synthetic precommit crash");
    f.editor.edit = edit;
    expect((await f.app.motionGeneration.receipt(r.id)).state).toBe("prepared");
    const file = join(
      f.app.directory,
      "cache/motion-receipts",
      `${other.id}.json`,
    );
    const record = JSON.parse(await readFile(file, "utf8"));
    record.receipt.createdAt = new Date(Date.now() - 86401000).toISOString();
    await writeFile(file, JSON.stringify(record));
    await f.app.motionGeneration.dispose();
    f.app.close();
    closed = true;
    const { OpenFilmApplication, TimelineEditor } =
      await import("../src/index.js");
    const app = await OpenFilmApplication.open(join(root, "film.openfilm"));
    try {
      expect(
        await readdir(join(app.directory, "cache/motion-candidates")),
      ).not.toContain(other.id);
      expect((await app.motionGeneration.receipt(other.id)).state).toBe(
        "revoked",
      );
      const editor = new TimelineEditor(app);
      const adopted = await app.motionGeneration.importCandidate(r.id, editor);
      expect(adopted.composition.tracks[0]!.clips[0]!.assetId).not.toBe(
        f.image.id,
      );
      expect(
        await readdir(join(app.directory, "cache/motion-candidates")),
      ).not.toContain(r.id);
    } finally {
      await app.motionGeneration.dispose();
      app.close();
    }
  } finally {
    if (!closed) {
      await f.app.motionGeneration.dispose();
      f.app.close();
    }
    await rm(root, { recursive: true, force: true });
  }
});

it("expires abandoned candidate files without receipts on reopen and frees their preview quota", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-orphan-expiry-"));
  const f = await createMotionFixture(root);
  let closed = false;
  try {
    const candidates = join(f.app.directory, "cache/motion-candidates");
    const input = request(f);
    const image = await readFile(localPath(f.image.uri));
    const expired = new Date(Date.now() - 86401000);
    const recentId = randomUUID();
    for (const id of [
      ...Array.from({ length: 23 }, () => randomUUID()),
      recentId,
    ]) {
      const directory = join(candidates, id);
      await mkdir(directory, { recursive: true });
      // A crash while checking the source leaves bytes before its receipt exists.
      await writeFile(join(directory, "source.image"), image);
      if (id !== recentId) await utimes(directory, expired, expired);
    }
    await f.app.motionGeneration.dispose();
    f.app.close();
    closed = true;
    const { OpenFilmApplication, TimelineEditor } =
      await import("../src/index.js");
    const app = await OpenFilmApplication.open(join(root, "film.openfilm"));
    try {
      expect(await readdir(candidates)).toEqual([recentId]);
      expect(
        await readFile(join(candidates, recentId, "source.image")),
      ).toEqual(image);
      expect(
        await app.motionGeneration.preview({
          ...input,
          baseRevision: new TimelineEditor(app).get("film").revision,
        }),
      ).toHaveLength(2);
    } finally {
      await app.motionGeneration.dispose();
      app.close();
    }
  } finally {
    if (!closed) {
      await f.app.motionGeneration.dispose();
      f.app.close();
    }
    await rm(root, { recursive: true, force: true });
  }
});

it("recovers an accepted implicit-pool candidate after its managed source committed before the prepared receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "motion-managed-commit-crash-"));
  const f = await createMotionFixture(root);
  let closed = false;
  try {
    const original = structuredClone(f.app.project.timelines[0]!);
    const candidate = await commitManagedMotionBeforeJournal(f);
    expect((await f.app.motionGeneration.receipt(candidate!.id)).state).toBe(
      "accepted",
    );
    expect(f.app.project.timelines[0]).toEqual(original);
    const videos = f.app.catalog
      .listAssets({ limit: 20 })
      .filter((asset) => asset.mediaType === "video");
    expect(videos).toHaveLength(1);
    await f.app.motionGeneration.dispose();
    f.app.close();
    closed = true;
    const { OpenFilmApplication, TimelineEditor } =
      await import("../src/index.js");
    const app = await OpenFilmApplication.open(join(root, "film.openfilm"));
    try {
      const editor = new TimelineEditor(app);
      const imported = await app.motionGeneration.importCandidate(
        candidate!.id,
        editor,
      );
      expect(imported.composition.tracks[0]!.clips[0]!.assetId).toBe(
        videos[0]!.id,
      );
      expect(imported.composition.tracks[1]).toEqual(original.tracks[1]);
      expect(
        (await app.motionGeneration.importCandidate(candidate!.id, editor))
          .revision,
      ).toBe(imported.revision);
      const undone = await editor.undo("film", imported.revision);
      expect(undone.composition).toEqual(original);
      await editor.redo("film", undone.revision);
      const { hashFile, runProcess } = await import("@openfilm/media");
      expect(await hashFile(localPath(f.image.uri))).toBe(
        candidate!.sourceSha256,
      );
      const output = await app.render("film");
      const proof = JSON.parse(
        (
          await runProcess("ffprobe", [
            "-v",
            "error",
            "-count_frames",
            "-show_entries",
            "stream=codec_type,nb_read_frames:format=duration",
            "-of",
            "json",
            output,
          ])
        ).stdout.toString(),
      );
      expect(
        proof.streams.find(
          (stream: { codec_type: string }) => stream.codec_type === "video",
        ).nb_read_frames,
      ).toBe("48");
      expect(
        proof.streams.some(
          (stream: { codec_type: string }) => stream.codec_type === "audio",
        ),
      ).toBe(true);
      expect(Number(proof.format.duration)).toBe(4);
    } finally {
      await app.motionGeneration.dispose();
      app.close();
    }
  } finally {
    if (!closed) {
      await f.app.motionGeneration.dispose();
      f.app.close();
    }
    await rm(root, { recursive: true, force: true });
  }
});

for (const change of [
  "target-edit",
  "source-lock",
  "managed-lock",
  "managed-bytes",
  "original-bytes",
  "other-pool-source",
] as const)
  it(`refuses ${change} while recovering a managed import without a prepared receipt`, async () => {
    const root = await mkdtemp(
      join(tmpdir(), "motion-managed-recovery-fence-"),
    );
    const f = await createMotionFixture(root);
    try {
      const candidate = await commitManagedMotionBeforeJournal(f);
      const managed = f.app.catalog
        .listAssets({ limit: 20 })
        .find((asset) => asset.mediaType === "video")!;
      if (change === "target-edit") {
        f.app.project.timelines[0]!.tracks[0]!.clips[0]!.title = "Later edit";
        await f.app.save();
      } else if (change === "source-lock" || change === "managed-lock") {
        const asset = f.app.catalog.getAsset(
          change === "source-lock" ? f.image.id : managed.id,
        )!;
        asset.state.locked = true;
        f.app.catalog.upsertAsset(asset);
      } else if (change === "managed-bytes" || change === "original-bytes") {
        const path = localPath(
          change === "managed-bytes" ? managed.uri : f.image.uri,
        );
        await writeFile(
          path,
          Buffer.concat([await readFile(path), Buffer.from("changed")]),
        );
      } else {
        const audio = f.app.catalog
          .listAssets({ limit: 20 })
          .find((asset) => asset.mediaType === "audio")!;
        audio.tags = ["Changed during recovery"];
        f.app.catalog.upsertAsset(audio);
      }
      const before = structuredClone(f.app.project);
      await expect(
        f.app.motionGeneration.importCandidate(candidate.id, f.editor),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.app.project).toEqual(before);
      expect((await f.app.motionGeneration.receipt(candidate.id)).state).toBe(
        "accepted",
      );
      expect(
        f.app.catalog
          .listAssets({ limit: 20 })
          .filter((asset) => asset.mediaType === "video"),
      ).toHaveLength(1);
    } finally {
      await f.app.motionGeneration.dispose();
      f.app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
