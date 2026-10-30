import { afterEach, expect, it } from "vitest";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  stageRuntime,
  type RuntimeInputs,
  type ToolSupportFile,
} from "../../scripts/native/stage.js";
import {
  assertDistributableRuntime,
  runtimeHash,
  verifyRuntimeBundle,
} from "../../apps/server/src/runtime-manifest.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-support-"));
  roots.push(root);
  const repository = join(root, "build");
  await mkdir(join(repository, "dist/server"), { recursive: true });
  await mkdir(join(repository, "dist/native"), { recursive: true });
  await symlink(
    resolve("node_modules"),
    join(repository, "node_modules"),
    "dir",
  );
  for (const path of [
    "LICENSE",
    "NOTICE",
    "dist/server/index.mjs",
    "dist/native/launcher.mjs",
    "package.json",
  ])
    await writeFile(
      join(repository, path),
      path === "package.json"
        ? '{"type":"module"}'
        : "synthetic non-distribution fixture",
    );
  const notice = join(root, "notice.txt");
  await writeFile(notice, "Synthetic fixture only. No license approval.");
  // Header-only data exercises copying/architecture checks without staging the
  // full host Node three times per negative case. These tools are never run;
  // genuine executable/owned-service coverage lives in native-runtime.test.ts.
  const source = join(root, "synthetic-tool");
  const header = Buffer.alloc(64);
  header.write("\x7fELF", 0, "binary");
  header[4] = 2;
  header[5] = 1;
  header.writeUInt16LE(3, 16);
  header.writeUInt16LE(process.arch === "x64" ? 62 : 183, 18);
  await writeFile(source, header);
  const file = {
    source,
    sha256: await runtimeHash(source),
    version: "1.0.0",
    license: "MIT",
    licenseFile: notice,
    licenseSha256: await runtimeHash(notice),
  };
  const inputs: RuntimeInputs = {
    appVersion: "0.4.0",
    nodeVersion: process.versions.node,
    platform: process.platform as RuntimeInputs["platform"],
    architecture: process.arch as RuntimeInputs["architecture"],
    tools: {
      node: { ...file, version: process.versions.node },
      ffmpeg: { ...file },
      ffprobe: { ...file },
      font: { ...file },
    },
    dependencyLicenses: Object.fromEntries(
      [
        "fontkit",
        "brotli",
        "dfa",
        `@resvg/resvg-js-${process.platform}-${process.arch}-gnu`,
      ].map((id) => [id, { source: notice, sha256: file.licenseSha256 }]),
    ),
  };
  const supportNotice = join(root, "support-notice.txt");
  await writeFile(
    supportNotice,
    "Synthetic fixture only. No license approval.",
  );
  const sidecar = join(root, "codec.dat");
  await writeFile(sidecar, "payload");
  const support: ToolSupportFile = {
    ...file,
    licenseFile: supportNotice,
    id: "codec",
    source: sidecar,
    sha256: await runtimeHash(sidecar),
    destination: "lib/codec.dat",
    executable: false,
  };
  inputs.tools.ffmpeg.supportFiles = [support];
  return { root, repository, inputs, support, output: join(root, "runtime") };
}
it("stages a loader-relative sidecar with its unique owner and complete notice in v1 inventory", async () => {
  const f = await fixture();
  const m = await stageRuntime(f.inputs, f.output, f.repository);
  expect(m.files.find((x) => x.path === "bin/lib/codec.dat")).toMatchObject({
    component: "tool:ffmpeg:codec",
    sha256: f.support.sha256,
  });
  const component = m.components.find((x) => x.id === "tool:ffmpeg:codec")!;
  expect(await readFile(join(f.output, component.licenseFile), "utf8")).toBe(
    "Synthetic fixture only. No license approval.",
  );
  expect((await verifyRuntimeBundle(f.output)).schemaVersion).toBe(1);
  expect(() => assertDistributableRuntime(m)).toThrow(
    "distributionReviewRequired",
  );
});
it.each([
  "missing",
  "hash",
  "traversal",
  "symlink",
  "parent-link",
  "hardlink",
  "collision",
  "case-collision",
  "notice",
  "architecture",
  "owner",
])("refuses %s sidecar input without publishing a bundle", async (fault) => {
  const f = await fixture();
  if (fault === "missing") f.support.source = join(f.root, "absent");
  if (fault === "hash") f.support.sha256 = "0".repeat(64);
  if (fault === "traversal") f.support.destination = "../escape";
  if (fault === "symlink") {
    await symlink(f.support.source, join(f.root, "link"));
    f.support.source = join(f.root, "link");
  }
  if (fault === "parent-link") {
    await mkdir(join(f.root, "real"));
    await writeFile(join(f.root, "real/file"), "payload");
    await symlink(join(f.root, "real"), join(f.root, "parent"));
    f.support.source = join(f.root, "parent/file");
  }
  if (fault === "hardlink") {
    await link(f.support.source, join(f.root, "hard"));
  }
  if (fault === "collision" || fault === "case-collision")
    f.inputs.tools.ffprobe.supportFiles = [
      {
        ...f.support,
        id: "other",
        destination: fault === "collision" ? "lib/codec.dat" : "LIB/CODEC.DAT",
      },
    ];
  if (fault === "notice") {
    await writeFile(f.support.licenseFile, "");
    f.support.licenseSha256 = await runtimeHash(f.support.licenseFile);
  }
  if (fault === "architecture") {
    const bytes = Buffer.alloc(64);
    bytes.write("\x7fELF", 0, "binary");
    bytes[4] = 2;
    bytes[5] = 1;
    bytes.writeUInt16LE(process.arch === "x64" ? 183 : 62, 18);
    await writeFile(f.support.source, bytes);
    f.support.sha256 = await runtimeHash(f.support.source);
  }
  if (fault === "owner") f.support.id = "../../ffmpeg";
  await expect(
    stageRuntime(f.inputs, f.output, f.repository),
  ).rejects.toThrow();
  await expect(
    readFile(join(f.output, "runtime-manifest.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
it("does not accept a generic review text as executed target import evidence", async () => {
  const f = await fixture();
  f.inputs.distributionReview = {
    source: f.support.licenseFile,
    sha256: f.support.licenseSha256,
    systemRequirements: ["fixture"],
  };
  await expect(stageRuntime(f.inputs, f.output, f.repository)).rejects.toThrow(
    "linkage",
  );
});
it("hash-covers attribution/SPDX receipts while retaining full first-party historical grants", async () => {
  const f = await fixture();
  const m = await stageRuntime(f.inputs, f.output, process.cwd());
  const evidence = JSON.parse(
    await readFile(join(f.output, "receipts/attribution.json"), "utf8"),
  );
  expect(evidence.reviewStatus).toBe("blocked");
  expect(evidence.distributionApproved).toBe(false);
  expect(evidence.blockers).toContain("native-build-evidence-missing");
  expect(
    m.files.find((x) => x.path === "receipts/attribution.json")?.sha256,
  ).toBe(await runtimeHash(join(f.output, "receipts/attribution.json")));
  const sbom = JSON.parse(
    await readFile(join(f.output, "sbom.spdx.json"), "utf8"),
  );
  expect(
    sbom.relationships.some(
      (x: { relationshipType: string }) => x.relationshipType === "CONTAINS",
    ),
  ).toBe(true);
  expect(
    sbom.packages.find((x: { name: string }) => x.name === "tool:ffmpeg:codec")
      ?.licenseConcluded,
  ).toBe("NOASSERTION");
  expect(
    await readFile(
      join(f.output, "licenses/historical/GPL-3.0-only.txt"),
      "utf8",
    ),
  ).toBe(await readFile("LICENSES/GPL-3.0-only.txt", "utf8"));
});
