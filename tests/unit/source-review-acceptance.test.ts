import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSourceReviewAcceptance,
  readSourceReviewAcceptance,
  retainSourceReviewAcceptance,
  type PendingSourceReviewAcceptance,
} from "../../apps/desktop/src/source-review-acceptance.js";

let storage: Map<string, string>;
const receipt = (): PendingSourceReviewAcceptance => ({
  version: 1,
  runId: "run-1",
  payload: {
    projectId: "project-a",
    operation: { kind: "reject-results", resultIds: ["result-1"] },
    expectedManifestId: "verified-1",
    expectedBeforeFingerprint: "a".repeat(64),
    expectedOperationFingerprint: "b".repeat(64),
    requestId: "request-1",
  },
});
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("private source-review recovery", () => {
  it("isolates project receipts and refuses to overwrite an unresolved operation", () => {
    const original = receipt();
    retainSourceReviewAcceptance(original);
    expect(readSourceReviewAcceptance("project-b")).toBeUndefined();
    const changed = receipt();
    changed.payload.requestId = "another-request";
    expect(() => retainSourceReviewAcceptance(changed)).toThrow(
      "requires recovery",
    );
    expect(readSourceReviewAcceptance("project-a")).toEqual(original);
  });

  it("does not delete a replacement receipt when an earlier acknowledgment arrives", () => {
    const original = receipt();
    retainSourceReviewAcceptance(original);
    const key = [...storage.keys()][0]!;
    const changed = receipt();
    changed.payload.requestId = "another-request";
    storage.set(key, JSON.stringify(changed));
    expect(() => clearSourceReviewAcceptance(original)).toThrow(
      "changed before acknowledgment",
    );
    expect(readSourceReviewAcceptance("project-a")).toEqual(changed);
  });

  it.each([
    { operation: { kind: "execute-script", script: "untrusted()" } },
    {
      operation: {
        kind: "reject-results",
        resultIds: ["result-1"],
        url: "https://invalid.example",
      },
    },
    { projectId: "project-b" },
    { expectedBeforeFingerprint: "invalid-fingerprint" },
    { requestId: "x".repeat(513) },
    {
      operation: {
        kind: "split-result",
        resultId: "result-1",
        ranges: [
          { assetId: "asset-1", start: 3, end: 1 },
          { assetId: "asset-1", start: 2, end: 4 },
        ],
      },
    },
  ])(
    "rejects altered local payloads without deleting the recovery evidence: %j",
    (patch) => {
      retainSourceReviewAcceptance(receipt());
      const key = [...storage.keys()][0]!;
      const corrupted = receipt();
      Object.assign(corrupted.payload, patch);
      const raw = JSON.stringify(corrupted);
      storage.set(key, raw);
      expect(() => readSourceReviewAcceptance("project-a")).toThrow();
      expect(storage.get(key)).toBe(raw);
    },
  );

  it("rejects oversized stored records before parsing or sending their payload", () => {
    retainSourceReviewAcceptance(receipt());
    const key = [...storage.keys()][0]!;
    storage.set(key, " ".repeat(128 * 1024 + 1));
    expect(() => readSourceReviewAcceptance("project-a")).toThrow(
      "exceeds its limit",
    );
    expect(storage.has(key)).toBe(true);
  });
});
