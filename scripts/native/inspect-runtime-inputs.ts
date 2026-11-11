// Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
import { lstat, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  runtimeHash,
  runtimePath,
} from "../../apps/server/src/runtime-manifest.js";
import { assertBinaryArchitecture, assertRegularInput } from "./input-files.js";
import type { InputFile, RuntimeInputs } from "./stage.js";

/** Cross-host, read-only intake. It never loads tools, addons or project code.
 * This is a pin/format check, not a license review or target execution receipt.
 */
export async function inspectRuntimeInputs(inputs: RuntimeInputs) {
  if (
    !inputs ||
    !["linux", "darwin", "win32"].includes(inputs.platform) ||
    !["x64", "arm64"].includes(inputs.architecture)
  )
    throw new Error("Unsupported runtime platform/architecture");
  if (
    !/^24\.(?:1[4-9]|[2-9]\d|\d{3,})\.\d+$/u.test(inputs.nodeVersion) ||
    inputs.tools?.node?.version !== inputs.nodeVersion
  )
    throw new Error("Node version must match the pinned supported 24.x tool");
  const files: { id: string; sha256: string; size: number }[] = [];
  const inspect = async (id: string, source: string, sha256: string) => {
    if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error(`Invalid hash: ${id}`);
    await assertRegularInput(source);
    const { size } = await lstat(source);
    if (!size || size > 1024 ** 3)
      throw new Error(`Input empty or oversized: ${id}`);
    if ((await runtimeHash(source)) !== sha256)
      throw new Error(`Input hash mismatch: ${id}`);
    files.push({ id, sha256, size });
  };
  const binary = async (source: string, required: boolean) => {
    const native = await assertBinaryArchitecture(
      source,
      inputs.architecture,
      required,
    );
    if (!native) {
      if (required)
        throw new Error(
          "Native executable binary required; scripts are not runtime tools",
        );
      return;
    }
    const handle = await open(source, "r");
    try {
      const bytes = Buffer.alloc(4);
      await handle.read(bytes, 0, 4, 0);
      const platform =
        bytes.subarray(0, 2).toString() === "MZ"
          ? "win32"
          : bytes.readUInt32LE(0) === 0xfeedfacf
            ? "darwin"
            : "linux";
      if (platform !== inputs.platform)
        throw new Error("Runtime input platform mismatch");
    } finally {
      await handle.close();
    }
  };
  const tool = async (
    id: string,
    input: InputFile,
    executable: boolean,
    inspectBinary: boolean,
  ) => {
    if (
      !input ||
      typeof input.version !== "string" ||
      !input.version.trim() ||
      typeof input.license !== "string" ||
      !input.license.trim()
    )
      throw new Error(`Missing input identity: ${id}`);
    await inspect(id, input.source, input.sha256);
    await inspect(`${id}:license`, input.licenseFile, input.licenseSha256);
    if (inspectBinary) await binary(input.source, executable);
  };
  const destinations = new Set<string>();
  for (const id of ["node", "ffmpeg", "ffprobe", "font"] as const) {
    destinations.add(
      id === "font"
        ? "fonts/default.ttf"
        : `bin/${id}${inputs.platform === "win32" ? ".exe" : ""}`,
    );
  }
  for (const id of ["node", "ffmpeg", "ffprobe", "font"] as const) {
    const input = inputs.tools[id];
    await tool(id, input, id !== "font", id !== "font");
    if (
      (input.supportFiles?.length ?? 0) > 32 ||
      (id === "font" && input.supportFiles?.length)
    )
      throw new Error("Unsupported support file count");
    const owners = new Set<string>();
    for (const support of input.supportFiles ?? []) {
      try {
        runtimePath("/intake", support.destination);
      } catch {
        throw new Error("Invalid runtime support path");
      }
      const destination = `bin/${support.destination}`.toLowerCase();
      if (
        !/^[a-z0-9][a-z0-9._-]{0,39}$/u.test(support.id) ||
        typeof support.executable !== "boolean" ||
        owners.has(support.id) ||
        destinations.has(destination)
      )
        throw new Error("Invalid or duplicate support input");
      owners.add(support.id);
      destinations.add(destination);
      await tool(`tool:${id}:${support.id}`, support, support.executable, true);
    }
  }
  for (const [id, receipt] of Object.entries(inputs.dependencyLicenses ?? {}))
    await inspect(`dependency-license:${id}`, receipt.source, receipt.sha256);
  for (const [id, receipt] of Object.entries({
    distributionReview: inputs.distributionReview,
    linkagePolicy: inputs.linkage?.policy,
    linkageEvidence: inputs.linkage?.evidence,
    buildContributions: inputs.attribution?.buildContributions,
    licenseReceipts: inputs.attribution?.licenseReceipts,
  }))
    if (receipt) await inspect(id, receipt.source, receipt.sha256);
  return {
    schemaVersion: 1,
    platform: inputs.platform,
    architecture: inputs.architecture,
    status: "pins-verified-only",
    executed: false,
    distributionApproved: false,
    files,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [source] = process.argv.slice(2);
  if (!source)
    throw new Error(
      "Usage: inspect-runtime-inputs.ts <runtime-inputs.local.json>",
    );
  const inputs = JSON.parse(await readFile(source, "utf8")) as RuntimeInputs;
  console.log(JSON.stringify(await inspectRuntimeInputs(inputs), null, 2));
}
