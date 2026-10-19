import { access, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "../src/index.js";

const projects: string[] = [];
const applications: OpenFilmApplication[] = [];
afterEach(async () => {
  for (const app of applications.splice(0)) app.close();
  await Promise.all(
    projects
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(color: string) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-visual-qa-"));
  projects.push(root);
  const source = join(root, "synthetic.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=96x54:d=1`,
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-update",
    "1",
    "-y",
    source,
  ]);
  const asset = await inspectMedia({
    path: source,
    uri: pathToFileURL(source).href,
    name: "synthetic.png",
  });
  const app = await OpenFilmApplication.create(
    join(root, "film.openfilm"),
    "Synthetic QA",
  );
  applications.push(app);
  app.project.settings = { width: 160, height: 90, frameRate: 8 };
  app.catalog.upsertAsset(asset);
  const story = app.generateStory({
    title: "Synthetic scene",
    template: "blank",
    assetIds: [asset.id],
    targetDuration: 1,
    maxDuration: 2,
  });
  const composition = app.compose(story.id);
  await app.save();
  return { app, asset, composition, source };
}

describe("saved-composition Visual QA", () => {
  it("does not create project-cache directories while polling a pending report", async () => {
    const { app } = await fixture("0x27a6c8");
    const id = randomUUID();

    expect(await app.readVisualQaReport(id)).toBeUndefined();
    expect(await app.visualQaFramePath(id, 0)).toBeUndefined();
    await expect(
      access(join(app.directory, "cache", "visual-qa", id)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("renders a real MP4, verifies decoded timestamped frames and source hashes", async () => {
    const { app, asset, composition, source } = await fixture("0x27a6c8");
    const sourceHash = await hashFile(source);
    const report = await app.runVisualQa(composition.id);

    expect(report.status).toBe("complete");
    expect(report.compositionId).toBe(composition.id);
    expect(report.compositionRevision).toMatch(/^[a-f\d]{64}$/u);
    expect(report.output?.sha256).toMatch(/^[a-f\d]{64}$/u);
    expect(report.sources).toEqual([{ assetId: asset.id, sha256: sourceHash }]);
    expect(report.samples.length).toBeGreaterThan(0);
    expect(await hashFile(source)).toBe(sourceHash);
    expect(report.output).toBeDefined();
    const outputHash = report.output!.sha256;

    const render = join(
      app.directory,
      "cache",
      "visual-qa",
      report.id,
      "render.mp4",
    );
    const probe = await runProcess("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=codec_name,width,height,avg_frame_rate,nb_read_frames",
      "-of",
      "json",
      render,
    ]);
    const stream = (
      JSON.parse(probe.stdout.toString("utf8")) as {
        streams: {
          codec_name: string;
          width: number;
          height: number;
          avg_frame_rate: string;
          nb_read_frames: string;
        }[];
      }
    ).streams[0]!;
    expect(stream.codec_name).toBe("h264");
    expect(stream.width).toBe(160);
    expect(stream.height).toBe(90);
    expect(stream.avg_frame_rate).toBe("8/1");
    expect(Number(stream.nb_read_frames)).toBeGreaterThan(0);
    expect(report.output?.frameCount).toBe(Number(stream.nb_read_frames));
    expect(await hashFile(render)).toBe(outputHash);

    for (const sample of report.samples) {
      expect(sample.timestamp).toBeCloseTo(sample.frameIndex / 8, 8);
      const frame = await app.visualQaFramePath(report.id, sample.index);
      if (!frame) throw new Error("Expected a readable Visual QA frame");
      expect(await hashFile(frame)).toBe(sample.sha256);
      const decoded = await runProcess("ffmpeg", [
        "-v",
        "error",
        "-i",
        frame,
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
      ]);
      expect(decoded.stdout.length).toBe(0);
    }
  }, 60000);

  it("reports legal black as manual review, never as a render error", async () => {
    const { app, composition } = await fixture("black");
    const report = await app.runVisualQa(composition.id);

    expect(report.status).toBe("complete");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "visual.suspected-blank",
        severity: "manual-review",
        manualReview: true,
      }),
    );
    expect(report.issues.some((issue) => issue.severity === "error")).toBe(
      false,
    );
  }, 60000);

  it("keeps typed missing-asset diagnostics when rendering cannot complete", async () => {
    const { app, composition } = await fixture("0x27a6c8");
    composition.tracks[0]!.clips[0]!.assetId = "missing-synthetic-asset";
    app.project.timelines[0] = composition;
    await app.save();

    const report = await app.runVisualQa(composition.id);

    expect(report.status).toBe("incomplete");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "asset.missing",
        severity: "error",
        clipId: composition.tracks[0]!.clips[0]!.id,
      }),
    );
    expect(report.samples).toEqual([]);
  }, 60000);

  it("classifies a font load failure and measurable title overflow before render", async () => {
    const { app, composition } = await fixture("0x27a6c8");
    const clip = composition.tracks[0]!.clips[0]!;
    clip.title = "Synthetic title that needs review";
    clip.titleStyle = { version: 1, role: "film-title", fontSize: 256 };
    app.project.timelines[0] = composition;
    await app.save();
    const overflow = await app.runVisualQa(composition.id);
    expect(overflow.status).toBe("incomplete");
    expect(overflow.issues).toContainEqual(
      expect.objectContaining({
        code: "title.overflow",
        severity: "error",
        clipId: clip.id,
      }),
    );

    clip.titleStyle = { version: 1, role: "film-title" };
    await app.save();
    const previous = process.env.OPENFILM_TITLE_FONT;
    process.env.OPENFILM_TITLE_FONT = join(app.directory, "missing-font.otf");
    try {
      const fontFailure = await app.runVisualQa(composition.id);
      expect(fontFailure.status).toBe("incomplete");
      expect(fontFailure.issues).toContainEqual(
        expect.objectContaining({
          code: "font.load-failed",
          severity: "error",
          detail: "unavailable",
          clipId: clip.id,
        }),
      );
    } finally {
      if (previous === undefined) delete process.env.OPENFILM_TITLE_FONT;
      else process.env.OPENFILM_TITLE_FONT = previous;
    }
  }, 60000);

  it("cleans cancelled artifacts, permits a fresh retry and refuses stale revision output", async () => {
    const { app, composition } = await fixture("0x27a6c8");
    const cancelledId = randomUUID();
    const controller = new AbortController();
    await expect(
      app.runVisualQa(composition.id, {
        jobId: cancelledId,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(
      app.catalog.listJobs().find((job) => job.id === cancelledId)?.status,
    ).toBe("cancelled");
    await expect(
      access(join(app.directory, "cache", "visual-qa", cancelledId)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const retry = await app.runVisualQa(composition.id);
    expect(retry.status).toBe("complete");
    expect(retry.id).not.toBe(cancelledId);

    const saved = structuredClone(app.project.timelines[0]!);
    let changed = false;
    const stale = await app.runVisualQa(composition.id, {
      onProgress: () => {
        if (changed) return;
        changed = true;
        app.project.timelines[0]!.tracks[0]!.clips[0]!.title = "Newer edit";
      },
    });
    app.project.timelines[0] = saved;
    expect(stale.status).toBe("stale");
    expect(stale.samples).toEqual([]);
    expect(stale.issues).toContainEqual(
      expect.objectContaining({ code: "revision.stale" }),
    );
  }, 60000);
});
