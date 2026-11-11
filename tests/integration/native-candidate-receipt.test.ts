// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it } from "vitest";
import {
  chmod,
  link,
  lstat,
  rename,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runtimeHash,
  type RuntimeManifest,
} from "../../apps/server/src/runtime-manifest.js";
import {
  captureFinalBytes,
  createCandidateIdentity,
  finalizeCandidate,
  writeReceipt,
} from "../../scripts/native/receipt.js";
import {
  pinFile,
  type CandidateTarget,
  type FilePin,
} from "../../scripts/native/receipt-contract.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(reviewed = false) {
  const root = await mkdtemp(join(tmpdir(), "candidate-flow-"));
  roots.push(root);
  await mkdir(join(root, "runtime"));
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
    const file = join(root, "runtime", path);
    await writeFile(file, "synthetic fixture");
    await chmod(file, 0o755);
    files.push({
      path,
      sha256: await runtimeHash(file),
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
    platform: "linux",
    architecture: "x64",
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
      status: reviewed ? "reviewed" : "test-only",
      systemRequirements: ["Synthetic platform"],
      receipt: reviewed ? "LICENSE" : null,
    },
  };
  await writeFile(
    join(root, "runtime/runtime-manifest.json"),
    JSON.stringify(manifest),
  );
  await writeFile(join(root, "shell"), "compiler shell");
  await writeFile(join(root, "installer.deb"), "installer");
  const target: CandidateTarget = {
    platform: "linux",
    architecture: "x64",
    triple: "x86_64-unknown-linux-gnu",
    abi: "glibc-test-only",
  };
  const options = {
    candidateSha: "a".repeat(40),
    target,
    runtimeRoot: "runtime",
    shellPath: "shell",
    installerPaths: ["installer.deb"],
  };
  const identity = await createCandidateIdentity(root, options);
  await writeReceipt(root, "candidate.json", identity, "runtime");
  const identityPin = await pinFile(root, "candidate.json");
  return { root, options, identity, identityPin };
}
it("keeps the runtime fixed while binding final signed bytes externally", async () => {
  const f = await fixture();
  const before = await readFile(join(f.root, "runtime/runtime-manifest.json"));
  await writeFile(join(f.root, "shell"), "signed shell");
  await writeFile(join(f.root, "installer.deb"), "signed installer");
  const final = await captureFinalBytes(f.root, f.identityPin);
  expect(final.shell.sha256).not.toBe(f.identity.shell.sha256);
  expect(final.candidateIdentitySha256).toBe(f.identityPin.sha256);
  expect(final.disposition).toBe("incomplete");
  expect(final.distributionApproved).toBe(false);
  expect(await readFile(join(f.root, "runtime/runtime-manifest.json"))).toEqual(
    before,
  );
  await expect(
    writeReceipt(f.root, "runtime/final.json", final, "runtime"),
  ).rejects.toThrow();
  await expect(
    writeReceipt(f.root, "candidate.json", final, "runtime"),
  ).rejects.toThrow();
});
it.each([
  "runtime-manifest",
  "runtime-payload",
  "candidate",
  "shell-missing",
  "installer-missing",
])("rejects %s mutation when sealing", async (fault) => {
  const f = await fixture();
  if (fault === "runtime-manifest")
    await writeFile(join(f.root, "runtime/runtime-manifest.json"), "{}");
  if (fault === "runtime-payload")
    await writeFile(join(f.root, "runtime/service"), "tampered");
  if (fault === "candidate")
    await writeFile(join(f.root, "candidate.json"), "{}");
  if (fault === "shell-missing") await rm(join(f.root, "shell"));
  if (fault === "installer-missing") await rm(join(f.root, "installer.deb"));
  await expect(captureFinalBytes(f.root, f.identityPin)).rejects.toThrow();
});
it("rejects target disagreement and duplicate installer paths", async () => {
  const f = await fixture();
  await expect(
    createCandidateIdentity(f.root, {
      ...f.options,
      target: { ...f.options.target, architecture: "arm64" },
    }),
  ).rejects.toThrow();
  await expect(
    createCandidateIdentity(f.root, {
      ...f.options,
      installerPaths: ["installer.deb", "installer.deb"],
    }),
  ).rejects.toThrow();
});
it("rejects a structurally valid synthetic runtime before final closure", async () => {
  const f = await fixture();
  const final = await captureFinalBytes(f.root, f.identityPin);
  await writeReceipt(f.root, "final-bytes.json", final, "runtime");
  const absent: FilePin = {
    path: "missing.json",
    sha256: "b".repeat(64),
    size: 1,
  };
  await expect(
    finalizeCandidate(f.root, {
      schemaVersion: 1,
      candidate: f.identityPin,
      finalBytes: await pinFile(f.root, "final-bytes.json"),
      attribution: absent,
      security: absent,
      trust: absent,
      lifecycle: absent,
      review: absent,
      finalLinkagePolicy: absent,
      finalLinkage: absent,
    }),
  ).rejects.toThrow("test-only");
});

it.each(["shell", "installer.deb", "runtime/service"])(
  "rejects changed %s against sealed final bytes",
  async (path) => {
    const f = await fixture(true);
    await writeReceipt(
      f.root,
      "final-bytes.json",
      await captureFinalBytes(f.root, f.identityPin),
      "runtime",
    );
    await writeFile(join(f.root, path), "tampered final bytes");
    const absent: FilePin = {
      path: "missing.json",
      sha256: "b".repeat(64),
      size: 1,
    };
    await expect(
      finalizeCandidate(f.root, {
        schemaVersion: 1,
        candidate: f.identityPin,
        finalBytes: await pinFile(f.root, "final-bytes.json"),
        attribution: absent,
        security: absent,
        trust: absent,
        lifecycle: absent,
        review: absent,
        finalLinkagePolicy: absent,
        finalLinkage: absent,
      }),
    ).rejects.toThrow(/hash|mismatch/u);
  },
);

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
it("runs the real CLI to seal a candidate without granting distribution approval", async () => {
  const f = await fixture();
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("scripts/native/receipt.ts"),
      "seal",
      f.root,
      "candidate.json",
      "sealed-cli.json",
    ],
    { encoding: "utf8" },
  );
  expect(JSON.parse(output)).toEqual({
    stage: "seal",
    output: "sealed-cli.json",
    distributionApproved: false,
  });
  expect(
    JSON.parse(await readFile(join(f.root, "sealed-cli.json"), "utf8"))
      .artifactsSha256,
  ).toMatch(/^[a-f0-9]{64}$/u);
});

it.each(["missing", "tampered"])(
  "rejects %s external evidence before observing a reviewed-labelled synthetic runtime",
  async (fault) => {
    const f = await fixture(true);
    await writeReceipt(
      f.root,
      "final-bytes.json",
      await captureFinalBytes(f.root, f.identityPin),
      "runtime",
    );
    const evidence = {} as Record<
      | "attribution"
      | "security"
      | "trust"
      | "lifecycle"
      | "review"
      | "finalLinkagePolicy"
      | "finalLinkage",
      FilePin
    >;
    for (const key of [
      "attribution",
      "security",
      "trust",
      "lifecycle",
      "review",
      "finalLinkagePolicy",
      "finalLinkage",
    ] as const) {
      await writeFile(join(f.root, `${key}.json`), "{}");
      evidence[key] = await pinFile(f.root, `${key}.json`);
    }
    if (fault === "missing") await rm(join(f.root, "trust.json"));
    else await writeFile(join(f.root, "trust.json"), '{"changed":true}');
    await expect(
      finalizeCandidate(f.root, {
        schemaVersion: 1,
        candidate: f.identityPin,
        finalBytes: await pinFile(f.root, "final-bytes.json"),
        ...evidence,
      }),
    ).rejects.toThrow(fault === "missing" ? /ENOENT/u : /mismatch/u);
  },
);

async function defaultCargoFixture() {
  const f = await fixture();
  const runtimeRoot = "apps/desktop/src-tauri/resources/runtime";
  const release = "apps/desktop/src-tauri/target/release";
  const shell = `${release}/openfilm-desktop`;
  await mkdir(join(f.root, "apps/desktop/src-tauri/resources"), {
    recursive: true,
  });
  await rename(join(f.root, "runtime"), join(f.root, runtimeRoot));
  await mkdir(join(f.root, release, "deps"), { recursive: true });
  await mkdir(join(f.root, release, "bundle"));
  await rename(join(f.root, "shell"), join(f.root, shell));
  await chmod(join(f.root, shell), 0o755);
  const alias = `${release}/deps/openfilm-desktop-buildhash`;
  await link(join(f.root, shell), join(f.root, alias));
  await rename(
    join(f.root, "installer.deb"),
    join(f.root, release, "bundle/installer.deb"),
  );
  const manifestPath = join(f.root, runtimeRoot, "runtime-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const linkage = JSON.stringify({ baseline: { abi: "glibc-test-only" } });
  await mkdir(join(f.root, runtimeRoot, "receipts"));
  const linkagePath = join(
    f.root,
    runtimeRoot,
    "receipts/linkage-evidence.json",
  );
  await writeFile(linkagePath, linkage);
  manifest.files.push({
    path: "receipts/linkage-evidence.json",
    sha256: await runtimeHash(linkagePath),
    size: Buffer.byteLength(linkage),
    executable: false,
    component: "openfilm",
  });
  await writeFile(manifestPath, JSON.stringify(manifest));
  execFileSync("git", ["init", "-q"], { cwd: f.root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "synthetic build",
    ],
    { cwd: f.root },
  );
  const cli = (...args: string[]) =>
    execFileSync(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        resolve("scripts/native/receipt.ts"),
        ...args,
      ],
      { cwd: f.root, encoding: "utf8", stdio: "pipe" },
    );
  return { ...f, runtimeRoot, release, shell, alias, manifestPath, cli };
}
it("stages the default Cargo hardlinked shell at its signing path before identity and seal", async () => {
  const f = await defaultCargoFixture();
  const before = await readFile(join(f.root, f.shell));
  const mode = (await lstat(join(f.root, f.shell))).mode;
  const manifest = await readFile(f.manifestPath);
  expect((await lstat(join(f.root, f.shell))).nlink).toBe(2);
  await expect(pinFile(f.root, f.shell)).rejects.toThrow("unlinked regular");
  await expect(
    createCandidateIdentity(f.root, {
      ...f.options,
      runtimeRoot: f.runtimeRoot,
      shellPath: f.shell,
      installerPaths: [`${f.release}/bundle/installer.deb`],
    }),
  ).rejects.toThrow("unlinked regular");
  expect(JSON.parse(f.cli())).toMatchObject({
    stage: "pre-trust",
    disposition: "incomplete",
    distributionApproved: false,
  });
  const candidatePath = `${f.release}/bundle/candidate.json`;
  const identity = JSON.parse(
    await readFile(join(f.root, candidatePath), "utf8"),
  );
  expect(identity.shell.path).toBe(f.shell);
  expect(await readFile(join(f.root, f.shell))).toEqual(before);
  expect(await readFile(join(f.root, f.alias))).toEqual(before);
  expect((await lstat(join(f.root, f.shell))).mode).toBe(mode);
  expect((await lstat(join(f.root, f.shell))).nlink).toBe(1);
  expect((await lstat(join(f.root, f.alias))).nlink).toBe(1);
  expect(await readFile(f.manifestPath)).toEqual(manifest);
  await writeFile(join(f.root, f.shell), "synthetic signed final bytes");
  f.cli("seal", ".", candidatePath, `${f.release}/bundle/final-bytes.json`);
  const final = JSON.parse(
    await readFile(join(f.root, f.release, "bundle/final-bytes.json"), "utf8"),
  );
  expect(final.shell.path).toBe(f.shell);
  expect(final.shell.sha256).not.toBe(identity.shell.sha256);
  expect(await readFile(join(f.root, f.alias))).toEqual(before);
  expect(await readFile(f.manifestPath)).toEqual(manifest);
});

it("refuses an existing default candidate before detaching its build shell", async () => {
  const f = await defaultCargoFixture();
  const path = join(f.root, f.release, "bundle/candidate.json");
  await writeFile(path, "existing candidate");
  expect(() => f.cli()).toThrow("Candidate output already exists");
  expect((await lstat(join(f.root, f.shell))).nlink).toBe(2);
  expect(await readFile(path, "utf8")).toBe("existing candidate");
});
