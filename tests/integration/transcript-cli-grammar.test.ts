import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";

const actionIds = [
  "edit",
  "search",
  "revisions",
  "undo",
  "redo",
  "select",
  "get",
];
let buildDirectory: string, cliPath: string;
const cleanups: (() => unknown | Promise<unknown>)[] = [];

beforeAll(async () => {
  buildDirectory = await mkdtemp(join(tmpdir(), "openfilm-built-cli-grammar-"));
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
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-cli-transcript-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const projectDirectory = join(directory, "film.openfilm");
  const userDataDirectory = join(directory, "user-data");
  const app = await OpenFilmApplication.create(
    projectDirectory,
    "CLI grammar",
    {},
    { userDataDirectory },
  );
  const revisions: Record<string, string> = {};
  try {
    for (const id of [...actionIds, "訪問 # & media"]) {
      const path = join(directory, `${id}.wav`);
      await writeFile(path, `Identity-only fixture for ${id}; not ASR.`);
      const sourceHash = await hashFile(path);
      app.catalog.upsertAsset({
        id,
        uri: pathToFileURL(path).href,
        name: `${id}.wav`,
        mediaType: "audio",
        duration: 2,
        contentHash: sourceHash,
        tags: [],
        state: {},
        metadata: {},
      });
      app.catalog.intelligence.replaceTranscript({
        id: `initial-${id}`,
        assetId: id,
        language: "en",
        provenance: {
          providerId: "cli-grammar-fixture",
          model: "identity-not-asr",
          version: "1",
          sourceHash,
          createdAt: new Date().toISOString(),
        },
        segments: [
          { id: "first", start: 0, end: 1, text: `First ${id}` },
          { id: "second", start: 1, end: 2, text: `Second ${id}` },
        ],
      });
      revisions[id] = (await app.transcriptEditor.get(id)).revision!;
    }
  } finally {
    app.close();
  }
  const run = (args: string[]) =>
    runProcess(process.execPath, [
      cliPath,
      ...args,
      "--project",
      projectDirectory,
      "--user-data-dir",
      userDataDirectory,
    ]);
  const cli = async (args: string[]) =>
    JSON.parse((await run(args)).stdout.toString());
  return { directory, revisions, cli, run };
}

describe("built transcript CLI grammar", () => {
  it.each(actionIds)(
    "explicit get reads and pages the valid asset ID %s instead of treating it as an action",
    async (assetId) => {
      const { cli } = await fixture();
      const result = await cli([
        "transcript",
        "get",
        assetId,
        "--offset",
        "1",
        "--limit",
        "1",
      ]);
      expect(result.transcript.assetId).toBe(assetId);
      expect(result.transcriptTotal).toBe(2);
      expect(result.transcriptOffset).toBe(1);
      expect(result.transcript.segments).toEqual([
        expect.objectContaining({ id: "second", text: `Second ${assetId}` }),
      ]);
    },
  );

  it("preserves the non-action shorthand and explicit get for Unicode, spaces and punctuation", async () => {
    const { cli } = await fixture();
    const assetId = "訪問 # & media";
    const shorthand = await cli(["transcript", assetId]);
    expect(shorthand.transcript.assetId).toBe(assetId);
    expect(await cli(["transcript", "get", assetId])).toEqual(shorthand);
  });

  it("keeps edit, search, revisions, undo, redo and select unambiguous for a reserved asset ID", async () => {
    const { directory, cli, revisions } = await fixture();
    const assetId = "edit";
    const commands = join(directory, "commands.json");
    await writeFile(
      commands,
      JSON.stringify({
        baseRevision: revisions[assetId],
        requestId: "cli-edit",
        commands: [
          {
            type: "replace-text",
            segmentId: "first",
            text: "Corrected memory",
          },
        ],
      }),
    );
    const edited = await cli([
      "transcript",
      "edit",
      assetId,
      "--commands",
      commands,
    ]);
    expect(edited.document.segments[0].text).toBe("Corrected memory");
    expect(
      (
        await cli([
          "transcript",
          "search",
          assetId,
          "--query",
          "Corrected memory",
        ])
      ).totalMatches,
    ).toBe(1);
    const history = await cli(["transcript", "revisions", assetId]);
    expect(history.total).toBe(2);
    const undone = await cli([
      "transcript",
      "undo",
      assetId,
      "--base-revision",
      edited.revision,
      "--request-id",
      "cli-undo",
    ]);
    expect(undone.document.segments[0].text).toBe("First edit");
    const redone = await cli([
      "transcript",
      "redo",
      assetId,
      "--base-revision",
      undone.revision,
      "--request-id",
      "cli-redo",
    ]);
    expect(redone.document.segments[0].text).toBe("Corrected memory");
    const selected = await cli([
      "transcript",
      "select",
      assetId,
      "--base-revision",
      redone.revision,
      "--request-id",
      "cli-select",
      "--revision",
      revisions[assetId]!,
    ]);
    expect(selected.document.segments[0].text).toBe("First edit");
  });

  it("does not reinterpret incomplete existing actions as asset reads", async () => {
    const { run } = await fixture();
    for (const action of actionIds.filter((id) => id !== "get"))
      await expect(run(["transcript", action])).rejects.toThrow(
        "Specify a media asset ID.",
      );
  });
});
