import { expect, it } from "vitest";
import { evaluatePhotoEasing, type PhotoBezierEasingV1 } from "@openfilm/core";
import { runProcess } from "@openfilm/media";
import * as render from "../src/index.js";
import { ffmpegExpressionValues } from "../../../tests/helpers/ffmpeg-expression-log.js";

it("parses only FFmpeg expression values from supported contexts", () => {
  expect(
    ffmpegExpressionValues(
      [
        "0.000000",
        "[Eval @ 0x0000000123456789] 1.000000",
        "[Parsed_perspective_0 @ 000001234567] 0.5",
        "encoder frame 257 bitrate 8.5",
      ].join("\n"),
    ),
  ).toEqual([0, 1, 0.5]);
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
        "repeat+info",
        "-nostats",
        "-f",
        "lavfi",
        "-i",
        "color=blue:s=16x16:r=30:d=9",
        "-vf",
        // Bound evaluations before the output limit can prefetch another frame.
        "format=gbrp,trim=end_frame=257,perspective=x0='print(" +
          expression +
          ")':y0=0:x1=W:y1=0:x2=0:y2=H:x3=W:y3=H:sense=destination:eval=frame:interpolation=cubic",
        "-frames:v",
        "257",
        "-threads",
        "1",
        "-f",
        "null",
        "-",
        "-progress",
        "pipe:1",
      ],
      { timeoutMs: 15000 },
    );
    const samples = ffmpegExpressionValues(stderr);
    const stdoutText = stdout.toString("utf8");
    const outputFrames = [...stdoutText.matchAll(/^frame=(\d+)$/gmu)].map(
      (match) => Number(match[1]),
    );
    expect(outputFrames.at(-1)).toBe(257);
    expect(stdoutText).toMatch(/^progress=end$/mu);
    expect(samples).toHaveLength(257);
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
