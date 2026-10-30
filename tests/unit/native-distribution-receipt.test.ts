import { afterEach, expect, it } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { attributeDistribution } from "../../scripts/native/attribute-distribution.js";
import { recordEsbuildContributions } from "../../scripts/build-attribution.mjs";
import {
  runtimeHash,
  type RuntimeManifest,
} from "../../apps/server/src/runtime-manifest.js";
import type { CargoEvidence } from "../../scripts/native/attribution.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-distribution-receipt-"));
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    '{"name":"openfilm","version":"0.4.0","license":"Apache-2.0"}',
  );
  await writeFile(join(root, "pnpm-lock.yaml"), "packages: {}\n");
  await writeFile(join(root, "entry.js"), 'console.log("fixture");');
  const built = await build({
    entryPoints: [join(root, "entry.js")],
    outfile: join(root, "dist/service.mjs"),
    absWorkingDir: root,
    bundle: true,
    metafile: true,
    format: "esm",
  });
  await recordEsbuildContributions(
    root,
    built.metafile,
    "service",
    "dist/contributions.json",
  );
  const runtime = join(root, "runtime");
  await mkdir(join(runtime, "receipts"), { recursive: true });
  const files: RuntimeManifest["files"] = [];
  const entries = {
    node: "node",
    launcher: "launcher",
    service: "service",
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
    font: "font",
  };
  for (const name of [
    "node",
    "launcher",
    "service",
    "ffmpeg",
    "ffprobe",
    "font",
    "LICENSE",
    "receipts/attribution.json",
    "receipts/linkage-evidence.json",
  ]) {
    const bytes =
      name === "service"
        ? await readFile(join(root, "dist/service.mjs"))
        : Buffer.from(
            name === "receipts/attribution.json"
              ? '{"packages":[]}'
              : name === "receipts/linkage-evidence.json"
                ? JSON.stringify({
                    schemaVersion: 1,
                    verified: true,
                    distributionApproved: false,
                    observationMode: "fixture",
                    platform: process.platform,
                    architecture: process.arch,
                    baseline: {
                      os: "fixture",
                      build: "fixture",
                      architecture: process.arch,
                      abi: "fixture",
                    },
                    binaries: [],
                  })
                : "synthetic fixture only",
          );
    await writeFile(join(runtime, name), bytes);
    await chmod(join(runtime, name), 0o755);
    files.push({
      path: name,
      sha256: await runtimeHash(join(runtime, name)),
      size: bytes.length,
      executable: true,
      component: ["node", "ffmpeg", "ffprobe", "font"].includes(name)
        ? name
        : "openfilm",
    });
  }
  const manifest: RuntimeManifest = {
    schemaVersion: 1,
    appVersion: "0.4.0",
    nodeVersion: "24.19.0",
    platform: process.platform as RuntimeManifest["platform"],
    architecture: process.arch as RuntimeManifest["architecture"],
    projectSchema: "1.0.0",
    entries,
    files,
    components: ["node", "ffmpeg", "ffprobe", "font", "openfilm"].map((id) => ({
      id,
      version:
        id === "node" ? "24.19.0" : id === "openfilm" ? "0.4.0" : "1.0.0",
      license: "MIT",
      licenseFile: "LICENSE",
    })),
    updates: { mode: "manual", automatic: false, signatureRequired: true },
    optionalCapabilities: { exiftool: false, whisper: false },
    distribution: {
      status: "test-only",
      systemRequirements: ["fixture"],
      receipt: null,
    },
  };
  await writeFile(
    join(runtime, "runtime-manifest.json"),
    JSON.stringify(manifest),
  );
  const target = `${process.arch === "x64" ? "x86_64" : "aarch64"}-${process.platform === "darwin" ? "apple-darwin" : process.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-gnu"}`;
  const shell = `target/${target}/release/fixture`;
  await mkdir(join(root, shell, ".."), { recursive: true });
  await writeFile(
    join(root, shell),
    "synthetic shell fixture only; never executed",
  );
  const sha256 = await runtimeHash(join(root, shell));
  const cargo: CargoEvidence = {
    schemaVersion: 1,
    observationMode: "fixture",
    target,
    metadataSha256: "1".repeat(64),
    lockSha256: "2".repeat(64),
    packages: [
      {
        id: "fixture-cargo",
        name: "fixture-cargo",
        version: "1.0.0",
        license: "MIT",
        sourceIdentity: "3".repeat(64),
        source: { kind: "cargo", locator: "fixture" },
      },
    ],
    compilations: [
      {
        packageId: "fixture-cargo",
        role: "target",
        artifacts: [{ path: shell, sha256 }],
      },
    ],
    shell: { path: shell, sha256, packageId: "fixture-cargo" },
    generatedOutputs: [],
  };
  await writeFile(join(root, "cargo.json"), JSON.stringify(cargo));
  await writeFile(join(root, "licenses.json"), "[]");
  const pin = async (path: string) => ({
    source: join(root, path),
    sha256: await runtimeHash(join(root, path)),
  });
  return {
    root,
    runtime,
    output: join(root, "external-attribution"),
    inputs: {
      repository: root,
      runtimeRoot: runtime,
      runtimeManifestSha256: await runtimeHash(
        join(runtime, "runtime-manifest.json"),
      ),
      buildContributions: await pin("dist/contributions.json"),
      cargo: await pin("cargo.json"),
      licenseReceipts: await pin("licenses.json"),
    },
  };
}
it("writes final native evidence outside the runtime and binds its existing manifest without a hash cycle", async () => {
  const f = await fixture();
  const before = await readFile(join(f.runtime, "runtime-manifest.json"));
  const e = await attributeDistribution(f.inputs, f.output);
  const receipt = JSON.parse(
    await readFile(join(f.output, "attribution.json"), "utf8"),
  );
  expect(receipt.scope).toBe("native-distribution");
  expect(receipt.runtimeManifestSha256).toBe(f.inputs.runtimeManifestSha256);
  expect(await readFile(join(f.runtime, "runtime-manifest.json"))).toEqual(
    before,
  );
  expect(e.distributionApproved).toBe(false);
  expect(e.reviewStatus).toBe("blocked");
  expect(e.blockers).toContain("native-build-evidence-is-fixture");
  expect(e.blockers).toContain("executed-linkage-evidence-missing");
  const spdx = JSON.parse(
    await readFile(join(f.output, "sbom.spdx.json"), "utf8"),
  );
  expect(
    spdx.packages.some((x: { name: string }) => x.name === "fixture-cargo"),
  ).toBe(true);
});
it("refuses a stale independently supplied runtime digest before creating native evidence", async () => {
  const f = await fixture();
  f.inputs.runtimeManifestSha256 = "0".repeat(64);
  await expect(attributeDistribution(f.inputs, f.output)).rejects.toThrow(
    "runtime.hash",
  );
  await expect(
    readFile(join(f.output, "attribution.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
it("refuses to write post-build receipts inside the already hashed runtime", async () => {
  const f = await fixture();
  await expect(
    attributeDistribution(f.inputs, join(f.runtime, "external")),
  ).rejects.toThrow("outside the runtime");
  expect(await runtimeHash(join(f.runtime, "runtime-manifest.json"))).toBe(
    f.inputs.runtimeManifestSha256,
  );
  await expect(
    readFile(join(f.runtime, "external/attribution.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
