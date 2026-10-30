import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, type Composition } from "@openfilm/core";
import type { OpenFilmApplication } from "../../packages/application/src/index.js";
import type { VisualQaReport } from "../../packages/application/src/visual-qa.js";
import { PipelineService } from "../../packages/application/src/pipeline-orchestrator.js";

const exec = promisify(execFile);
let root: string;
let video: Buffer;
let sequence = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "openfilm-pipeline-media-"));
  const path = join(root, "synthetic.mp4");
  await exec("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=64x64:r=10:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-y",
    path,
  ]);
  video = await readFile(path);
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

/** Test the real orchestrator at its application-adapter boundary. */
async function fixture() {
  const directory = join(root, `case-${sequence++}`);
  await mkdir(directory, { recursive: true });
  const project = createProject("Synthetic pipeline media");
  project.settings = { width: 64, height: 64, frameRate: 10 };
  project.stories = [
    { id: "story", title: "Synthetic", targetDuration: 1, beats: [] },
  ];
  const composition: Composition = {
    id: "cut",
    storyId: "story",
    duration: 1,
    tracks: [],
  };
  const qaReport: VisualQaReport = {
    version: 1,
    id: "test-report",
    projectId: project.id,
    compositionId: composition.id,
    compositionRevision: "adapter-fixture",
    createdAt: new Date().toISOString(),
    status: "complete",
    settings: project.settings,
    output: {
      sha256: createHash("sha256").update(video).digest("hex"),
      duration: 1,
      frameCount: 10,
    },
    sources: [],
    samples: [],
    issues: [],
  };
  const writeVideo = async (relative: string) => {
    const path = join(directory, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, video);
    return path;
  };
  const app = {
    directory,
    project,
    catalog: { getAsset: vi.fn() },
    motionGeneration: { list: () => [] },
    compose: vi.fn(() => composition),
    save: vi.fn(async () => {
      project.timelines = [composition];
    }),
    render: vi.fn(async () => writeVideo("cache/preview.mp4")),
    visualQa: { run: vi.fn(async () => qaReport) },
    exportMp4: vi.fn(async () => ({
      path: await writeVideo("exports/finished.mp4"),
      report: {},
    })),
    export: vi.fn(async () => {
      throw new Error("Non-MP4 export failed");
    }),
  };
  const pipeline = new PipelineService(app as unknown as OpenFilmApplication);
  const run = await pipeline.createRun("guided-story-to-video", {
    compositionTarget: { version: 1, mode: "new-cut" },
    storyId: "story",
    narration: { type: "none" },
  });
  return { app, pipeline, run, qaReport };
}

describe("Pipeline media failures never become success artifacts", () => {
  it.each([
    "ffmpeg failed",
    "ENOENT: ffmpeg",
    "Missing Media",
    "media.unsupported",
  ])("preserves render failure: %s", async (message) => {
    const { app, pipeline, run } = await fixture();
    app.render.mockRejectedValueOnce(new Error(message));
    const result = await pipeline.startRun(run.id);
    expect(result.status).toBe("failed");
    expect(result.stepAttempts[5]?.status).toBe("failed");
    expect(result.stepAttempts[5]?.error?.message).toBe(message);
    expect(result.artifacts.some((a) => a.kind === "preview-video")).toBe(
      false,
    );
    expect(app.visualQa.run).not.toHaveBeenCalled();
    expect(app.exportMp4).not.toHaveBeenCalled();
  });

  it("propagates QA exceptions and does not export", async () => {
    const { app, pipeline, run } = await fixture();
    app.visualQa.run.mockRejectedValueOnce(new Error("Inspection failed"));
    const result = await pipeline.startRun(run.id);
    expect(result.status).toBe("failed");
    expect(result.stepAttempts[6]?.status).toBe("failed");
    expect(result.artifacts.some((a) => a.kind === "qa-report")).toBe(false);
    expect(app.exportMp4).not.toHaveBeenCalled();
  });

  it.each(["incomplete", "stale"] as const)(
    "does not export a %s QA report with no listed issues",
    async (status) => {
      const { app, pipeline, run, qaReport } = await fixture();
      app.visualQa.run.mockResolvedValueOnce({
        ...qaReport,
        status,
        output: undefined,
      });
      const result = await pipeline.startRun(run.id);
      expect(result.status).toBe("failed");
      expect(app.exportMp4).not.toHaveBeenCalled();
    },
  );

  it("delegates MP4 export and preserves decodable bytes", async () => {
    const { app, pipeline, run } = await fixture();
    const result = await pipeline.startRun(run.id);
    expect(result.status).toBe("succeeded");
    expect(app.exportMp4).toHaveBeenCalledTimes(1);
    expect(app.exportMp4).toHaveBeenCalledWith("cut", {
      signal: expect.any(AbortSignal),
    });
    const artifact = result.artifacts.find((a) => a.kind === "export-file");
    expect(artifact?.path).toBeTruthy();
    const output = resolve(app.directory, artifact!.path!);
    expect(await readFile(output)).toEqual(video);
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=width,height,nb_read_frames",
      "-of",
      "json",
      output,
    ]);
    expect(JSON.parse(stdout).streams[0]).toMatchObject({
      width: 64,
      height: 64,
      nb_read_frames: "10",
    });
    await exec("ffmpeg", ["-v", "error", "-i", output, "-f", "null", "-"]);
  });

  it("propagates exporter failure without fallback files", async () => {
    const { app, pipeline, run } = await fixture();
    app.exportMp4.mockRejectedValueOnce(new Error("Disk full"));
    const result = await pipeline.startRun(run.id);
    expect(result.status).toBe("failed");
    expect(result.stepAttempts[7]?.error?.message).toBe("Disk full");
    expect(result.artifacts.some((a) => a.kind === "export-file")).toBe(false);
  });

  it("does not publish a cancelled QA result", async () => {
    const { app, pipeline, run } = await fixture();
    const controller = new AbortController();
    app.visualQa.run.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("QA cancelled");
    });
    const result = await pipeline.startRun(run.id, {
      signal: controller.signal,
    });
    expect(result.status).toBe("cancelled");
    expect(result.stepAttempts[6]?.status).toBe("cancelled");
    expect(result.artifacts.some((a) => a.kind === "qa-report")).toBe(false);
    expect(app.exportMp4).not.toHaveBeenCalled();
  });
});
