import { expect, it } from "vitest";
import { evaluatePhotoEasing, type PhotoBezierEasingV1 } from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import * as render from "../src/index.js";

function parseFfmpegPrintSamples(text: string): number[] {
  const sampleLine =
    /^(?:\[Parsed_perspective_\d+\s+@\s+[^\]]+\]\s*)?(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*$/u;
  return text.split(/\r?\n/u).flatMap((line) => {
    const match = sampleLine.exec(line.trim());
    return match ? [Number(match[1])] : [];
  });
}

it("parses FFmpeg perspective print values with either supported log prefix", () => {
  expect(
    parseFfmpegPrintSamples(
      "0.000000\r\n[Parsed_perspective_0 @ 000001234567] 1.000000\r\nnot a sample 2.0\r\n",
    ),
  ).toEqual([0, 1]);
});

it("matches bounded core easing in actual FFmpeg perspective expressions including endpoint-flat and exponent-form handles", async () => {
  const points = [
    [0.25, 0.1, 0.25, 1],
    [0.42, 0, 0.58, 1],
    [0, 0, 0, 1],
    [1, 0, 1, 1],
    [0, 0, 1, 1],
    [1e-8, 1e-9, 0.9, 0.9],
  ];
  for (const [x1, y1, x2, y2] of points) {
    const curve: PhotoBezierEasingV1 = {
      version: 1,
      kind: "cubic-bezier",
      x1: x1!,
      y1: y1!,
      x2: x2!,
      y2: y2!,
    };
    const expression = render.photoEasingExpression(
      curve,
      "min(1,max(0,(on-1)/256))",
    );
    const { stdout, stderr } = await runProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "info",
        "-f",
        "lavfi",
        "-i",
        "color=blue:s=16x16:r=30:d=9",
        "-vf",
        `format=gbrp,perspective=x0='print(${expression})':y0=0:x1=W:y1=0:x2=0:y2=H:x3=W:y3=H:sense=destination:eval=frame:interpolation=cubic`,
        "-frames:v",
        "257",
        "-threads",
        "1",
        "-f",
        "null",
        "-",
      ],
      { timeoutMs: 15000 },
    );
    // FFmpeg builds route print() diagnostics to different streams and may
    // include the filter context prefix in platform-specific log formats.
    const stdoutSamples = parseFfmpegPrintSamples(stdout.toString("utf8"));
    const stderrSamples = parseFfmpegPrintSamples(stderr);
    const samples = [...stdoutSamples, ...stderrSamples];
    expect(
      samples,
      [
        `FFmpeg print() samples: stdout=${stdoutSamples.length}, stderr=${stderrSamples.length}`,
        `stdout tail=${JSON.stringify(stdout.toString("utf8").slice(-800))}`,
        `stderr tail=${JSON.stringify(stderr.slice(-800))}`,
      ].join("; "),
    ).toHaveLength(257);
    expect(samples[0]).toBe(0);
    expect(samples[256]).toBe(1);
    for (const [index, value] of samples.entries())
      expect(
        Math.abs(value - evaluatePhotoEasing(curve, index / 256)),
      ).toBeLessThanOrEqual(5.1e-7);
  }
});

it("rejects untrusted project curve syntax before emitting a filter", () => {
  expect(() =>
    render.photoEasingExpression(
      {
        version: 1,
        kind: "cubic-bezier",
        x1: "while(1,1)",
        y1: 0,
        x2: 1,
        y2: 1,
      } as never,
      "0.5",
    ),
  ).toThrow();
});
