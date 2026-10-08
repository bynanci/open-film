import * as fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "@openfilm/core";
import type { TranscriptDocument } from "@openfilm/core";
import * as media from "@openfilm/media";
import { hashFile } from "@openfilm/media";
import { OpenFilmApplication, TimelineEditor } from "../src/index.js";

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
const actualFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

const applications = new Set<OpenFilmApplication>();
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.writeFile).mockImplementation(actualFs.writeFile);
  for (const app of applications) app.close();
  applications.clear();
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});

async function fixture(count = 3, transcript = true) {
  const root = await fs.mkdtemp(join(tmpdir(), "openfilm-captions-"));
  roots.push(root);
  const source = join(root, "spoken # & 青森.mp4"),
    bytes = "Original spoken media bytes.";
  await fs.writeFile(source, bytes);
  const sourceHash = await hashFile(source);
  const directory = join(root, "film.openfilm"),
    runtime = { userDataDirectory: join(root, "user-data") };
  const app = await OpenFilmApplication.create(
    directory,
    "Captions",
    {},
    runtime,
  );
  applications.add(app);
  const duration = Math.max(20, count + 1);
  app.catalog.upsertAsset({
    id: "spoken",
    uri: pathToFileURL(source).href,
    name: "spoken # & 青森.mp4",
    mediaType: "video",
    contentHash: sourceHash,
    duration,
    tags: [],
    state: { locked: true },
    metadata: { "openfilm.ffprobe": { streams: [{ codec_type: "audio" }] } },
  });
  const document: TranscriptDocument = {
    id: "provider-original",
    assetId: "spoken",
    language: "zh",
    provenance: {
      providerId: "fixture",
      model: "test-model",
      sourceHash,
      version: "1",
      createdAt: "2026-10-08T00:00:00Z",
    },
    segments: Array.from({ length: count }, (_, index) => ({
      id: `segment-${index}`,
      start: index,
      end: index + 0.8,
      text: index === 0 ? "我們去了十河田湖" : `Memory ${index}`,
      words: [
        {
          start: index,
          end: index + 0.8,
          text: index === 0 ? "我們去了十河田湖" : `Memory ${index}`,
        },
      ],
    })),
  };
  if (transcript) app.catalog.intelligence.replaceTranscript(document);
  app.project.stories.push({
    id: "story",
    title: "Keep story",
    beats: [{ id: "beat", title: "Keep beat", candidateAssetIds: ["spoken"] }],
  });
  app.project.timelines.push({
    id: "film",
    storyId: "story",
    duration,
    tracks: [
      {
        id: "dialogue",
        type: "video",
        clips: [
          {
            id: "instance",
            assetId: "spoken",
            beatId: "beat",
            sourceIn: 0,
            sourceOut: duration,
            timelineStart: 0,
            timelineDuration: duration,
            locked: true,
          },
        ],
      },
    ],
  });
  await app.save();
  const input = () => ({
    projectId: app.project.id,
    compositionId: "film",
    trackId: "dialogue",
    baseRevision: new TimelineEditor(app).get("film").revision,
  });
  return {
    app,
    root,
    source,
    sourceHash,
    bytes,
    directory,
    runtime,
    input,
    document,
  };
}

async function entries(directory: string, name: string): Promise<string[]> {
  try {
    return await fs.readdir(join(directory, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("composition-bound caption application", () => {
  it("uses corrected transcript revisions without changing provider evidence, history, media or project", async () => {
    const test = await fixture();
    const original = await test.app.transcriptEditor.get("spoken");
    const corrected = await test.app.transcriptEditor.edit("spoken", {
      baseRevision: original.revision!,
      requestId: "correct-place",
      commands: [
        {
          type: "replace-text",
          segmentId: "segment-0",
          text: "我們去了十和田湖",
        },
      ],
    });
    const before = await fs.readFile(
      join(test.directory, "project.json"),
      "utf8",
    );
    const preview = await test.app.captions.prepare(test.input());
    expect(preview.cues[0]?.text).toBe("我們去了十和田湖");
    expect(preview.sources[0]).toMatchObject({
      sourceHash: test.sourceHash,
      transcriptRevisionId: corrected.revision,
      provenance: { providerId: "fixture", model: "test-model" },
    });
    expect(
      preview.issues.some((issue) => issue.code === "ALIGNMENT_STALE"),
    ).toBe(true);
    expect(preview.exportable).toBe(true);
    expect(
      await fs.readFile(join(test.directory, "project.json"), "utf8"),
    ).toBe(before);
    expect(await fs.readFile(test.source, "utf8")).toBe(test.bytes);
    expect(await test.app.transcriptEditor.get("spoken")).toEqual(corrected);
    const evidence = await test.app.transcriptEditor.get("spoken", {
      revisionId: original.revision,
    });
    expect(evidence.document?.segments[0]?.text).toBe("我們去了十河田湖");
    expect(evidence.document?.provenance).toEqual(
      original.document?.provenance,
    );
  });

  it("publishes SRT and VTT with full clip/revision provenance, preserves earlier exports, and reopens", async () => {
    const test = await fixture();
    const snapshot = await test.app.captions.prepare(test.input());
    const srt = await test.app.captions.export(snapshot.id, "srt", {
      projectId: test.app.project.id,
    });
    const vtt = await test.app.captions.export(snapshot.id, "vtt", {
      projectId: test.app.project.id,
    });
    expect(srt.id).not.toBe(vtt.id);
    expect(
      (
        await test.app.captions.readOutput(srt.id, {
          projectId: test.app.project.id,
        })
      ).content,
    ).toContain("00:00:00,000 --> 00:00:00,800");
    expect(
      (
        await test.app.captions.readOutput(vtt.id, {
          projectId: test.app.project.id,
        })
      ).content,
    ).toContain("WEBVTT");
    const manifest = JSON.parse(
      await test.app.captions.readManifest(srt.id, {
        projectId: test.app.project.id,
      }),
    );
    expect(manifest.snapshot.clipBindings).toEqual(snapshot.clipBindings);
    expect(manifest.snapshot.compositionDuration).toBe(20);
    expect(manifest.snapshot.cues[0]).toMatchObject({
      clipId: "instance",
      assetId: "spoken",
      transcriptRevisionId: snapshot.sources[0]!.transcriptRevisionId,
    });
    const reopened = await OpenFilmApplication.openForExport(
      test.directory,
      test.runtime,
    );
    applications.add(reopened);
    const restored = await reopened.captions.get(snapshot.id, {
      projectId: reopened.project.id,
    });
    expect(restored.stale).toBe(false);
    expect(restored.cues).toEqual(snapshot.cues);
    expect(
      await reopened.captions.readPublication(srt.id, {
        projectId: reopened.project.id,
      }),
    ).toEqual(srt);
    expect(await entries(test.directory, "exports")).toEqual(
      expect.arrayContaining([`captions-${srt.id}`, `captions-${vtt.id}`]),
    );
  });

  it("rejects a different project, old composition revision, unknown options and unsafe IDs", async () => {
    const test = await fixture();
    await expect(
      test.app.captions.prepare({ ...test.input(), projectId: "another" }),
    ).rejects.toMatchObject({ code: "captions.stale" });
    await expect(
      test.app.captions.prepare({ ...test.input(), baseRevision: "obsolete" }),
    ).rejects.toMatchObject({ code: "captions.stale" });
    await expect(
      test.app.captions.prepare({ ...test.input(), unexpected: true } as never),
    ).rejects.toMatchObject({ code: "captions.invalid" });
    await expect(
      test.app.captions.get("../../project", {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.invalid" });
    const snapshot = await test.app.captions.prepare(test.input());
    await expect(
      test.app.captions.get(snapshot.id, {
        projectId: test.app.project.id,
        limit: 201,
      }),
    ).rejects.toMatchObject({ code: "captions.invalid" });
    await expect(
      test.app.captions.export(snapshot.id, "ass" as never, {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.invalid" });
  });

  it("marks changed composition stale and never publishes its old subtitle times", async () => {
    const test = await fixture();
    const snapshot = await test.app.captions.prepare(test.input());
    test.app.project.timelines[0]!.tracks[0]!.clips[0]!.timelineStart = 1;
    test.app.project.timelines[0]!.duration += 1;
    await test.app.save();
    const stale = await test.app.captions.get(snapshot.id, {
      projectId: test.app.project.id,
    });
    expect(stale.staleReasons).toContain("composition");
    expect(stale.exportable).toBe(false);
    await expect(
      test.app.captions.export(snapshot.id, "vtt", {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.stale" });
    expect(await entries(test.directory, "exports")).toEqual([]);
  });

  it("detects another process's project edit without refreshing or overwriting the current application", async () => {
    const test = await fixture();
    const snapshot = await test.app.captions.prepare(test.input());
    const durable = structuredClone(test.app.project);
    durable.timelines[0]!.tracks[0]!.clips[0]!.transform = { speed: 2 };
    durable.timelines[0]!.tracks[0]!.clips[0]!.timelineDuration = 10;
    durable.timelines[0]!.duration = 10;
    await fs.writeFile(
      join(test.directory, "project.json"),
      JSON.stringify(durable),
    );
    await expect(
      test.app.captions.export(snapshot.id, "srt", {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.stale" });
    expect(test.app.project.timelines[0]!.duration).toBe(20);
    expect(
      JSON.parse(
        await fs.readFile(join(test.directory, "project.json"), "utf8"),
      ),
    ).toEqual(durable);
  });

  it("an export session does not recover active jobs, rewrite project bytes or save an obsolete snapshot on close", async () => {
    const test = await fixture();
    const job = {
      id: "foreign-analysis",
      type: "transcribe" as const,
      status: "running" as const,
      progress: 0.4,
      createdAt: "2026-10-08T00:00:00Z",
      updatedAt: "2026-10-08T00:00:00Z",
      errors: [],
    };
    test.app.catalog.saveJob(job);
    const projectPath = join(test.directory, "project.json"),
      before = await fs.readFile(projectPath, "utf8");
    const exporter = await OpenFilmApplication.openForExport(
      test.directory,
      test.runtime,
    );
    expect(
      exporter.catalog.listJobs().find((item) => item.id === job.id),
    ).toEqual(job);
    const snapshot = await exporter.captions.prepare({
      ...test.input(),
      baseRevision: new TimelineEditor(exporter).get("film").revision,
    });
    await exporter.captions.export(snapshot.id, "srt", {
      projectId: exporter.project.id,
    });
    expect(await fs.readFile(projectPath, "utf8")).toBe(before);
    const durable = structuredClone(test.app.project);
    durable.timelines[0]!.tracks[0]!.clips[0]!.transform = { volume: 0.25 };
    const otherBytes = JSON.stringify(durable);
    await fs.writeFile(projectPath, otherBytes);
    exporter.close();
    expect(await fs.readFile(projectPath, "utf8")).toBe(otherBytes);
    expect(
      test.app.catalog.listJobs().find((item) => item.id === job.id),
    ).toEqual(job);
  });

  it("invalidates a snapshot when a corrected transcript changes", async () => {
    const test = await fixture();
    const snapshot = await test.app.captions.prepare(test.input());
    await test.app.transcriptEditor.edit("spoken", {
      baseRevision: snapshot.sources[0]!.transcriptRevisionId!,
      requestId: "later-edit",
      commands: [
        { type: "replace-text", segmentId: "segment-0", text: "New user text" },
      ],
    });
    expect(
      (
        await test.app.captions.get(snapshot.id, {
          projectId: test.app.project.id,
        })
      ).staleReasons,
    ).toContain("transcript");
    await expect(
      test.app.captions.export(snapshot.id, "srt", {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.stale" });
  });

  it("binds missing transcripts too, so newly available text requires regeneration", async () => {
    const test = await fixture(3, false);
    const snapshot = await test.app.captions.prepare(test.input());
    expect(snapshot.sources[0]!.transcriptRevisionId).toBeNull();
    expect(
      snapshot.issues.some((issue) => issue.code === "TRANSCRIPT_MISSING"),
    ).toBe(true);
    test.app.catalog.intelligence.replaceTranscript(test.document);
    expect(
      (
        await test.app.captions.get(snapshot.id, {
          projectId: test.app.project.id,
        })
      ).staleReasons,
    ).toContain("transcript");
  });

  it("checks source bytes again before export even when catalog metadata did not change", async () => {
    const test = await fixture();
    const snapshot = await test.app.captions.prepare(test.input());
    await fs.writeFile(test.source, "Changed spoken media bytes!!");
    expect(
      (
        await test.app.captions.get(snapshot.id, {
          projectId: test.app.project.id,
        })
      ).staleReasons,
    ).toContain("source");
    await expect(
      test.app.captions.export(snapshot.id, "srt", {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.stale" });
  });

  it("reports offline sources without changing their edits and invalidates when the file returns", async () => {
    const test = await fixture();
    await fs.rm(test.source);
    const snapshot = await test.app.captions.prepare(test.input());
    expect(snapshot.stale).toBe(false);
    expect(
      snapshot.issues.some((issue) => issue.code === "SOURCE_UNAVAILABLE"),
    ).toBe(true);
    expect(snapshot.cues).toEqual([]);
    expect(snapshot.sources[0]!.transcriptRevisionId).not.toBeNull();
    expect(
      (
        await test.app.captions.get(snapshot.id, {
          projectId: test.app.project.id,
        })
      ).stale,
    ).toBe(false);
    await fs.writeFile(test.source, test.bytes);
    expect(
      (
        await test.app.captions.get(snapshot.id, {
          projectId: test.app.project.id,
        })
      ).staleReasons,
    ).toContain("source");
  });

  it("captures pages from one immutable revision and rejects a concurrent revision change", async () => {
    const test = await fixture(450);
    const get = test.app.catalog.transcripts.get.bind(
      test.app.catalog.transcripts,
    );
    let changed = false;
    vi.spyOn(test.app.catalog.transcripts, "get").mockImplementation(
      (assetId, sourceHash, options = {}) => {
        const page = get(assetId, sourceHash, options);
        if (options.offset === 200 && !changed) {
          changed = true;
          test.app.catalog.transcripts.edit(assetId, sourceHash, {
            baseRevision: page.revision!,
            requestId: "concurrent-user",
            commands: [
              {
                type: "replace-text",
                segmentId: "segment-300",
                text: "Concurrent text",
              },
            ],
          });
        }
        return page;
      },
    );
    await expect(test.app.captions.prepare(test.input())).rejects.toMatchObject(
      { code: "captions.stale" },
    );
    expect(changed).toBe(true);
    expect(await entries(test.directory, "cache/captions")).toEqual([]);
    expect(
      (await test.app.transcriptEditor.get("spoken", { offset: 300, limit: 1 }))
        .document?.segments[0]!.text,
    ).toBe("Concurrent text");
  });

  it("rejects durable composition edits that land after source checks but before publication", async () => {
    const test = await fixture();
    const get = test.app.catalog.transcripts.get.bind(
      test.app.catalog.transcripts,
    );
    let changed = false;
    vi.spyOn(test.app.catalog.transcripts, "get").mockImplementation(
      (...args) => {
        const result = get(...args);
        if (!changed && args[2]?.limit === 200) {
          changed = true;
          const durable = structuredClone(test.app.project);
          durable.timelines[0]!.tracks[0]!.clips[0]!.transform = { volume: 0 };
          writeFileSync(
            join(test.directory, "project.json"),
            JSON.stringify(durable),
          );
        }
        return result;
      },
    );
    await expect(test.app.captions.prepare(test.input())).rejects.toMatchObject(
      { code: "captions.stale" },
    );
    expect(await entries(test.directory, "cache/captions")).toEqual([]);
  });

  it("returns bounded cue/issue pages for ten thousand segments and preserves their total counts", async () => {
    const test = await fixture(10_000);
    const get = vi.spyOn(test.app.catalog.transcripts, "get");
    const snapshot = await test.app.captions.prepare(test.input());
    expect(snapshot.cueCount).toBe(10_000);
    expect(snapshot.cues).toHaveLength(100);
    expect(get.mock.calls.every((call) => (call[2]?.limit ?? 200) <= 200)).toBe(
      true,
    );
    const later = await test.app.captions.get(snapshot.id, {
      projectId: test.app.project.id,
      offset: 9900,
      limit: 200,
      issueLimit: 1,
    });
    expect(later.cues).toHaveLength(100);
    expect(later.cues[0]!.segmentId).toBe("segment-9900");
    expect(JSON.stringify(later).length).toBeLessThan(200_000);
  }, 20_000);

  it("pages every source and clip binding independently even when export is blocked, including after reopen", async () => {
    const test = await fixture();
    const firstAsset = test.app.catalog.getAsset("spoken")!;
    const sourceIds = [
      "spoken",
      ...Array.from({ length: 204 }, (_, index) => `source-${index + 1}`),
    ];
    for (const assetId of sourceIds.slice(1)) {
      const path = join(test.root, `${assetId}.mp4`);
      await fs.copyFile(test.source, path);
      test.app.catalog.upsertAsset({
        ...firstAsset,
        id: assetId,
        uri: pathToFileURL(path).href,
        name: `${assetId}.mp4`,
      });
    }
    const clipAssetIds = [...sourceIds, "spoken", "spoken"];
    const composition = test.app.project.timelines[0]!;
    composition.duration = clipAssetIds.length * 3;
    composition.tracks[0]!.clips = clipAssetIds.map((assetId, index) => ({
      id: `instance-${index}`,
      assetId,
      sourceIn: 0,
      sourceOut: 3,
      timelineStart: index * 3,
      timelineDuration: 3,
      ...(index === 204 ? { transform: { speed: 2 } } : {}),
    }));
    await test.app.save();
    const snapshot = await test.app.captions.prepare(test.input());
    expect(snapshot).toMatchObject({
      sourceCount: 205,
      clipCount: 207,
      cueCount: 9,
      errorCount: 1,
      exportable: false,
      sourceOffset: 0,
      sourceLimit: 200,
      clipOffset: 0,
      clipLimit: 200,
    });
    expect(snapshot.sources).toHaveLength(200);
    expect(snapshot.clipBindings).toHaveLength(200);
    await expect(
      test.app.captions.export(snapshot.id, "vtt", {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.unavailable" });
    const options = {
      projectId: test.app.project.id,
      sourceOffset: 200,
      sourceLimit: 200,
      clipOffset: 200,
      clipLimit: 200,
      offset: 1,
      limit: 1,
      issueOffset: 1,
      issueLimit: 2,
    };
    const tail = await test.app.captions.get(snapshot.id, options);
    expect(tail).toMatchObject({
      ...options,
      sourceCount: 205,
      clipCount: 207,
      exportable: false,
    });
    expect(tail.sources.map((source) => source.assetId)).toEqual(
      sourceIds.slice(200),
    );
    expect(tail.clipBindings.map((clip) => clip.id)).toEqual(
      composition.tracks[0]!.clips.slice(200).map((clip) => clip.id),
    );
    expect(
      [...snapshot.sources, ...tail.sources].map((source) => source.assetId),
    ).toEqual(sourceIds);
    expect([...snapshot.clipBindings, ...tail.clipBindings]).toEqual(
      composition.tracks[0]!.clips,
    );
    expect(tail.cues).toEqual(snapshot.cues.slice(1, 2));
    expect(tail.issues).toEqual(snapshot.issues.slice(1, 3));
    const independent = await test.app.captions.get(snapshot.id, {
      ...options,
      sourceOffset: 201,
      sourceLimit: 1,
      clipOffset: 206,
      clipLimit: 1,
    });
    expect(independent.sources.map((source) => source.assetId)).toEqual([
      sourceIds[201],
    ]);
    expect(independent.clipBindings.map((clip) => clip.id)).toEqual([
      "instance-206",
    ]);
    expect(independent.cues).toEqual(tail.cues);
    expect(independent.issues).toEqual(tail.issues);
    test.app.close();
    applications.delete(test.app);
    const reopened = await OpenFilmApplication.openForExport(
      test.directory,
      test.runtime,
    );
    applications.add(reopened);
    expect(await reopened.captions.get(snapshot.id, options)).toEqual(tail);
    const pastEnd = await reopened.captions.get(snapshot.id, {
      ...options,
      sourceOffset: 205,
      clipOffset: 207,
    });
    expect(pastEnd.sources).toEqual([]);
    expect(pastEnd.clipBindings).toEqual([]);
    expect(pastEnd).toMatchObject({
      sourceCount: 205,
      clipCount: 207,
      sourceOffset: 205,
      clipOffset: 207,
    });
    expect(await entries(test.directory, "exports")).toEqual([]);
  }, 20_000);

  it.each(["sourceOffset", "sourceLimit", "clipOffset", "clipLimit"] as const)(
    "strictly validates independent provenance page bounds: %s",
    async (field) => {
      const test = await fixture();
      const snapshot = await test.app.captions.prepare(test.input());
      const invalidValues: unknown[] = [
        null,
        -1,
        0.5,
        NaN,
        Infinity,
        "1",
        true,
        {},
        Number.MAX_SAFE_INTEGER + 1,
      ];
      if (field.endsWith("Limit")) invalidValues.push(0, 201);
      for (const value of invalidValues) {
        await expect(
          test.app.captions.get(snapshot.id, {
            projectId: test.app.project.id,
            [field]: value,
          } as never),
        ).rejects.toMatchObject({ code: "captions.invalid" });
      }
      const boundary = await test.app.captions.get(snapshot.id, {
        projectId: test.app.project.id,
        [field]: field.endsWith("Limit") ? 200 : 0,
      });
      expect(boundary.sources).toHaveLength(1);
      expect(boundary.clipBindings).toHaveLength(1);
    },
  );

  it("cancels preparation and publication without successful-looking partial files, then permits retry", async () => {
    const test = await fixture();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      test.app.captions.prepare(test.input(), { signal: aborted.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const snapshot = await test.app.captions.prepare(test.input());
    const controller = new AbortController();
    const write = actualFs.writeFile;
    vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      const result = await write(...args);
      if (String(args[0]).endsWith("captions.srt")) controller.abort();
      return result;
    });
    await expect(
      test.app.captions.export(snapshot.id, "srt", {
        projectId: test.app.project.id,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await entries(test.directory, "exports")).toEqual([]);
    vi.restoreAllMocks();
    vi.mocked(fs.writeFile).mockImplementation(actualFs.writeFile);
    expect(
      await test.app.captions.export(snapshot.id, "srt", {
        projectId: test.app.project.id,
      }),
    ).toMatchObject({ cueCount: 3 });
  });

  it("removes a staged subtitle if manifest writing fails, without overwriting any source or older output", async () => {
    const test = await fixture();
    const snapshot = await test.app.captions.prepare(test.input());
    const prior = await test.app.captions.export(snapshot.id, "vtt", {
      projectId: test.app.project.id,
    });
    const write = actualFs.writeFile;
    vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("manifest.json"))
        throw new Error("Simulated disk write failure");
      return write(...args);
    });
    await expect(
      test.app.captions.export(snapshot.id, "srt", {
        projectId: test.app.project.id,
      }),
    ).rejects.toThrow("Simulated disk write failure");
    expect(await entries(test.directory, "exports")).toEqual([
      `captions-${prior.id}`,
    ]);
    expect(await fs.readFile(test.source, "utf8")).toBe(test.bytes);
    vi.restoreAllMocks();
    vi.mocked(fs.writeFile).mockImplementation(actualFs.writeFile);
    expect(
      (
        await test.app.captions.export(snapshot.id, "srt", {
          projectId: test.app.project.id,
        })
      ).id,
    ).not.toBe(prior.id);
  });

  it.each(["source", "transcript", "composition"] as const)(
    "rejects %s edits arriving after export freshness checks but before atomic publication",
    async (kind) => {
      const test = await fixture();
      const snapshot = await test.app.captions.prepare(test.input());
      let changed = false;
      vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
        const result = await actualFs.writeFile(...args);
        if (String(args[0]).endsWith("manifest.json") && !changed) {
          changed = true;
          if (kind === "source")
            writeFileSync(test.source, "Source changed during export.");
          if (kind === "transcript")
            test.app.catalog.transcripts.edit("spoken", test.sourceHash, {
              baseRevision: snapshot.sources[0]!.transcriptRevisionId!,
              requestId: "edit-during-export",
              commands: [
                {
                  type: "replace-text",
                  segmentId: "segment-0",
                  text: "Changed while writing",
                },
              ],
            });
          if (kind === "composition") {
            const next = structuredClone(test.app.project);
            next.timelines[0]!.tracks[0]!.clips[0]!.transform = { volume: 0 };
            writeFileSync(
              join(test.directory, "project.json"),
              JSON.stringify(next),
            );
          }
        }
        return result;
      });
      await expect(
        test.app.captions.export(snapshot.id, "vtt", {
          projectId: test.app.project.id,
        }),
      ).rejects.toMatchObject({ code: "captions.stale" });
      expect(changed).toBe(true);
      expect(await entries(test.directory, "exports")).toEqual([]);
    },
  );

  it("refuses linked storage and changed output receipts instead of following paths into original media", async () => {
    const test = await fixture();
    const snapshot = await test.app.captions.prepare(test.input());
    const publication = await test.app.captions.export(snapshot.id, "srt", {
      projectId: test.app.project.id,
    });
    const output = join(test.directory, publication.relativePath);
    await fs.writeFile(output, "corrupted");
    await expect(
      test.app.captions.readOutput(publication.id, {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.unavailable" });
    await fs.rm(output);
    await fs.symlink(test.source, output);
    await expect(
      test.app.captions.readOutput(publication.id, {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.failed" });
    await fs.rename(
      join(test.directory, "exports"),
      join(test.directory, "older-exports"),
    );
    await fs.symlink(test.root, join(test.directory, "exports"));
    await expect(
      test.app.captions.export(snapshot.id, "vtt", {
        projectId: test.app.project.id,
      }),
    ).rejects.toMatchObject({ code: "captions.failed" });
    expect(await fs.readFile(test.source, "utf8")).toBe(test.bytes);
  });
});

describe("caption preparation resource and output contracts", () => {
  it.each([
    "audibility",
    "mediaType",
    "duration",
    "previewBlocked",
    "name",
  ] as const)(
    "invalidates changed source %s even when media bytes and transcript revision are unchanged",
    async (kind) => {
      const test = await fixture();
      const snapshot = await test.app.captions.prepare(test.input());
      const projectBefore = await fs.readFile(
        join(test.directory, "project.json"),
        "utf8",
      );
      const asset = test.app.catalog.getAsset("spoken")!;
      if (kind === "audibility")
        asset.metadata["openfilm.ffprobe"] = {
          streams: [{ codec_type: "video" }],
        };
      if (kind === "mediaType") asset.mediaType = "audio";
      if (kind === "duration") asset.duration = 19;
      if (kind === "previewBlocked")
        asset.metadata["openfilm.preview"] = { supported: false };
      if (kind === "name") asset.name = "Renamed source.mp4";
      test.app.catalog.upsertAsset(asset);
      expect(await hashFile(test.source)).toBe(test.sourceHash);
      expect(
        test.app.catalog.transcripts.get("spoken", test.sourceHash).revision,
      ).toBe(snapshot.sources[0]!.transcriptRevisionId);
      const current = await test.app.captions.get(snapshot.id, {
        projectId: test.app.project.id,
      });
      expect(current.staleReasons).toContain("source");
      expect(current.exportable).toBe(false);
      await expect(
        test.app.captions.export(snapshot.id, "vtt", {
          projectId: test.app.project.id,
        }),
      ).rejects.toMatchObject({ code: "captions.stale" });
      expect(await entries(test.directory, "exports")).toEqual([]);
      expect(
        await fs.readFile(join(test.directory, "project.json"), "utf8"),
      ).toBe(projectBefore);
    },
  );

  it.each(["assetState", "frameRate"] as const)(
    "treats an intact legacy snapshot without %s binding as stale instead of assuming parity",
    async (binding) => {
      const test = await fixture();
      const snapshot = await test.app.captions.prepare(test.input());
      const path = join(
        test.directory,
        "cache",
        "captions",
        `${snapshot.id}.json`,
      );
      const stored = JSON.parse(await fs.readFile(path, "utf8"));
      if (binding === "assetState")
        delete stored.snapshot.sources[0].assetState;
      else delete stored.snapshot.frameRate;
      stored.digest = createHash("sha256")
        .update(JSON.stringify(stored.snapshot))
        .digest("hex");
      await fs.writeFile(path, JSON.stringify(stored));
      const current = await test.app.captions.get(snapshot.id, {
        projectId: test.app.project.id,
      });
      expect(current.staleReasons).toContain(
        binding === "assetState" ? "source" : "composition",
      );
      expect(current.exportable).toBe(false);
      await expect(
        test.app.captions.export(snapshot.id, "srt", {
          projectId: test.app.project.id,
        }),
      ).rejects.toMatchObject({ code: "captions.stale" });
    },
  );

  it("rejects an oversized track before hashing any source or reading transcript pages", async () => {
    const test = await fixture(1);
    const composition = test.app.project.timelines[0]!;
    const template = composition.tracks[0]!.clips[0]!;
    composition.tracks[0]!.clips = Array.from(
      { length: core.CAPTION_LIMITS.clips + 1 },
      (_, index) => ({ ...template, id: `instance-${index}` }),
    );
    await test.app.save();
    const hash = vi.spyOn(media, "hashFile");
    const readTranscript = vi.spyOn(test.app.catalog.transcripts, "get");
    await expect(test.app.captions.prepare(test.input())).rejects.toMatchObject(
      { code: "request.tooLarge" },
    );
    expect(hash).not.toHaveBeenCalled();
    expect(readTranscript).not.toHaveBeenCalled();
    expect(await entries(test.directory, "cache/captions")).toEqual([]);
  });

  it("counts UTF-8 bytes while loading each page and stops before fetching any page beyond 32 MiB", async () => {
    const test = await fixture(1);
    const get = test.app.catalog.transcripts.get.bind(
      test.app.catalog.transcripts,
    );
    const text = "青".repeat(20_000);
    expect(Buffer.byteLength(text, "utf8")).toBe(60_000);
    const read = vi
      .spyOn(test.app.catalog.transcripts, "get")
      .mockImplementation((assetId, sourceHash, options = {}) => {
        const actual = get(assetId, sourceHash, options);
        if (options.limit !== 200) return actual;
        const document = get(assetId, sourceHash, { limit: 1 }).document!;
        const offset = options.offset ?? 0;
        return {
          ...actual,
          total: 800,
          document: {
            ...document,
            segments: Array.from({ length: 200 }, (_, index) => ({
              id: `large-${offset + index}`,
              start: offset + index,
              end: offset + index + 0.5,
              text,
            })),
          },
        };
      });
    await expect(test.app.captions.prepare(test.input())).rejects.toMatchObject(
      { code: "request.tooLarge" },
    );
    // 200 * 60,000 bytes = 12 MB per page; the third exceeds 32 MiB.
    // UTF-16/code-point counting would incorrectly consume the fourth page.
    expect(
      read.mock.calls
        .filter((call) => call[2]?.limit === 200)
        .map((call) => call[2]?.offset ?? 0),
    ).toEqual([0, 200, 400]);
    expect(await entries(test.directory, "cache/captions")).toEqual([]);
  });

  it("retains only segment timing/text for the mapper while preserving provider word evidence in the catalog", async () => {
    const test = await fixture(205);
    const before = test.app.catalog.transcripts.get("spoken", test.sourceHash, {
      offset: 200,
      limit: 5,
    });
    expect(
      before.document!.segments.every((segment) => !!segment.words?.length),
    ).toBe(true);
    const mapper = vi.spyOn(core, "generateCompositionCaptions");
    const snapshot = await test.app.captions.prepare(test.input());
    expect(snapshot.cueCount).toBe(205);
    expect(mapper).toHaveBeenCalledOnce();
    const retained = mapper.mock.calls[0]![1][0]!.transcript!.segments;
    expect(retained).toHaveLength(205);
    expect(retained.every((segment) => segment.words === undefined)).toBe(true);
    expect(
      test.app.catalog.transcripts.get("spoken", test.sourceHash, {
        offset: 200,
        limit: 5,
      }),
    ).toEqual(before);
    expect(await hashFile(test.source)).toBe(test.sourceHash);
  });

  it.each(["memory", "durable"] as const)(
    "invalidates a changed %s project frame rate without changing the composition revision",
    async (location) => {
      const test = await fixture();
      const snapshot = await test.app.captions.prepare(test.input());
      expect(snapshot).toMatchObject({ frameRate: 30, outputDuration: 20 });
      const projectPath = join(test.directory, "project.json");
      const durableBefore = await fs.readFile(projectPath, "utf8");
      if (location === "memory") test.app.project.settings.frameRate = 24;
      else {
        const durable = JSON.parse(durableBefore);
        durable.settings.frameRate = 24;
        await fs.writeFile(projectPath, JSON.stringify(durable));
      }
      expect(test.input().baseRevision).toBe(snapshot.compositionRevision);
      const current = await test.app.captions.get(snapshot.id, {
        projectId: test.app.project.id,
      });
      expect(current.staleReasons).toContain("composition");
      expect(current.exportable).toBe(false);
      await expect(
        test.app.captions.export(snapshot.id, "vtt", {
          projectId: test.app.project.id,
        }),
      ).rejects.toMatchObject({ code: "captions.stale" });
      if (location === "memory")
        expect(await fs.readFile(projectPath, "utf8")).toBe(durableBefore);
      else expect(test.app.project.settings.frameRate).toBe(30);
    },
  );

  it("omits a spoken tail beyond the rendered frame boundary and binds the frame rate in the saved source record", async () => {
    const test = await fixture(1);
    test.app.catalog.intelligence.replaceTranscript({
      ...test.document,
      segments: [
        { id: "audible", start: 0, end: 0.5, text: "Heard in the film" },
        { id: "tail", start: 1, end: 1.01, text: "Beyond the rendered film" },
      ],
    });
    const composition = test.app.project.timelines[0]!;
    composition.duration = 1.01;
    composition.tracks[0]!.clips[0]!.sourceOut = 1.01;
    composition.tracks[0]!.clips[0]!.timelineDuration = 1.01;
    await test.app.save();
    const before = JSON.stringify(test.app.project);
    const snapshot = await test.app.captions.prepare(test.input());
    expect(snapshot).toMatchObject({ frameRate: 30, outputDuration: 1 });
    expect(snapshot.cues.map((cue) => cue.segmentId)).toEqual(["audible"]);
    expect(snapshot.cues.every((cue) => cue.endMs <= 1000)).toBe(true);
    const published = await test.app.captions.export(snapshot.id, "vtt", {
      projectId: test.app.project.id,
    });
    const output = await test.app.captions.readOutput(published.id, {
      projectId: test.app.project.id,
    });
    expect(output.content).not.toContain("Beyond the rendered film");
    const manifest = JSON.parse(
      await test.app.captions.readManifest(published.id, {
        projectId: test.app.project.id,
      }),
    );
    expect(manifest.snapshot).toMatchObject({
      frameRate: 30,
      outputDuration: 1,
    });
    expect(JSON.stringify(test.app.project)).toBe(before);
    expect(await hashFile(test.source)).toBe(test.sourceHash);
  });
});
