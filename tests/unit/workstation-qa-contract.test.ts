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
