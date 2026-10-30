// SPDX-License-Identifier: Apache-2.0
// SYNTHETIC validator input only. This does not represent an executed hosted run.
import { readFileSync } from "node:fs";
import pins from "../../fixtures/render-qa/toolchain.json";
import { qaSha256 } from "../../scripts/ci/render-qa-tools.js";
import {
  renderQaControls,
  renderQaOutputIds,
  renderQaSampleMetricIds,
  renderQaSourceIds,
} from "../helpers/render-qa-contract.js";
import type { RenderQaEvidence } from "../helpers/render-qa-evidence.js";
import {
  assertRenderQaIdentity,
  assertRenderQaMetric,
  RenderQaMetricError,
  renderQaPolicySha256,
  type RenderQaMetricId,
} from "../helpers/render-qa-policy.js";

export function syntheticRenderQaEvidence(
  platformId: RenderQaEvidence["platformId"] = "linux-x64",
): RenderQaEvidence {
  const hash = "a".repeat(64),
    pin = pins.tools[platformId];
  const observedTools = {
    ffmpeg: { version: pin.version, sha256: hash, configurationSha256: hash },
    ffprobe: { version: pin.version, sha256: hash, configurationSha256: hash },
  };
  const metrics = Object.entries(renderQaSampleMetricIds).map(
    ([sampleId, metricId]) => {
      let measurement;
      if (metricId === "identity.fontHash") {
        const face = sampleId.split(".")[1] as keyof typeof pins.fonts.faces;
        measurement = assertRenderQaIdentity(
          "fontHash",
          pins.fonts.faces[face].sha256,
          pins.fonts.faces[face].sha256,
        );
      } else if (metricId === "identity.sourceHash")
        measurement = assertRenderQaIdentity("sourceHash", hash, hash);
      else if (metricId === "identity.frameCount")
        measurement = assertRenderQaIdentity("frameCount", 180, 180);
      else if (metricId === "identity.decodedLossless")
        measurement = assertRenderQaIdentity(
          "decodedLossless",
          Uint8Array.of(1),
          Uint8Array.of(1),
        );
      else
        measurement = assertRenderQaMetric(
          metricId as RenderQaMetricId,
          metricId === "cutDesk.onsetGainRatio" ? 1 : 0,
          metricId === "cutDesk.pts" ? 0 : undefined,
        );
      return { sampleId, ...measurement };
    },
  );
  const controls = Object.entries(renderQaControls).map(([id, control]) => {
    const metric = metrics.find(
      (metric) => metric.sampleId === control.baseline,
    )!;
    let failedMeasurement;
    try {
      if (control.metricId.startsWith("identity.")) {
        const kind = control.metricId.slice("identity.".length);
        if (kind === "frameCount")
          assertRenderQaIdentity("frameCount", 179, 180);
        else if (kind === "decodedLossless")
          assertRenderQaIdentity(
            "decodedLossless",
            Uint8Array.of(2),
            Uint8Array.of(1),
          );
        else
          assertRenderQaIdentity(
            kind as "sourceHash" | "fontHash",
            "b".repeat(64),
            metric.expected!,
          );
      } else assertRenderQaMetric(control.metricId as RenderQaMetricId, 100);
    } catch (error) {
      if (!(error instanceof RenderQaMetricError) || !error.measurement)
        throw error;
      failedMeasurement = error.measurement;
    }
    if (!failedMeasurement)
      throw new Error("Synthetic negative fixture did not fail");
    return {
      id: id as keyof typeof renderQaControls,
      metricId: control.metricId,
      kind: control.kind,
      validSampleId: control.baseline,
      observedFailure: true as const,
      outputSha256: hash,
      failedMeasurement,
    };
  });
  return {
    schemaVersion: 1,
    scope: "hosted-pinned",
    candidateSha: "1".repeat(40),
    workingTreeDirty: false,
    runId: "123",
    runAttempt: "1",
    platformId,
    host: { release: "synthetic", runnerImage: "synthetic-test-image" },
    nodeVersion: "v24.14.0",
    pnpmVersion: "11.11.0",
    policy: { version: 1, sha256: renderQaPolicySha256 },
    admission: {
      schemaVersion: 1,
      platformId,
      provenanceSha256: qaSha256(
        readFileSync(
          new URL("../../fixtures/render-qa/toolchain.json", import.meta.url),
        ),
      ),
      fontSourceCommit: pins.fonts.sourceCommit,
      fontSha256: Object.fromEntries(
        Object.entries(pins.fonts.faces).map(([key, face]) => [
          key,
          face.sha256,
        ]),
      ),
      fontLicenseSha256: pins.fonts.license.sha256,
      admittedPackageSha256: pin.sha256,
      tools: observedTools,
      dependencies: [],
    },
    observedTools,
    sources: renderQaSourceIds.map((id) => ({ id, sha256: hash })),
    outputs: renderQaOutputIds.map((id) => ({ id, sha256: hash })),
    metrics,
    controls,
    complete: true,
    workstationVerified: false,
  };
}
