import { describe, expect, it } from "vitest";
import {
  WORKSTATION_QA_GATES,
  createWorkstationQaRecord,
  validateWorkstationQaRecord,
} from "../../scripts/workstation-qa";

describe("workstation QA evidence contract", () => {
  const sha = "a".repeat(40);

  it("creates every required manual gate as not-run without inventing evidence", () => {
    const record = createWorkstationQaRecord(sha);
    expect(record.candidateSha).toBe(sha);
    expect(Object.keys(record.gates).sort()).toEqual(
      [...WORKSTATION_QA_GATES].sort(),
    );
    expect(
      Object.values(record.gates).every(
        (gate) => gate.status === "not-run" && gate.observations.length === 0,
      ),
    ).toBe(true);
    expect(validateWorkstationQaRecord(record)).toEqual([]);
  });

  it("records Windows, macOS and Linux installer gates in version 1.1", () => {
    const record = createWorkstationQaRecord(sha);
    expect(record.schemaVersion).toBe("1.1.0");
    for (const id of [
      "windows-installer",
      "macos-installer",
      "linux-installer",
    ])
      expect(record.gates).toHaveProperty(id, {
        status: "not-run",
        observations: [],
      });
  });

  it("keeps original version 1.0 records readable without adding observations", () => {
    const current = createWorkstationQaRecord(sha);
    const gates: Record<string, unknown> = { ...current.gates };
    delete gates["macos-installer"];
    delete gates["linux-installer"];
    const legacy = { ...current, schemaVersion: "1.0.0", gates };
    const original = JSON.stringify(legacy);
    expect(validateWorkstationQaRecord(legacy)).toEqual([]);
    expect(JSON.stringify(legacy)).toBe(original);
  });

  it("requires the new installer gates only for version 1.1", () => {
    const current = createWorkstationQaRecord(sha);
    const gates: Record<string, unknown> = { ...current.gates };
    delete gates["macos-installer"];
    expect(
      validateWorkstationQaRecord({
        ...current,
        schemaVersion: "1.1.0",
        gates,
      }),
    ).toContain("gates.macos-installer is required");
    expect(
      validateWorkstationQaRecord({ ...current, schemaVersion: "1.0.0" }),
    ).toContain("gates.macos-installer is not supported");
  });

  it("rejects a macOS pass without positive evidence", () => {
    const record = createWorkstationQaRecord(sha);
    const invalid = {
      ...record,
      gates: {
        ...record.gates,
        "macos-installer": {
          status: "passed",
          completedAt: "2026-11-08T14:00:00Z",
          observations: [{ check: "Clean install", status: "unavailable" }],
        },
      },
    };
    expect(validateWorkstationQaRecord(invalid)).toContain(
      "gates.macos-installer cannot pass with an unavailable observation",
    );
  });

  it("requires positive evidence before a gate can pass", () => {
    const record = createWorkstationQaRecord(sha);
    record.gates["4k"] = {
      status: "passed",
      completedAt: new Date().toISOString(),
      observations: [],
    };
    expect(validateWorkstationQaRecord(record)).toContain(
      "gates.4k cannot pass without observations",
    );
    record.gates["4k"].observations.push({
      check: "10-minute UHD preview render",
      status: "fail",
    });
    expect(validateWorkstationQaRecord(record)).toContain(
      "gates.4k cannot pass with a failed observation",
    );
  });

  it("keeps blocked and failed states explicit", () => {
    const record = createWorkstationQaRecord(sha);
    record.gates["windows-installer"] = {
      status: "blocked",
      completedAt: new Date().toISOString(),
      observations: [],
    };
    record.gates.camera = {
      status: "failed",
      completedAt: new Date().toISOString(),
      observations: [{ check: "Pixel HDR import", status: "info" }],
    };
    const errors = validateWorkstationQaRecord(record);
    expect(errors).toContain(
      "gates.windows-installer.blocker is required when blocked",
    );
    expect(errors).toContain("gates.camera must include a failed observation");
  });
});
