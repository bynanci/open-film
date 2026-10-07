import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createWorkstationQaRecord,
  validateWorkstationQaRecord,
} from "../../scripts/workstation-qa";

const sha = "a".repeat(40);
const record = () => createWorkstationQaRecord(sha);
const passed = (observations: unknown[]) => ({
  status: "passed",
  completedAt: "2026-10-07T10:00:00Z",
  observations,
});
const positive = {
  check: "Real speech reference",
  status: "pass",
  actual: "Human reference compared",
  evidence: ["asr/result.json"],
};

function validateGate(gate: unknown): string[] {
  const value = record();
  return validateWorkstationQaRecord({
    ...value,
    gates: { ...value.gates, asr: gate },
  });
}

describe("workstation evidence validation boundaries", () => {
  it("creates independent not-run observations for every gate", () => {
    const value = record();
    expect(validateWorkstationQaRecord(value)).toEqual([]);
    value.gates.asr.observations.push({ check: "sample", status: "info" });
    expect(value.gates.llm.observations).toEqual([]);
  });

  it("returns errors rather than throwing for malformed observations", () => {
    for (const status of ["passed", "failed"])
      for (const malformed of [null, false, 42, [], {}]) {
        let errors: string[] = [];
        expect(() => {
          errors = validateGate({ ...passed([malformed]), status });
        }).not.toThrow();
        expect(errors.length).toBeGreaterThan(0);
      }
  });

  it("rejects info-only and unavailable-only pass claims", () => {
    for (const status of ["info", "unavailable"])
      expect(
        validateGate(passed([{ check: "Real speech", status }])).length,
      ).toBeGreaterThan(0);
    expect(
      validateGate(
        passed([positive, { check: "Playback", status: "unavailable" }]),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("requires actual results and nonblank evidence for pass observations", () => {
    for (const observation of [
      { check: "Real speech", status: "pass" },
      { ...positive, evidence: [" "] },
      { ...positive, evidence: [] },
      { ...positive, actual: "" },
    ])
      expect(validateGate(passed([observation])).length).toBeGreaterThan(0);
  });

  it("checks environment, nested input types and unsupported keys", () => {
    const value = record();
    for (const invalid of [
      { ...value, environment: [] },
      { ...value, environment: {} },
      { ...value, environment: { ...value.environment, memoryBytes: -1 } },
      { ...value, environment: { ...value.environment, extra: true } },
      { ...value, extra: true },
      { ...value, gates: { ...value.gates, other: value.gates.asr } },
    ])
      expect(validateWorkstationQaRecord(invalid).length).toBeGreaterThan(0);
    expect(
      validateGate({
        ...value.gates.asr,
        inputs: [{ label: "input", kind: "audio", sha256: "bad" }],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateGate({ ...value.gates.asr, notes: [false] }).length,
    ).toBeGreaterThan(0);
  });

  it("rejects naive timestamps, impossible dates and reversed intervals", () => {
    for (const createdAt of [
      "2026-02-30T12:00:00Z",
      "2026-10-07",
      "2026-10-07T10:00:00",
    ])
      expect(
        validateWorkstationQaRecord({ ...record(), createdAt }).length,
      ).toBeGreaterThan(0);
    expect(
      validateGate({
        ...passed([positive]),
        startedAt: "2026-10-07T11:00:00Z",
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateWorkstationQaRecord({
        ...record(),
        createdAt: "2024-02-29T12:00:00+08:00",
      }),
    ).toEqual([]);
  });

  it("accepts complete records without certifying artifact authenticity", () => {
    expect(validateGate(passed([positive]))).toEqual([]);
  });

  it("refuses to overwrite previously collected evidence from the CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openfilm-qa-init-"));
    try {
      const path = join(directory, "evidence.json");
      const original = "Existing human observations; preserve these bytes.\n";
      await writeFile(path, original);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("../../scripts/workstation-qa.ts", import.meta.url)),
          "init",
          path,
          "--candidate",
          sha,
        ],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("EEXIST");
      expect(await readFile(path, "utf8")).toBe(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
