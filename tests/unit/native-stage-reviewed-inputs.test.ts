// Modified by OpenFilm contributors on 2026-11-12. See LICENSE and NOTICE.
import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRuntimeInputs } from "../../scripts/native/inspect-runtime-inputs.js";
import {
  stageRuntime,
  type RuntimeInputs,
} from "../../scripts/native/stage.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

function header(platform: RuntimeInputs["platform"]): Buffer {
  const bytes = Buffer.alloc(128);
  if (platform === "win32") {
    bytes.write("MZ");
    bytes.writeUInt32LE(64, 60);
    bytes.write("PE\0\0", 64);
    bytes.writeUInt16LE(process.arch === "x64" ? 34404 : 43620, 68);
  } else if (platform === "darwin") {
    bytes.writeUInt32LE(0xfeedfacf);
    bytes.writeUInt32LE(process.arch === "x64" ? 16777223 : 16777228, 4);
  } else {
    bytes.write("\x7fELF", 0, "binary");
    bytes[4] = 2;
    bytes[5] = 1;
    bytes.writeUInt16LE(process.arch === "x64" ? 62 : 183, 18);
  }
  return bytes;
}

async function fixture() {
  // Resolve OS temporary-directory aliases before introducing hostile parents.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "openfilm-reviewed-stage-")),
  );
  roots.push(root);
  const platform = process.platform as RuntimeInputs["platform"];
  const directory = join(root, "inputs");
  const repository = join(root, "repository");
  await mkdir(directory);
  await mkdir(repository);
  const inputs: RuntimeInputs = {
    platform,
    architecture: process.arch as RuntimeInputs["architecture"],
    appVersion: "1.0.0",
    nodeVersion: "24.14.0",
    tools: {} as RuntimeInputs["tools"],
  };
  for (const id of ["node", "ffmpeg", "ffprobe", "font"] as const) {
    const source = join(directory, id);
    const licenseFile = join(directory, `${id}-notice.txt`);
    const bytes =
      id === "font" ? Buffer.from("Synthetic font data") : header(platform);
    const notice = "Synthetic fixture notice only; not a license approval.\n";
    await writeFile(source, bytes);
    await writeFile(licenseFile, notice);
    inputs.tools[id] = {
      source,
      sha256: hash(bytes),
      version: id === "node" ? "24.14.0" : "1.0.0",
      license: "MIT",
      licenseFile,
      licenseSha256: hash(notice),
    };
  }
  const review =
    "Synthetic review bytes only; no rights or distribution approval.\n";
  const reviewSource = join(directory, "review.txt");
  await writeFile(reviewSource, review);
  inputs.distributionReview = {
    source: reviewSource,
    sha256: hash(review),
    systemRequirements: ["Synthetic fixture; never distribute"],
  };
  return {
    root,
    directory,
    repository,
    inputs,
    parent: join(root, "destination-parent"),
    output: join(root, "destination-parent", "runtime"),
    sentinel: join(root, "NEVER_EXECUTE"),
  };
}

const executableFaults = [
  ["wrong OS", "Runtime input platform mismatch"],
  [
    "script",
    "Native executable binary required; scripts are not runtime tools",
  ],
  ["hardlink", "Runtime inputs must be unlinked regular files"],
  ["symlink parent", "Symlink in runtime input parent"],
] as const;
const noticeFaults = [
  ["hardlink", "Runtime inputs must be unlinked regular files"],
  ["symlink parent", "Symlink in runtime input parent"],
  ["empty", "Input empty or oversized"],
  ["changed hash", "Input hash mismatch"],
] as const;
const cases = [
  ...(["node", "ffmpeg", "ffprobe"] as const).flatMap((id) =>
    executableFaults.map(([fault, message]) => ({
      id,
      notice: false,
      fault,
      message,
    })),
  ),
  ...(["node", "ffmpeg", "ffprobe", "font"] as const).flatMap((id) =>
    noticeFaults.map(([fault, message]) => ({
      id,
      notice: true,
      fault,
      message:
        fault === "empty" || fault === "changed hash"
          ? `${message}: ${id}:license`
          : message,
    })),
  ),
];

it.each(cases)(
  "rejects reviewed $id input (notice=$notice, $fault) before destination effects",
  async ({ id, notice, fault, message }) => {
    const f = await fixture();
    const input = f.inputs.tools[id];
    const source = notice ? input.licenseFile : input.source;
    if (fault === "wrong OS") {
      const bytes = header(process.platform === "win32" ? "darwin" : "win32");
      await writeFile(source, bytes);
      input.sha256 = hash(bytes);
    } else if (fault === "script") {
      const script = `#!/bin/sh\ntouch '${f.sentinel}'\n`;
      await writeFile(source, script, { mode: 0o755 });
      input.sha256 = hash(script);
    } else if (fault === "hardlink") {
      await link(source, join(f.root, "hardlink-alias"));
    } else if (fault === "symlink parent") {
      const alias = join(f.root, "linked-inputs");
      await symlink(f.directory, alias, "dir");
      const linkedSource = join(alias, source.slice(f.directory.length + 1));
      if (notice) input.licenseFile = linkedSource;
      else input.source = linkedSource;
    } else if (fault === "empty") {
      await writeFile(source, "");
      input.licenseSha256 = hash("");
    } else if (fault === "changed hash") {
      await writeFile(
        source,
        "Changed synthetic notice; not license approval.\n",
      );
    }
    const original = new Map(
      await Promise.all(
        (await readdir(f.directory)).map(async (name) => {
          const path = join(f.directory, name);
          return [path, await readFile(path)] as const;
        }),
      ),
    );
    const before = (await readdir(f.root)).sort();
    const error: unknown = await stageRuntime(
      f.inputs,
      f.output,
      f.repository,
    ).catch((reason: unknown) => reason);
    expect.soft(error).toBeInstanceOf(Error);
    expect.soft((error as Error).constructor).toBe(Error);
    expect.soft((error as Error).message).toBe(message);
    for (const path of [f.output, f.parent, `${f.output}.lock`, f.sentinel])
      await expect.soft(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect.soft((await readdir(f.root)).sort()).toEqual(before);
    for (const [path, bytes] of original)
      expect.soft(await readFile(path)).toEqual(bytes);
  },
);

it("admits matching host header pins only to the existing missing LICENSE gate", async () => {
  const f = await fixture();
  const report = await inspectRuntimeInputs(f.inputs);
  expect(report).toMatchObject({
    status: "pins-verified-only",
    executed: false,
    distributionApproved: false,
  });
  const original = await readFile(f.inputs.tools.node.source);
  await expect(
    stageRuntime(f.inputs, f.output, f.repository),
  ).rejects.toMatchObject({
    code: "ENOENT",
    path: join(f.repository, "LICENSE"),
  });
  expect(await readdir(f.parent)).toEqual([]);
  for (const path of [f.output, `${f.output}.lock`, f.sentinel])
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(f.inputs.tools.node.source)).toEqual(original);
});
