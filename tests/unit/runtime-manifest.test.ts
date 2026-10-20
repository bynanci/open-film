import { describe, expect, it } from "vitest";
import {
  validateRuntimeManifest,
  runtimePath,
  assertUpdatePolicy,
} from "../../apps/server/src/runtime-manifest.js";

describe("native runtime manifest", () => {
  it("rejects traversal, UNC, drive paths, reserved files and unknown updater feeds", () => {
    for (const path of [
      "../node",
      "C:/node",
      "//host/node",
      "bin\\node",
      "bin/CON",
      "bin/node.",
      "bin//node",
    ])
      expect(() => runtimePath("/bundle", path)).toThrow();
    expect(() =>
      assertUpdatePolicy({
        automatic: true,
        mode: "manual",
        signatureRequired: true,
      }),
    ).toThrow();
  });
  it("rejects unknown schemas and incomplete runtime manifests before execution", () => {
    expect(() => validateRuntimeManifest({ schemaVersion: 99 })).toThrow();
    expect(() =>
      validateRuntimeManifest({ schemaVersion: 1, files: [] }),
    ).toThrow();
  });
});

import { generateKeyPairSync, sign } from "node:crypto";
import {
  chmod,
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import {
  assertDistributableRuntime,
  runtimeHash,
  verifyRuntimeBundle,
  type RuntimeManifest,
} from "../../apps/server/src/runtime-manifest.js";
import { verifyRuntimeUpdate } from "../../apps/server/src/runtime-update.js";
import { runtimeEnvironment } from "../../apps/server/src/native-launcher.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-runtime-manifest-"));
  roots.push(root);
  const files: RuntimeManifest["files"] = [];
  for (const path of [
    "node",
    "service",
    "launcher",
    "ffmpeg",
    "ffprobe",
    "font",
    "LICENSE",
    "sbom.spdx.json",
  ]) {
    await writeFile(join(root, path), "synthetic fixture");
    await chmod(join(root, path), 0o755);
    files.push({
      path,
      sha256: await runtimeHash(join(root, path)),
      size: 17,
      executable: true,
      component: ["node", "ffmpeg", "ffprobe", "font"].includes(path)
        ? path
        : "openfilm",
    });
  }
  const manifest: RuntimeManifest = {
    schemaVersion: 1,
    appVersion: "0.1.0",
    nodeVersion: "24.14.0",
    platform: process.platform as RuntimeManifest["platform"],
    architecture: process.arch as RuntimeManifest["architecture"],
    projectSchema: "1.0.0",
    entries: {
      node: "node",
      launcher: "launcher",
      service: "service",
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      font: "font",
    },
    components: ["node", "ffmpeg", "ffprobe", "font", "openfilm"].map((id) => ({
      id,
      version:
        id === "node" ? "24.14.0" : id === "openfilm" ? "0.1.0" : "1.0.0",
      license: "CC0-1.0",
      licenseFile: "LICENSE",
    })),
    files,
    updates: { mode: "manual", automatic: false, signatureRequired: true },
    optionalCapabilities: { exiftool: false, whisper: false },
    distribution: {
      status: "test-only",
      systemRequirements: ["Synthetic test platform"],
      receipt: null,
    },
  };
  await writeFile(
    join(root, "runtime-manifest.json"),
    JSON.stringify(manifest),
  );
  return { root, manifest };
}
it("verifies all receipts and rejects changed bytes, extra files, hardlinks and symlinks", async () => {
  const { root } = await fixture();
  expect((await verifyRuntimeBundle(root)).files).toHaveLength(8);
  await writeFile(join(root, "service"), "changed");
  await expect(verifyRuntimeBundle(root)).rejects.toThrow("runtime.hash");
  await writeFile(join(root, "service"), "synthetic fixture");
  await writeFile(join(root, ".env"), "private");
  await expect(verifyRuntimeBundle(root)).rejects.toThrow();
  await rm(join(root, ".env"));
  await link(join(root, "font"), join(root, "linked"));
  await expect(verifyRuntimeBundle(root)).rejects.toThrow();
  await rm(join(root, "linked"));
  await symlink(join(root, "font"), join(root, "symbolic"));
  await expect(verifyRuntimeBundle(root)).rejects.toThrow();
});
it("requires a configured trusted update key and a valid signature before accepting bytes", async () => {
  const { root } = await fixture();
  const json = JSON.parse(
    await readFile(join(root, "runtime-manifest.json"), "utf8"),
  ) as RuntimeManifest;
  expect(() => assertDistributableRuntime(json)).toThrow(
    "distributionReviewRequired",
  );
  json.distribution = {
    status: "reviewed",
    systemRequirements: ["Synthetic signed fixture"],
    receipt: "LICENSE",
  };
  await writeFile(join(root, "runtime-manifest.json"), JSON.stringify(json));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = sign(
    null,
    await readFile(join(root, "runtime-manifest.json")),
    privateKey,
  );
  await expect(verifyRuntimeUpdate(root, signature)).rejects.toThrow(
    "updatesDisabled",
  );
  const key = publicKey.export({ format: "pem", type: "spki" }).toString();
  expect((await verifyRuntimeUpdate(root, signature, key)).schemaVersion).toBe(
    1,
  );
  signature[0] = signature[0]! ^ 1;
  await expect(verifyRuntimeUpdate(root, signature, key)).rejects.toThrow(
    "signature",
  );
});
it("does not pass provider secrets or Node injection settings into the owned service", () => {
  process.env.OPENFILM_TEST_SECRET = "synthetic-key";
  process.env.NODE_OPTIONS = "--inspect";
  try {
    const env = runtimeEnvironment("/runtime", "/data", "/projects");
    expect(env.OPENFILM_TEST_SECRET).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.PATH).toBe(join("/runtime", "bin"));
  } finally {
    delete process.env.OPENFILM_TEST_SECRET;
    delete process.env.NODE_OPTIONS;
  }
});
