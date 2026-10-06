import { readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const WORKSTATION_QA_SCHEMA_VERSION = "1.0.0" as const;
export const WORKSTATION_QA_GATES = [
  "resolve",
  "asr",
  "llm",
  "gpu",
  "camera",
  "4k",
  "windows-installer",
  "cross-process-recovery",
] as const;

export type WorkstationQaGateId = (typeof WORKSTATION_QA_GATES)[number];
export type WorkstationQaGateStatus =
  "not-run" | "passed" | "failed" | "blocked";

export interface WorkstationQaObservation {
  check: string;
  status: "pass" | "fail" | "unavailable" | "info";
  expected?: string;
  actual?: string;
  evidence?: string[];
}

export interface WorkstationQaGate {
  status: WorkstationQaGateStatus;
  startedAt?: string;
  completedAt?: string;
  blocker?: string;
  notes?: string[];
  inputs?: Array<{
    label: string;
    kind: string;
    sha256?: string;
  }>;
  observations: WorkstationQaObservation[];
}

export interface WorkstationQaRecord {
  schemaVersion: typeof WORKSTATION_QA_SCHEMA_VERSION;
  candidateSha: string;
  createdAt: string;
  environment: {
    platform: string;
    release: string;
    arch: string;
    node: string;
    cpu?: string;
    memoryBytes: number;
    gpu?: string;
    openfilmVersion?: string;
    ffmpegVersion?: string;
    resolveVersion?: string;
    resolveEdition?: string;
  };
  gates: Record<WorkstationQaGateId, WorkstationQaGate>;
}

export function createWorkstationQaRecord(
  candidateSha: string,
): WorkstationQaRecord {
  if (!/^[0-9a-f]{40}$/iu.test(candidateSha))
    throw new Error("candidateSha must be a full 40-character Git SHA");
  return {
    schemaVersion: WORKSTATION_QA_SCHEMA_VERSION,
    candidateSha,
    createdAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      node: process.version,
      cpu: cpus()[0]?.model,
      memoryBytes: totalmem(),
    },
    gates: Object.fromEntries(
      WORKSTATION_QA_GATES.map((id) => [
        id,
        { status: "not-run", observations: [] },
      ]),
    ) as Record<WorkstationQaGateId, WorkstationQaGate>,
  };
}

export function validateWorkstationQaRecord(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return ["record must be an object"];
  const record = value as Partial<WorkstationQaRecord>;
  if (record.schemaVersion !== WORKSTATION_QA_SCHEMA_VERSION)
    errors.push(`schemaVersion must be ${WORKSTATION_QA_SCHEMA_VERSION}`);
  if (
    typeof record.candidateSha !== "string" ||
    !/^[0-9a-f]{40}$/iu.test(record.candidateSha)
  )
    errors.push("candidateSha must be a full 40-character Git SHA");
  if (
    typeof record.createdAt !== "string" ||
    !Number.isFinite(Date.parse(record.createdAt))
  )
    errors.push("createdAt must be an ISO timestamp");
  if (!record.environment || typeof record.environment !== "object")
    errors.push("environment is required");
  if (!record.gates || typeof record.gates !== "object") {
    errors.push("gates are required");
    return errors;
  }
  for (const id of WORKSTATION_QA_GATES) {
    const gate = record.gates[id];
    if (!gate || typeof gate !== "object") {
      errors.push(`gates.${id} is required`);
      continue;
    }
    if (!["not-run", "passed", "failed", "blocked"].includes(gate.status))
      errors.push(`gates.${id}.status is invalid`);
    if (!Array.isArray(gate.observations))
      errors.push(`gates.${id}.observations must be an array`);
    const observations = Array.isArray(gate.observations)
      ? gate.observations
      : [];
    for (const [index, observation] of observations.entries()) {
      if (
        !observation ||
        typeof observation !== "object" ||
        typeof observation.check !== "string" ||
        !observation.check.trim()
      )
        errors.push(
          `gates.${id}.observations[${index}].check must be nonblank`,
        );
      if (
        !observation ||
        typeof observation !== "object" ||
        !["pass", "fail", "unavailable", "info"].includes(observation.status)
      )
        errors.push(`gates.${id}.observations[${index}].status is invalid`);
    }
    if (gate.status === "passed") {
      if (!observations.length)
        errors.push(`gates.${id} cannot pass without observations`);
      if (observations.some((item) => item.status === "fail"))
        errors.push(`gates.${id} cannot pass with a failed observation`);
    }
    if (
      gate.status === "failed" &&
      !observations.some((item) => item.status === "fail")
    )
      errors.push(`gates.${id} must include a failed observation`);
    if (
      gate.status === "blocked" &&
      (typeof gate.blocker !== "string" || !gate.blocker.trim())
    )
      errors.push(`gates.${id}.blocker is required when blocked`);
    if (
      gate.status !== "not-run" &&
      (typeof gate.completedAt !== "string" ||
        !Number.isFinite(Date.parse(gate.completedAt)))
    )
      errors.push(`gates.${id}.completedAt is required for a terminal status`);
  }
  return errors;
}

async function main(argv: string[]) {
  const [command, path, ...rest] = argv;
  if (command === "init") {
    if (!path)
      throw new Error(
        "Usage: workstation-qa init <output.json> --candidate <sha>",
      );
    const candidateIndex = rest.indexOf("--candidate");
    const candidate =
      candidateIndex >= 0 ? rest[candidateIndex + 1] : undefined;
    if (!candidate) throw new Error("--candidate <full-sha> is required");
    const output = resolve(path);
    await writeFile(
      output,
      JSON.stringify(createWorkstationQaRecord(candidate), null, 2) + "\n",
      "utf8",
    );
    process.stdout.write(JSON.stringify({ output }) + "\n");
    return;
  }
  if (command === "validate") {
    if (!path)
      throw new Error("Usage: workstation-qa validate <evidence.json>");
    const input = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
    const errors = validateWorkstationQaRecord(input);
    process.stdout.write(
      JSON.stringify({ valid: errors.length === 0, errors }, null, 2) + "\n",
    );
    if (errors.length) process.exitCode = 1;
    return;
  }
  throw new Error(
    "Usage: workstation-qa init <output.json> --candidate <sha> | validate <evidence.json>",
  );
}

const invoked =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
