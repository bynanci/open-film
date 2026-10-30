// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join, posix } from "node:path";
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
    f.name !== p.formula ||
    f.tap !== "homebrew/core" ||
    f.versions?.stable !== p.version ||
    f.revision !== p.revision ||
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

export function admitRequiredQaFilters(stdout: string) {
  const filters = new Map(
    [
      ...stdout.matchAll(
        /^\s*([T.][S.][C.]?)\s+([a-z0-9_]+)\s+V->V(?:\s|$)/gmu,
      ),
    ].map(
      (match) =>
        [
          match[2]!,
          { flags: match[1]!, name: match[2]!, signature: "V->V" },
        ] as const,
    ),
  );
  const required = ["zscale", "tonemap"];
  if (required.some((name) => !filters.has(name)))
    throw new Error("Render QA tool lacks required HDR filters.");
  return required.map((name) => filters.get(name)!);
}

/** Raw paths stay in the local setup root; only validated identities/hashes travel. */
export async function observeMacQaDependencies(
  installedFormula: unknown,
  bin: string,
  run: (command: string, args: string[]) => Promise<string>,
) {
  admitBrewFormula(installedFormula, true);
  const dependencies = (
    installedFormula as { formulae: Array<{ dependencies?: unknown }> }
  ).formulae[0]!.dependencies;
  if (
    !Array.isArray(dependencies) ||
    dependencies.length < 1 ||
    dependencies.length > 64 ||
    dependencies.some(
      (name) =>
        typeof name !== "string" ||
        !/^[a-z0-9][a-z0-9+@._-]{0,99}$/u.test(name) ||
        name === pins.tools["darwin-arm64"].formula,
    ) ||
    new Set(dependencies).size !== dependencies.length
  )
    throw new Error("Missing or invalid Homebrew dependency inventory");
  const local = {
    metadata: [] as Array<{ name: string; stdout: string; sha256: string }>,
    libraries: [] as Array<{ name: string; stdout: string; sha256: string }>,
  };
  const summary: string[] = [];
  let totalBytes = 0;
  async function observation(command: string, args: string[]) {
    let stdout: string;
    try {
      stdout = await run(command, args);
    } catch (error) {
      throw new Error(`Required macOS ${command} observation failed`, {
        cause: error,
      });
    }
    const bytes = Buffer.byteLength(stdout, "utf8");
    totalBytes += bytes;
    if (!bytes || bytes > 256 * 1024 || totalBytes > 4 * 1024 ** 2)
      throw new Error("Invalid bounded macOS dependency observation");
    return { stdout, sha256: qaSha256(stdout) };
  }
  const pending = [pins.tools["darwin-arm64"].formula, ...dependencies];
  const seen = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const name = pending[index]!;
    if (seen.has(name)) continue;
    seen.add(name);
    if (seen.size > 128)
      throw new Error("Homebrew dependency closure exceeds its bound");
    const observed = await observation("brew", ["info", "--json=v2", name]);
    let data;
    try {
      data = JSON.parse(observed.stdout) as {
        formulae?: Array<{
          name?: string;
          tap?: string;
          installed?: Array<{ version?: string }>;
          dependencies?: unknown;
          license?: unknown;
        }>;
        casks?: unknown[];
      };
    } catch (error) {
      throw new Error("Invalid Homebrew dependency JSON", { cause: error });
    }
    const formula = data?.formulae?.[0];
    const version = formula?.installed?.[0]?.version;
    if (
      data?.formulae?.length !== 1 ||
      (data.casks !== undefined &&
        (!Array.isArray(data.casks) || data.casks.length !== 0)) ||
      !formula ||
      formula.name !== name ||
      formula.tap !== "homebrew/core" ||
      formula.installed?.length !== 1 ||
      typeof version !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_:-]{0,99}$/u.test(version)
    )
      throw new Error(
        "Missing or invalid installed Homebrew dependency identity",
      );
    if (
      !Array.isArray(formula.dependencies) ||
      formula.dependencies.length > 64 ||
      formula.dependencies.some(
        (dependency) =>
          typeof dependency !== "string" ||
          !/^[a-z0-9][a-z0-9+@._-]{0,99}$/u.test(dependency) ||
          dependency === pins.tools["darwin-arm64"].formula,
      ) ||
      new Set(formula.dependencies).size !== formula.dependencies.length ||
      typeof formula.license !== "string" ||
      !formula.license.length ||
      formula.license.length > 4096 ||
      [...formula.license].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })
    )
      throw new Error(
        "Missing or invalid Homebrew dependency/license metadata",
      );
    if (name === pins.tools["darwin-arm64"].formula) {
      admitBrewFormula(data, true);
      if (
        !Array.isArray(formula.dependencies) ||
        JSON.stringify([...formula.dependencies].sort()) !==
          JSON.stringify([...dependencies].sort())
      )
        throw new Error(
          "Homebrew dependency inventory changed during observation",
        );
    }
    pending.push(...formula.dependencies);
    local.metadata.push({ name, ...observed });
    summary.push(
      `brew:${name}=${version}`,
      `brew-info:${name}:sha256=${observed.sha256}`,
      `brew-license:${name}:sha256=${qaSha256(formula.license)}`,
    );
  }
  for (const name of ["ffmpeg", "ffprobe"]) {
    // This evidence describes a macOS executable even when its fault-control
    // fixture is evaluated on a Windows host.
    const path = posix.join(bin, name);
    const observed = await observation("otool", ["-L", path]);
    const [header, ...libraries] = observed.stdout.split(/\r?\n/u);
    if (
      header !== `${path}:` ||
      libraries.length < 1 ||
      libraries.length > 256 ||
      libraries.some(
        (line) =>
          !/^\s+(?:\/|@(?:rpath|loader_path|executable_path)\/)[^\r\n]+ \(compatibility version \d+(?:\.\d+){0,2}, current version \d+(?:\.\d+){0,2}\)$/u.test(
            line,
          ),
      )
    )
      throw new Error("Missing or invalid otool library observation");
    local.libraries.push({ name, ...observed });
    summary.push(
      `otool:${name}:sha256=${observed.sha256}:libraries=${libraries.length}`,
    );
  }
  return { local, summary };
}
