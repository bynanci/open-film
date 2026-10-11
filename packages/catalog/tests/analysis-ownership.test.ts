import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import type {
  Job,
  SceneAnalysis,
  TranscriptDocument,
  WaveformData,
} from "@openfilm/core";
import { CATALOG_SCHEMA_VERSION, ProjectCatalog } from "../src/index.js";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const hash = "a".repeat(64);
const operations = ["transcribe", "waveform", "scenes"] as const;
type Operation = (typeof operations)[number];
const provenance = {
  providerId: "catalog-control-flow-fixture",
  version: "1",
  sourceHash: hash,
  createdAt: "2026-10-07T00:00:00Z",
};
function job(
  type: Operation = "transcribe",
  status: Job["status"] = "queued",
  token = "original",
): Job {
  return {
    id: "analysis",
    type,
    assetId: "source",
    status,
    analysisOwner: { host: "not-liveness-evidence", pid: 1, token },
    createdAt: "2026-10-07T00:00:00Z",
    updatedAt: "2026-10-07T00:00:01Z",
  };
}
function transcript(id: string): TranscriptDocument {
  return {
    id,
    assetId: "source",
    language: "en",
    provenance: { ...provenance },
    segments: [
      {
        id: "speech",
        start: 0,
        end: 1,
        text: id,
        words: [{ start: 0, end: 1, text: id }],
      },
    ],
  };
}
function waveform(value: number): WaveformData {
  return {
    assetId: "source",
    duration: 4,
    sampleRate: 1,
    peaks: [value, value, value, value],
    provenance: { ...provenance },
  };
}
function scenes(id: string): SceneAnalysis {
  return {
    assetId: "source",
    provenance: { ...provenance },
    markers: [{ id, assetId: "source", type: "scene-cut", time: 2 }],
  };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-analysis-owner-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const first = new ProjectCatalog(directory),
    second = new ProjectCatalog(directory);
  cleanup.push(
    () => first.close(),
    () => second.close(),
  );
  first.upsertAsset({
    id: "source",
    uri: "file:///identity-only.mp4",
    name: "Control-flow fixture",
    mediaType: "video",
    duration: 4,
    contentHash: hash,
    metadata: {},
    tags: [],
    state: { locked: true },
  });
  const database = new DatabaseSync(join(directory, "database.sqlite"));
  cleanup.push(() => database.close());
  const read = (operation: Operation) =>
    operation === "transcribe"
      ? second.transcripts.get("source", hash)
      : operation === "waveform"
        ? second.intelligence.getWaveform("source", hash)
        : second.intelligence.getScenes("source", hash);
  const write = (
    operation: Operation,
    current: boolean,
    ownedCompletion?: Job,
    expectedRevision?: string | null,
  ) => {
    if (operation === "transcribe")
      first.intelligence.replaceTranscript(
        transcript(current ? "current" : "stale"),
        {
          ownedCompletion,
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
        },
      );
    else if (operation === "waveform")
      first.intelligence.saveWaveform(waveform(current ? 0.8 : 0.2), {
        ownedCompletion,
      });
    else
      first.intelligence.saveScenes(scenes(current ? "current" : "stale"), {
        ownedCompletion,
      });
  };
  return {
    first,
    second,
    database,
    read,
    write,
    storedJob: () => second.listJobs().find((j) => j.id === "analysis"),
  };
}

it.each(operations)(
  "rejects late %s completion after owner rotation and preserves current analysis",
  async (operation) => {
    const f = await fixture();
    f.write(operation, true);
    const owned = job(operation, "running"),
      recovered = job(operation, "failed", "recovered");
    f.first.saveJob(owned);
    f.second.saveJob(recovered);
    const before = f.read(operation);
    expect(() =>
      f.write(operation, false, { ...owned, status: "completed" }),
    ).toThrowError(expect.objectContaining({ status: 409 }));
    expect(f.read(operation)).toEqual(before);
    expect(f.storedJob()).toEqual(recovered);
  },
);

it.each(operations)(
  "commits %s result and terminal job together for the current running owner",
  async (operation) => {
    const f = await fixture(),
      running = job(operation, "running"),
      completed = { ...running, status: "completed" as const };
    f.first.saveJob(running);
    f.write(
      operation,
      true,
      completed,
      operation === "transcribe" ? null : undefined,
    );
    expect(f.read(operation)).toBeDefined();
    expect(f.storedJob()).toEqual(completed);
    expect(f.database.prepare("PRAGMA user_version").get()?.user_version).toBe(
      CATALOG_SCHEMA_VERSION,
    );
  },
);

it.each(operations)(
  "cannot resurrect same-token failed %s jobs by saving results",
  async (operation) => {
    const f = await fixture(),
      failed = job(operation, "failed");
    f.first.saveJob(failed);
    expect(() =>
      f.write(operation, false, { ...failed, status: "completed" }),
    ).toThrowError(expect.objectContaining({ status: 409 }));
    if (operation === "transcribe")
      expect(f.read(operation)).toMatchObject({ total: 0 });
    else expect(f.read(operation)).toBeUndefined();
    expect(f.storedJob()).toEqual(failed);
  },
);

it.each(["queued", "completed"] as const)(
  "does not publish a transcript for a same-token %s execution",
  async (status) => {
    const f = await fixture(),
      observed = job("transcribe", status);
    f.first.saveJob(observed);
    expect(() =>
      f.write("transcribe", false, { ...observed, status: "completed" }),
    ).toThrowError(expect.objectContaining({ status: 409 }));
    expect(f.read("transcribe")).toMatchObject({ total: 0 });
    expect(f.storedJob()).toEqual(observed);
  },
);

it.each(operations)(
  "rolls back %s insertion when terminal job persistence fails",
  async (operation) => {
    const f = await fixture(),
      running = job(operation, "running");
    f.write(operation, true);
    f.first.saveJob(running);
    const before = f.read(operation);
    f.database.exec(
      `CREATE TRIGGER reject_analysis_finish BEFORE UPDATE ON jobs WHEN json_extract(NEW.data,'$.status')='completed' BEGIN SELECT RAISE(ABORT,'injected terminal write failure'); END`,
    );
    expect(() =>
      f.write(operation, false, { ...running, status: "completed" }),
    ).toThrow("injected terminal write failure");
    expect(f.read(operation)).toEqual(before);
    expect(f.storedJob()).toEqual(running);
  },
);

it("keeps manual revisions and undo history when owner or expected revision completion is stale", async () => {
  const f = await fixture();
  f.write("transcribe", true);
  const initial = f.second.transcripts.get("source", hash);
  const edited = f.second.transcripts.edit("source", hash, {
    baseRevision: initial.revision!,
    requestId: "manual-edit",
    commands: [
      { type: "replace-text", segmentId: "speech", text: "Keep manual text" },
    ],
  });
  const running = job("transcribe", "running");
  f.first.saveJob(running);
  expect(() =>
    f.write(
      "transcribe",
      false,
      { ...running, status: "completed" },
      initial.revision,
    ),
  ).toThrowError(
    expect.objectContaining({ code: "transcript.revisionConflict" }),
  );
  expect(f.read("transcribe")).toEqual(edited);
  expect(f.storedJob()).toEqual(running);
  const recovered = job("transcribe", "failed", "successor");
  f.second.saveJob(recovered);
  expect(() =>
    f.write(
      "transcribe",
      false,
      { ...running, status: "completed" },
      edited.revision,
    ),
  ).toThrowError(expect.objectContaining({ status: 409 }));
  expect(f.read("transcribe")).toEqual(edited);
  expect(
    f.database
      .prepare("SELECT COUNT(*) AS count FROM intelligence_transcripts")
      .get()?.count,
  ).toBe(2);
  expect(
    f.second.transcripts.undo("source", hash, {
      baseRevision: edited.revision!,
      requestId: "undo-preserved-edit",
    }).document?.segments[0]?.text,
  ).toBe("current");
});

it.each(operations)(
  "rejects a changed source without completing the owned %s job",
  async (operation) => {
    const f = await fixture(),
      running = job(operation, "running");
    f.first.saveJob(running);
    f.second.upsertAsset({
      ...f.second.getAsset("source")!,
      contentHash: "b".repeat(64),
    });
    expect(() =>
      f.write(operation, false, { ...running, status: "completed" }),
    ).toThrow("Analysis source is missing or has changed");
    expect(f.storedJob()).toEqual(running);
  },
);

it.each(operations)(
  "reserves one project analysis atomically against active %s jobs",
  async (operation) => {
    const f = await fixture(),
      queued = job(operation);
    f.first.intelligence.reserveAnalysisJob(queued);
    expect(() =>
      f.second.intelligence.reserveAnalysisJob({
        ...job("waveform"),
        id: "second",
        assetId: "another-asset",
      }),
    ).toThrowError(expect.objectContaining({ code: "jobs.busy", status: 409 }));
    expect(f.second.listJobs()).toEqual([queued]);
  },
);

it("does not reuse an unrelated terminal job ID or leave a reservation after validation failure", async () => {
  const f = await fixture(),
    historical = { ...job("scenes", "completed"), assetId: "another-asset" };
  f.first.saveJob(historical);
  expect(() => f.second.intelligence.reserveAnalysisJob(job())).toThrowError(
    expect.objectContaining({ status: 409 }),
  );
  expect(f.second.listJobs()).toEqual([historical]);
  expect(() =>
    f.second.intelligence.reserveAnalysisJob({
      ...job(),
      id: "invalid",
      analysisOwner: { ...job().analysisOwner!, pid: 0 },
    }),
  ).toThrowError(expect.objectContaining({ status: 400 }));
  expect(f.second.listJobs()).toEqual([historical]);
});

it("claims an exact queued reservation once and blocks queue replay through progress writes", async () => {
  const f = await fixture(),
    queued = job(),
    running = job("transcribe", "running");
  f.first.intelligence.reserveAnalysisJob(queued);
  expect(f.first.intelligence.claimAnalysisReservation(queued, running)).toBe(
    true,
  );
  expect(f.second.intelligence.claimAnalysisReservation(queued, running)).toBe(
    false,
  );
  expect(f.second.intelligence.saveOwnedAnalysisJob(queued)).toBe(false);
  expect(f.storedJob()).toEqual(running);
  const cancelled = { ...running, status: "cancelled" as const };
  expect(f.first.intelligence.saveOwnedAnalysisJob(cancelled)).toBe(true);
  expect(f.first.intelligence.saveOwnedAnalysisJob(running)).toBe(false);
  expect(f.storedJob()).toEqual(cancelled);
});

it("publishes owned progress only for the current operation, asset, owner and active checkpoint", async () => {
  const f = await fixture(),
    running = job("waveform", "running");
  f.first.saveJob(running);
  const progress = { ...running, progress: 0.5 };
  expect(f.first.intelligence.saveOwnedAnalysisJob(progress)).toBe(true);
  for (const mismatch of [
    { type: "scenes" },
    { assetId: "other" },
    { analysisOwner: { ...running.analysisOwner!, token: "stale" } },
    { analysisOwner: { ...running.analysisOwner!, pid: 2 } },
    { analysisOwner: { ...running.analysisOwner!, host: "foreign" } },
  ])
    expect(
      f.second.intelligence.saveOwnedAnalysisJob({ ...progress, ...mismatch }),
    ).toBe(false);
  expect(f.storedJob()).toEqual(progress);
});

it("recovers only an unchanged active checkpoint with a new token, fencing initial queued claims", async () => {
  const f = await fixture(),
    queued = job(),
    recovered = job("transcribe", "failed", "recovered");
  f.first.intelligence.reserveAnalysisJob(queued);
  expect(() =>
    f.second.intelligence.recoverAnalysisJob(queued, {
      ...recovered,
      analysisOwner: queued.analysisOwner,
    }),
  ).toThrowError(expect.objectContaining({ status: 400 }));
  expect(f.second.intelligence.recoverAnalysisJob(queued, recovered)).toBe(
    true,
  );
  expect(
    f.first.intelligence.claimAnalysisReservation(
      queued,
      job("transcribe", "running"),
    ),
  ).toBe(false);
  expect(
    f.first.intelligence.saveOwnedAnalysisJob({ ...queued, status: "failed" }),
  ).toBe(false);
  expect(f.first.intelligence.recoverAnalysisJob(queued, recovered)).toBe(
    false,
  );
  expect(f.storedJob()).toEqual(recovered);
});

it("does not recover a queued snapshot after a competing connection claims it", async () => {
  const f = await fixture(),
    queued = job(),
    running = job("transcribe", "running");
  f.first.intelligence.reserveAnalysisJob(queued);
  expect(f.second.intelligence.claimAnalysisReservation(queued, running)).toBe(
    true,
  );
  expect(
    f.first.intelligence.recoverAnalysisJob(
      queued,
      job("transcribe", "failed", "recovered"),
    ),
  ).toBe(false);
  expect(f.storedJob()).toEqual(running);
});

it("allows exact explicit recovery of ownerless legacy analysis without silently claiming it", async () => {
  const f = await fixture(),
    legacy = { ...job(), analysisOwner: undefined };
  f.first.saveJob(legacy);
  expect(
    f.second.intelligence.recoverAnalysisJob(
      legacy,
      job("transcribe", "failed", "recovered"),
    ),
  ).toBe(true);
  expect(f.storedJob()?.analysisOwner?.token).toBe("recovered");
});

it.each([
  { id: " " },
  { assetId: "" },
  { type: "import" },
  { status: "completed" },
  { analysisOwner: undefined },
  { analysisOwner: { host: "", pid: 1, token: "valid" } },
  { analysisOwner: { host: "valid", pid: 1, token: " " } },
  { progress: Number.NaN },
])("rejects invalid analysis reservations: %j", async (patch) => {
  const f = await fixture();
  expect(() =>
    f.first.intelligence.reserveAnalysisJob({ ...job(), ...patch } as Job),
  ).toThrowError(expect.objectContaining({ status: 400 }));
  expect(f.second.listJobs()).toEqual([]);
});

it.each([
  { assetId: "another-source" },
  { type: "waveform" },
  { analysisOwner: undefined },
  { status: "running" },
])(
  "rejects invalid completion targets before publishing: %j",
  async (patch) => {
    const f = await fixture(),
      running = job("transcribe", "running");
    f.first.saveJob(running);
    expect(() =>
      f.write("transcribe", false, {
        ...running,
        status: "completed",
        ...patch,
      } as Job),
    ).toThrowError(
      expect.objectContaining({ code: "request.invalid", status: 400 }),
    );
    expect(f.read("transcribe")).toMatchObject({ total: 0 });
    expect(f.storedJob()).toEqual(running);
  },
);

it("cannot bypass the queued claim with owned running or completed notifications", async () => {
  const f = await fixture(),
    queued = job();
  f.first.intelligence.reserveAnalysisJob(queued);
  expect(
    f.second.intelligence.saveOwnedAnalysisJob({
      ...queued,
      status: "running",
    }),
  ).toBe(false);
  expect(
    f.second.intelligence.saveOwnedAnalysisJob({
      ...queued,
      status: "completed",
    }),
  ).toBe(false);
  expect(f.storedJob()).toEqual(queued);
});

it("does not change reservations when a claim changes its operation, asset or owner", async () => {
  const f = await fixture(),
    queued = job();
  f.first.intelligence.reserveAnalysisJob(queued);
  for (const patch of [
    { type: "waveform" },
    { assetId: "other" },
    { analysisOwner: { ...queued.analysisOwner!, token: "other" } },
  ])
    expect(() =>
      f.second.intelligence.claimAnalysisReservation(queued, {
        ...queued,
        status: "running",
        ...patch,
      } as Job),
    ).toThrowError(expect.objectContaining({ status: 400 }));
  expect(f.storedJob()).toEqual(queued);
});
