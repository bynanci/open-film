// Modified by OpenFilm contributors on 2026-11-11. See LICENSE and NOTICE.
import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRuntimeInputs } from "../../scripts/native/inspect-runtime-inputs.js";
import type { RuntimeInputs } from "../../scripts/native/stage.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
async function fixture(platform: "win32" | "darwin" = "win32") {
  const root = await mkdtemp(join(tmpdir(), "openfilm-intake-"));
  roots.push(root);
  const bytes = Buffer.alloc(128);
  if (platform === "win32") {
    bytes.write("MZ");
    bytes.writeUInt32LE(64, 60);
    bytes.write("PE\0\0", 64);
    bytes.writeUInt16LE(34404, 68);
  } else {
    bytes.writeUInt32LE(0xfeedfacf);
    bytes.writeUInt32LE(16777228, 4);
  }
  const source = join(root, "binary");
  const licenseFile = join(root, "notice");
  await writeFile(source, bytes);
  await writeFile(licenseFile, "Fixture notice; not a license approval.");
  const tool = {
    source,
    sha256: hash(bytes),
    version: "24.14.0",
    license: "MIT",
    licenseFile,
    licenseSha256: hash("Fixture notice; not a license approval."),
  };
  const font = join(root, "font");
  await writeFile(font, "fixture font");
  const inputs: RuntimeInputs = {
    platform,
    architecture: platform === "win32" ? "x64" : "arm64",
    appVersion: "0.4.0",
    nodeVersion: "24.14.0",
    tools: {
      node: { ...tool },
      ffmpeg: { ...tool, version: "7.1.1" },
      ffprobe: { ...tool, version: "7.1.1" },
      font: {
        ...tool,
        source: font,
        sha256: hash("fixture font"),
        version: "2.004",
        license: "OFL-1.1",
      },
    },
  };
  return { root, inputs, source, bytes, licenseFile };
}
it.each(["win32", "darwin"] as const)(
  "inspects %s target pins on any host without granting distribution permission or exposing input paths",
  async (platform) => {
    const f = await fixture(platform);
    const before = await readFile(f.source);
    const result = await inspectRuntimeInputs(f.inputs);
    expect(result).toMatchObject({
      schemaVersion: 1,
      platform,
      status: "pins-verified-only",
      executed: false,
      distributionApproved: false,
    });
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "node",
          sha256: hash(f.bytes),
          size: 128,
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(f.root);
    expect(await readFile(f.source)).toEqual(before);
  },
);
it.each([
  "os",
  "architecture",
  "hash",
  "license-hash",
  "empty-license",
  "script",
  "hardlink",
  "node-version",
  "support-hash",
  "support-traversal",
  "dependency-license",
])("rejects %s before handing inputs to target staging", async (fault) => {
  const f = await fixture();
  if (fault === "os") f.inputs.platform = "darwin";
  if (fault === "architecture") f.inputs.architecture = "arm64";
  if (fault === "hash") f.inputs.tools.node.sha256 = "0".repeat(64);
  if (fault === "license-hash")
    f.inputs.tools.node.licenseSha256 = "0".repeat(64);
  if (fault === "empty-license") {
    await writeFile(f.licenseFile, "");
    for (const t of Object.values(f.inputs.tools)) t.licenseSha256 = hash("");
  }
  if (fault === "script") {
    const script = "#!/bin/sh\ntouch NEVER_EXECUTE\n";
    await writeFile(f.source, script);
    f.inputs.tools.node.sha256 = hash(script);
  }
  if (fault === "hardlink") await link(f.source, join(f.root, "alias"));
  if (fault === "node-version") f.inputs.nodeVersion = "24.19.0";
  if (fault.startsWith("support"))
    f.inputs.tools.ffmpeg.supportFiles = [
      {
        ...f.inputs.tools.node,
        id: "codec",
        destination: fault === "support-traversal" ? "../outside" : "codec.dll",
        executable: false,
        sha256: fault === "support-hash" ? "0".repeat(64) : hash(f.bytes),
      },
    ];
  if (fault === "dependency-license")
    f.inputs.dependencyLicenses = {
      fontkit: { source: f.licenseFile, sha256: "0".repeat(64) },
    };
  const messages: Record<string, RegExp> = {
    os: /platform/,
    architecture: /architecture/,
    hash: /hash mismatch/,
    "license-hash": /hash mismatch/,
    "empty-license": /empty/,
    script: /binary/,
    hardlink: /unlinked regular/,
    "node-version": /Node version/,
    "support-hash": /hash mismatch/,
    "support-traversal": /path/i,
    "dependency-license": /hash mismatch/,
  };
  await expect(inspectRuntimeInputs(f.inputs)).rejects.toThrow(messages[fault]);
});
