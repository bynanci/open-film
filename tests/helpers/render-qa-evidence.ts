// SPDX-License-Identifier: Apache-2.0
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import pins from "../../fixtures/render-qa/toolchain.json";
import type { RenderQaToolReceipt } from "../../scripts/ci/setup-render-qa.js";
import {
  assertRenderQaIdentity,
  assertRenderQaMetric,
  RenderQaMetricError,
  renderQaPolicy,
  renderQaPolicySha256,
  renderQaPolicyVersion,
  type RenderQaMeasurement,
  type RenderQaMetricId,
} from "./render-qa-policy.js";

export {
  renderQaPlatforms,
  renderQaControls,
  requiredRenderQaMetrics,
} from "./render-qa-contract.js";
import {
  renderQaPlatforms,
  renderQaControls,
  renderQaSampleMetricIds,
  renderQaSourceIds,
  renderQaOutputIds,
} from "./render-qa-contract.js";
export const renderQaProvenanceSha256 = createHash("sha256")
  .update(
    readFileSync(
      new URL("../../fixtures/render-qa/toolchain.json", import.meta.url),
    ),
  )
  .digest("hex");
export type RenderQaSample = RenderQaMeasurement & { sampleId: string };
export interface RenderQaControl {
  id: keyof typeof renderQaControls;
  metricId: string;
  kind: "decoded-output" | "identity-fixture";
  validSampleId: string;
  observedFailure: true;
  outputSha256: string;
  failedMeasurement: Omit<RenderQaMeasurement, "passed">;
}
export interface RenderQaEvidence {
  schemaVersion: 1;
  scope: "hosted-pinned" | "local-observation";
  candidateSha: string;
  workingTreeDirty: boolean;
  runId: string;
  runAttempt: string;
  platformId: (typeof renderQaPlatforms)[number];
  host: { release: string; runnerImage: string };
  nodeVersion: string;
  pnpmVersion: string;
  policy: { version: 1; sha256: string };
  admission: RenderQaToolReceipt;
  observedTools: NonNullable<RenderQaToolReceipt["tools"]>;
  sources: Array<{ id: string; sha256: string }>;
  outputs: Array<{ id: string; sha256: string }>;
  metrics: RenderQaSample[];
  controls: RenderQaControl[];
  complete: boolean;
  failureId?: string;
  workstationVerified: false;
}
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,110}$/u.test(value);
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid render QA evidence object");
  return input as Record<string, unknown>;
}
function keys(
  input: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  const object = record(input);
  if (
    required.some((key) => !Object.hasOwn(object, key)) ||
    Object.keys(object).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new Error("Unexpected render QA evidence fields");
  return object;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length)
    throw new Error("Duplicate render QA evidence identity");
}

export function observeRenderQaFailure(
  controlId: keyof typeof renderQaControls,
  valid: RenderQaSample,
  attempt: () => unknown,
  outputSha256: string,
): RenderQaControl {
  const spec = renderQaControls[controlId];
  if (
    !Object.hasOwn(renderQaControls, controlId) ||
    !spec ||
    valid.sampleId !== spec.baseline ||
    valid.id !== spec.metricId ||
    valid.passed !== true ||
    !id(valid.sampleId) ||
    !hash(outputSha256)
  )
    throw new Error("Invalid render QA negative control baseline");
  try {
    attempt();
  } catch (error) {
    if (
      !(error instanceof RenderQaMetricError) ||
      error.reason !== "threshold" ||
      error.metricId !== spec.metricId ||
      !error.measurement
    )
      throw error;
    return {
      id: controlId,
      metricId: spec.metricId,
      kind: spec.kind,
      validSampleId: valid.sampleId,
      observedFailure: true,
      outputSha256,
      failedMeasurement: error.measurement,
    };
  }
  throw new Error(`Render QA negative control ${controlId} did not fail`);
}

/** Validate the entire positive/negative inventory; local observations cannot pass CI admission. */
export function validateRenderQaEvidence(
  input: unknown,
  requirePinned = true,
): RenderQaEvidence {
  const value = record(input);
  const serialized = JSON.stringify(value);
  if (
    serialized.length > 1024 * 1024 ||
    /(?:\/(?:Users|home|tmp|workspace|private|var)\/|[A-Za-z]:[\\/]|file:\/)/u.test(
      serialized,
    )
  )
    throw new Error("Private paths or oversized render QA evidence");
  const rootKeys = [
    "schemaVersion",
    "scope",
    "candidateSha",
    "workingTreeDirty",
    "runId",
    "runAttempt",
    "platformId",
    "host",
    "nodeVersion",
    "pnpmVersion",
    "policy",
    "admission",
    "observedTools",
    "sources",
    "outputs",
    "metrics",
    "controls",
    "complete",
    "failureId",
    "workstationVerified",
  ];
  if (
    Object.keys(value).some((key) => !rootKeys.includes(key)) ||
    value.schemaVersion !== 1 ||
    value.workstationVerified !== false ||
    typeof value.complete !== "boolean" ||
    typeof value.workingTreeDirty !== "boolean" ||
    !/^[a-f0-9]{40}$/u.test(String(value.candidateSha)) ||
    !/^(?:local|[1-9]\d*)$/u.test(String(value.runId)) ||
    !/^[1-9]\d*$/u.test(String(value.runAttempt)) ||
    !(renderQaPlatforms as readonly unknown[]).includes(value.platformId) ||
    !["hosted-pinned", "local-observation"].includes(String(value.scope))
  )
    throw new Error("Invalid render QA evidence identity");
  const evidence = value as unknown as RenderQaEvidence;
  if (
    !/^v\d+\.\d+\.\d+$/u.test(evidence.nodeVersion) ||
    !/^\d+\.\d+\.\d+$/u.test(evidence.pnpmVersion) ||
    !evidence.host ||
    !/^[A-Za-z0-9 ._()+-]{1,160}$/u.test(evidence.host.release) ||
    !/^[A-Za-z0-9 ._()+-]{1,120}$/u.test(evidence.host.runnerImage)
  )
    throw new Error("Invalid render QA host/tool identity");
  if (
    evidence.policy?.version !== renderQaPolicyVersion ||
    evidence.policy?.sha256 !== renderQaPolicySha256
  )
    throw new Error("Render QA metric policy changed");
  keys(evidence.host, ["release", "runnerImage"]);
  keys(evidence.policy, ["version", "sha256"]);
  const admission = keys(evidence.admission, [
    "schemaVersion",
    "platformId",
    "provenanceSha256",
    "fontSourceCommit",
    "fontSha256",
    "fontLicenseSha256",
    "admittedPackageSha256",
    "tools",
    "dependencies",
  ]);
  if (
    admission.schemaVersion !== 1 ||
    admission.platformId !== evidence.platformId ||
    admission.fontSourceCommit !== pins.fonts.sourceCommit ||
    admission.fontLicenseSha256 !== pins.fonts.license.sha256 ||
    admission.provenanceSha256 !== renderQaProvenanceSha256
  )
    throw new Error("Invalid render QA tool/font provenance");
  const admittedFonts = record(admission.fontSha256);
  if (
    Object.keys(admittedFonts).length !== 4 ||
    Object.entries(pins.fonts.faces).some(
      ([key, face]) => admittedFonts[key] !== face.sha256,
    )
  )
    throw new Error("Unreviewed render QA font identities");
  const observed = keys(evidence.observedTools, ["ffmpeg", "ffprobe"]);
  for (const name of ["ffmpeg", "ffprobe"] as const) {
    const tool = keys(observed[name], [
      "version",
      "sha256",
      "configurationSha256",
    ]);
    if (
      !hash(tool.sha256) ||
      !hash(tool.configurationSha256) ||
      !/^\d+\.\d+\.\d+$/u.test(String(tool.version))
    )
      throw new Error("Invalid observed render QA tools");
  }
  if (requirePinned) {
    const pin = pins.tools[evidence.platformId];
    if (
      !evidence.complete ||
      evidence.scope !== "hosted-pinned" ||
      evidence.workingTreeDirty ||
      evidence.runId === "local" ||
      evidence.nodeVersion !== "v24.14.0" ||
      evidence.pnpmVersion !== "11.11.0" ||
      admission.admittedPackageSha256 !== pin.sha256 ||
      !Array.isArray(admission.dependencies) ||
      admission.dependencies.some(
        (dep) => typeof dep !== "string" || dep.length > 300,
      )
    )
      throw new Error("Render QA hosted pin admission is incomplete");
    const tools = keys(admission.tools, ["ffmpeg", "ffprobe"]);
    for (const name of ["ffmpeg", "ffprobe"] as const) {
      const admitted = keys(tools[name], [
        "version",
        "sha256",
        "configurationSha256",
      ]);
      const actual = record(observed[name]);
      if (
        admitted.version !== pin.version ||
        actual.version !== pin.version ||
        admitted.sha256 !== actual.sha256 ||
        admitted.configurationSha256 !== actual.configurationSha256
      )
        throw new Error(
          "Render QA executed a different tool from the admitted package",
        );
    }
  }
  for (const entries of [evidence.sources, evidence.outputs]) {
    if (
      !Array.isArray(entries) ||
      entries.length > 100 ||
      entries.some((entry) => !id(entry?.id) || !hash(entry?.sha256))
    )
      throw new Error("Invalid render QA file identities");
    for (const entry of entries) keys(entry, ["id", "sha256"]);
    unique(entries.map((entry) => entry.id));
    const allowed =
      entries === evidence.sources ? renderQaSourceIds : renderQaOutputIds;
    if (
      entries.some(
        (entry) => !(allowed as readonly string[]).includes(entry.id),
      )
    )
      throw new Error("Unexpected render QA file identity");
    if (evidence.complete && entries.length !== allowed.length)
      throw new Error("Incomplete render QA file identity inventory");
  }
  if (
    !Array.isArray(evidence.metrics) ||
    evidence.metrics.length > 1000 ||
    !Array.isArray(evidence.controls) ||
    evidence.controls.length > 30
  )
    throw new Error("Invalid render QA measurement inventory");
  unique(evidence.metrics.map((metric) => metric.sampleId));
  unique(evidence.controls.map((control) => control.id));
  for (const metric of evidence.metrics) {
    keys(
      metric,
      ["sampleId", "id", "unit", "rule", "actual", "passed"],
      ["expected"],
    );
    if (
      !id(metric.sampleId) ||
      !Object.hasOwn(renderQaSampleMetricIds, metric.sampleId) ||
      renderQaSampleMetricIds[metric.sampleId] !== metric.id ||
      metric.passed !== true
    )
      throw new Error("Invalid render QA measurement");
    let checked: RenderQaMeasurement;
    if (metric.id.startsWith("identity.")) {
      const kind = metric.id.slice("identity.".length);
      if (
        !["sourceHash", "fontHash", "frameCount", "decodedLossless"].includes(
          kind,
        )
      )
        throw new Error("Unknown render QA identity metric");
      if (kind === "decodedLossless") {
        if (
          !hash(metric.actual) ||
          metric.actual !== metric.expected ||
          metric.unit !== "sha256-of-decoded-bytes" ||
          JSON.stringify(metric.rule) !== JSON.stringify({ kind: "exact" })
        )
          throw new Error("Invalid decoded lossless identity");
        continue;
      }
      checked = assertRenderQaIdentity(
        kind as "sourceHash" | "fontHash" | "frameCount",
        metric.actual,
        metric.expected!,
      );
    } else {
      if (!(metric.id in renderQaPolicy))
        throw new Error("Unknown render QA metric");
      checked = assertRenderQaMetric(
        metric.id as RenderQaMetricId,
        metric.actual as number,
        metric.expected as number | undefined,
      );
    }
    if (
      checked.unit !== metric.unit ||
      JSON.stringify(checked.rule) !== JSON.stringify(metric.rule)
    )
      throw new Error("Render QA metric units/comparator changed");
  }
  for (const control of evidence.controls) {
    keys(control, [
      "id",
      "metricId",
      "kind",
      "validSampleId",
      "observedFailure",
      "outputSha256",
      "failedMeasurement",
    ]);
    const spec = renderQaControls[control.id];
    const valid = evidence.metrics.find(
      (metric) => metric.sampleId === control.validSampleId,
    );
    if (
      !Object.hasOwn(renderQaControls, control.id) ||
      !spec ||
      control.metricId !== spec.metricId ||
      control.kind !== spec.kind ||
      control.observedFailure !== true ||
      control.validSampleId !== spec.baseline ||
      valid?.id !== spec.metricId ||
      !evidence.outputs.some(
        (output) =>
          output.id === spec.output && output.sha256 === control.outputSha256,
      )
    )
      throw new Error("Invalid render QA deliberate failure evidence");
    const failed = control.failedMeasurement;
    keys(failed, ["id", "unit", "rule", "actual"], ["expected"]);
    if (
      !failed ||
      failed.id !== spec.metricId ||
      failed.expected !== valid.expected
    )
      throw new Error("Invalid render QA failed measurement binding");
    if (spec.metricId === "identity.decodedLossless") {
      if (
        !hash(failed.actual) ||
        !hash(failed.expected) ||
        failed.actual === failed.expected ||
        failed.unit !== valid.unit ||
        JSON.stringify(failed.rule) !== JSON.stringify(valid.rule)
      )
        throw new Error("Invalid lossless deliberate failure");
    } else {
      let rejected = false;
      try {
        if (spec.metricId.startsWith("identity."))
          assertRenderQaIdentity(
            spec.metricId.slice(9) as "sourceHash" | "fontHash" | "frameCount",
            failed.actual,
            failed.expected!,
          );
        else
          assertRenderQaMetric(
            spec.metricId as RenderQaMetricId,
            failed.actual as number,
            failed.expected as number | undefined,
          );
      } catch (error) {
        if (
          !(error instanceof RenderQaMetricError) ||
          error.reason !== "threshold" ||
          JSON.stringify(error.measurement) !== JSON.stringify(failed)
        )
          throw new Error("Invalid deliberate failure rule/value", {
            cause: error,
          });
        rejected = true;
      }
      if (!rejected)
        throw new Error("Claimed deliberate failure did not cross its limit");
    }
  }
  if (evidence.complete) {
    if (
      evidence.failureId !== undefined ||
      evidence.sources.length < 4 ||
      evidence.outputs.length < 8 ||
      evidence.metrics.length !== Object.keys(renderQaSampleMetricIds).length ||
      Object.keys(renderQaControls).some(
        (controlId) =>
          !evidence.controls.some((control) => control.id === controlId),
      )
    )
      throw new Error("Incomplete render QA positive/negative coverage");
    for (const [key, font] of Object.entries(pins.fonts.faces)) {
      if (
        !evidence.metrics.some(
          (metric) =>
            metric.sampleId === `font.${key}.identity` &&
            metric.id === "identity.fontHash" &&
            metric.actual === font.sha256 &&
            metric.expected === font.sha256,
        )
      )
        throw new Error("Missing verified render QA font face");
    }
  } else if (!id(evidence.failureId))
    throw new Error(
      "Failed render QA evidence requires a bounded failure identity",
    );
  return evidence;
}
export async function writeRenderQaEvidence(
  root: string,
  evidence: RenderQaEvidence,
): Promise<void> {
  if (!isAbsolute(root))
    throw new Error("Render QA evidence root must be absolute");
  validateRenderQaEvidence(evidence, false);
  await mkdir(root, { recursive: true });
  const temporary = join(root, `.evidence-${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(evidence, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, join(root, `${evidence.platformId}.json`));
  } finally {
    await rm(temporary, { force: true });
  }
}
