// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { renderQaSourceIds } from "../helpers/render-qa-contract.js";
import { syntheticRenderQaEvidence } from "../fixtures/render-qa-evidence.js";
import type { RenderQaEvidence } from "../helpers/render-qa-evidence.js";
import { assertRenderQaMetric } from "../helpers/render-qa-policy.js";
import {
  observeRenderQaFailure,
  validateRenderQaEvidence,
} from "../helpers/render-qa-evidence.js";

it("records only an actual expected threshold failure after its valid control passed", () => {
  const valid = {
    sampleId: "video.color.f0.c0",
    ...assertRenderQaMetric("cutDesk.channelError", 0),
  };
  expect(
    observeRenderQaFailure(
      "pixelColor",
      valid,
      () => assertRenderQaMetric("cutDesk.channelError", 20),
      "a".repeat(64),
    ),
  ).toMatchObject({
    id: "pixelColor",
    metricId: "cutDesk.channelError",
    validSampleId: "video.color.f0.c0",
    observedFailure: true,
    failedMeasurement: {
      id: "cutDesk.channelError",
      actual: 20,
      unit: "rgb-channel-units",
      rule: { kind: "bound", op: "lte", limit: 12 },
    },
  });
  expect(() =>
    observeRenderQaFailure(
      "pixelColor",
      valid,
      () => assertRenderQaMetric("cutDesk.channelError", 0),
      "a".repeat(64),
    ),
  ).toThrow(/did not fail/u);
  expect(() =>
    observeRenderQaFailure(
      "pixelColor",
      valid,
      () => {
        throw new Error("decoder failed");
      },
      "a".repeat(64),
    ),
  ).toThrow(/decoder failed/u);
  expect(() =>
    observeRenderQaFailure(
      "pixelColor",
      valid,
      () => assertRenderQaMetric("cutDesk.channelError", NaN),
      "a".repeat(64),
    ),
  ).toThrow(/invalid/u);
  expect(() =>
    observeRenderQaFailure(
      "pixelColor",
      valid,
      () => assertRenderQaMetric("photoDepth.rgbMae", 50),
      "a".repeat(64),
    ),
  ).toThrow();
});
it("rejects malformed/private/incomplete evidence instead of treating it as successful", () => {
  for (const data of [
    null,
    {},
    {
      schemaVersion: 1,
      complete: true,
      privatePath: "/Users/private/film.mp4",
    },
    { schemaVersion: 1, complete: true, scope: "local-observation" },
  ])
    expect(() => validateRenderQaEvidence(data)).toThrow();
});
it("accepts a complete synthetic schema fixture without claiming it was executed", () => {
  const evidence = syntheticRenderQaEvidence();
  expect(validateRenderQaEvidence(evidence)).toBe(evidence);
});
it.each([
  {
    name: "unexpected source payload",
    mutate: (r: RenderQaEvidence) => {
      Object.assign(r.sources[0]!, { unreviewed: "payload" });
    },
  },
  {
    name: "unexpected control payload",
    mutate: (r: RenderQaEvidence) => {
      Object.assign(r.controls[0]!, { unreviewed: "payload" });
    },
  },
  {
    name: "unexpected admission payload",
    mutate: (r: RenderQaEvidence) => {
      Object.assign(r.admission, { unreviewed: "payload" });
    },
  },
  {
    name: "missing interior sample",
    mutate: (r: RenderQaEvidence) => {
      r.metrics = r.metrics.filter((m) => m.sampleId !== "video.color.f67.c1");
    },
  },
  {
    name: "missing output",
    mutate: (r: RenderQaEvidence) => {
      r.outputs.pop();
    },
  },
  {
    name: "extra output",
    mutate: (r: RenderQaEvidence) => {
      r.outputs.push({ id: "unexpected", sha256: "a".repeat(64) });
    },
  },
  {
    name: "extra source",
    mutate: (r: RenderQaEvidence) => {
      r.sources.push({ id: "unexpected", sha256: "a".repeat(64) });
    },
  },
  {
    name: "different provenance",
    mutate: (r: RenderQaEvidence) => {
      r.admission.provenanceSha256 = "0".repeat(64);
    },
  },
  {
    name: "nonfailing negative measurement",
    mutate: (r: RenderQaEvidence) => {
      r.controls[0]!.failedMeasurement.actual = 0;
    },
  },
  {
    name: "different valid control sample",
    mutate: (r: RenderQaEvidence) => {
      r.controls[0]!.validSampleId = "audio.absent.t0.f880";
    },
  },
  {
    name: "modified rule",
    mutate: (r: RenderQaEvidence) => {
      r.metrics.find((m) => m.id === "cutDesk.channelError")!.rule.limit = 999;
    },
  },
  {
    name: "duplicate sample",
    mutate: (r: RenderQaEvidence) => {
      r.metrics.push(r.metrics[0]!);
    },
  },
  {
    name: "unobserved control",
    mutate: (r: RenderQaEvidence) => {
      r.controls.pop();
    },
  },
  {
    name: "local scope",
    mutate: (r: RenderQaEvidence) => {
      r.scope = "local-observation";
    },
  },
  {
    name: "dirty source",
    mutate: (r: RenderQaEvidence) => {
      r.workingTreeDirty = true;
    },
  },
  {
    name: "private path",
    mutate: (r: RenderQaEvidence) => {
      r.host.release = "/Users/private/film";
    },
  },
])("rejects $name", ({ mutate }) => {
  const evidence = syntheticRenderQaEvidence();
  mutate(evidence);
  expect(() => validateRenderQaEvidence(evidence)).toThrow();
});

// Changing only an inventory digest must invalidate the claimed source observation.
it.each(renderQaSourceIds)(
  "rejects contradictory source inventory hash %s",
  (sourceId) => {
    const evidence = syntheticRenderQaEvidence();
    evidence.sources.find((source) => source.id === sourceId)!.sha256 =
      "c".repeat(64);
    expect(() => validateRenderQaEvidence(evidence)).toThrow(
      /source.*binding/iu,
    );
  },
);
it.each(["fontSubstitution", "sourceMutation"] as const)(
  "rejects %s measurements detached from their encoded output receipt",
  (controlId) => {
    const evidence = syntheticRenderQaEvidence();
    evidence.controls.find(
      (control) => control.id === controlId,
    )!.failedMeasurement.actual = "c".repeat(64);
    expect(() => validateRenderQaEvidence(evidence)).toThrow(
      /failed measurement binding/u,
    );
  },
);
it("keeps decoded lossless hashes distinct from encoded output hashes", () => {
  const evidence = syntheticRenderQaEvidence();
  const control = evidence.controls.find(
    (control) => control.id === "losslessPixels",
  )!;
  expect(control.failedMeasurement.actual).not.toBe(control.outputSha256);
  expect(() => validateRenderQaEvidence(evidence)).not.toThrow();
});

it.each(renderQaSourceIds)(
  "rejects jointly changed source actual/expected %s",
  (sourceId) => {
    const evidence = syntheticRenderQaEvidence();
    Object.assign(
      evidence.metrics.find(
        (metric) => metric.sampleId === `source.${sourceId}`,
      )!,
      { actual: "c".repeat(64), expected: "c".repeat(64) },
    );
    expect(() => validateRenderQaEvidence(evidence)).toThrow(
      /source.*binding/iu,
    );
  },
);
it.each(["fontSubstitution", "sourceMutation"] as const)(
  "retains %s output inventory and expected-baseline joins",
  (controlId) => {
    const outputMismatch = syntheticRenderQaEvidence();
    outputMismatch.controls.find(
      (control) => control.id === controlId,
    )!.outputSha256 = "c".repeat(64);
    expect(() => validateRenderQaEvidence(outputMismatch)).toThrow(
      /deliberate failure evidence/u,
    );
    const baselineMismatch = syntheticRenderQaEvidence();
    baselineMismatch.controls.find(
      (control) => control.id === controlId,
    )!.failedMeasurement.expected = "c".repeat(64);
    expect(() => validateRenderQaEvidence(baselineMismatch)).toThrow(
      /failed measurement binding/u,
    );
  },
);
