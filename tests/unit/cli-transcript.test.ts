import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";

type EditorState = Awaited<
  ReturnType<OpenFilmApplication["transcriptEditor"]["get"]>
>;
type ReadState = EditorState &
  Awaited<ReturnType<OpenFilmApplication["intelligence"]["read"]>>;

const opaqueSegmentId = `provider\u0000/${"原".repeat(300)}\ud800`;
let buildDirectory: string, cliPath: string;
const fixtureDirectories: string[] = [];

beforeAll(async () => {
  buildDirectory = await mkdtemp(
    join(tmpdir(), "openfilm-cli-revision-build-"),
  );
  cliPath = join(buildDirectory, "openfilm.mjs");
  await build({
    entryPoints: [resolve("apps/cli/src/index.ts")],
    outfile: cliPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
  });
});
afterAll(() => rm(buildDirectory, { recursive: true, force: true }));
afterEach(async () => {
  for (const directory of fixtureDirectories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(assetId: string, transcribed = true) {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-cli-revision-"));
  fixtureDirectories.push(directory);
  const projectDirectory = join(directory, "film.openfilm");
  const userDataDirectory = join(directory, "user-data");
  const sourcePath = join(directory, "source.wav");
  // Identity-only source: this regression tests editing persisted provider evidence,
  // not recognition or decoding, and never configures a transcription provider.
  await writeFile(sourcePath, "Original source bytes remain unchanged.");
  const sourceHash = await hashFile(sourcePath);
  const app = await OpenFilmApplication.create(
    projectDirectory,
    "Headless transcript editing",
    {},
    { userDataDirectory },
  );
  let marker;
  try {
    app.catalog.upsertAsset({
      id: assetId,
      uri: pathToFileURL(sourcePath).href,
      name: "source.wav",
      mediaType: "audio",
      duration: 2,
      contentHash: sourceHash,
      tags: [],
      state: {},
      metadata: {},
    });
    if (transcribed)
      app.catalog.intelligence.replaceTranscript({
        id: "persisted-provider-result",
        assetId,
        language: "en",
        provenance: {
          providerId: "cli-revision-fixture",
          model: "identity-not-asr",
          version: "1",
          sourceHash,
          createdAt: new Date().toISOString(),
        },
        segments: [
          { id: opaqueSegmentId, start: 0, end: 1, text: "Original words" },
          { id: "second", start: 1, end: 2, text: "Later words" },
        ],
      });
    marker = await app.intelligence.addMarker(assetId, 0.5, "Remember this");
  } finally {
    app.close();
  }
  const cli = async <T = ReadState>(args: string[]): Promise<T> =>
    JSON.parse(
      (
        await runProcess(process.execPath, [
          cliPath,
          ...args,
          "--project",
          projectDirectory,
          "--user-data-dir",
          userDataDirectory,
        ])
      ).stdout.toString("utf8"),
    ) as T;
  return {
    directory,
    projectDirectory,
    userDataDirectory,
    sourcePath,
    sourceHash,
    marker,
    cli,
  };
}

describe("bundled CLI transcript read revisions", () => {
  it.each([
    { label: "canonical reserved asset", assetId: "edit", canonical: true },
    { label: "legacy shorthand", assetId: "訪問 # & media", canonical: false },
  ])(
    "$label supplies the current revision for edit, undo, redo and reopen",
    async ({ assetId, canonical }) => {
      const setup = await fixture(assetId);
      const readArgs = canonical
        ? ["transcript", "get", assetId]
        : ["transcript", assetId];
      const initial = await setup.cli(readArgs);
      expect(initial.revision).toEqual(expect.any(String));
      expect(initial.revisionInfo?.id).toBe(initial.revision);
      expect(initial.document?.segments[0]?.id).toBe(opaqueSegmentId);
      expect(initial.transcript).toEqual(initial.document);
      expect(initial).toMatchObject({
        total: 2,
        offset: 0,
        limit: 100,
        transcriptTotal: 2,
        transcriptOffset: 0,
        canUndo: false,
        canRedo: false,
        sourceHash: setup.sourceHash,
        markers: [setup.marker],
      });

      const commandsPath = join(setup.directory, "commands.json");
      await writeFile(
        commandsPath,
        JSON.stringify({
          baseRevision: initial.revision,
          requestId: "headless-edit",
          commands: [
            {
              type: "replace-text",
              segmentId: initial.document!.segments[0]!.id,
              text: "Corrected words",
            },
          ],
        }),
      );
      const edited = await setup.cli<EditorState>([
        "transcript",
        "edit",
        assetId,
        "--commands",
        commandsPath,
      ]);
      const afterEdit = await setup.cli(readArgs);
      expect(afterEdit.revision).toBe(edited.revision);
      expect(afterEdit.revision).not.toBe(initial.revision);
      expect(afterEdit.transcript?.segments[0]).toMatchObject({
        id: opaqueSegmentId,
        text: "Corrected words",
      });
      expect(afterEdit.canUndo).toBe(true);

      const undone = await setup.cli<EditorState>([
        "transcript",
        "undo",
        assetId,
        "--base-revision",
        afterEdit.revision!,
        "--request-id",
        "headless-undo",
      ]);
      const afterUndo = await setup.cli(readArgs);
      expect(afterUndo.revision).toBe(undone.revision);
      expect(afterUndo.document?.segments[0]?.text).toBe("Original words");
      expect(afterUndo.canRedo).toBe(true);
      const redone = await setup.cli<EditorState>([
        "transcript",
        "redo",
        assetId,
        "--base-revision",
        afterUndo.revision!,
        "--request-id",
        "headless-redo",
      ]);
      const afterRedo = await setup.cli(readArgs);
      expect(afterRedo.revision).toBe(redone.revision);
      expect(afterRedo.document?.segments[0]).toMatchObject({
        id: opaqueSegmentId,
        text: "Corrected words",
      });

      const reopened = await OpenFilmApplication.open(setup.projectDirectory, {
        userDataDirectory: setup.userDataDirectory,
      });
      try {
        const persisted = await reopened.transcriptEditor.get(assetId);
        expect(persisted.revision).toBe(afterRedo.revision);
        expect(persisted.document).toEqual(afterRedo.document);
      } finally {
        reopened.close();
      }
      expect(await readFile(setup.sourcePath, "utf8")).toBe(
        "Original source bytes remain unchanged.",
      );
    },
  );

  it("pages editor state and legacy aliases from the same revision", async () => {
    const { cli } = await fixture("speech");
    const current = await cli(["transcript", "get", "speech"]);
    const page = await cli([
      "transcript",
      "get",
      "speech",
      "--offset",
      "1",
      "--limit",
      "1",
    ]);
    expect(page.revision).toBe(current.revision);
    expect(page).toMatchObject({
      total: 2,
      offset: 1,
      limit: 1,
      transcriptTotal: 2,
      transcriptOffset: 1,
    });
    expect(page.document?.segments).toEqual([
      expect.objectContaining({ id: "second", text: "Later words" }),
    ]);
    expect(page.transcript).toEqual(page.document);
  });

  it("reports empty editable state without inventing a revision before transcription", async () => {
    const { cli, marker } = await fixture("speech", false);
    expect(await cli(["transcript", "get", "speech"])).toEqual({
      sourceHash: expect.any(String),
      total: 0,
      offset: 0,
      limit: 100,
      transcriptTotal: 0,
      transcriptOffset: 0,
      canUndo: false,
      canRedo: false,
      markers: [marker],
    });
  });
});
