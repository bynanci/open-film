import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { generateSampleMedia } from "../fixtures/sample-media/generate.mjs";

const root = await mkdtemp(join(tmpdir(), "openfilm-built-cli-"));
const project = join(root, "Jo's film.openfilm");
const execute = promisify(execFile);
const command = async (...args) => {
  const { stdout } = await execute(
    process.execPath,
    [resolve("dist/cli/index.mjs"), ...args],
    { maxBuffer: 5 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
};
const digest = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
try {
  const originals = await generateSampleMedia(join(root, "media"));
  const before = await Promise.all(originals.map(digest));
  await command("create", project, "--title", "Built CLI integration");
  const imported = await command(
    "import",
    join(root, "media"),
    "--project",
    project,
  );
  assert.equal(imported.imported, 5);
  assert.equal(imported.failed, 0);
  await assert.rejects(
    command("import", join(root, "missing-folder"), "--project", project),
    (error) =>
      error.code === 1 && JSON.parse(error.stdout).job.status === "failed",
  );
  const listing = await command("list", "--project", project);
  assert.equal(listing.total, 5);
  const first = listing.assets.find((asset) => asset.mediaType === "image");
  await command(
    "rate",
    first.id,
    "--project",
    project,
    "--favorite",
    "--lock",
    "--rating",
    "5",
  );
  const analyzed = await command("analyze", "--project", project);
  assert.ok(analyzed.events.length);
  const generated = await command(
    "story",
    "generate",
    "--project",
    project,
    "--template",
    "proposal-film",
    "--target",
    "12",
    "--max",
    "15",
  );
  assert.equal(generated.story.beats.length, 9);
  const composed = await command("compose", "--project", project);
  assert.ok(composed.composition.duration <= 15);
  assert.ok(
    composed.composition.tracks
      .flatMap((track) => track.clips)
      .some((clip) => clip.assetId === first.id),
  );
  const rendered = await command("render", "--project", project);
  assert.ok((await stat(rendered.path)).size > 0);
  const { stdout } = await execute("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    rendered.path,
  ]);
  const probe = JSON.parse(stdout);
  assert.ok(Number(probe.format.duration) <= 15.00001);
  assert.ok(probe.streams.some((stream) => stream.codec_type === "video"));
  for (const format of ["json", "otio", "fcpxml"]) {
    const exported = await command(
      "export",
      "--project",
      project,
      "--format",
      format,
    );
    assert.ok((await stat(exported.path)).size > 0);
  }
  const reopened = await command("list", "--project", project);
  assert.equal(
    reopened.assets.find((asset) => asset.id === first.id).rating,
    5,
  );
  assert.deepEqual(await Promise.all(originals.map(digest)), before);
  console.log(
    "Built CLI: real EXIF/SQLite import, ranking, nine-beat template, locked composition, bounded playable MP4, editable exports and reopen passed; original hashes unchanged.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
