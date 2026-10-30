// SPDX-License-Identifier: Apache-2.0
import { readFile, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { runProcess } from "@openfilm/media";
import type { RenderQaToolReceipt } from "../../scripts/ci/setup-render-qa.js";
import {
  admitToolVersion,
  qaSha256,
} from "../../scripts/ci/render-qa-tools.js";

export async function observeRenderQaTools(
  admission: RenderQaToolReceipt,
  hosted: boolean,
): Promise<NonNullable<RenderQaToolReceipt["tools"]>> {
  const tools = {} as NonNullable<RenderQaToolReceipt["tools"]>;
  for (const name of ["ffmpeg", "ffprobe"] as const) {
    let path: string | undefined;
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      const candidate = join(
        directory,
        `${name}${process.platform === "win32" ? ".exe" : ""}`,
      );
      if ((await stat(candidate).catch(() => null))?.isFile()) {
        path = candidate;
        break;
      }
    }
    if (!path) throw new Error("Render QA tools are unavailable");
    const info = await stat(path);
    if (info.size > 256 * 1024 ** 2)
      throw new Error("Render QA executable exceeds its byte limit");
    const sha256 = qaSha256(await readFile(path));
    if (hosted && admission.tools?.[name]?.sha256 !== sha256)
      throw new Error("Render QA tool bytes differ before execution");
    const versionOutput = (
      await runProcess(path, ["-version"], { maxOutputBytes: 1024 * 1024 })
    ).stdout
      .toString()
      .trim();
    const version = /^\w+ version (\d+\.\d+\.\d+)/u.exec(versionOutput)?.[1];
    if (!version) throw new Error("Render QA tool version is unavailable");
    admitToolVersion(name, versionOutput, version);
    const configurationSha256 = qaSha256(versionOutput);
    if (
      hosted &&
      (admission.tools?.[name]?.version !== version ||
        admission.tools[name].configurationSha256 !== configurationSha256)
    )
      throw new Error("Render QA tool configuration differs from admission");
    tools[name] = { version, sha256, configurationSha256 };
  }
  return tools;
}
export async function renderQaRgb(
  path: string,
  frame?: number,
  pixelFormat = "rgb24",
): Promise<Buffer> {
  return (
    await runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        ...(frame === undefined ? [] : ["-vf", `select=eq(n\\,${frame})`]),
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        pixelFormat,
        "-",
      ],
      { maxOutputBytes: 2 * 1024 ** 2 },
    )
  ).stdout;
}
export async function renderQaAudio(path: string): Promise<Buffer> {
  return (
    await runProcess(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "f32le",
        "-",
      ],
      { maxOutputBytes: 4 * 1024 ** 2 },
    )
  ).stdout;
}
export function renderQaAmplitude(
  bytes: Buffer,
  start: number,
  frequency: number,
  seconds = 0.2,
): number {
  const first = Math.round(start * 48000),
    count = Math.round(seconds * 48000);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(frequency) ||
    !Number.isFinite(seconds) ||
    first < 0 ||
    count < 1 ||
    (first + count) * 4 > bytes.length
  )
    throw new Error("Invalid bounded audio measurement window");
  let real = 0,
    imaginary = 0;
  for (let index = 0; index < count; index++) {
    const value = bytes.readFloatLE((first + index) * 4);
    if (!Number.isFinite(value))
      throw new Error("Nonfinite decoded audio measurement");
    const angle = (2 * Math.PI * frequency * index) / 48000;
    real += value * Math.cos(angle);
    imaginary += value * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imaginary)) / count;
}
export function renderQaMae(actual: Buffer, expected: Buffer): number {
  if (!actual.length || actual.length !== expected.length)
    throw new Error("Decoded pixel dimensions or sample counts differ");
  let total = 0;
  for (let i = 0; i < actual.length; i++)
    total += Math.abs(actual[i]! - expected[i]!);
  return total / actual.length;
}
export async function renderQaFrameCount(path: string): Promise<number> {
  const probe = JSON.parse(
    (
      await runProcess("ffprobe", [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "json",
        path,
      ])
    ).stdout.toString(),
  );
  const count = Number(probe.streams?.[0]?.nb_read_frames);
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("Decoded frame count is unavailable");
  return count;
}
