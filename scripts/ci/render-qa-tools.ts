// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import pins from "../../fixtures/render-qa/toolchain.json";

export const qaSha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

/** A dedicated tool bin must not put all of /usr/bin ahead of setup-node. */
export async function stageLinuxQaBin(
  source: string,
  output: string,
): Promise<void> {
  await mkdir(output);
  try {
    for (const name of ["ffmpeg", "ffprobe"]) {
      const from = join(source, name),
        to = join(output, name),
        info = await lstat(from);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size < 1 ||
        info.size > 256 * 1024 ** 2
      )
        throw new Error("Invalid admitted Linux executable");
      const original = await readFile(from);
      await copyFile(from, to, constants.COPYFILE_EXCL);
      await chmod(to, 0o755);
      if (
        original.length !== info.size ||
        qaSha256(original) !== qaSha256(await readFile(to))
      )
        throw new Error("Linux tool bytes changed while staging");
    }
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}
const origins = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "release-assets.githubusercontent.com",
  "archive.ubuntu.com",
]);
function trustedUrl(input: string): URL {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !origins.has(url.hostname)
  )
    throw new Error("Unreviewed render QA download origin");
  return url;
}
export function verifyPinnedBytes(
  bytes: Uint8Array,
  sha256: string,
  maxBytes: number,
): void {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    bytes.length < 1 ||
    bytes.length > maxBytes
  )
    throw new Error("Render QA download exceeds its byte limit");
  if (!/^[a-f0-9]{64}$/u.test(sha256) || qaSha256(bytes) !== sha256)
    throw new Error("Render QA download hash mismatch");
}
export async function downloadPinnedBytes(
  input: string,
  sha256: string,
  maxBytes: number,
): Promise<Buffer> {
  let url = trustedUrl(input);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location)
        throw new Error("Render QA download redirect has no location");
      url = trustedUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error("Render QA download failed");
    const advertised = response.headers.get("content-length");
    if (
      advertised &&
      (!/^\d+$/u.test(advertised) || Number(advertised) > maxBytes)
    ) {
      await response.body.cancel();
      throw new Error("Render QA download exceeds its byte limit");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes)
          throw new Error("Render QA download exceeds its byte limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    verifyPinnedBytes(bytes, sha256, maxBytes);
    return bytes;
  }
  throw new Error("Render QA download redirect limit exceeded");
}
export function admitToolVersion(
  tool: "ffmpeg" | "ffprobe",
  stdout: string,
  expected: string,
): string {
  const first = stdout.split(/\r?\n/u)[0] ?? "";
  const version = /^(ffmpeg|ffprobe) version (\d+\.\d+\.\d+)(?:[- +]|$)/u.exec(
    first,
  );
  if (
    !version ||
    version[1] !== tool ||
    version[2] !== expected ||
    first.length > 250 ||
    [...first].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error("Render QA tool version mismatch");
  return first;
}
export function admitBrewFormula(input: unknown, installed: boolean): void {
  const p = pins.tools["darwin-arm64"];
  const data = input as {
    formulae?: Array<{
      name?: string;
      tap?: string;
      versions?: { stable?: string };
      revision?: number;
      license?: string;
      bottle?: { stable?: { files?: Record<string, { sha256?: string }> } };
      installed?: Array<{ version?: string; poured_from_bottle?: boolean }>;
    }>;
  };
  const f = data?.formulae?.[0];
  if (
    data?.formulae?.length !== 1 ||
    !f ||
    f.name !== "ffmpeg" ||
    f.tap !== "homebrew/core" ||
    f.versions?.stable !== p.version ||
    f.revision !== 1 ||
    f.license !== "GPL-3.0-or-later" ||
    f.bottle?.stable?.files?.[p.bottleTag]?.sha256 !== p.sha256 ||
    (installed &&
      (f.installed?.length !== 1 ||
        f.installed[0]?.version !== p.packageVersion ||
        f.installed[0]?.poured_from_bottle !== true))
  )
    throw new Error(
      "Homebrew formula, bottle or installed identity is unreviewed",
    );
}
