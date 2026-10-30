import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import {
  createBuildContributions,
  verifyBuildContributions,
  recordEsbuildContributions,
  type PackageIdentity,
} from "../../scripts/build-attribution.mjs";
import {
  createDistributionAttribution,
  runtimeComponentIdentity,
  type CargoEvidence,
  type LicenseReceipt,
} from "../../scripts/native/attribution.js";
import {
  runtimeHash,
  type RuntimeManifest,
} from "../../apps/server/src/runtime-manifest.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-attribution-"));
  roots.push(root);
  await mkdir(
    join(root, "node_modules/.pnpm/included@1.0.0/node_modules/included"),
    { recursive: true },
  );
  const pkg = "node_modules/.pnpm/included@1.0.0/node_modules/included";
  await writeFile(
    join(root, "package.json"),
    '{"name":"openfilm","version":"0.4.0","license":"Apache-2.0"}',
  );
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\npackages:\n  included@1.0.0:\n    resolution: {integrity: sha512-aW5jbHVkZWQ=}\n  unshipped@1.0.0:\n    resolution: {integrity: sha512-dW5zaGlwcGVk}\nsnapshots: {}\n",
  );
  await writeFile(
    join(root, pkg, "package.json"),
    '{"name":"included","version":"1.0.0","license":"MIT"}',
  );
  await writeFile(join(root, pkg, "index.js"), "export const answer=42;");
  await writeFile(
    join(root, "entry.js"),
    `import {answer} from './${pkg}/index.js'; console.log(answer);`,
  );
  const result = await build({
    entryPoints: [join(root, "entry.js")],
    outfile: join(root, "dist/server/index.mjs"),
    bundle: true,
    format: "esm",
    metafile: true,
    absWorkingDir: root,
  });
  const outputs = Object.entries(result.metafile!.outputs).map(
    ([path, data]) => ({
      path,
      delivery: "service" as const,
      inputs: Object.entries(data.inputs).map(([path, input]) => ({
        path,
        bytesInOutput: input.bytesInOutput,
      })),
    }),
  );
  return { root, pkg, outputs, metafile: result.metafile! };
}
it("uses emitted contributions and frozen identity, excluding optional/unshipped lock entries", async () => {
  const f = await fixture();
  const c = await createBuildContributions({
    repository: f.root,
    outputs: f.outputs,
  });
  expect(c.packages.map((p) => p.name).sort()).toEqual([
    "included",
    "openfilm",
  ]);
  expect(c.packages.find((p) => p.name === "included")?.source.integrity).toBe(
    "sha512-aW5jbHVkZWQ=",
  );
  expect(c.artifacts[0]?.sha256).toBe(
    await runtimeHash(join(f.root, "dist/server/index.mjs")),
  );
  await verifyBuildContributions(c, f.root);
});
it.each(["unknown", "manifest", "module", "output", "lock"])(
  "rejects %s contribution identity changes",
  async (fault) => {
    const f = await fixture();
    if (fault === "unknown")
      await writeFile(join(f.root, "pnpm-lock.yaml"), "packages: {}\n");
    if (fault === "unknown") {
      await expect(
        createBuildContributions({ repository: f.root, outputs: f.outputs }),
      ).rejects.toThrow();
      return;
    }
    const c = await createBuildContributions({
      repository: f.root,
      outputs: f.outputs,
    });
    if (fault === "manifest")
      await writeFile(
        join(f.root, f.pkg, "package.json"),
        '{"name":"included","version":"1.0.1"}',
      );
    if (fault === "module")
      await writeFile(
        join(f.root, f.pkg, "index.js"),
        "export const answer=41;",
      );
    if (fault === "output")
      await writeFile(join(f.root, "dist/server/index.mjs"), "changed output");
    if (fault === "lock")
      await writeFile(join(f.root, "pnpm-lock.yaml"), "changed lock");
    await expect(verifyBuildContributions(c, f.root)).rejects.toThrow();
  },
);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function manifest(): RuntimeManifest {
  return {
    schemaVersion: 1,
    appVersion: "0.4.0",
    nodeVersion: "24.19.0",
    platform: "linux",
    architecture: "x64",
    projectSchema: "1.0.0",
    entries: {
      node: "bin/node",
      launcher: "launcher.mjs",
      service: "service/index.mjs",
      ffmpeg: "bin/ffmpeg",
      ffprobe: "bin/ffprobe",
      font: "fonts/default.ttf",
    },
    components: [
      {
        id: "tool:ffmpeg:codec",
        version: "1.0",
        license: "MIT",
        licenseFile: "licenses/codec",
      },
    ],
    files: [
      {
        path: "bin/lib/codec.so",
        sha256: hash("codec"),
        size: 5,
        executable: false,
        component: "tool:ffmpeg:codec",
      },
    ],
    updates: { mode: "manual", automatic: false, signatureRequired: true },
    optionalCapabilities: { exiftool: false, whisper: false },
    distribution: {
      status: "test-only",
      systemRequirements: ["fixture"],
      receipt: null,
    },
  };
}
function cargo(): CargoEvidence {
  const p = (id: string): PackageIdentity => ({
    id,
    name: id,
    version: "1.0.0",
    sourceIdentity: hash(id),
    license: "MIT",
    source: {
      kind: "cargo",
      locator: "registry+fixture#" + id,
      checksum: hash(id),
    },
  });
  return {
    schemaVersion: 1,
    observationMode: "fixture",
    target: "x86_64-unknown-linux-gnu",
    metadataSha256: hash("metadata"),
    lockSha256: hash("lock"),
    packages: [p("compiled"), p("build-tool"), p("inactive")],
    compilations: [
      {
        packageId: "compiled",
        role: "target",
        artifacts: [
          {
            path: "target/x86_64-unknown-linux-gnu/release/libcompiled.rlib",
            sha256: hash("rlib"),
          },
        ],
      },
      { packageId: "build-tool", role: "build", artifacts: [] },
    ],
    shell: {
      path: "target/x86_64-unknown-linux-gnu/release/openfilm",
      sha256: hash("shell"),
      packageId: "compiled",
    },
    generatedOutputs: [],
  };
}
it("attributes bundled npm and compiled Rust while distinguishing build-only and inactive packages", async () => {
  const f = await fixture();
  const b = await createBuildContributions({
    repository: f.root,
    outputs: f.outputs,
  });
  const e = await createDistributionAttribution(b, cargo(), manifest(), [], {
    repository: f.root,
  });
  expect(e.packages.find((p) => p.name === "included")?.uses).toContain(
    "bundled-javascript",
  );
  expect(e.packages.find((p) => p.id === "compiled")?.uses).toContain(
    "compiled-target",
  );
  expect(e.packages.find((p) => p.id === "build-tool")?.uses).toEqual([
    "build-only",
  ]);
  expect(e.packages.find((p) => p.id === "inactive")?.uses).toEqual([
    "platform-inactive",
  ]);
  expect(e.spdx.packages.some((p) => p.name === "compiled")).toBe(true);
  expect(e.spdx.packages.some((p) => p.name === "build-tool")).toBe(false);
  expect(
    e.spdx.relationships.some((r) => r.relationshipType === "GENERATED_FROM"),
  ).toBe(true);
  expect(e.reviewStatus).toBe("blocked");
  expect(e.distributionApproved).toBe(false);
  expect(e.blockers.some((x) => x.includes("tool:ffmpeg:codec"))).toBe(true);
});
it.each([
  "missing-text",
  "identity",
  "NOASSERTION",
  "GPL-3.0-or-later",
  "MPL-2.0",
  "OFL-1.1",
  "Apache-2.0",
])("blocks incomplete %s license receipts", async (fault) => {
  const f = await fixture();
  if (["GPL-3.0-or-later", "MPL-2.0", "OFL-1.1", "Apache-2.0"].includes(fault))
    await writeFile(
      join(f.root, f.pkg, "package.json"),
      JSON.stringify({ name: "included", version: "1.0.0", license: fault }),
    );
  const b = await createBuildContributions({
    repository: f.root,
    outputs: f.outputs,
  });
  const p = b.packages.find((p) => p.name === "included")!;
  const text = join(f.root, "reviewed-text.txt");
  await writeFile(text, "Full fixture text only; not a distribution review.");
  const receipt: LicenseReceipt = {
    packageId: p.id,
    sourceIdentity: fault === "identity" ? hash("changed") : p.sourceIdentity,
    reviewed: true,
    licenseConcluded: fault === "NOASSERTION" ? "NOASSERTION" : p.license,
    texts:
      fault === "missing-text"
        ? []
        : [
            {
              source: text,
              sha256: await runtimeHash(text),
              origin: "https://example.invalid/fixture-license",
            },
          ],
    obligations: [],
  };
  const e = await createDistributionAttribution(
    b,
    undefined,
    manifest(),
    [receipt],
    { repository: f.root },
  );
  expect(e.blockers.some((x) => x.includes(p.id))).toBe(true);
  expect(e.reviewStatus).toBe("blocked");
});
it("hash-binds complete notices to SPDX file relationships and never treats NOASSERTION as approval", async () => {
  const f = await fixture();
  const b = await createBuildContributions({
    repository: f.root,
    outputs: f.outputs,
  });
  const p = b.packages.find((p) => p.name === "included")!;
  const text = join(f.root, "full-MIT.txt");
  await writeFile(
    text,
    "Fixture full license text with authentic notices required in real inputs.",
  );
  const e = await createDistributionAttribution(
    b,
    undefined,
    manifest(),
    [
      {
        packageId: p.id,
        sourceIdentity: p.sourceIdentity,
        reviewed: true,
        licenseConcluded: "MIT",
        texts: [
          {
            source: text,
            sha256: await runtimeHash(text),
            origin: "https://example.invalid/source",
          },
        ],
        obligations: [],
      },
    ],
    { repository: f.root },
  );
  const noticeHash = hash(await readFile(text, "utf8"));
  expect(e.notices).toHaveLength(1);
  expect(
    e.spdx.files.some((x) => x.checksums[0]?.checksumValue === noticeHash),
  ).toBe(true);
  expect(e.packages.find((x) => x.id === p.id)?.licenseConcluded).toBe("MIT");
  expect(e.distributionApproved).toBe(false);
  expect(e.blockers).toContain("native-build-evidence-missing");
});
it("attributes Vite's Vue export runtime helper to the actual frozen Vue build plugin", async () => {
  const repository = process.cwd();
  const folder = await mkdtemp(
    join(repository, "dist/generated-contributor-test-"),
  );
  roots.push(folder);
  const path = join(folder, "helper.js");
  await writeFile(path, "export const helper=true;");
  const c = await createBuildContributions({
    repository,
    outputs: [
      {
        path,
        delivery: "frontend",
        inputs: [{ path: "\0plugin-vue:export-helper", bytesInOutput: 26 }],
      },
    ],
  });
  expect(c.packages.map((p) => p.name)).toEqual(["@vitejs/plugin-vue"]);
  await verifyBuildContributions(c, repository);
});
it("refuses an edited bundle inventory that omits a package present in raw esbuild output", async () => {
  const f = await fixture();
  const c = await recordEsbuildContributions(
    f.root,
    f.metafile,
    "service",
    "dist/attribution/server.json",
  );
  const omitted = c.packages.find((p) => p.name === "included")!;
  c.packages = c.packages.filter((p) => p.id !== omitted.id);
  for (const artifact of c.artifacts) {
    artifact.inputs = artifact.inputs.filter((p) => p.packageId !== omitted.id);
    artifact.packages = artifact.packages.filter((id) => id !== omitted.id);
  }
  await expect(verifyBuildContributions(c, f.root)).rejects.toThrow("raw");
});
it("keeps Rust sysroot code unresolved until an artifact-bound source inventory is supplied", async () => {
  const f = await fixture();
  const b = await createBuildContributions({
    repository: f.root,
    outputs: f.outputs,
  });
  const c = cargo();
  const source = join(f.root, "reviewed-rust-inputs.txt");
  await writeFile(
    source,
    "Fixture source/link inventory only; not a distribution approval.",
  );
  const sha256 = await runtimeHash(source);
  const input = {
    family: "rust-sysroot" as const,
    identity: {
      id: "rust-std-fixture",
      name: "rust-std",
      version: "1.99.0",
      sourceIdentity: hash("reviewed-sysroot"),
      license: "Apache-2.0 OR MIT",
      source: {
        kind: "runtime" as const,
        locator: "fixture-rust-source",
        checksum: sha256,
      },
    },
    artifactSha256: [c.shell.sha256],
    inventory: {
      source,
      sha256,
      origin: "https://example.invalid/reviewed-rust-sources",
    },
  };
  const e = await createDistributionAttribution(b, c, manifest(), [], {
    repository: f.root,
    nativeRuntimeInputs: [input],
  });
  expect(e.packages.find((p) => p.id === "rust-std-fixture")?.uses).toContain(
    "compiled-target",
  );
  expect(e.blockers).not.toContain(
    "native-rust-sysroot-contribution-review-required",
  );
  expect(e.reviewStatus).toBe("blocked");
  expect(e.distributionApproved).toBe(false);
  const wrong = await createDistributionAttribution(b, c, manifest(), [], {
    repository: f.root,
    nativeRuntimeInputs: [{ ...input, artifactSha256: [hash("other shell")] }],
  });
  expect(wrong.blockers).toContain(
    "native-rust-sysroot-contribution-review-required",
  );
});
it("binds source obligations to sidecar data bytes regardless of filename extension", async () => {
  const f = await fixture(),
    m = manifest();
  m.files[0]!.path = "bin/lib/codec.dat";
  m.components[0]!.license = "MPL-2.0";
  const p = runtimeComponentIdentity(m, "tool:ffmpeg:codec");
  const source = join(f.root, "sidecar-source-receipt.txt");
  await writeFile(
    source,
    "Fixture source disclosure receipt; no distribution approval.",
  );
  const sha256 = await runtimeHash(source);
  const r: LicenseReceipt = {
    packageId: p.id,
    sourceIdentity: p.sourceIdentity,
    reviewed: true,
    licenseConcluded: "MPL-2.0",
    texts: [{ source, sha256, origin: "fixture:full-license" }],
    obligations: [
      {
        kind: "modified-source",
        file: { source, sha256, origin: "fixture:corresponding-source" },
        artifactSha256: [],
      },
    ],
  };
  const e = await createDistributionAttribution(undefined, undefined, m, [r], {
    repository: f.root,
  });
  expect(e.blockers).toContain(
    "tool:ffmpeg:codec: source-obligation-not-bound-to-artifacts",
  );
});
it("requires explicit review before treating proc-macro generated code as build-only", async () => {
  const f = await fixture(),
    c = cargo();
  c.compilations[1]!.role = "proc-macro";
  const e = await createDistributionAttribution(undefined, c, manifest(), [], {
    repository: f.root,
  });
  expect(e.blockers).toContain(
    "native-proc-macro-generated-code-review-required:build-tool",
  );
  expect(e.distributionApproved).toBe(false);
});
it("attributes esbuild runtime helpers that are absent from its module metafile", async () => {
  const repository = process.cwd();
  const folder = await mkdtemp(join(repository, "dist/esbuild-helper-test-"));
  roots.push(folder);
  await writeFile(
    join(folder, "entry.js"),
    'void import("./module.js").then(console.log);',
  );
  await writeFile(join(folder, "module.js"), "export const answer=42;");
  const result = await build({
    entryPoints: [join(folder, "entry.js")],
    outfile: join(folder, "output.mjs"),
    absWorkingDir: repository,
    bundle: true,
    format: "esm",
    metafile: true,
  });
  const c = await recordEsbuildContributions(
    repository,
    result.metafile,
    "service",
    join(folder, "contributions.json"),
  );
  expect(c.packages.map((p) => p.name)).toContain("esbuild");
  await verifyBuildContributions(c, repository);
  const withoutHelper = {
    ...c,
    packages: c.packages.filter((p) => p.name !== "esbuild"),
    artifacts: c.artifacts.map((a) => ({
      ...a,
      inputs: a.inputs.filter((i) => !i.path.startsWith("generated:esbuild/")),
      packages: a.packages.filter((id) => !id.includes(":esbuild@")),
    })),
  };
  await expect(
    verifyBuildContributions(withoutHelper, repository),
  ).rejects.toThrow("raw");
});
it("refuses to reclassify a shipped esbuild artifact as an unshipped CLI output", async () => {
  const f = await fixture();
  const c = await recordEsbuildContributions(
    f.root,
    f.metafile,
    "service",
    "dist/attribution/server.json",
  );
  c.artifacts[0]!.delivery = "cli";
  await expect(verifyBuildContributions(c, f.root)).rejects.toThrow("raw");
});
