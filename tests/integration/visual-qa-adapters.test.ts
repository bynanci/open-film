import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { hashFile, inspectMedia, runProcess } from "@openfilm/media";
import { OpenFilmApplication } from "@openfilm/application";
import { startServer } from "../../apps/server/src/server.js";

const exec = promisify(execFile);
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-visual-qa-adapters-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "generated.png");
  await runProcess("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x3366aa:s=96x54:d=1",
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
    name: "generated.png",
  });
  const directory = join(root, "Synthetic film.openfilm");
  const app = await OpenFilmApplication.create(directory, "Synthetic adapters");
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
  app.close();
  return { root, directory, composition, source };
}

describe("Visual QA HTTP and CLI adapters", () => {
  it("starts a report over HTTP, serves only its frames, and exposes the same report in CLI", async () => {
    const { directory, composition, source } = await fixture();
    const sourceHash = await hashFile(source);
    const runtime = await startServer({ port: 0, project: directory });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await runtime.close();
    };
    cleanup.push(close);
    const request = (route: string, data?: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}/api${route}`, {
        method: data === undefined ? "GET" : "POST",
        ...(data === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            }),
      });

    const started = await request("/visual-qa", {
      compositionId: composition.id,
    });
    expect(started.status).toBe(202);
    const { jobId } = (await started.json()) as { jobId: string };
    expect(jobId).toMatch(/^[a-f\d-]{36}$/u);

    let state:
      | {
          job: { status: string; type: string; errors?: unknown };
          active: boolean;
          report?: {
            status: string;
            compositionId: string;
            samples: { index: number; sha256: string }[];
            sources: { assetId: string; sha256: string }[];
          };
        }
      | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await request(`/visual-qa/${jobId}`);
      expect(response.status).toBe(200);
      state = (await response.json()) as typeof state;
      if (
        !state?.active &&
        (state?.report ||
          ["failed", "cancelled"].includes(state?.job.status ?? ""))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(state?.job, JSON.stringify(state?.job.errors)).toMatchObject({
      type: "visual-qa",
      status: "completed",
    });
    expect(state?.report).toMatchObject({
      status: "complete",
      compositionId: composition.id,
    });
    expect(state?.report?.sources[0]?.sha256).toBe(sourceHash);
    expect(state?.report?.sources[0]).not.toHaveProperty("uri");
    expect(state?.report?.samples.length).toBeGreaterThan(0);

    const sample = state!.report!.samples[0]!;
    const response = await request(
      `/visual-qa/${jobId}/frames/${sample.index}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await hashFile(await writeResponseFixture(response))).toBe(
      sample.sha256,
    );
    expect(
      (await request(`/visual-qa/${jobId}/frames/../report.json`)).status,
    ).not.toBe(200);

    await close();
    const args = [
      "--import",
      "tsx",
      "apps/cli/src/index.ts",
      "visual-qa",
      "--project",
      directory,
      "--composition",
      composition.id,
    ];
    const { stdout } = await exec(process.execPath, args, {
      cwd: process.cwd(),
    });
    const cliReport = JSON.parse(stdout) as {
      status: string;
      compositionId: string;
      sources: { sha256: string }[];
      samples: { timestamp: number }[];
    };
    expect(cliReport).toMatchObject({
      status: "complete",
      compositionId: composition.id,
    });
    expect(cliReport.sources[0]?.sha256).toBe(sourceHash);
    expect(cliReport.samples[0]?.timestamp).toBeGreaterThanOrEqual(0);
    expect(stdout).not.toContain(source);
  }, 60000);

  it("blocks project replacement during a QA job, cancels partial output and retries with a new ID", async () => {
    const [{ directory, composition }, { directory: otherProject }] =
      await Promise.all([fixture(), fixture()]);
    const app = await OpenFilmApplication.open(directory);
    const saved = app.project.timelines.find(
      (item) => item.id === composition.id,
    )!;
    saved.duration = 60;
    for (const track of saved.tracks)
      for (const clip of track.clips) clip.timelineDuration = 60;
    const story = app.project.stories.find(
      (item) => item.id === saved.storyId,
    )!;
    story.maxDuration = 60;
    await app.save();
    app.close();

    const runtime = await startServer({ port: 0, project: directory });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await runtime.close();
    };
    cleanup.push(close);
    const request = (route: string, data?: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}/api${route}`, {
        method: data === undefined ? "GET" : "POST",
        ...(data === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            }),
      });

    const started = await request("/visual-qa", {
      compositionId: composition.id,
    });
    const { jobId } = (await started.json()) as { jobId: string };
    expect(started.status).toBe(202);
    expect(
      (await request("/project/open", { path: otherProject })).status,
    ).toBe(409);
    expect((await request(`/jobs/${jobId}/cancel`, {})).status).toBe(200);

    let cancelled:
      | { job: { status: string }; active: boolean; report?: unknown }
      | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await request(`/visual-qa/${jobId}`);
      cancelled = (await response.json()) as typeof cancelled;
      if (cancelled?.job.status === "cancelled" && !cancelled.active) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(cancelled?.job.status).toBe("cancelled");
    expect(cancelled?.report).toBeUndefined();

    const retryResponse = await request("/visual-qa", {
      compositionId: composition.id,
    });
    expect(retryResponse.status).toBe(202);
    const retryId = ((await retryResponse.json()) as { jobId: string }).jobId;
    expect(retryId).not.toBe(jobId);
    let retried:
      | {
          job: { status: string; errors?: unknown };
          active: boolean;
          report?: { status: string };
        }
      | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await request(`/visual-qa/${retryId}`);
      retried = (await response.json()) as typeof retried;
      if (
        !retried?.active &&
        (retried?.report ||
          ["failed", "cancelled"].includes(retried?.job.status ?? ""))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(retried?.job.status, JSON.stringify(retried?.job.errors)).toBe(
      "completed",
    );
    expect(retried?.report?.status).toBe("complete");
  }, 60000);
});

async function writeResponseFixture(response: Response): Promise<string> {
  const path = join(tmpdir(), `openfilm-visual-qa-frame-${randomUUID()}.png`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  cleanup.push(() => rm(path, { force: true }));
  return path;
}
