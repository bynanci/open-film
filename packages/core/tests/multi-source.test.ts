import { describe, expect, it } from "vitest";
import {
  canTransitionAnalysisRun,
  canTransitionImportBatch,
  canTransitionJobAttempt,
} from "../src/index.js";

describe("multi-source lifecycle contracts", () => {
  it("allows an import retry without reopening a sealed batch", () => {
    expect(canTransitionImportBatch("sealing", "partial")).toBe(true);
    expect(canTransitionImportBatch("partial", "sealing")).toBe(true);
    expect(canTransitionImportBatch("failed", "sealing")).toBe(true);
    expect(canTransitionImportBatch("cancelled", "sealing")).toBe(true);
    expect(canTransitionImportBatch("sealed", "sealing")).toBe(false);
  });

  it("requeues a failed run but keeps a completed run terminal", () => {
    expect(canTransitionAnalysisRun("queued", "running")).toBe(true);
    expect(canTransitionAnalysisRun("running", "partial")).toBe(true);
    expect(canTransitionAnalysisRun("partial", "queued")).toBe(true);
    expect(canTransitionAnalysisRun("failed", "queued")).toBe(true);
    expect(canTransitionAnalysisRun("cancelled", "queued")).toBe(true);
    expect(canTransitionAnalysisRun("completed", "queued")).toBe(false);
  });

  it("never mutates a terminal attempt", () => {
    expect(canTransitionJobAttempt("queued", "running")).toBe(true);
    expect(canTransitionJobAttempt("running", "succeeded")).toBe(true);
    expect(canTransitionJobAttempt("running", "abandoned")).toBe(true);
    expect(canTransitionJobAttempt("failed", "queued")).toBe(false);
    expect(canTransitionJobAttempt("cancelled", "running")).toBe(false);
    expect(canTransitionJobAttempt("succeeded", "failed")).toBe(false);
  });
});
