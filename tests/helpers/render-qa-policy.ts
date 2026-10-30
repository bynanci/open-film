// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";

type Operator = "lt" | "lte" | "gt" | "gte";
type Bound = { kind: "bound"; unit: string; op: Operator; limit: number };
type Rule =
  | Bound
  | { kind: "closeTo"; unit: string; digits: number }
  | { kind: "openInterval"; unit: string; lower: number; upper: number }
  | { kind: "oneFramePlus"; unit: string; extra: number };
const bound = (unit: string, op: Operator, limit: number): Bound => ({
  kind: "bound",
  unit,
  op,
  limit,
});
export const renderQaPolicy = Object.freeze({
  "photoDepth.rgbMae": bound("rgb-channel-units", "lt", 12),
  "photoDepth.edgeChannelError": bound("rgb-channel-units", "lte", 8),
  "photoDepth.alphaChannelError": bound("rgb-channel-units", "lte", 8),
  "filmLook.channelError": bound("rgb-channel-units", "lte", 3),
  "filmLook.losslessChannelError": bound("rgb-channel-units", "lte", 1),
  "title.highDetailGlyphChannelError": bound("rgb-channel-units", "lte", 8),
  "cutDesk.channelError": bound("rgb-channel-units", "lte", 12),
  "cutDesk.pts": { kind: "closeTo", unit: "seconds", digits: 6 },
  "cutDesk.primaryAmplitudeError": bound("linear-peak-amplitude", "lt", 0.006),
  "cutDesk.overlayAmplitudeError": bound("linear-peak-amplitude", "lt", 0.004),
  "cutDesk.absentAmplitude": bound("linear-peak-amplitude", "lt", 0.003),
  "cutDesk.onsetGainRatio": bound("ratio", "gt", 0.9),
  "title.textDelta": bound("luminance-units", "gt", 60),
  "title.scrimDelta": bound("luminance-units", "lt", -60),
  "title.opacityRatio": { kind: "closeTo", unit: "ratio", digits: 1 },
  "title.sourceLuminance": {
    kind: "closeTo",
    unit: "luminance-units",
    digits: 0,
  },
  "title.exclusiveGateLuminance": bound("luminance-units", "lt", 5),
  "audio.integratedLufs": {
    kind: "openInterval",
    unit: "LUFS",
    lower: -35,
    upper: -10,
  },
  "audio.trueMinusSamplePeak": bound("decibels", "gte", -0.2),
  "audio.duration": { kind: "closeTo", unit: "seconds", digits: 1 },
  "photo.subjectEdgeError": bound("output-pixels", "lte", 1.5),
  "photo.firstFrameCenterError": bound("output-pixels", "lt", 0.12),
  "photo.panTravel": bound("output-pixels", "gt", 1.5),
  "photo.panStep": bound("output-pixels-per-frame", "lt", 0.18),
  "photo.fadeOutRmsRatio": bound("ratio", "lt", 0.2),
  "photo.fadeInRmsRatio": bound("ratio", "lt", 0.5),
  "photo.duration": { kind: "closeTo", unit: "seconds", digits: 1 },
  "photo.tightDuration": { kind: "closeTo", unit: "seconds", digits: 3 },
  "photoFilm.durationError": {
    kind: "oneFramePlus",
    unit: "seconds",
    extra: 0.001,
  },
} satisfies Record<string, Rule>);
for (const rule of Object.values(renderQaPolicy)) Object.freeze(rule);
export const renderQaPolicyVersion = 1 as const;
export const renderQaPolicySha256 = createHash("sha256")
  .update(JSON.stringify(renderQaPolicy))
  .digest("hex");
export type RenderQaMetricId = keyof typeof renderQaPolicy;
export interface RenderQaMeasurement {
  id: string;
  unit: string;
  rule: Record<string, string | number>;
  actual: number | string;
  expected?: number | string;
  passed: true;
}
export class RenderQaMetricError extends Error {
  constructor(
    public readonly metricId: string,
    public readonly reason: "invalid" | "threshold",
    public readonly measurement?: Omit<RenderQaMeasurement, "passed">,
  ) {
    super(`Render QA ${metricId}: ${reason} measurement`);
    this.name = "RenderQaMetricError";
  }
}
function invalid(id: string): never {
  throw new RenderQaMetricError(id, "invalid");
}
export function assertRenderQaMetric(
  id: RenderQaMetricId,
  actual: number,
  expected?: number,
  context?: { frameRate?: number },
): RenderQaMeasurement {
  const policy: Rule = renderQaPolicy[id];
  if (!policy || !Number.isFinite(actual)) invalid(id);
  const nonnegative =
    [
      "rgb-channel-units",
      "linear-peak-amplitude",
      "output-pixels",
      "output-pixels-per-frame",
    ].includes(policy.unit) ||
    id === "photoFilm.durationError" ||
    id === "photo.fadeInRmsRatio" ||
    id === "photo.fadeOutRmsRatio";
  if (
    (nonnegative && actual < 0) ||
    (policy.unit === "rgb-channel-units" && actual > 255)
  )
    invalid(id);
  if (context && Object.keys(context).some((key) => key !== "frameRate"))
    invalid(id);
  let rule: Rule | Bound = policy;
  if (rule.kind === "oneFramePlus") {
    const rate = context?.frameRate;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)
      invalid(id);
    rule = bound(rule.unit, "lte", 1 / rate + rule.extra);
  } else if (context?.frameRate !== undefined) invalid(id);
  let passed: boolean;
  if (rule.kind === "closeTo") {
    if (expected === undefined || !Number.isFinite(expected)) invalid(id);
    passed = Math.abs(actual - expected) < 0.5 * 10 ** -rule.digits;
  } else {
    if (expected !== undefined) invalid(id);
    if (rule.kind === "bound") {
      passed =
        rule.op === "lt"
          ? actual < rule.limit
          : rule.op === "lte"
            ? actual <= rule.limit
            : rule.op === "gt"
              ? actual > rule.limit
              : actual >= rule.limit;
    } else if (rule.kind === "openInterval")
      passed = actual > rule.lower && actual < rule.upper;
    else invalid(id);
  }
  if (!passed)
    throw new RenderQaMetricError(id, "threshold", {
      id,
      unit: rule.unit,
      rule: { ...rule },
      actual,
      ...(expected === undefined ? {} : { expected }),
    });
  return {
    id,
    unit: rule.unit,
    rule: { ...rule },
    actual,
    ...(expected === undefined ? {} : { expected }),
    passed: true,
  };
}
export function assertRenderQaIdentity(
  kind: "sourceHash" | "fontHash" | "decodedLossless" | "frameCount",
  actual: string | number | Uint8Array,
  expected: string | number | Uint8Array,
): RenderQaMeasurement {
  const id = `identity.${kind}`;
  let a: string | number, b: string | number, unit: string;
  if (kind === "decodedLossless") {
    if (
      !(actual instanceof Uint8Array) ||
      !(expected instanceof Uint8Array) ||
      actual.length < 1 ||
      expected.length < 1
    )
      invalid(id);
    a = createHash("sha256").update(actual).digest("hex");
    b = createHash("sha256").update(expected).digest("hex");
    unit = "sha256-of-decoded-bytes";
  } else if (kind === "frameCount") {
    if (
      typeof actual !== "number" ||
      typeof expected !== "number" ||
      !Number.isSafeInteger(actual) ||
      !Number.isSafeInteger(expected) ||
      actual < 1 ||
      expected < 1
    )
      invalid(id);
    a = actual;
    b = expected;
    unit = "frames";
  } else {
    if (
      typeof actual !== "string" ||
      typeof expected !== "string" ||
      !/^[a-f0-9]{64}$/u.test(actual) ||
      !/^[a-f0-9]{64}$/u.test(expected)
    )
      invalid(id);
    a = actual;
    b = expected;
    unit = "sha256";
  }
  if (a !== b)
    throw new RenderQaMetricError(id, "threshold", {
      id,
      unit,
      rule: { kind: "exact" },
      actual: a,
      expected: b,
    });
  return {
    id,
    unit,
    rule: { kind: "exact" },
    actual: a,
    expected: b,
    passed: true,
  };
}
