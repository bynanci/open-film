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
  const gate = (): WorkstationQaGate => ({
    status: "not-run",
    observations: [],
  });
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
    gates: {
      resolve: gate(),
      asr: gate(),
      llm: gate(),
      gpu: gate(),
      camera: gate(),
      "4k": gate(),
      "windows-installer": gate(),
      "cross-process-recovery": gate(),
    },
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

/** Reject local timestamps and calendar rollovers that Date.parse normalizes. */
function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offsetH, offsetM] = match;
  const end = new Date(0);
  end.setUTCFullYear(Number(year), Number(month), 0);
  return (
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= end.getUTCDate() &&
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second) < 60 &&
    Number(offsetH ?? 0) < 24 &&
    Number(offsetM ?? 0) < 60 &&
    Number.isFinite(Date.parse(value))
  );
}

/** Validate record structure and consistency, not the truth of linked evidence. */
export function validateWorkstationQaRecord(value: unknown): string[] {
  const errors: string[] = [];
  if (!object(value)) return ["record must be an object"];
  const keys = (
    data: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
  ) => {
    for (const key of Object.keys(data))
      if (!allowed.includes(key))
        errors.push(`${path}.${key} is not supported`);
  };
  const optionalStrings = (
    data: Record<string, unknown>,
    fields: readonly string[],
    path: string,
  ) => {
    for (const key of fields)
      if (data[key] !== undefined && typeof data[key] !== "string")
        errors.push(`${path}.${key} must be a string`);
  };
  const strings = (data: unknown, path: string) => {
    if (!Array.isArray(data) || data.some((item) => !nonblank(item)))
      errors.push(`${path} must contain nonblank strings`);
  };
  keys(
    value,
    ["schemaVersion", "candidateSha", "createdAt", "environment", "gates"],
    "record",
  );
  if (value.schemaVersion !== WORKSTATION_QA_SCHEMA_VERSION)
    errors.push(`schemaVersion must be ${WORKSTATION_QA_SCHEMA_VERSION}`);
  if (
    typeof value.candidateSha !== "string" ||
    !/^[0-9a-f]{40}$/iu.test(value.candidateSha)
  )
    errors.push("candidateSha must be a full 40-character Git SHA");
  if (!timestamp(value.createdAt))
    errors.push("createdAt must be an ISO timestamp");
  const environment = value.environment;
  if (!object(environment)) errors.push("environment is required");
  else {
    const required = ["platform", "release", "arch", "node"];
    const optional = [
      "cpu",
      "gpu",
      "openfilmVersion",
      "ffmpegVersion",
      "resolveVersion",
      "resolveEdition",
    ];
    keys(environment, [...required, ...optional, "memoryBytes"], "environment");
    for (const field of required)
      if (!nonblank(environment[field]))
        errors.push(`environment.${field} must be nonblank`);
    optionalStrings(environment, optional, "environment");
    if (
      !Number.isSafeInteger(environment.memoryBytes) ||
      Number(environment.memoryBytes) <= 0
    )
      errors.push("environment.memoryBytes must be a positive safe integer");
  }
  if (!object(value.gates)) return [...errors, "gates are required"];
  keys(value.gates, WORKSTATION_QA_GATES, "gates");
  for (const id of WORKSTATION_QA_GATES) {
    const gate = value.gates[id];
    const path = `gates.${id}`;
    if (!object(gate)) {
      errors.push(`${path} is required`);
      continue;
    }
    keys(
      gate,
      [
        "status",
        "startedAt",
        "completedAt",
        "blocker",
        "notes",
        "inputs",
        "observations",
      ],
      path,
    );
    if (
      typeof gate.status !== "string" ||
      !["not-run", "passed", "failed", "blocked"].includes(gate.status)
    )
      errors.push(`${path}.status is invalid`);
    optionalStrings(gate, ["blocker"], path);
    if (gate.notes !== undefined) strings(gate.notes, `${path}.notes`);
    for (const field of ["startedAt", "completedAt"])
      if (gate[field] !== undefined && !timestamp(gate[field]))
        errors.push(`${path}.${field} must be an ISO timestamp`);
    if (
      timestamp(gate.startedAt) &&
      timestamp(gate.completedAt) &&
      Date.parse(gate.completedAt) < Date.parse(gate.startedAt)
    )
      errors.push(`${path}.completedAt precedes startedAt`);
    if (gate.inputs !== undefined) {
      if (!Array.isArray(gate.inputs))
        errors.push(`${path}.inputs must be an array`);
      else
        gate.inputs.forEach((input, index) => {
          const inputPath = `${path}.inputs[${index}]`;
          if (!object(input)) {
            errors.push(`${inputPath} must be an object`);
            return;
          }
          keys(input, ["label", "kind", "sha256"], inputPath);
          for (const field of ["label", "kind"])
            if (!nonblank(input[field]))
              errors.push(`${inputPath}.${field} must be nonblank`);
          if (
            input.sha256 !== undefined &&
            (typeof input.sha256 !== "string" ||
              !/^[0-9a-f]{64}$/iu.test(input.sha256))
          )
            errors.push(`${inputPath}.sha256 must be a SHA-256 hash`);
        });
    }
    if (!Array.isArray(gate.observations))
      errors.push(`${path}.observations must be an array`);
    const observations: unknown[] = Array.isArray(gate.observations)
      ? gate.observations
      : [];
    let passes = 0;
    let failures = 0;
    let unavailable = 0;
    observations.forEach((observation, index) => {
      const itemPath = `${path}.observations[${index}]`;
      if (!object(observation)) {
        errors.push(`${itemPath} must be an object`);
        return;
      }
      keys(
        observation,
        ["check", "status", "expected", "actual", "evidence"],
        itemPath,
      );
      if (!nonblank(observation.check))
        errors.push(`${itemPath}.check must be nonblank`);
      if (
        typeof observation.status !== "string" ||
        !["pass", "fail", "unavailable", "info"].includes(observation.status)
      )
        errors.push(`${itemPath}.status is invalid`);
      optionalStrings(observation, ["expected", "actual"], itemPath);
      if (observation.evidence !== undefined)
        strings(observation.evidence, `${itemPath}.evidence`);
      if (observation.status === "pass") {
        passes++;
        if (!nonblank(observation.actual))
          errors.push(`${itemPath}.actual is required for pass`);
        if (
          !Array.isArray(observation.evidence) ||
          !observation.evidence.length
        )
          errors.push(`${itemPath}.evidence is required for pass`);
      }
      if (observation.status === "fail") failures++;
      if (observation.status === "unavailable") unavailable++;
    });
    if (gate.status === "passed") {
      if (!observations.length)
        errors.push(`${path} cannot pass without observations`);
      if (!passes) errors.push(`${path} must include a positive observation`);
      if (failures)
        errors.push(`${path} cannot pass with a failed observation`);
      if (unavailable)
        errors.push(`${path} cannot pass with an unavailable observation`);
    }
    if (gate.status === "failed" && !failures)
      errors.push(`${path} must include a failed observation`);
    if (gate.status === "blocked" && !nonblank(gate.blocker))
      errors.push(`${path}.blocker is required when blocked`);
    if (gate.status !== "not-run" && !timestamp(gate.completedAt))
      errors.push(`${path}.completedAt is required for a terminal status`);
  }
  return errors;
}

async function main(argv: string[]) {
  const [command, path, ...rest] = argv;
  if (command === "init") {
    if (!path || rest.length !== 2 || rest[0] !== "--candidate" || !rest[1])
      throw new Error(
        "Usage: workstation-qa init <output.json> --candidate <sha>",
      );
    const output = resolve(path);
    await writeFile(
      output,
      JSON.stringify(createWorkstationQaRecord(rest[1]), null, 2) + "\n",
      { encoding: "utf8", flag: "wx" },
    );
    process.stdout.write(JSON.stringify({ output }) + "\n");
    return;
  }
  if (command === "validate") {
    if (!path || rest.length)
      throw new Error("Usage: workstation-qa validate <evidence.json>");
    const input = JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
    const errors = validateWorkstationQaRecord(input);
    process.stdout.write(
      JSON.stringify(
        { valid: errors.length === 0, errors, verification: "record-only" },
        null,
        2,
      ) + "\n",
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
