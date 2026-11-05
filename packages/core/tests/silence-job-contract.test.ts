import { expect, it } from "vitest";
import { createProject, validateJob, validateProject } from "../src/index.js";

const digest = (letter: string) => letter.repeat(64);

function silenceJob(status: string = "waiting-review") {
  return {
    id: "silence-job-1",
    type: "silence-analysis",
    status,
    assetId: "voice-1",
    progress: 1,
    analysisOwner: { host: "local-scope", pid: 17, token: "owner-token" },
    silenceAnalysis: {
      version: 1,
      projectId: "project-1",
      compositionId: "timeline-1",
      baseRevision: digest("a"),
      requestId: "create-1",
      requestFingerprint: digest("b"),
      options: {
        thresholdDb: -40,
        minimumSilenceSeconds: 0.5,
        paddingSeconds: 0.12,
      },
      sourceHash: digest("c"),
      reviewId: digest("d"),
      attempt: 1,
    },
  };
}

function applyReceipt() {
  return {
    version: 1,
    jobId: "silence-job-1",
    requestId: "apply-1",
    fingerprint: digest("a"),
    compositionId: "timeline-1",
    reviewId: digest("b"),
    baseRevision: digest("c"),
    appliedRevision: digest("d"),
    appliedAt: "2026-11-05T00:00:00.000Z",
  };
}

it("validates and round-trips waiting-review silence jobs with exact identities", () => {
  const value = silenceJob();
  expect(validateJob(value)).toEqual(value);
  const completed = {
    ...value,
    status: "completed",
    silenceAnalysis: {
      ...value.silenceAnalysis,
      applyRequestId: "apply-1",
      applyFingerprint: digest("e"),
      appliedRevision: digest("f"),
    },
  };
  expect(validateJob(completed)).toEqual(completed);
});

it("validates a selection-only Review Job as an all-or-nothing source identity", () => {
  const base = silenceJob();
  const derived = {
    ...base,
    id: "silence-derived-1",
    silenceAnalysis: {
      ...base.silenceAnalysis,
      requestId: "review-selection-1",
      requestFingerprint: digest("e"),
      parentJobId: base.id,
      sourceReviewId: digest("d"),
      selectedCandidateIds: ["silence-0001-1s-2o"],
    },
  };
  expect(validateJob(derived)).toEqual(derived);
  expect(() =>
    validateJob({
      ...derived,
      silenceAnalysis: {
        ...derived.silenceAnalysis,
        selectedCandidateIds: ["silence-0001-1s-2o", "silence-0001-1s-2o"],
      },
    }),
  ).toThrow(/duplicate candidate/u);
  expect(() =>
    validateJob({
      ...derived,
      silenceAnalysis: {
        ...derived.silenceAnalysis,
        sourceReviewId: undefined,
      },
    }),
  ).toThrow(/together/u);
});

it.each([
  { type: "transcribe" },
  { silenceAnalysis: undefined },
  {
    silenceAnalysis: { ...silenceJob().silenceAnalysis, sourceHash: undefined },
  },
  { silenceAnalysis: { ...silenceJob().silenceAnalysis, baseRevision: "bad" } },
  { silenceAnalysis: { ...silenceJob().silenceAnalysis, sourceHash: "bad" } },
  {
    silenceAnalysis: {
      ...silenceJob().silenceAnalysis,
      options: {
        thresholdDb: -9,
        minimumSilenceSeconds: 0.5,
        paddingSeconds: 0.12,
      },
    },
  },
  { analysisOwner: undefined },
])("rejects incomplete or invalid silence Job state: %j", (patch) => {
  expect(() =>
    validateJob({ ...silenceJob("running"), ...patch, status: "running" }),
  ).toThrow();
});

it("preserves valid project-scoped Apply receipts and rejects duplicate request identities", () => {
  const project = {
    ...createProject("Silence apply receipts"),
    silenceApplyReceipts: [applyReceipt()],
  };
  expect(validateProject(project)).toEqual(project);
  expect(validateProject(project).silenceApplyReceipts).not.toBe(
    project.silenceApplyReceipts,
  );
  expect(() =>
    validateProject({
      ...project,
      silenceApplyReceipts: [applyReceipt(), applyReceipt()],
    }),
  ).toThrow(/requestId|jobId/u);
});

it("rejects malformed Apply receipts and bounds the durable receipt history", () => {
  const valid = applyReceipt();
  expect(() =>
    validateProject({
      ...createProject("Bad silence receipt"),
      silenceApplyReceipts: [{ ...valid, appliedRevision: "short" }],
    }),
  ).toThrow(/appliedRevision/u);
  expect(() =>
    validateProject({
      ...createProject("Too many silence receipts"),
      silenceApplyReceipts: Array.from({ length: 201 }, (_, index) => ({
        ...valid,
        jobId: `job-${index}`,
        requestId: `request-${index}`,
      })),
    }),
  ).toThrow(/at most 200/u);
});
