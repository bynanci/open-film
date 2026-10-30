import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { FilesystemSource } from "@openfilm/media";
import { startServer } from "../../apps/server/src/server.js";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";
import type { VisionSampleProvider } from "@openfilm/plugin-sdk";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture(
  options: { visionSampleProviders?: VisionSampleProvider[] } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-source-draft-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = await startServer({ port: 0, ...options });
  cleanup.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}/api`;
  const created = await fetch(`${base}/project/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: join(root, "film.openfilm"),
      title: "Source draft",
    }),
  });
  expect(created.status).toBe(200);
  const project = (await created.json()).project as { id: string };
  const mutate = (path: string, method: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { base, project, root, mutate };
}

describe("source draft HTTP boundary", () => {
  it.each(["run", "job"])(
    "cancels a running visual analysis through its %s without queuing behind its provider",
    async (target) => {
      let started!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const provider: VisionSampleProvider = {
        id: "local.synthetic-cancel",
        name: "Delayed synthetic provider",
        kind: "vision-sample",
        execution: "local",
        dataKinds: ["images", "metadata"],
        analyzeSample: async (_sample, options) => {
          started();
          await Promise.race([
            held,
            new Promise<void>((resolve) =>
              options?.signal?.addEventListener("abort", () => resolve(), {
                once: true,
              }),
            ),
          ]);
          return { labels: [] };
        },
      };
      const h = await fixture({ visionSampleProviders: [provider] });
      const media = join(h.root, "cancel-media");
      await generateSampleMedia(media);
      const added = await h.mutate("/import-draft/sources", "POST", {
        projectId: h.project.id,
        baseRevision: 0,
        requestId: "cancel-add",
        sources: [
          {
            kind: "file",
            displayName: "Synthetic photo",
            accessClass: "native-path",
            accessRef: join(media, "01-photo.png"),
            recursive: false,
          },
        ],
      });
      const { draft } = await added.json();
      expect(
        (
          await h.mutate("/import-draft/scan", "POST", {
            projectId: h.project.id,
            baseRevision: draft.revision,
            requestId: "cancel-scan",
          })
        ).ok,
      ).toBe(true);
      const sealed = await h.mutate("/import-batches", "POST", {
        projectId: h.project.id,
        baseRevision: draft.revision,
        requestId: "cancel-seal",
      });
      const { result: batch } = await sealed.json();
      expect(batch.status).toBe("sealed");
      const running = h.mutate("/analysis-runs", "POST", {
        projectId: h.project.id,
        verifiedManifestId: batch.verifiedManifest.id,
        scopeMode: "selected-sources",
        requestId: "cancel-running",
        visualSampling: {
          version: 1,
          algorithmVersion: "representative-frames-v1",
          providerId: provider.id,
        },
      });
      let cancellation: Promise<Response> | undefined;
      try {
        await ready;
        const progress = await (
          await fetch(
            `${h.base}/analysis-runs/progress?requestId=cancel-running`,
          )
        ).json();
        cancellation = h.mutate(
          target === "run"
            ? `/analysis-runs/${encodeURIComponent(progress.state.progress.runId)}/cancel`
            : `/jobs/${encodeURIComponent(progress.state.progress.attemptId)}/cancel`,
          "POST",
          { projectId: h.project.id },
        );
        const cancelledPromptly = await Promise.race([
          cancellation.then((response) => response.ok),
          delay(1000).then(() => false),
        ]);
        expect(cancelledPromptly).toBe(true);
        const result = await (await running).json();
        expect(result.result.run.status).toBe("cancelled");
        expect(result.result.results).toEqual([]);
      } finally {
        release();
        await Promise.allSettled([
          running,
          ...(cancellation ? [cancellation] : []),
        ]);
      }
    },
  );

  it("aborts native discovery when the client disconnects after its request body was read", async () => {
    const h = await fixture();
    const media = join(h.root, "disconnect-media");
    await mkdir(media);
    const file = join(media, "one.jpg");
    await writeFile(file, "synthetic");
    const added = await h.mutate("/import-draft/sources", "POST", {
      projectId: h.project.id,
      baseRevision: 0,
      requestId: "disconnect-add",
      sources: [
        {
          kind: "folder",
          displayName: "Synthetic folder",
          accessClass: "native-path",
          accessRef: media,
          recursive: true,
        },
      ],
    });
    const { draft } = await added.json();
    let started!: () => void;
    let release!: () => void;
    let observedAbort!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      observedAbort = resolve;
    });
    const discover = vi
      .spyOn(FilesystemSource.prototype, "discover")
      .mockImplementation(async function* (_input, options) {
        const signal =
          options instanceof AbortSignal ? options : options?.signal;
        yield {
          path: file,
          uri: pathToFileURL(file).href,
          name: "one.jpg",
          relativePath: "one.jpg",
          mediaType: "image",
          size: 9,
        };
        started();
        await Promise.race([
          held,
          new Promise<void>((resolve) =>
            signal?.addEventListener(
              "abort",
              () => {
                observedAbort();
                resolve();
              },
              { once: true },
            ),
          ),
        ]);
      });
    const controller = new AbortController();
    const request = fetch(`${h.base}/import-draft/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: h.project.id,
        baseRevision: draft.revision,
        requestId: "disconnect-scan",
      }),
      signal: controller.signal,
    }).catch(() => undefined);
    try {
      await ready;
      controller.abort();
      await request;
      expect(
        await Promise.race([
          aborted.then(() => true),
          delay(1000).then(() => false),
        ]),
      ).toBe(true);
      await expect
        .poll(
          async () =>
            (
              await (
                await fetch(
                  `${h.base}/import-draft/scan-progress?requestId=disconnect-scan`,
                )
              ).json()
            ).progress.status,
        )
        .toBe("cancelled");
    } finally {
      release();
      discover.mockRestore();
      await request;
    }
  });

  it("requires an explicit bounded-image consent action for a registered remote sample provider", async () => {
    const provider: VisionSampleProvider = {
      id: "remote.synthetic-vision",
      name: "Synthetic provider",
      kind: "vision-sample",
      execution: "remote",
      endpoint: "https://vision.example.invalid/samples",
      dataKinds: ["images", "metadata"],
      analyzeSample: async () => ({ labels: [] }),
    };
    const h = await fixture({ visionSampleProviders: [provider] });
    const before = await fetch(`${h.base}/analysis/vision-sample-providers`);
    expect((await before.json()).providers).toMatchObject([
      { id: provider.id, enabled: false, endpoint: provider.endpoint },
    ]);
    const denied = await h.mutate(
      `/analysis/vision-sample-providers/${encodeURIComponent(provider.id)}/consent`,
      "POST",
      { acknowledged: false },
    );
    expect(denied.status).toBe(400);
    const granted = await h.mutate(
      `/analysis/vision-sample-providers/${encodeURIComponent(provider.id)}/consent`,
      "POST",
      { acknowledged: true },
    );
    expect((await granted.json()).providers).toMatchObject([
      { id: provider.id, enabled: true },
    ]);
    const revoked = await fetch(
      `${h.base}/analysis/vision-sample-providers/${encodeURIComponent(provider.id)}/consent`,
      { method: "DELETE" },
    );
    expect((await revoked.json()).providers).toMatchObject([
      { id: provider.id, enabled: false },
    ]);
  });

  it("scans through shared application logic and pages private-source occurrences", async () => {
    const h = await fixture();
    const media = join(h.root, "synthetic-media");
    await mkdir(media);
    await writeFile(join(media, "one.jpg"), "synthetic image");
    await writeFile(join(media, "two.mp4"), "synthetic video");
    const added = await h.mutate("/import-draft/sources", "POST", {
      projectId: h.project.id,
      baseRevision: 0,
      requestId: "scan-source-add",
      sources: [
        {
          kind: "folder",
          displayName: "Synthetic media",
          accessClass: "native-path",
          accessRef: media,
          recursive: true,
        },
      ],
    });
    const draft = (await added.json()).draft as {
      revision: number;
      selections: { id: string }[];
    };
    const scanned = await h.mutate("/import-draft/scan", "POST", {
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: "scan-source-run",
      selectionIds: [draft.selections[0]!.id],
    });
    expect(scanned.status).toBe(200);
    expect((await scanned.json()).summary).toMatchObject({
      projectId: h.project.id,
      sourcesScanned: 1,
      discovered: 2,
      supported: 2,
      skipped: 0,
      failed: 0,
    });
    const progress = await fetch(
      `${h.base}/import-draft/scan-progress?requestId=scan-source-run`,
    );
    expect((await progress.json()).progress).toMatchObject({
      projectId: h.project.id,
      status: "completed",
      summary: { discovered: 2 },
    });

    const query = new URLSearchParams({
      selectionId: draft.selections[0]!.id,
      offset: "0",
      limit: "1",
    });
    const first = await fetch(`${h.base}/import-draft/occurrences?${query}`);
    expect(first.status).toBe(200);
    const page = (await first.json()).page;
    expect(page).toMatchObject({
      limit: 1,
      hasMore: true,
      items: [{ occurrence: { relativePath: expect.any(String) } }],
    });
    expect(JSON.stringify(page)).not.toContain(media);
    const second = await fetch(
      `${h.base}/import-draft/occurrences?${new URLSearchParams({
        selectionId: draft.selections[0]!.id,
        offset: "1",
        limit: "1",
      })}`,
    );
    expect((await second.json()).page.hasMore).toBe(false);
  });

  it("reviews inclusion and creates a restart-readable verified import batch", async () => {
    const h = await fixture();
    const generated = join(h.root, "generated");
    const media = join(h.root, "selected-media");
    await generateSampleMedia(generated);
    await mkdir(media);
    await writeFile(
      join(media, "one.png"),
      await readFile(join(generated, "01-photo.png")),
    );
    await writeFile(
      join(media, "two.png"),
      await readFile(join(generated, "03-evening.png")),
    );
    const added = await h.mutate("/import-draft/sources", "POST", {
      projectId: h.project.id,
      baseRevision: 0,
      requestId: "batch-http-add",
      sources: [
        {
          kind: "folder",
          displayName: "Synthetic",
          accessClass: "native-path",
          accessRef: media,
        },
      ],
    });
    const draft = (await added.json()).draft as {
      revision: number;
      selections: { id: string }[];
    };
    const selectionId = draft.selections[0]!.id;
    const scanned = await h.mutate("/import-draft/scan", "POST", {
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: "batch-http-scan",
    });
    expect(scanned.status).toBe(200);
    const listed = await fetch(
      `${h.base}/import-draft/occurrences?selectionId=${selectionId}&offset=0&limit=20`,
    );
    const items = (await listed.json()).page.items as Array<{
      occurrence: { id: string; relativePath: string };
      included: boolean;
    }>;
    const excluded = items.find(
      ({ occurrence }) => occurrence.relativePath === "two.png",
    )!.occurrence;
    const membership = await h.mutate(
      `/import-draft/occurrences/${encodeURIComponent(excluded.id)}`,
      "PATCH",
      {
        projectId: h.project.id,
        baseRevision: draft.revision,
        requestId: "batch-http-exclude",
        selectionId,
        included: false,
      },
    );
    expect(membership.status).toBe(200);
    expect((await membership.json()).membership).toMatchObject({
      occurrenceId: excluded.id,
      included: false,
    });

    const sealed = await h.mutate("/import-batches", "POST", {
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: "batch-http-seal",
      selectionIds: [selectionId],
      partialPolicy: "require-all",
    });
    expect(sealed.status).toBe(200);
    const result = (await sealed.json()).result as {
      batch: { id: string; status: string; expectedManifestId: string };
      status: string;
      verified: number;
      excluded: number;
      verifiedManifest: { excludedOccurrenceIds: string[] };
    };
    expect(result).toMatchObject({
      status: "sealed",
      batch: { status: "sealed" },
      verified: 1,
      excluded: 1,
    });
    expect(result.verifiedManifest.excludedOccurrenceIds).toEqual([
      excluded.id,
    ]);
    const status = await fetch(`${h.base}/import-batches/${result.batch.id}`);
    expect(status.status).toBe(200);
    expect((await status.json()).verifiedManifest.id).toBeTruthy();
    const progress = await fetch(
      `${h.base}/import-batches/progress?requestId=batch-http-seal`,
    );
    expect((await progress.json()).state).toMatchObject({
      status: "completed",
      result: { batch: { id: result.batch.id } },
    });
  });

  it("scans and privately stages browser sources through the shared batch service", async () => {
    const h = await fixture();
    const generated = join(h.root, "browser-generated");
    await generateSampleMedia(generated);
    const file = join(generated, "01-photo.png");
    const info = await stat(file);
    const bytes = await readFile(file);
    const added = await h.mutate("/import-draft/sources", "POST", {
      projectId: h.project.id,
      baseRevision: 0,
      requestId: "browser-http-add",
      sources: [
        {
          kind: "folder",
          displayName: "Browser album",
          accessClass: "ephemeral-browser-file",
          accessRef: "browser-file:private",
        },
      ],
    });
    const draft = (await added.json()).draft as {
      revision: number;
      selections: { id: string }[];
    };
    const selectionId = draft.selections[0]!.id;
    const scanRequestId = "browser-http-scan";
    const scan = async (body: unknown) =>
      h.mutate("/import-draft/browser-scan", "POST", body);
    const begun = await scan({
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: scanRequestId,
      selectionId,
      phase: "begin",
    });
    expect(begun.status).toBe(200);
    const { scanRevision } = (await begun.json()) as { scanRevision: number };
    const page = await scan({
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: scanRequestId,
      selectionId,
      phase: "page",
      scanRevision,
      candidates: [
        {
          relativePath: "album/01-photo.png",
          name: "01-photo.png",
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
        },
      ],
    });
    expect(page.status).toBe(200);
    expect((await page.json()).summary.discovered).toBe(1);
    const finished = await scan({
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: scanRequestId,
      selectionId,
      phase: "finish",
      scanRevision,
    });
    expect((await finished.json()).summary).toMatchObject({
      discovered: 1,
      failed: 0,
      cancelled: false,
    });
    const readiness = await fetch(`${h.base}/import-draft/scan-readiness`);
    expect((await readiness.json()).summary).toMatchObject({
      projectId: h.project.id,
      draftRevision: draft.revision,
      sourcesScanned: 1,
      supported: 1,
    });
    const occurrences = await fetch(
      `${h.base}/import-draft/occurrences?selectionId=${selectionId}&offset=0&limit=10`,
    );
    const occurrence = (await occurrences.json()).page.items[0].occurrence as {
      id: string;
    };
    const staged = await fetch(
      `${h.base}/import-draft/occurrences/${encodeURIComponent(occurrence.id)}/stage?selectionId=${encodeURIComponent(selectionId)}&baseRevision=${draft.revision}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-OpenFilm-Source-Modified-At": info.mtime.toISOString(),
        },
        body: bytes,
      },
    );
    expect(staged.status).toBe(201);
    const stageStatus = await fetch(
      `${h.base}/import-draft/staged-occurrences?selectionId=${encodeURIComponent(selectionId)}&offset=0&limit=10`,
    );
    expect((await stageStatus.json()).page.occurrenceIds).toEqual([
      occurrence.id,
    ]);
    const sealed = await h.mutate("/import-batches", "POST", {
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: "browser-http-seal",
      partialPolicy: "require-all",
    });
    expect((await sealed.json()).result).toMatchObject({
      status: "sealed",
      verified: 1,
      failed: 0,
    });
  });

  it("runs common analysis through the verified manifest and returns restart-readable evidence", async () => {
    const h = await fixture();
    const generated = join(h.root, "analysis-generated");
    const media = join(h.root, "analysis-selected");
    await generateSampleMedia(generated);
    await mkdir(media);
    await writeFile(
      join(media, "memory.png"),
      await readFile(join(generated, "01-photo.png")),
    );
    const add = await h.mutate("/import-draft/sources", "POST", {
      projectId: h.project.id,
      baseRevision: 0,
      requestId: "analysis-http-add",
      sources: [
        {
          kind: "folder",
          displayName: "Synthetic story",
          accessClass: "native-path",
          accessRef: media,
        },
      ],
    });
    const draft = (await add.json()).draft as { revision: number };
    expect(
      (
        await h.mutate("/import-draft/scan", "POST", {
          projectId: h.project.id,
          baseRevision: draft.revision,
          requestId: "analysis-http-scan",
        })
      ).status,
    ).toBe(200);
    const sealed = await h.mutate("/import-batches", "POST", {
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: "analysis-http-seal",
    });
    const manifestId = (
      (await sealed.json()).result as { verifiedManifest: { id: string } }
    ).verifiedManifest.id;
    const analysisRequest = {
      projectId: h.project.id,
      verifiedManifestId: manifestId,
      scopeMode: "selected-sources",
      requestId: "analysis-http-run",
    };
    const response = await h.mutate("/analysis-runs", "POST", analysisRequest);
    expect(response.status).toBe(200);
    const first = (await response.json()).result as {
      run: {
        id: string;
        status: string;
        manifestId: string;
        inputFingerprint: string;
      };
      results: Array<{
        kind: string;
        evidence: { assetIds: string[] };
        bindingIds: string[];
      }>;
      attempts: Array<{ generation: number; status: string }>;
    };
    expect(first.run).toMatchObject({
      status: "completed",
      manifestId,
      inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(first.results).toHaveLength(1);
    expect(first.results[0]).toMatchObject({
      kind: "event",
      evidence: { assetIds: [expect.any(String)] },
      bindingIds: [expect.any(String)],
    });
    expect(first.attempts).toMatchObject([
      { generation: 1, status: "succeeded" },
    ]);

    const repeated = await h.mutate("/analysis-runs", "POST", analysisRequest);
    expect((await repeated.json()).result.run.id).toBe(first.run.id);
    const reopenedRecord = await fetch(
      `${h.base}/analysis-runs/${encodeURIComponent(first.run.id)}`,
    );
    expect((await reopenedRecord.json()).result).toEqual(first);
    const progress = await fetch(
      `${h.base}/analysis-runs/progress?requestId=analysis-http-run`,
    );
    expect((await progress.json()).state).toMatchObject({
      status: "completed",
      progress: { runId: first.run.id, stage: "completed" },
    });

    const assetId = first.results[0]!.evidence.assetIds[0]!;
    const parsed = await fetch(
      `${h.base}/travel-gpx/parse?trackId=assigned-route`,
      {
        method: "POST",
        headers: { "Content-Type": "application/gpx+xml" },
        body: `<gpx><trk><trkseg><trkpt lat="25.03" lon="121.56"><time>2026-01-01T09:00:00Z</time></trkpt></trkseg></trk></gpx>`,
      },
    );
    const track = (
      (await parsed.json()) as {
        track: {
          id: string;
          contentHash: string;
          segments: Array<{
            index: number;
            points: Array<{
              latitude: number;
              longitude: number;
              time?: string;
            }>;
          }>;
        };
      }
    ).track;
    const travelRun = await h.mutate("/analysis-runs", "POST", {
      ...analysisRequest,
      requestId: "analysis-http-travel-run",
      travelContext: {
        version: 1,
        algorithmVersion: "travel-v1",
        tracks: [track],
        clockMappings: [
          {
            id: "manual-clock",
            assetIds: [assetId],
            offsetMilliseconds: 0,
            source: "manual",
          },
        ],
        assignments: [{ trackId: track.id, assetIds: [assetId] }],
      },
    });
    expect(travelRun.status).toBe(200);
    const travelRecord = (
      (await travelRun.json()) as {
        result: {
          run: {
            id: string;
            travelContext: { tracks: Array<{ contentHash: string }> };
          };
          results: Array<{
            kind: string;
            evidence: { type: string; trackContentHash?: string };
          }>;
        };
      }
    ).result;
    expect(travelRecord.run.travelContext.tracks[0]?.contentHash).toBe(
      track.contentHash,
    );
    expect(
      travelRecord.results.some(
        ({ kind, evidence }) =>
          kind === "observation" &&
          evidence.type === "travel-observation" &&
          evidence.trackContentHash === track.contentHash,
      ),
    ).toBe(true);
    const travelReopened = await fetch(
      `${h.base}/analysis-runs/${encodeURIComponent(travelRecord.run.id)}`,
    );
    expect(travelReopened.status).toBe(200);
  });

  it("exposes review search and requires a matching preview before accepting a typed decision", async () => {
    const h = await fixture();
    const generated = join(h.root, "review-generated");
    const media = join(h.root, "review-selected");
    await generateSampleMedia(generated);
    await mkdir(media);
    await writeFile(
      join(media, "review.png"),
      await readFile(join(generated, "01-photo.png")),
    );
    const add = await h.mutate("/import-draft/sources", "POST", {
      projectId: h.project.id,
      baseRevision: 0,
      requestId: "analysis-review-http-add",
      sources: [
        {
          kind: "folder",
          displayName: "Synthetic review media",
          accessClass: "native-path",
          accessRef: media,
        },
      ],
    });
    const draft = (await add.json()).draft as { revision: number };
    await h.mutate("/import-draft/scan", "POST", {
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: "analysis-review-http-scan",
    });
    const sealed = await h.mutate("/import-batches", "POST", {
      projectId: h.project.id,
      baseRevision: draft.revision,
      requestId: "analysis-review-http-seal",
    });
    const manifestId = (
      (await sealed.json()).result as { verifiedManifest: { id: string } }
    ).verifiedManifest.id;
    const analysis = await h.mutate("/analysis-runs", "POST", {
      projectId: h.project.id,
      verifiedManifestId: manifestId,
      scopeMode: "selected-sources",
      requestId: "analysis-review-http-run",
    });
    const run = (await analysis.json()).result as {
      run: { id: string };
      results: Array<{ id: string; reviewStatus: string }>;
    };
    const resultId = run.results[0]!.id;
    const search = await fetch(
      `${h.base}/analysis-runs/${encodeURIComponent(run.run.id)}/review?query=event&offset=0&limit=10`,
    );
    expect((await search.json()).result.items).toMatchObject([
      { id: resultId },
    ]);
    const operation = { kind: "reject-results", resultIds: [resultId] };
    const previewResponse = await h.mutate(
      `/analysis-runs/${encodeURIComponent(run.run.id)}/review/preview`,
      "POST",
      { operation },
    );
    const preview = (await previewResponse.json()).preview as {
      beforeFingerprint: string;
      operationFingerprint: string;
      manifestId: string;
      outcome: string;
    };
    expect(preview.outcome).toBe("ready");
    const accepted = await h.mutate(
      `/analysis-runs/${encodeURIComponent(run.run.id)}/review/accept`,
      "POST",
      {
        projectId: h.project.id,
        operation,
        expectedManifestId: preview.manifestId,
        expectedBeforeFingerprint: preview.beforeFingerprint,
        expectedOperationFingerprint: preview.operationFingerprint,
        requestId: "analysis-review-http-accept",
      },
    );
    expect((await accepted.json()).decision).toMatchObject({
      outcome: "applied",
      operation,
    });
    const reviewed = await fetch(
      `${h.base}/analysis-runs/${encodeURIComponent(run.run.id)}/review?offset=0&limit=10`,
    );
    const reviewedBody = await reviewed.json();
    expect(reviewed.status, JSON.stringify(reviewedBody)).toBe(200);
    expect(reviewedBody).toMatchObject({
      result: { items: [{ reviewStatus: "rejected" }] },
    });
  });

  it("parses an explicitly supplied synthetic GPX track without retaining an input path", async () => {
    const h = await fixture();
    const xml = `<gpx version="1.1" creator="OpenFilm synthetic"><trk><trkseg><trkpt lat="25.03" lon="121.56"><time>2026-01-01T09:00:00Z</time></trkpt></trkseg></trk></gpx>`;
    const parsed = await fetch(
      `${h.base}/travel-gpx/parse?trackId=synthetic-route`,
      {
        method: "POST",
        headers: { "Content-Type": "application/gpx+xml" },
        body: xml,
      },
    );
    expect(parsed.status).toBe(200);
    const { track } = (await parsed.json()) as {
      track: {
        id: string;
        contentHash: string;
        segments: Array<{
          index: number;
          points: Array<{ latitude: number; longitude: number; time?: string }>;
        }>;
      };
    };
    expect(track).toMatchObject({
      id: "synthetic-route",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      segments: [
        {
          index: 0,
          points: [
            {
              latitude: 25.03,
              longitude: 121.56,
              time: "2026-01-01T09:00:00.000Z",
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(track)).not.toContain("file:");
    const unsafe = await fetch(
      `${h.base}/travel-gpx/parse?trackId=unsafe-route`,
      {
        method: "POST",
        headers: { "Content-Type": "application/gpx+xml" },
        body: `<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]>${xml}`,
      },
    );
    expect(unsafe.status).toBe(400);
  });

  it("accumulates sources, fences stale revisions and never starts legacy import", async () => {
    const h = await fixture();
    expect(await (await fetch(`${h.base}/import-draft`)).json()).toEqual({
      draft: {
        schemaVersion: 1,
        projectId: h.project.id,
        revision: 0,
        selections: [],
      },
    });
    const add = async (
      baseRevision: number,
      requestId: string,
      paths: string[],
    ) =>
      h.mutate("/import-draft/sources", "POST", {
        projectId: h.project.id,
        baseRevision,
        requestId,
        sources: paths.map((path) => ({
          kind: "file",
          displayName: path.split("/").at(-1),
          accessClass: "native-path",
          accessRef: path,
          recursive: false,
        })),
      });
    const firstResponse = await add(0, "http-add-1", [
      "/a.mp4",
      "/b.mp4",
      "/c.mp4",
    ]);
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()).draft;
    expect(first).toMatchObject({ revision: 1 });
    expect(first.selections).toHaveLength(3);

    const secondResponse = await add(1, "http-add-2", ["/d.mp4", "/e.mp4"]);
    expect(secondResponse.status).toBe(200);
    expect((await secondResponse.json()).draft.selections).toHaveLength(5);
    const stale = await add(1, "http-stale", ["/late.mp4"]);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "import.draftStale" });
    expect((await (await fetch(`${h.base}/jobs`)).json()).jobs).toEqual([]);
  });

  it("updates and removes only the selected relationship and rejects a foreign project", async () => {
    const h = await fixture();
    const addedResponse = await h.mutate("/import-draft/sources", "POST", {
      projectId: h.project.id,
      baseRevision: 0,
      requestId: "http-folder-add",
      sources: [
        {
          kind: "folder",
          displayName: "京都",
          accessClass: "persistent-browser-handle",
          accessRef: "browser-handle:kyoto",
          recursive: true,
        },
      ],
    });
    const added = (await addedResponse.json()).draft;
    const sourceId = added.selections[0].id as string;
    const updatedResponse = await h.mutate(
      `/import-draft/sources/${encodeURIComponent(sourceId)}`,
      "PATCH",
      {
        projectId: h.project.id,
        baseRevision: 1,
        requestId: "http-folder-update",
        recursive: false,
      },
    );
    expect(updatedResponse.status).toBe(200);
    expect((await updatedResponse.json()).draft.selections[0]).toMatchObject({
      id: sourceId,
      recursive: false,
    });

    const foreign = await h.mutate("/import-draft/sources", "POST", {
      projectId: "foreign-project",
      baseRevision: 2,
      requestId: "http-foreign",
      sources: [
        {
          kind: "file",
          displayName: "foreign.mp4",
          accessClass: "native-path",
          accessRef: "/foreign.mp4",
        },
      ],
    });
    expect(foreign.status).toBe(403);

    const removed = await h.mutate(
      `/import-draft/sources/${encodeURIComponent(sourceId)}`,
      "DELETE",
      {
        projectId: h.project.id,
        baseRevision: 2,
        requestId: "http-folder-remove",
      },
    );
    expect(removed.status).toBe(200);
    expect((await removed.json()).draft).toMatchObject({
      revision: 3,
      selections: [],
    });
  });
});
