import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

const suggestion = () => ({
  id: "script-suggestion",
  kind: "scene-script",
  target: { storyId: "story", beatId: "beat", field: "narration" },
  sourceRevisionId: "source-revision",
  before: "Original script",
  after: "Suggested script",
  reason: "A more concrete opening.",
  source: { type: "provider", id: "language" },
  status: "pending",
  createdAt: "2026-10-16T00:00:00Z",
});

describe("scene script review evidence", () => {
  it("retains real story, beat and field identity without a transcript target", () => {
    expect(core.validateReviewSuggestion(suggestion()).target).toEqual(
      suggestion().target,
    );
    expect(() =>
      core.validateTranscriptReviewSuggestion(suggestion()),
    ).toThrow();
    expect(core.validateSceneScriptReviewSuggestion(suggestion())).toEqual(
      suggestion(),
    );
  });

  it.each(["story\u0000\ud800", "scene-" + "x".repeat(300)])(
    "preserves existing opaque Story and beat IDs: %j",
    (id) => {
      const value = {
        ...suggestion(),
        target: { storyId: id, beatId: id, field: "visualDirection" },
      };
      expect(core.validateSceneScriptReviewSuggestion(value).target).toEqual(
        value.target,
      );
    },
  );

  it.each([
    { kind: "transcript-correction" },
    { target: { storyId: "story", beatId: "beat", field: "title" } },
    {
      target: {
        storyId: "story",
        beatId: "beat",
        field: "narration",
        assetId: "asset",
      },
    },
    { target: { storyId: "", beatId: "beat", field: "narration" } },
    { source: { type: "rule", id: "rule" } },
    { after: "x".repeat(8001) },
    { before: "x".repeat(8001) },
    { after: "\ud800" },
    { after: "bad\u0000text" },
  ])("rejects an invalid scene script envelope %j", (patch) => {
    expect(core.validateSceneScriptReviewSuggestion).toBeTypeOf("function");
    expect(() =>
      core.validateSceneScriptReviewSuggestion({ ...suggestion(), ...patch }),
    ).toThrow();
  });

  it("counts script limits in Unicode code points", () => {
    const value = { ...suggestion(), after: "😀".repeat(8000) };
    expect(core.validateSceneScriptReviewSuggestion(value).after).toBe(
      value.after,
    );
    expect(() =>
      core.validateSceneScriptReviewSuggestion({
        ...value,
        after: value.after + "😀",
      }),
    ).toThrow();
  });
});

describe("project script review receipts", () => {
  const receipt = () => ({
    suggestionId: "suggestion",
    requestId: "request",
    evidenceHash: "hash",
    acceptedRevisionId: "accepted-revision",
    acceptedAt: "2026-10-16T00:00:00Z",
  });

  it("preserves receipt evidence while old projects remain valid", () => {
    const legacy = core.createProject("Legacy");
    expect(core.validateProject(legacy)).toEqual(legacy);
    const value = { ...legacy, sceneScriptReviewReceipts: [receipt()] };
    expect(core.validateProject(value)).toEqual(value);
  });

  it("rejects one acceptance request reused for different suggestion evidence", () => {
    const value = {
      ...core.createProject("Restored film"),
      sceneScriptReviewReceipts: [
        receipt(),
        { ...receipt(), suggestionId: "another-suggestion" },
      ],
    };
    expect(() => core.validateProject(value)).toThrow(/requestId/);
    expect(() => core.migrateProject(value)).toThrow(/requestId/);
  });

  it("preserves distinct request identities across multiple restored receipts", () => {
    const value = {
      ...core.createProject("Restored film"),
      sceneScriptReviewReceipts: [
        receipt(),
        {
          ...receipt(),
          suggestionId: "another-suggestion",
          requestId: "another-request",
        },
      ],
    };
    expect(core.validateProject(value)).toEqual(value);
    expect(core.migrateProject(value)).toEqual(value);
  });

  it.each(
    ["suggestionId", "requestId", "evidenceHash", "acceptedRevisionId"].flatMap(
      (field) =>
        [
          "x".repeat(257),
          "bad\nid",
          "bad\tid",
          "bad\u0000id",
          "bad\u007fid",
          "\ud800",
          "\udc00",
        ].map((value) => ({ field, value })),
    ),
  )(
    "rejects malformed persisted receipt $field: $value",
    ({ field, value }) => {
      const project = {
        ...core.createProject("Restored film"),
        sceneScriptReviewReceipts: [{ ...receipt(), [field]: value }],
      };
      expect(() => core.validateProject(project)).toThrow(field);
      expect(() => core.migrateProject(project)).toThrow(field);
    },
  );

  it.each(
    ["suggestionId", "requestId", "evidenceHash", "acceptedRevisionId"].flatMap(
      (field) =>
        ["x".repeat(256), "😀".repeat(128)].map((value) => ({ field, value })),
    ),
  )(
    "preserves well-formed receipt $field at the 256-unit boundary",
    ({ field, value }) => {
      const project = {
        ...core.createProject("Restored film"),
        sceneScriptReviewReceipts: [{ ...receipt(), [field]: value }],
      };
      expect(core.validateProject(project)).toEqual(project);
      expect(core.migrateProject(project)).toEqual(project);
    },
  );

  it.each(
    [
      [receipt(), receipt()],
      [{ ...receipt(), acceptedAt: "2026-02-30T00:00:00Z" }],
      [{ ...receipt(), requestId: " " }],
      [{ ...receipt(), evidenceHash: "" }],
      [{ ...receipt(), acceptedRevisionId: "" }],
      Array.from({ length: 10001 }, (_, index) => ({
        ...receipt(),
        suggestionId: String(index),
      })),
    ].map((receipts) => ({ receipts })),
  )(
    "rejects malformed, duplicate or excessive receipt evidence",
    ({ receipts }) => {
      expect(() =>
        core.validateProject({
          ...core.createProject("Film"),
          sceneScriptReviewReceipts: receipts,
        }),
      ).toThrow();
    },
  );

  it("validates optional real Story job scope", () => {
    const job = {
      id: "script-job",
      type: "scene-script-review",
      status: "running",
      storyId: "story",
      beatId: "beat",
      scriptField: "narration",
    };
    expect(core.validateJob(job)).toEqual(job);
    expect(() => core.validateJob({ ...job, scriptField: "title" })).toThrow();
    expect(() => core.validateJob({ ...job, storyId: " " })).toThrow();
  });
});
