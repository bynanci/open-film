import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenFilmApplication, createReviewOwner } from "@openfilm/application";
import { api as desktopApi } from "../../apps/desktop/src/api";
import { hashFile, runProcess } from "@openfilm/media";
import type { Job, ReviewBatch, TranscriptSegment } from "@openfilm/core";
import type {
  LanguageProvider,
  TranscriptionOptions,
  TranscriptionProvider,
} from "@openfilm/plugin-sdk";
import {
  startServer,
  type ServerOptions,
} from "../../apps/server/src/server.js";

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const result = {
  text: "Visit youtube",
  language: "en",
  execution: "cpu" as const,
  model: "protocol-fixture-not-asr",
  version: "1",
  segments: [
    {
      id: "segment-0",
      start: 0,
      end: 1,
      text: "Visit youtube",
      words: [{ start: 0, end: 1, text: "Visit youtube" }],
    },
  ],
};
function transcription(
  transcribe: TranscriptionProvider["transcribe"],
  supportsPromptHints = true,
): TranscriptionProvider {
  return {
    id: "adapter-fixture",
    name: "Adapter protocol fixture, not ASR",
    kind: "transcription",
    execution: "local",
    dataKinds: ["audio", "metadata"],
    capabilities: {
      wordTimestamps: true,
      languages: ["en"],
      cpuFallback: false,
      supportsPromptHints,
    },
    transcribe,
  };
}
async function fixture(segments: TranscriptSegment[] = result.segments) {
  const directory = await mkdtemp(
    join(tmpdir(), "openfilm-transcript-adapters-"),
  );
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "訪問 # & literal.wav");
  await writeFile(
    path,
    "Identity-only fixture. No speech recognition is performed.",
  );
  const sourceHash = await hashFile(path),
    userDataDirectory = join(directory, "settings");
  const app = await OpenFilmApplication.create(
    join(directory, "film.openfilm"),
    "Transcript adapters",
    {},
    { userDataDirectory },
  );
  let closed = false;
  const close = () => {
    if (!closed) {
      app.close();
      closed = true;
    }
  };
  cleanups.push(close);
  const assetId = "audio";
  app.catalog.upsertAsset({
    id: assetId,
    uri: pathToFileURL(path).href,
    name: "訪問 # & literal.wav",
    mediaType: "audio",
    duration: 10,
    contentHash: sourceHash,
    tags: [],
    state: {},
    metadata: {},
  });
  app.catalog.intelligence.replaceTranscript({
    id: "initial",
    assetId,
    language: "en",
    provenance: {
      providerId: "fixture",
      model: "identity-not-asr",
      version: "1",
      sourceHash,
      createdAt: new Date().toISOString(),
    },
    segments,
  });
  return { directory, path, app, close, assetId, userDataDirectory };
}
async function server(
  options: Partial<ServerOptions> = {},
  segments?: TranscriptSegment[],
) {
  const setup = await fixture(segments);
  setup.close();
  const runtime = await startServer({
    port: 0,
    project: setup.app.directory,
    userDataDirectory: setup.userDataDirectory,
    ...options,
  });
  cleanups.push(() => runtime.close());
  const base = `http://127.0.0.1:${runtime.port}/api`;
  const get = async (path: string) => (await fetch(base + path)).json();
  const post = (path: string, data: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  const job = async (id: string) => {
    await expect
      .poll(
        async () =>
          ((await get("/jobs")).jobs as Job[]).find((item) => item.id === id)
            ?.status,
      )
      .not.toMatch(/^(queued|running)$/);
    return ((await get("/jobs")).jobs as Job[]).find((item) => item.id === id)!;
  };
  return { ...setup, base, get, post, job };
}

describe("transcript REST and CLI adapters", () => {
  it("exposes explicit HTTP recovery for a confirmed unknown review owner", async () => {
    const setup = await fixture();
    const transcript = await setup.app.transcriptEditor.get(setup.assetId);
    const owner = createReviewOwner();
    const reviewOwner = { ...owner, host: owner.host + ":foreign" };
    const job: Job = {
      id: "unknown-owner-http",
      type: "language-review",
      assetId: setup.assetId,
      status: "running",
      reviewOwner,
      createdAt: "2026-10-06T00:00:00Z",
      updatedAt: "2026-10-06T00:01:00Z",
    };
    setup.app.catalog.saveJob(job);
    const batch: ReviewBatch = {
      jobId: job.id,
      index: 0,
      assetId: setup.assetId,
      sourceRevisionId: transcript.revision!,
      providerId: "adapter-fixture",
      segmentIds: ["segment-0"],
      status: "running",
      attempts: 1,
    };
    setup.app.catalog.knowledge.saveBatch(batch);
    setup.close();

    const runtime = await startServer({
      port: 0,
      project: setup.app.directory,
      userDataDirectory: setup.userDataDirectory,
    });
    cleanups.push(() => runtime.close());
    const base = `http://127.0.0.1:${runtime.port}/api`;
    const recovery = await (
      await fetch(`${base}/review/jobs/${job.id}/recovery`)
    ).json();
    expect(recovery).toMatchObject({
      jobId: job.id,
      ownerState: "unknown",
      manualRecoveryAllowed: true,
      ownerToken: reviewOwner.token,
      updatedAt: job.updatedAt,
    });

    const rejected = await fetch(`${base}/review/jobs/${job.id}/recovery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmStopped: true,
        ownerToken: "stale",
        updatedAt: recovery.updatedAt,
      }),
    });
    expect(rejected.status).toBe(409);

    const accepted = await fetch(`${base}/review/jobs/${job.id}/recovery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmStopped: true,
        ownerToken: recovery.ownerToken,
        updatedAt: recovery.updatedAt,
      }),
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).job).toMatchObject({
      id: job.id,
      status: "failed",
      stage: "interrupted",
    });
    expect(
      (
        await (
          await fetch(`${base}/review/jobs/${job.id}/batches`)
        ).json()
      ).batches[0].status,
    ).toBe("cancelled");
  });

  it.each([
    ["isolated surrogate", "provider-\ud800"],
    ["long opaque identifier", "provider-" + "長".repeat(32000)],
  ])(
    "Desktop preview lookup transports %s without changing source position",
    async (_label, id) => {
      const segments = [
        { id: "ordinary", start: 0, end: 1, text: "First memory" },
        { id, start: 3, end: 4, text: "Preview this exact memory" },
      ];
      const { base } = await server({}, segments);
      const nativeFetch = globalThis.fetch;
      const redirected = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          const url = new URL(String(input), "http://127.0.0.1:4310");
          return nativeFetch(
            base.replace(/\/api$/, "") + url.pathname + url.search,
            init,
          );
        });
      cleanups.push(() => redirected.mockRestore());
      // Redirect the normal Desktop adapter to the ephemeral real HTTP server;
      // request serialization, response parsing and SQLite lookup are not mocked.
      const found = await desktopApi.transcriptSegment("audio", id);
      expect(found.segment.id).toBe(id);
      expect(found.position).toBe(1);
      expect(found.segment.start).toBe(3);
      expect(found.segment.end).toBe(4);
      expect(redirected.mock.calls.at(-1)?.[1]?.method).toBe("POST");
      if (id.includes("\ud800"))
        await expect(
          desktopApi.transcriptSegment("audio", "provider-\ufffd"),
        ).rejects.toMatchObject({
          status: 404,
          code: "transcript.segmentNotFound",
        });
    },
  );
  it("body lookup reaches distinct lone-surrogate and replacement-character segment identities", async () => {
    const ids = ["provider-\ud800", "provider-\ufffd"];
    const { post } = await server(
      {},
      ids.map((id, index) => ({
        id,
        start: index * 3,
        end: index * 3 + 1,
        text: "Different memory " + index,
      })),
    );
    for (const [position, segmentId] of ids.entries()) {
      const response = await post("/assets/audio/transcript/segment", {
        segmentId,
      });
      expect(response.status).toBe(200);
      const found = await response.json();
      expect(found.segment.id).toBe(segmentId);
      expect(found.position).toBe(position);
      expect(found.segment.start).toBe(position * 3);
    }
    for (const data of [
      { segmentId: null },
      { segmentId: " " },
      { segmentId: ids[0], position: 1 },
    ]) {
      const response = await post("/assets/audio/transcript/segment", data);
      expect(response.status).toBe(400);
    }
    expect(
      (
        await post("/assets/audio/transcript/segment", {
          segmentId: "x".repeat(1024 * 1024),
        })
      ).status,
    ).toBe(413);
  });
  it("preserves opaque provider segment IDs through HTTP paging, encoded lookup, editing, reopen and selected review acceptance", async () => {
    const ids = [
      "provider-" + "長".repeat(350) + " %/#&",
      "provider-\u0000\u0001\t\n %/#&",
    ];
    const segments = ids.map((id, index) => ({
      id,
      start: index * 2,
      end: index * 2 + 1,
      text: "Visit youtube",
      words: [{ start: index * 2, end: index * 2 + 1, text: "Visit youtube" }],
    }));
    const { app, get, post, job } = await server({}, segments);
    const initial = await get("/assets/audio/transcript?limit=1&offset=1");
    expect(initial.total).toBe(2);
    expect(initial.document.segments[0].id).toBe(ids[1]);
    for (const [position, id] of ids.entries()) {
      const found = await get(
        "/assets/audio/transcript/segments/" + encodeURIComponent(id),
      );
      expect(found.segment.id).toBe(id);
      expect(found.position).toBe(position);
    }
    const editedResponse = await post("/assets/audio/transcript/edit", {
      baseRevision: initial.revision,
      requestId: "opaque-edit",
      commands: ids.map((segmentId) => ({
        type: "replace-text",
        segmentId,
        text: "Manual memory",
      })),
    });
    expect(editedResponse.status).toBe(200);
    const edited = await editedResponse.json();
    expect(
      edited.document.segments.map((segment: TranscriptSegment) => segment.id),
    ).toEqual(ids);
    const undoneResponse = await post("/assets/audio/transcript/undo", {
      baseRevision: edited.revision,
      requestId: "opaque-undo",
    });
    expect(undoneResponse.status).toBe(200);
    expect(
      (await undoneResponse.json()).document.segments.map(
        (segment: TranscriptSegment) => segment.text,
      ),
    ).toEqual(["Visit youtube", "Visit youtube"]);
    expect((await post("/project/close", {})).status).toBe(200);
    expect((await post("/project/open", { path: app.directory })).status).toBe(
      200,
    );
    expect(
      (await get("/assets/audio/transcript")).document.segments.map(
        (segment: TranscriptSegment) => segment.id,
      ),
    ).toEqual(ids);
    await post("/glossary", {
      scope: "project",
      source: "youtube",
      replacement: "YouTube",
    });
    for (const id of ids) {
      const before = await get("/assets/audio/transcript");
      const started = await post("/assets/audio/review", {
        source: "glossary",
        segmentIds: [id],
      });
      expect(started.status).toBe(202);
      const completed = await job((await started.json()).job.id);
      expect(completed.status, JSON.stringify(completed)).toBe("completed");
      const pending = await get(
        "/assets/audio/review/suggestions?status=pending",
      );
      expect(pending.suggestions).toHaveLength(1);
      expect(pending.suggestions[0].target.segmentId).toBe(id);
      const accepted = await post(
        `/review/suggestions/${pending.suggestions[0].id}/accept`,
        {
          baseRevision: before.revision,
          requestId: "opaque-accept-" + ids.indexOf(id),
        },
      );
      expect(accepted.status).toBe(200);
      expect(
        (await accepted.json()).document.segments.find(
          (segment: TranscriptSegment) => segment.id === id,
        ).text,
      ).toBe("Visit YouTube");
    }
    for (const segmentIds of [[null], ["  "], [ids[0], ids[0]]]) {
      const rejected = await post("/assets/audio/review", {
        source: "glossary",
        segmentIds,
      });
      expect(rejected.status).toBe(400);
      expect((await rejected.json()).code).toBe("request.invalid");
    }
  });
  it("edits, searches, locates, undoes/redoes and selects durable revisions with strict mutation receipts", async () => {
    const { get, post, base } = await server();
    const original = await get("/assets/audio/transcript");
    const input = {
      baseRevision: original.revision,
      requestId: "edit-1",
      commands: [
        {
          type: "replace-text",
          segmentId: "segment-0",
          text: "台積電 # & memory",
        },
      ],
    };
    const edited = await (
      await post("/assets/audio/transcript/edit", input)
    ).json();
    expect(edited.document.segments[0].text).toBe("台積電 # & memory");
    expect(
      (await (await post("/assets/audio/transcript/edit", input)).json())
        .revision,
    ).toBe(edited.revision);
    expect(
      (
        await post("/assets/audio/transcript/edit", {
          ...input,
          requestId: "stale",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post("/assets/audio/transcript/edit", {
          ...input,
          commandFile: "/tmp/no",
        })
      ).status,
    ).toBe(400);
    expect(
      (await fetch(base + "/assets/audio/transcript?limit=201")).status,
    ).toBe(400);
    expect(
      (
        await fetch(
          base + "/assets/audio/transcript/search?query=x&caseSensitive=1",
        )
      ).status,
    ).toBe(400);
    const found = await get(
      "/assets/audio/transcript/search?query=" + encodeURIComponent("# &"),
    );
    expect(found.totalMatches).toBe(1);
    expect(
      (await get("/assets/audio/transcript/segments/segment-0")).position,
    ).toBe(0);
    const undone = await (
      await post("/assets/audio/transcript/undo", {
        baseRevision: edited.revision,
        requestId: "undo",
      })
    ).json();
    expect(undone.document.segments[0].text).toBe("Visit youtube");
    const redone = await (
      await post("/assets/audio/transcript/redo", {
        baseRevision: undone.revision,
        requestId: "redo",
      })
    ).json();
    expect(redone.document.segments[0].text).toBe("台積電 # & memory");
    expect(
      (await get("/assets/audio/transcript/revisions")).total,
    ).toBeGreaterThan(1);
    const selected = await (
      await post("/assets/audio/transcript/select", {
        baseRevision: redone.revision,
        requestId: "select",
        revisionId: original.revision,
      })
    ).json();
    expect(selected.document.segments[0].text).toBe("Visit youtube");
    expect((await post("/project/close", {})).status).toBe(200);
  });
  it("reviews local terminology as suggestions, accepts only explicitly, and rejects untrusted paths/config", async () => {
    const { get, post, job, base } = await server();
    expect(await get("/review/provider")).toEqual({
      configured: false,
      available: false,
    });
    expect(
      (
        await post("/review/consent", {
          allow: true,
          endpoint: "https://example.invalid",
        })
      ).status,
    ).toBe(400);
    expect((await post("/review/consent", { allow: true })).status).toBe(400);
    expect(
      (
        await post("/glossary", {
          scope: ["project"],
          source: "youtube",
          replacement: "YouTube",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("/glossary", {
          scope: "global",
          source: "youtube",
          replacement: "YouTube",
          userDataDirectory: "/tmp/forbidden",
        })
      ).status,
    ).toBe(400);
    const { entry } = await (
      await post("/glossary", {
        scope: "project",
        source: "youtube",
        replacement: "YouTube",
      })
    ).json();
    const before = await get("/assets/audio/transcript");
    const started = await post("/assets/audio/review", {
      source: "glossary",
      batchSize: 1,
    });
    expect(started.status).toBe(202);
    const completed = await job((await started.json()).job.id);
    expect(completed.status, JSON.stringify(completed)).toBe("completed");
    expect((await get("/assets/audio/transcript")).revision).toBe(
      before.revision,
    );
    const { suggestions } = await get(
      "/assets/audio/review/suggestions?status=pending",
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].after).toBe("Visit YouTube");
    const accepted = await (
      await post(`/review/suggestions/${suggestions[0].id}/accept`, {
        baseRevision: before.revision,
        requestId: "accept",
      })
    ).json();
    expect(accepted.document.segments[0].text).toBe("Visit YouTube");
    expect(
      (await get("/assets/audio/review/suggestions?status=accepted")).total,
    ).toBe(1);
    expect(
      (
        await fetch(base + `/glossary/${entry.id}?scope=project`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    const failed = await (
      await post("/assets/audio/review", { source: "language" })
    ).json();
    expect((await job(failed.job.id)).errors?.[0]?.code).toBe(
      "review.providerUnavailable",
    );
  });
  it("authorizes a registered remote review provider with additional disclosed data kinds", async () => {
    const generate = vi.fn(async (_prompt: string) => '{"suggestions":[]}');
    const provider: LanguageProvider = {
      id: "extra-kind-review",
      name: "Remote descriptor contract fixture",
      kind: "language",
      execution: "remote",
      endpoint: "https://review.invalid/text",
      dataKinds: ["text", "transcripts", "metadata"],
      generate,
    };
    const { get, post, job, path, directory, base } = await server({
      languageProvider: provider,
    });
    const disclosure = (await get("/review/provider")).provider;
    expect(disclosure.dataKinds).toEqual(provider.dataKinds);
    const denied = await (
      await post("/assets/audio/review", { source: "language" })
    ).json();
    expect((await job(denied.job.id)).status).toBe("failed");
    expect(generate).not.toHaveBeenCalled();
    const nativeFetch = globalThis.fetch;
    const redirected = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input), "http://127.0.0.1:4310");
        return nativeFetch(
          base.replace(/\/api$/, "") + url.pathname + url.search,
          init,
        );
      });
    cleanups.push(() => redirected.mockRestore());
    const granted = await desktopApi.reviewConsent(true, disclosure);
    expect(granted.available).toBe(true);
    expect(JSON.parse(String(redirected.mock.calls.at(-1)?.[1]?.body))).toEqual(
      {
        allow: true,
        providerId: disclosure.id,
        endpoint: disclosure.endpoint,
        dataKinds: disclosure.dataKinds,
      },
    );
    const started = await (
      await post("/assets/audio/review", { source: "language" })
    ).json();
    expect((await job(started.job.id)).status).toBe("completed");
    expect(generate).toHaveBeenCalledOnce();
    // The descriptor consent does not add asset metadata, source references,
    // paths, media bytes, or project context to this text-only review request.
    const prompt = generate.mock.calls[0]![0];
    const payload = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
    expect(Object.keys(payload).sort()).toEqual([
      "glossary",
      "language",
      "segments",
    ]);
    expect(payload.segments).toEqual(
      result.segments.map((segment) => ({
        segmentId: segment.id,
        text: segment.text,
      })),
    );
    expect(prompt).not.toContain(path);
    expect(prompt).not.toContain(directory);
    expect(prompt).not.toContain(pathToFileURL(path).href);
    expect(prompt).not.toContain(await hashFile(path));
    expect(prompt).not.toContain("Identity-only fixture");
    expect((await post("/review/consent", { allow: false })).status).toBe(200);
    const revoked = await (
      await post("/assets/audio/review", { source: "language" })
    ).json();
    expect((await job(revoked.job.id)).status).toBe("failed");
    expect(generate).toHaveBeenCalledOnce();
  });
  it("rejects consent that does not identify the displayed destination and complete data kinds", async () => {
    const generate = vi.fn(async () => '{"suggestions":[]}');
    const provider: LanguageProvider = {
      id: "disclosed-review",
      name: "Disclosure fixture",
      kind: "language",
      execution: "remote",
      endpoint: "https://review.invalid/approved",
      dataKinds: ["text", "transcripts", "metadata"],
      generate,
    };
    const { get, post, job } = await server({ languageProvider: provider });
    const disclosed = (await get("/review/provider")).provider;
    const grant = {
      allow: true,
      providerId: disclosed.id,
      endpoint: disclosed.endpoint,
      dataKinds: disclosed.dataKinds,
    };
    for (const input of [
      { allow: true },
      { ...grant, providerId: "another-provider" },
      { ...grant, endpoint: "https://review.invalid/undisclosed" },
      { ...grant, dataKinds: ["text", "transcripts"] },
      { ...grant, dataKinds: ["text", "transcripts", "metadata", "audio"] },
      { ...grant, dataKinds: ["text", "transcripts", "transcripts"] },
      { ...grant, dataKinds: "text,transcripts,metadata" },
      { ...grant, dataKinds: ["text", "transcripts", ["metadata"]] },
      { ...grant, sourcePath: "/untrusted/source" },
    ]) {
      const response = await post("/review/consent", input);
      expect(response.status, JSON.stringify(input)).toBe(400);
      expect((await response.json()).code).toBe("request.invalid");
      expect((await get("/review/provider")).available).toBe(false);
    }
    const denied = await (
      await post("/assets/audio/review", { source: "language" })
    ).json();
    expect((await job(denied.job.id)).status).toBe("failed");
    expect(generate).not.toHaveBeenCalled();
    // Disclosure order is presentation, not a different consent scope.
    expect(
      (
        await post("/review/consent", {
          ...grant,
          dataKinds: [...grant.dataKinds].reverse(),
        })
      ).status,
    ).toBe(200);
    expect((await get("/review/provider")).available).toBe(true);
  });
  it.each(["destination", "data kinds"] as const)(
    "keeps descriptor %s changes behind fresh registration and consent",
    async (changed) => {
      const generate = vi.fn(async () => '{"suggestions":[]}');
      const provider: LanguageProvider = {
        id: "changing-review",
        name: "Changed registration fixture",
        kind: "language",
        execution: "remote",
        endpoint: "https://review.invalid/original",
        dataKinds: ["text", "transcripts", "metadata"],
        generate,
      };
      const { get, post, job, app } = await server({
        languageProvider: provider,
      });
      const disclosure = (await get("/review/provider")).provider;
      const grant = {
        allow: true,
        providerId: disclosure.id,
        endpoint: disclosure.endpoint,
        dataKinds: disclosure.dataKinds,
      };
      expect((await post("/review/consent", grant)).status).toBe(200);
      if (changed === "destination")
        provider.endpoint = "https://review.invalid/changed";
      else provider.dataKinds = [...provider.dataKinds, "audio"];
      expect((await get("/review/provider")).available).toBe(false);
      expect((await post("/review/consent", grant)).status).toBe(400);
      const denied = await (
        await post("/assets/audio/review", { source: "language" })
      ).json();
      expect((await job(denied.job.id)).status).toBe("failed");
      expect(generate).not.toHaveBeenCalled();

      // Opening the project registers the trusted runtime's changed descriptor.
      // A stale browser disclosure still cannot authorize that new registration.
      expect((await post("/project/close", {})).status).toBe(200);
      expect(
        (await post("/project/open", { path: app.directory })).status,
      ).toBe(200);
      expect((await post("/review/consent", grant)).status).toBe(400);
      const fresh = (await get("/review/provider")).provider;
      expect(
        (
          await post("/review/consent", {
            allow: true,
            providerId: fresh.id,
            endpoint: fresh.endpoint,
            dataKinds: fresh.dataKinds,
          })
        ).status,
      ).toBe(200);
      const started = await (
        await post("/assets/audio/review", { source: "language" })
      ).json();
      expect((await job(started.job.id)).status).toBe("completed");
      expect(generate).toHaveBeenCalledOnce();
    },
  );
  it("requires consent for only the configured remote provider and persists batch failures for retry/skip", async () => {
    let fail = true;
    const generate = vi.fn(async (prompt: string) => {
      if (fail) throw new Error("fixture temporary provider failure");
      const data = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
      return JSON.stringify({
        suggestions: [
          {
            segmentId: data.segments[0].segmentId,
            after: "Corrected by explicit fixture",
            reason: "Test evidence only",
          },
        ],
      });
    });
    const provider: LanguageProvider = {
      id: "configured-review",
      name: "Remote contract fixture",
      kind: "language",
      execution: "remote",
      endpoint: "https://review.invalid",
      dataKinds: ["text", "transcripts"],
      generate,
    };
    const { get, post, job } = await server({ languageProvider: provider });
    expect((await get("/review/provider")).available).toBe(false);
    const denied = await (
      await post("/assets/audio/review", { source: "language" })
    ).json();
    expect((await job(denied.job.id)).status).toBe("failed");
    expect(generate).not.toHaveBeenCalled();
    expect(
      (
        await post("/review/consent", {
          allow: true,
          providerId: provider.id,
          endpoint: provider.endpoint,
          dataKinds: provider.dataKinds,
        })
      ).status,
    ).toBe(200);
    const run = await (
      await post("/assets/audio/review", { source: "language", batchSize: 1 })
    ).json();
    const failed = await job(run.job.id);
    expect(failed.status).toBe("failed");
    expect(
      (await get(`/review/jobs/${run.job.id}/batches`)).batches.length,
      JSON.stringify(failed),
    ).toBeGreaterThan(0);
    expect(
      (await get(`/review/jobs/${run.job.id}/batches`)).batches[0].status,
    ).toBe("failed");
    fail = false;
    expect(
      (await post(`/review/jobs/${run.job.id}/batches/0/retry`, {})).status,
    ).toBe(202);
    expect((await job(run.job.id)).status).toBe("completed");
    const beforeInvalidRetry = await job(run.job.id);
    expect(
      (await post(`/review/jobs/${run.job.id}/batches/99/retry`, {})).status,
    ).toBe(400);
    expect(
      (await post(`/review/jobs/${run.job.id}/batches/0/retry`, {})).status,
    ).toBe(400);
    expect(await job(run.job.id)).toEqual(beforeInvalidRetry);
    expect((await get("/assets/audio/review/suggestions")).total).toBe(1);
    await post("/review/consent", { allow: false });
    expect((await get("/review/provider")).available).toBe(false);
  });
  it.each([
    ["missing source", 400, "media.missing"],
    ["stale transcript", 409, "review.suggestionStale"],
    ["unconfigured provider", 400, "review.providerUnavailable"],
  ] as const)(
    "returns the %s retry preparation error without rewriting its checkpoint",
    async (failure, status, code) => {
      const generate = vi.fn(async () => {
        throw new Error("fixture initial provider failure");
      });
      const { post, get, job, app, path, userDataDirectory } = await server({
        languageProvider: {
          id: "retry-preflight-fixture",
          name: "Retry preflight fixture",
          kind: "language",
          execution: "local",
          dataKinds: ["text", "transcripts"],
          generate,
        },
      });
      const started = await (
        await post("/assets/audio/review", { source: "language", batchSize: 1 })
      ).json();
      const originalJob = await job(started.job.id);
      expect(originalJob.status).toBe("failed");
      const originalBatches = await get(
        `/review/jobs/${started.job.id}/batches`,
      );
      expect(originalBatches.batches[0].status).toBe("failed");
      const calls = generate.mock.calls.length;
      let retryPost = post;
      if (failure === "missing source") await rm(path);
      else if (failure === "stale transcript") {
        const transcript = await get("/assets/audio/transcript");
        const edited = await post("/assets/audio/transcript/edit", {
          baseRevision: transcript.revision,
          requestId: "edit-before-retry",
          commands: [
            {
              type: "replace-text",
              segmentId: "segment-0",
              text: "A manual correction before retry.",
            },
          ],
        });
        expect(edited.status).toBe(200);
        expect((await edited.json()).revision).not.toBe(transcript.revision);
      } else {
        // Another normal application opens the existing ledger without any
        // language provider configured. It must report its unavailable capability.
        const runtime = await startServer({
          port: 0,
          project: app.directory,
          userDataDirectory,
        });
        cleanups.push(() => runtime.close());
        const base = `http://127.0.0.1:${runtime.port}/api`;
        expect(await (await fetch(base + "/review/provider")).json()).toEqual({
          configured: false,
          available: false,
        });
        retryPost = (path, data) =>
          fetch(base + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
      }
      const rejected = await retryPost(
        `/review/jobs/${started.job.id}/batches/0/retry`,
        {},
      );
      expect(rejected.status).toBe(status);
      expect(await rejected.json()).toMatchObject({ code });
      expect(await job(started.job.id)).toEqual(originalJob);
      expect(await get(`/review/jobs/${started.job.id}/batches`)).toEqual(
        originalBatches,
      );
      expect(generate).toHaveBeenCalledTimes(calls);
      await expect
        .poll(async () => (await post("/project/close", {})).status)
        .toBe(200);
      expect(
        (await post("/project/open", { path: app.directory })).status,
      ).toBe(200);
      expect(await job(started.job.id)).toEqual(originalJob);
      expect(await get(`/review/jobs/${started.job.id}/batches`)).toEqual(
        originalBatches,
      );
      expect(generate).toHaveBeenCalledTimes(calls);
    },
  );
  it("acknowledges an owned retry before its deferred provider completes", async () => {
    let first = true,
      finished = false;
    let entered!: () => void, release!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async () => {
      if (first) {
        first = false;
        throw new Error("fixture initial provider failure");
      }
      entered();
      await providerGate;
      finished = true;
      return '{"suggestions":[]}';
    });
    const { post, get, job } = await server(
      {
        languageProvider: {
          id: "retry-ack-fixture",
          name: "Deferred retry fixture",
          kind: "language",
          execution: "local",
          dataKinds: ["text", "transcripts"],
          generate,
        },
      },
      [result.segments[0]!],
    );
    cleanups.push(release);
    const started = await (
      await post("/assets/audio/review", { source: "language" })
    ).json();
    expect(started.job.status).toBe("queued");
    const failed = await job(started.job.id);
    expect(failed.status).toBe("failed");
    let response: Response | undefined;
    const acknowledgement = post(
      `/review/jobs/${failed.id}/batches/0/retry`,
      {},
    ).then((value) => {
      response = value;
    });
    try {
      await providerEntered;
      await expect.poll(() => response?.status).toBe(202);
      expect(finished).toBe(false);
      const accepted = (await response!.json()).job as Job;
      expect(accepted).toMatchObject({ id: failed.id, status: "running" });
      expect(accepted.reviewOwner?.token).toBeDefined();
      expect(accepted.reviewOwner?.token).not.toBe(failed.reviewOwner?.token);
      expect(
        (await get("/jobs")).jobs.find((value: Job) => value.id === failed.id),
      ).toMatchObject({ status: "running", reviewOwner: accepted.reviewOwner });
      expect(
        (await get(`/review/jobs/${failed.id}/batches`)).batches[0].status,
      ).toBe("running");
      expect(generate).toHaveBeenCalledTimes(2);
    } finally {
      release();
      await acknowledgement;
    }
    expect((await job(failed.id)).status).toBe("completed");
    expect(finished).toBe(true);
  });
  it("keeps cancellation available and blocks project switching while a review owns the project", async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const provider: LanguageProvider = {
      id: "cancellable-review",
      name: "Cancellation fixture",
      kind: "language",
      execution: "local",
      dataKinds: ["text", "transcripts"],
      async generate(_prompt, options) {
        entered();
        await new Promise<void>((_resolve, reject) => {
          const abort = () =>
            reject(new DOMException("Cancelled", "AbortError"));
          if (options?.signal?.aborted) abort();
          else
            options?.signal?.addEventListener("abort", abort, { once: true });
        });
        return '{"suggestions":[]}';
      },
    };
    const { post, job } = await server({ languageProvider: provider });
    const response = await post("/assets/audio/review", { source: "language" });
    expect(response.status).toBe(202);
    const id = (await response.json()).job.id;
    await started;
    expect((await post("/project/close", {})).status).toBe(409);
    expect(
      (await post("/assets/audio/review", { source: "glossary" })).status,
    ).toBe(409);
    expect((await post(`/jobs/${id}/cancel`, {})).status).toBe(200);
    expect((await job(id)).status).toBe("cancelled");
    expect((await post(`/review/jobs/${id}/batches/0/skip`, {})).status).toBe(
      200,
    );
    expect((await post("/project/close", {})).status).toBe(200);
  });
  it.each(["project", "global"])(
    "CLI glossary preserves defaults and supports reversible case matching in %s scope",
    async (scope) => {
      const setup = await fixture();
      setup.close();
      const cli = async (args: string[]) =>
        JSON.parse(
          (
            await runProcess(process.execPath, [
              "--import",
              "tsx",
              resolve("apps/cli/src/index.ts"),
              "glossary",
              ...args,
              "--scope",
              scope,
              "--project",
              setup.app.directory,
              "--user-data-dir",
              setup.userDataDirectory,
            ])
          ).stdout.toString(),
        );
      const { entry } = await cli([
        "add",
        "--source",
        "YouTube",
        "--replacement",
        "YouTube channel",
      ]);
      expect(entry.caseSensitive).toBe(true);
      const { entry: insensitive } = await cli([
        "add",
        "--source",
        "OpenFilm",
        "--replacement",
        "OpenFilm app",
        "--case-insensitive",
      ]);
      expect(insensitive.caseSensitive).toBe(false);
      const update = ["update", "--id", entry.id];
      expect(
        (await cli([...update, "--case-insensitive"])).entry.caseSensitive,
      ).toBe(false);
      expect(
        (await cli([...update, "--replacement", "YouTube official"])).entry
          .caseSensitive,
      ).toBe(false);
      expect(
        (await cli([...update, "--case-sensitive"])).entry.caseSensitive,
      ).toBe(true);
      expect(
        (await cli([...update, "--replacement", "YouTube memories"])).entry
          .caseSensitive,
      ).toBe(true);
      const before = await cli(["list"]);
      await expect(
        cli([
          ...update,
          "--case-sensitive",
          "--case-insensitive",
          "--replacement",
          "Must not persist",
        ]),
      ).rejects.toThrow(
        "Choose either --case-sensitive or --case-insensitive.",
      );
      await expect(
        cli([
          "add",
          "--source",
          "Must not exist",
          "--replacement",
          "Conflict",
          "--case-insensitive",
          "--case-sensitive",
        ]),
      ).rejects.toThrow(
        "Choose either --case-sensitive or --case-insensitive.",
      );
      expect(await cli(["list"])).toEqual(before);
    },
  );
  it("CLI keeps machine-readable output and edits/searches/reviews using bounded JSON commands", async () => {
    const setup = await fixture();
    const original = await setup.app.transcriptEditor.get("audio");
    setup.close();
    const cli = async (args: string[]) =>
      JSON.parse(
        (
          await runProcess(process.execPath, [
            "--import",
            "tsx",
            resolve("apps/cli/src/index.ts"),
            ...args,
            "--project",
            setup.app.directory,
            "--user-data-dir",
            setup.userDataDirectory,
          ])
        ).stdout.toString(),
      );
    const commandPath = join(setup.directory, "編輯 # &.json");
    await writeFile(
      commandPath,
      JSON.stringify({
        baseRevision: original.revision,
        requestId: "cli-edit",
        commands: [
          {
            type: "replace-text",
            segmentId: "segment-0",
            text: "Visit youtube today",
          },
        ],
      }),
    );
    expect(
      (await cli(["transcript", "edit", "audio", "--commands", commandPath]))
        .document.segments[0].text,
    ).toBe("Visit youtube today");
    expect(
      (await cli(["transcript", "search", "audio", "--query", "youtube"]))
        .totalMatches,
    ).toBe(1);
    expect(
      (await cli(["transcript", "audio"])).transcript.segments[0].text,
    ).toBe("Visit youtube today");
    const { entry } = await cli([
      "glossary",
      "add",
      "--source",
      "youtube",
      "--replacement",
      "YouTube",
    ]);
    expect(entry.scope).toBe("project");
    expect((await cli(["review", "run", "audio"])).job.status).toBe(
      "completed",
    );
    const { suggestions } = await cli(["review", "list", "audio"]);
    expect(suggestions).toHaveLength(1);
    expect(
      (await cli(["review", "skip", suggestions[0].id])).suggestion.status,
    ).toBe("skipped");
    await writeFile(commandPath, " ".repeat(1024 * 1024 + 1));
    await expect(
      cli(["transcript", "edit", "audio", "--commands", commandPath]),
    ).rejects.toThrow("1 MiB");
  });
});

describe("transcription terminology and revision concurrency", () => {
  it.each([true, false])(
    "forwards glossary context only to supporting providers (%s), never rewrites output",
    async (supports) => {
      const { app } = await fixture();
      app.knowledge.glossaryUpsert({
        scope: "project",
        source: "youtube",
        replacement: "YouTube",
      });
      let received: TranscriptionOptions | undefined;
      app.intelligence.registerTranscriptionProvider(
        transcription(async (_asset, options) => {
          received = options;
          return result;
        }, supports),
      );
      expect(
        (await app.analyzeIntelligence("audio", { operation: "transcribe" }))
          .status,
      ).toBe("completed");
      expect(received?.promptHints).toEqual(supports ? ["YouTube"] : undefined);
      expect(
        (await app.transcriptEditor.get("audio")).document?.segments[0]?.text,
      ).toBe("Visit youtube");
    },
  );
  it("does not let an in-flight provider overwrite a concurrent user edit or append a failed revision", async () => {
    const { app } = await fixture();
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.intelligence.registerTranscriptionProvider(
      transcription(async () => {
        started();
        await gate;
        return result;
      }),
    );
    const pending = app.analyzeIntelligence("audio", {
      operation: "transcribe",
    });
    await entered;
    const before = await app.transcriptEditor.get("audio");
    const edited = await app.transcriptEditor.edit("audio", {
      baseRevision: before.revision!,
      requestId: "during-asr",
      commands: [
        {
          type: "replace-text",
          segmentId: "segment-0",
          text: "User text wins",
        },
      ],
    });
    const revisions = await app.transcriptEditor.revisions("audio");
    release();
    const job = await pending;
    expect(job.status).toBe("failed");
    expect(job.errors?.[0]?.code).toBe("transcript.revisionConflict");
    expect((await app.transcriptEditor.get("audio")).revision).toBe(
      edited.revision,
    );
    expect((await app.transcriptEditor.revisions("audio")).total).toBe(
      revisions.total,
    );
  });
});
