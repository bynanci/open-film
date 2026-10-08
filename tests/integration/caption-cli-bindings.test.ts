import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  OpenFilmApplication,
  type CaptionSnapshotPage,
} from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

async function fixture(assetCount: number) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-caption-cli-bindings-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "影片 # &.openfilm");
  const userDataDirectory = join(root, "user-data");
  const app = await OpenFilmApplication.create(
    directory,
    "Binding pages",
    {},
    { userDataDirectory },
  );
  const hashes: string[] = [];
  try {
    for (let index = 0; index < assetCount; index++) {
      const source = join(root, `spoken-${index}.wav`);
      await writeFile(
        source,
        `Identity fixture ${index}; not an ASR quality claim.`,
      );
      const sourceHash = await hashFile(source);
      hashes.push(sourceHash);
      const assetId = `asset-${index}`;
      app.catalog.upsertAsset({
        id: assetId,
        uri: pathToFileURL(source).href,
        name: `spoken-${index}.wav`,
        mediaType: "audio",
        duration: 1,
        contentHash: sourceHash,
        tags: [],
        state: {},
        metadata: {},
      });
      app.catalog.intelligence.replaceTranscript({
        id: `transcript-${index}`,
        assetId,
        language: "en",
        provenance: {
          providerId: "fixture-not-asr",
          version: "1",
          sourceHash,
          createdAt: "2026-10-08T00:00:00Z",
        },
        segments: [
          { id: `segment-${index}`, start: 0, end: 1, text: `Memory ${index}` },
        ],
      });
    }
    app.project.stories = [{ id: "story", title: "Memories", beats: [] }];
    app.project.timelines = [
      {
        id: "film",
        storyId: "story",
        duration: assetCount,
        tracks: [
          {
            id: "voice",
            type: "audio",
            clips: Array.from({ length: assetCount }, (_, index) => ({
              id: `clip-${index}`,
              assetId: `asset-${index}`,
              sourceIn: 0,
              sourceOut: 1,
              timelineStart: index,
              timelineDuration: 1,
              // Structurally valid legacy edit, but its selected range disagrees with speed.
              // Caption export must be blocked without hiding later provenance bindings.
              ...(index === 0 ? { transform: { speed: 2 } } : {}),
            })),
          },
        ],
      },
    ];
    await app.save();
  } finally {
    app.close();
  }
  const projectBefore = await readFile(join(directory, "project.json"), "utf8");
  const cli = (...args: string[]) =>
    runProcess(process.execPath, [
      "--import",
      "tsx",
      resolve("apps/cli/src/index.ts"),
      "captions",
      ...args,
      "--project",
      directory,
      "--user-data-dir",
      userDataDirectory,
    ]);
  const prepared = JSON.parse(
    (
      await cli("prepare", "--composition", "film", "--track", "voice")
    ).stdout.toString("utf8"),
  ) as CaptionSnapshotPage;
  const get = async (...args: string[]) =>
    JSON.parse(
      (await cli("get", prepared.id, ...args)).stdout.toString("utf8"),
    ) as CaptionSnapshotPage;
  return { directory, cli, get, prepared, projectBefore, hashes };
}

it("CLI retrieves every source and clip binding beyond 200 even when caption export is blocked", async () => {
  const f = await fixture(205);
  expect(f.prepared.exportable).toBe(false);
  expect(f.prepared.errorCount).toBe(1);
  expect(f.prepared.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "TIMING_UNSUPPORTED",
        clipId: "clip-0",
        severity: "error",
      }),
    ]),
  );
  expect(f.prepared.sourceCount).toBe(205);
  expect(f.prepared.clipCount).toBe(205);
  expect(f.prepared.sources).toHaveLength(200);
  expect(f.prepared.clipBindings).toHaveLength(200);
  await expect(
    f.cli("export", f.prepared.id, "--format", "vtt"),
  ).rejects.toThrow("captions.unavailable");

  const later = await f.get(
    "--source-offset",
    "200",
    "--source-limit",
    "5",
    "--clip-offset",
    "200",
    "--clip-limit",
    "5",
    "--offset",
    "2",
    "--limit",
    "1",
    "--issue-offset",
    "0",
    "--issue-limit",
    "1",
  );
  expect(later).toMatchObject({
    sourceOffset: 200,
    sourceLimit: 5,
    clipOffset: 200,
    clipLimit: 5,
    sourceCount: 205,
    clipCount: 205,
    offset: 2,
    limit: 1,
    issueOffset: 0,
    issueLimit: 1,
    exportable: false,
  });
  expect(later.cues).toHaveLength(1);
  expect(later.issues).toHaveLength(1);
  expect(
    [...f.prepared.sources, ...later.sources].map((source) => source.assetId),
  ).toEqual(Array.from({ length: 205 }, (_, index) => `asset-${index}`));
  expect(
    [...f.prepared.clipBindings, ...later.clipBindings].map((clip) => clip.id),
  ).toEqual(Array.from({ length: 205 }, (_, index) => `clip-${index}`));
  for (const [index, source] of later.sources.entries()) {
    expect(source).toMatchObject({
      sourceHash: f.hashes[200 + index],
      available: true,
      transcriptId: `transcript-${200 + index}`,
    });
    expect(source.transcriptRevisionId).toEqual(expect.any(String));
  }
  const independent = await f.get(
    "--source-offset",
    "204",
    "--source-limit",
    "1",
    "--clip-offset",
    "201",
    "--clip-limit",
    "2",
  );
  expect(independent.sources.map((source) => source.assetId)).toEqual([
    "asset-204",
  ]);
  expect(independent.clipBindings.map((clip) => clip.id)).toEqual([
    "clip-201",
    "clip-202",
  ]);
  const defaults = await f.get();
  expect(defaults).toMatchObject({
    sourceOffset: 0,
    sourceLimit: 200,
    clipOffset: 0,
    clipLimit: 200,
  });
  expect(defaults.sources).toHaveLength(200);
  expect(defaults.clipBindings).toHaveLength(200);
  expect(await readFile(join(f.directory, "project.json"), "utf8")).toBe(
    f.projectBefore,
  );
});

it("CLI documents provenance options and rejects invalid numeric bounds through the shared application contract", async () => {
  const f = await fixture(1);
  const help = (await f.cli("--help")).stdout.toString("utf8");
  for (const option of [
    "--source-offset",
    "--source-limit",
    "--clip-offset",
    "--clip-limit",
  ])
    expect(help).toContain(option);
  for (const [option, invalid] of [
    ["--source-offset", "-1"],
    ["--source-offset", "0.5"],
    ["--source-offset", "invalid"],
    ["--source-limit", "0"],
    ["--source-limit", "201"],
    ["--source-limit", "Infinity"],
    ["--clip-offset", "-1"],
    ["--clip-offset", "0.5"],
    ["--clip-offset", "invalid"],
    ["--clip-limit", "0"],
    ["--clip-limit", "201"],
    ["--clip-limit", "Infinity"],
  ] as const)
    await expect(f.cli("get", f.prepared.id, option, invalid)).rejects.toThrow(
      "captions.invalid",
    );
});
