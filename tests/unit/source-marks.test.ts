import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { formatSequenceTimecode, parseSequenceTimecode } from "@openfilm/core";
import {
  markStale,
  reconcileSourceMarks,
  reset,
  stageIn,
  stageOut,
  validSourceRange,
  type SourceMarkOwner,
} from "../../apps/desktop/src/sourceMarks";

const owner: SourceMarkOwner = {
  projectId: "project",
  compositionId: "cut",
  revision: "r1",
  clipId: "clip",
  assetId: "asset",
  timebaseKey: "v1:30/1:ndf",
};

describe("transient Source marks", () => {
  it("stages immutable in/out values without changing the saved range or owner", () => {
    const initial = reset(owner, 0, 10);
    const input = stageIn(initial, 2);
    const output = stageOut(input, 8);
    expect(initial).toMatchObject({
      sourceIn: 0,
      sourceOut: 10,
      staged: false,
    });
    expect(input).toMatchObject({ sourceIn: 2, sourceOut: 10, staged: true });
    expect(output).toMatchObject({ sourceIn: 2, sourceOut: 8, staged: true });
    expect(output.owner).toEqual(owner);
    expect(output.owner).not.toBe(owner);
  });
  it.each([
    [8, 2],
    [2, 2],
    [-1, 8],
    [0, 11],
    [Number.NaN, 8],
    [0, Number.POSITIVE_INFINITY],
  ])("rejects invalid Source range %s–%s at Apply", (start, end) => {
    const marks = stageOut(stageIn(reset(owner, 0, 10), start), end);
    expect(validSourceRange(marks, 10)).toBe(false);
  });
  it("retains reviewable stale marks across revision changes", () => {
    const marks = stageIn(reset(owner, 0, 10), 2);
    const stale = reconcileSourceMarks(
      marks,
      { ...owner, revision: "r2" },
      0,
      10,
    );
    expect(stale).toMatchObject({ sourceIn: 2, staged: true, stale: true });
    expect(validSourceRange(stale, 10)).toBe(false);
    expect(marks.stale).toBe(false);
    expect(markStale(marks)).toEqual(stale);
    expect(stageOut(stale, 8).stale).toBe(true);
  });
  it.each([
    "projectId",
    "compositionId",
    "clipId",
    "assetId",
    "timebaseKey",
  ] as const)("clears marks when %s changes", (key) => {
    const marks = stageIn(reset(owner, 0, 10), 2);
    const next = { ...owner, [key]: "other" };
    expect(reconcileSourceMarks(marks, next, 1, 9)).toEqual(reset(next, 1, 9));
  });
  it("reset adopts the accepted range and releases stale state", () => {
    const marks = reset({ ...owner, revision: "accepted" }, 2, 8);
    expect(marks).toMatchObject({
      sourceIn: 2,
      sourceOut: 8,
      stale: false,
      staged: false,
    });
    expect(validSourceRange(marks, 10)).toBe(true);
  });
});

describe("accessible timecode entry", () => {
  it("uses exact DF parsing, rejects nonexistent labels and bounds, and emits only valid seeks", () => {
    const vue = createRequire(resolve("apps/desktop/package.json"))("vue");
    const source = readFileSync(
      resolve("apps/desktop/src/components/TimecodeField.vue"),
      "utf8",
    );
    const code = transformSync(
      source.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)![1]!,
      { loader: "ts", format: "esm" },
    ).code.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "");
    const seeks: unknown[] = [];
    const props = {
      frame: 0,
      timebase: {
        version: 1,
        rateNumerator: 30000,
        rateDenominator: 1001,
        dropFrame: true,
      },
      label: "Elapsed",
      minFrame: 0,
      maxFrame: 2000,
      disabled: false,
    };
    const scope = vue.effectScope();
    const field = scope.run(() =>
      new Function(
        "d",
        `const {${["ref", "watch", "useId", "defineProps", "defineEmits", "useI18n", "formatSequenceTimecode", "parseSequenceTimecode"].join(",")}} = d; ${code}; return { draft, invalid, commit };`,
      )({
        ref: vue.ref,
        watch: vue.watch,
        useId: () => "timecode",
        defineProps: () => props,
        defineEmits: () => (_: string, frame: number) => seeks.push(frame),
        useI18n: () => ({ t: String }),
        formatSequenceTimecode,
        parseSequenceTimecode,
      }),
    )!;
    try {
      field.draft.value = "00:01:00;00";
      field.commit();
      expect(field.invalid.value).toBe(true);
      expect(seeks).toEqual([]);
      field.draft.value = "00:01:00;02";
      field.commit();
      expect(field.invalid.value).toBe(false);
      expect(seeks).toEqual([1800]);
      field.draft.value = "00:02:00;02";
      field.commit();
      expect(field.invalid.value).toBe(true);
      expect(seeks).toEqual([1800]);
      props.disabled = true;
      field.draft.value = "00:00:00;01";
      field.commit();
      expect(seeks).toEqual([1800]);
    } finally {
      scope.stop();
    }
  });
});
