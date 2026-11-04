// SPDX-License-Identifier: Apache-2.0
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OpenFilmApplication,
  TimelineEditor,
  type SilenceReviewEnvelope,
} from "@openfilm/application";
import { hashFile, runProcess } from "@openfilm/media";

let root: string;
let cliPath: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-silence-cli-"));
  cliPath = join(root, "openfilm.mjs");
  await build({
    entryPoints: [resolve("apps/cli/src/index.ts")],
    outfile: cliPath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["koffi"],
  });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reviewed silence CLI", () => {
  it("round-trips pure JSON between separate preview/apply processes and persists only confirmed changes", async () => {
    const source = join(root, "interview.mkv");
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=96x64:r=25:d=5",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(between(t\\,1\\,2)+between(t\\,3\\,4)\\,0\\,0.5):s=48000:d=5",
      "-c:v",
      "ffv1",
      "-c:a",
      "pcm_s16le",
      "-threads",
      "1",
      "-y",
      source,
    ]);
    const sourceHash = await hashFile(source);
    const project = join(root, "film.openfilm");
    const app = await OpenFilmApplication.create(project, "Silence CLI");
    app.catalog.upsertAsset({
      id: "interview",
      name: "interview.mkv",
      uri: pathToFileURL(source).href,
      mediaType: "video",
      duration: 5,
      contentHash: sourceHash,
      tags: [],
      state: {},
      metadata: {},
    });
    const story = app.generateStory({
      title: "Review",
      assetIds: ["interview"],
      targetDuration: 5,
      maxDuration: 10,
    });
    const composed = app.compose(story.id);
    const composition = app.project.timelines.find(
      (item) => item.id === composed.id,
    )!;
    composition.duration = 5;
    composition.tracks = [
      {
        id: "video",
        type: "video",
        clips: [
          {
            id: "main-clip",
            assetId: "interview",
            timelineStart: 0,
            timelineDuration: 5,
            sourceIn: 0,
            sourceOut: 5,
          },
        ],
      },
    ];
    await app.save();
    const baseRevision = new TimelineEditor(app).get(composition.id).revision;
    app.close();
    const cli = (...args: string[]) =>
      runProcess(process.execPath, [
        cliPath,
        ...args,
        "--project",
        project,
        "--user-data-dir",
        join(root, "user-data"),
      ]);

    const preview = await cli(
      "silence",
      "preview",
      "interview",
      "--composition",
      composition.id,
    );
    const review = JSON.parse(
      preview.stdout.toString("utf8"),
    ) as SilenceReviewEnvelope;
    expect(review.proposal.baseRevision).toBe(baseRevision);
    expect(review.proposal.totalDurationReduced).toBeCloseTo(1.52, 4);
    expect(review.proposal.sourceIntervals).toEqual([
      { start: 1.12, end: 1.88 },
      { start: 3.12, end: 3.88 },
    ]);
    expect(preview.stderr).toContain("silence.analysis.progress");
    const reviewFile = join(root, "review.json");
    await writeFile(reviewFile, preview.stdout);
    await expect(
      cli("silence", "apply", "--review", reviewFile),
    ).rejects.toThrow("--confirm");
    const untouched = await OpenFilmApplication.open(project);
    expect(new TimelineEditor(untouched).get(composition.id).revision).toBe(
      baseRevision,
    );
    untouched.close();

    const tampered = structuredClone(review);
    tampered.proposal.paddingSeconds = 0.2;
    const tamperedFile = join(root, "tampered.json");
    await writeFile(tamperedFile, JSON.stringify(tampered));
    await expect(
      cli("silence", "apply", "--review", tamperedFile, "--confirm"),
    ).rejects.toThrow();
    const applied = JSON.parse(
      (
        await cli("silence", "apply", "--review", reviewFile, "--confirm")
      ).stdout.toString("utf8"),
    );
    expect(applied.revision).not.toBe(baseRevision);
    expect(applied.composition.duration).toBeCloseTo(3.48, 4);
    expect(applied.composition.tracks[0].clips).toHaveLength(3);
    await expect(
      cli("silence", "apply", "--review", reviewFile, "--confirm"),
    ).rejects.toThrow();
    const reopened = await OpenFilmApplication.open(project);
    expect(
      new TimelineEditor(reopened).get(composition.id).composition.duration,
    ).toBeCloseTo(3.48, 4);
    reopened.close();
    expect(await hashFile(source)).toBe(sourceHash);
  });
});
