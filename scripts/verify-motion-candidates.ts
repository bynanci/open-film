// SPDX-License-Identifier: Apache-2.0
// Synthetic-only actual FFmpeg evidence. Never takes user photo input.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { hashFile, localPath, runProcess } from "@openfilm/media";
import { createMotionFixture } from "../tests/fixtures/motion-generation.js";
const output = resolve(process.argv[2] ?? "/tmp/openfilm-m8b-evidence");
await mkdir(output, { recursive: true });
const work = join(output, `work-${randomUUID()}`);
await mkdir(work);
const { app, editor, image } = await createMotionFixture(work);
try {
  const originalHash = await hashFile(localPath(image.uri));
  const receipts = await app.motionGeneration.preview({
    requestId: randomUUID(),
    projectId: app.project.id,
    compositionId: "film",
    clipId: "photo",
    baseRevision: editor.get("film").revision,
    providerId: "local-motion-fixture",
    count: 2,
    prompt: "Synthetic environment camera fixture",
    negativeConstraints: "No identity changes",
    consent: true,
    containsPeople: false,
  });
  const frames = (stdout: Buffer) =>
    stdout
      .toString()
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split(",").at(-1)!.trim());
  const candidates = [];
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]!,
      path = await app.motionGeneration.media(r.id);
    assert.equal(await hashFile(path), r.outputSha256);
    await copyFile(path, join(output, `candidate-${i + 1}.mp4`));
    const hashes = frames(
      (
        await runProcess("ffmpeg", [
          "-v",
          "error",
          "-i",
          path,
          "-f",
          "framemd5",
          "-",
        ])
      ).stdout,
    );
    assert.equal(hashes.length, 48);
    const order = [36, 0, 47, 12, 24];
    for (const frame of order) {
      const seek = frames(
        (
          await runProcess("ffmpeg", [
            "-v",
            "error",
            "-ss",
            String(frame / 12),
            "-i",
            path,
            "-frames:v",
            "1",
            "-f",
            "framemd5",
            "-",
          ])
        ).stdout,
      );
      assert.equal(seek[0], hashes[frame]);
    }
    for (const frame of [0, 12, 24, 36, 47])
      await runProcess("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(frame / 12),
        "-i",
        path,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-y",
        join(output, `candidate-${i + 1}-frame-${frame}.png`),
      ]);
    candidates.push({
      outputSha256: r.outputSha256,
      sourceSha256: r.sourceSha256,
      output: r.output,
      decodedFrames: hashes.length,
      sampledFrames: [0, 12, 24, 36, 47].map((frame) => ({
        frame,
        seconds: frame / 12,
        md5: hashes[frame],
      })),
      randomSeekOrder: order,
      randomSeekMatches: true,
    });
  }
  await app.motionGeneration.accept(receipts[0]!.id, true);
  await app.motionGeneration.importCandidate(receipts[0]!.id, editor);
  const rendered = await app.render("film");
  await copyFile(rendered, join(output, "adopted-film.mp4"));
  const probe = JSON.parse(
    (
      await runProcess("ffprobe", [
        "-v",
        "error",
        "-count_frames",
        "-show_entries",
        "stream=codec_type,nb_read_frames,width,height,avg_frame_rate:format=duration",
        "-of",
        "json",
        rendered,
      ])
    ).stdout.toString(),
  );
  assert.equal(
    probe.streams.find((s: { codec_type: string }) => s.codec_type === "video")
      .nb_read_frames,
    "48",
  );
  assert.ok(
    probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio"),
  );
  assert.equal(Number(probe.format.duration), 4);
  assert.equal(await hashFile(localPath(image.uri)), originalHash);
  await app.motionGeneration.clearPreviews();
  const evidence = {
    schema: 1,
    syntheticOnly: true,
    remoteCalls: 0,
    sourceSha256: originalHash,
    originalUnchanged: true,
    candidates,
    actualOutput: { sha256: await hashFile(rendered), probe },
    manualReview: [
      "identity/detail deformation",
      "color appearance",
      "native workstation",
      "paid remote API terms/cost/retention not run",
    ],
  };
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await app.motionGeneration.dispose();
  app.close();
  await rm(work, { recursive: true, force: true });
}
