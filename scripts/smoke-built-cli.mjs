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
const commandWithEnvironment = async (environment, ...args) => {
  const { stdout } = await execute(
    process.execPath,
    [resolve("dist/cli/index.mjs"), ...args],
    { maxBuffer: 5 * 1024 * 1024, env: { ...process.env, ...environment } },
  );
  return JSON.parse(stdout);
};
const command = (...args) => commandWithEnvironment({}, ...args);
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
  // Exercise the bundled adapters after compilation, including sidecar shipping.
  // The explicit protocol fixture proves orchestration, never speech recognition.
  for (const app of ["cli", "server"])
    assert.ok((await stat(resolve(`dist/${app}/whisper_runner.py`))).size > 0);
  const video = listing.assets.find((asset) => asset.mediaType === "video");
  const savedBeforeIntelligence = JSON.parse(
    await readFile(join(project, "project.json"), "utf8"),
  );
  await assert.rejects(
    commandWithEnvironment(
      {
        OPENFILM_WHISPER_PYTHON: "python3",
        OPENFILM_WHISPER_RUNNER: resolve("dist/cli/whisper_runner.py"),
        OPENFILM_WHISPER_MODEL: join(root, "unavailable-model"),
      },
      "transcribe",
      video.id,
      "--project",
      project,
    ),
    (error) => {
      const { job } = JSON.parse(error.stdout);
      return (
        error.code === 1 &&
        job.status === "failed" &&
        job.errors?.[0]?.code === "transcription.modelInvalid"
      );
    },
  );
  const transcription = await commandWithEnvironment(
    {
      OPENFILM_WHISPER_PYTHON: "python3",
      OPENFILM_WHISPER_RUNNER: resolve("tests/fixtures/whisper-protocol.py"),
      OPENFILM_WHISPER_MODEL: resolve("tests/fixtures/whisper-model"),
      OPENFILM_WHISPER_FIXTURE_DELAY: "0",
    },
    "transcribe",
    video.id,
    "--project",
    project,
    "--language",
    "ja",
    "--execution",
    "cpu",
  );
  assert.equal(transcription.job.status, "completed");
  for (const operation of ["waveform", "scenes"]) {
    const result = await command(operation, video.id, "--project", project);
    assert.equal(result.job.status, "completed");
  }
  const { marker } = await command(
    "marker",
    video.id,
    "--project",
    project,
    "--time",
    "0.5",
  );
  const intelligence = await command(
    "transcript",
    video.id,
    "--project",
    project,
    "--offset",
    "1",
    "--limit",
    "1",
  );
  assert.equal(intelligence.transcript.language, "ja");
  assert.equal(intelligence.transcriptTotal, 2);
  assert.equal(intelligence.transcriptOffset, 1);
  assert.equal(intelligence.transcript.segments.length, 1);
  assert.ok(intelligence.transcript.segments[0].words.length);
  assert.equal(
    intelligence.transcript.provenance.providerVersion,
    "fixture-protocol/1",
  );
  assert.ok(intelligence.waveform.peaks.length);
  assert.ok(intelligence.scenes);
  assert.ok(intelligence.markers.some((item) => item.id === marker.id));
  const savedAfterIntelligence = JSON.parse(
    await readFile(join(project, "project.json"), "utf8"),
  );
  assert.deepEqual(
    savedAfterIntelligence.stories,
    savedBeforeIntelligence.stories,
  );
  assert.deepEqual(
    savedAfterIntelligence.compositions,
    savedBeforeIntelligence.compositions,
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
    "Built CLI: real import, Story, local FFmpeg waveform/scenes, paged protocol-fixture words/markers, missing-model failure, bounded playable MP4, exports and reopen passed; Story/composition and original hashes unchanged by intelligence. Protocol fixture is not ASR QA.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
