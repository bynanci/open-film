import { afterEach, expect, it } from "vitest";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import {
  captureCargoBuild,
  metadataArgsForCargo,
  resolveNativeTarget,
} from "../../scripts/native/capture-cargo-build.mjs";
import { verifyCargoReplayAgainstCapture } from "../../scripts/native/receipt-cargo.js";
import { pinFile } from "../../scripts/native/receipt-contract.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const target = "x86_64-unknown-linux-gnu";
const expectedShellPath = `apps/desktop/src-tauri/target/${target}/release/openfilm-desktop`;
const packageId =
  "path+file:///candidate/apps/desktop/src-tauri#openfilm-desktop@1.0.0";
const args = [
  "build",
  "--locked",
  "--message-format=json",
  "--bins",
  "--features",
  "tauri/custom-protocol",
  "--release",
  "--target",
  target,
];

async function fixture(mode = "valid") {
  const root = await mkdtemp(join(tmpdir(), "native-cargo-capture-"));
  roots.push(root);
  const tauriDir = join(root, "apps/desktop/src-tauri");
  const targetDirectory = join(tauriDir, "target");
  const shellPath = `apps/desktop/src-tauri/target/${target}/release/openfilm-desktop`;
  const shell = join(root, shellPath);
  const lockfile = join(tauriDir, "Cargo.lock");
  const captureDirectory = join(root, "dist/native-evidence/cargo-build");
  await mkdir(tauriDir, { recursive: true });
  await writeFile(
    join(tauriDir, "Cargo.toml"),
    "[package]\nname='openfilm-desktop'\n",
  );
  await writeFile(
    lockfile,
    'version = 4\n\n[[package]]\nname = "openfilm-desktop"\nversion = "1.0.0"\n',
  );
  const fakeCargo = String.raw`
    const fs = require("node:fs");
    const path = require("node:path");
    const args = process.argv.slice(1);
    const targetDir = process.env.FAKE_TARGET_DIR;
    const target = process.env.FAKE_TARGET;
    const shell = process.env.FAKE_SHELL;
    const packageId = process.env.FAKE_PACKAGE_ID;
    if (args[0] === "build") {
      if (process.env.FAKE_MODE === "hardlink") {
        const alias = path.join(targetDir, "shared-shell");
        fs.mkdirSync(path.dirname(shell), { recursive: true });
        fs.writeFileSync(alias, "fixture shell bytes");
        fs.linkSync(alias, shell);
      } else {
        fs.mkdirSync(path.dirname(shell), { recursive: true });
        fs.writeFileSync(shell, "fixture shell bytes");
      }
      const generated = path.join(targetDir, target, "release/build/openfilm/out/generated.rs");
      fs.mkdirSync(path.dirname(generated), { recursive: true });
      fs.writeFileSync(generated, "// fixture generated input\n");
      const compilerShell = process.env.FAKE_MODE === "wrong-shell"
        ? path.join(targetDir, target, "release", "other-binary")
        : shell;
      process.stdout.write([
        { reason: "compiler-artifact", package_id: packageId, target: { name: "openfilm-desktop", kind: ["bin"] }, filenames: [compilerShell], executable: compilerShell },
        { reason: "build-script-executed", package_id: packageId, out_dir: path.dirname(generated), linked_libs: [] },
        { reason: "build-finished", success: process.env.FAKE_MODE !== "failed" },
      ].map((value) => JSON.stringify(value) + "\n").join(""));
      process.stderr.write("fixture cargo stderr\n");
      if (process.env.FAKE_MODE === "failed") process.exitCode = 17;
    } else if (args[0] === "metadata") {
      const wrongDirectory = process.env.FAKE_MODE === "wrong-metadata"
        ? path.join(targetDir, "elsewhere")
        : targetDir;
      process.stdout.write(JSON.stringify({
        workspace_root: process.cwd(),
        target_directory: wrongDirectory,
        packages: [{
          id: packageId,
          name: "openfilm-desktop",
          manifest_path: path.join(process.cwd(), "Cargo.toml"),
          source: null,
          targets: [{ name: "openfilm-desktop", kind: ["bin"] }],
        }],
        resolve: { nodes: [{ id: packageId }] },
      }));
    } else {
      process.stderr.write("unexpected fake Cargo subcommand\n");
      process.exitCode = 2;
    }
  `;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const stdoutSink = new Writable({
    write(chunk, _encoding, callback) {
      stdout.push(Buffer.from(chunk));
      callback();
    },
  });
  const stderrSink = new Writable({
    write(chunk, _encoding, callback) {
      stderr.push(Buffer.from(chunk));
      callback();
    },
  });
  const capture = (overrides: Record<string, unknown> = {}) =>
    captureCargoBuild({
      args,
      root,
      cwd: tauriDir,
      target,
      targetDirectory,
      shellPath,
      lockfile,
      captureDirectory,
      candidateSha: "a".repeat(40),
      headSha: "a".repeat(40),
      rustcVersion: "rustc 1.99.0 fixture",
      cargoVersion: "cargo 1.99.0 fixture",
      command: process.execPath,
      commandPrefix: ["--eval", fakeCargo],
      environment: {
        ...process.env,
        FAKE_MODE: mode,
        FAKE_TARGET_DIR: targetDirectory,
        FAKE_TARGET: target,
        FAKE_SHELL: shell,
        FAKE_PACKAGE_ID: packageId,
      },
      stdout: stdoutSink,
      stderr: stderrSink,
      ...overrides,
    });
  return {
    root,
    tauriDir,
    targetDirectory,
    shell,
    shellPath,
    lockfile,
    captureDirectory,
    capture,
    stdout,
    stderr,
  };
}

it("maps a verified runner/runtime identity to the exact Tauri target shell and bundle", () => {
  expect(
    resolveNativeTarget(
      { platform: "linux", architecture: "x64" },
      { platform: "linux", architecture: "x64" },
      "/candidate",
    ),
  ).toEqual({
    target,
    targetDirectory: "apps/desktop/src-tauri/target",
    shellPath: expectedShellPath,
    bundleDirectory: `apps/desktop/src-tauri/target/${target}/release/bundle`,
  });
  expect(() =>
    resolveNativeTarget(
      { platform: "darwin", architecture: "arm64" },
      { platform: "linux", architecture: "x64" },
      "/candidate",
    ),
  ).toThrow("Runner/runtime target mismatch");
  expect(
    resolveNativeTarget(
      { platform: "win32", architecture: "x64" },
      { platform: "win32", architecture: "x64" },
      "/candidate",
    ),
  ).toMatchObject({
    target: "x86_64-pc-windows-msvc",
    shellPath:
      "apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/openfilm-desktop.exe",
    bundleDirectory:
      "apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle",
  });
  expect(
    resolveNativeTarget(
      { platform: "darwin", architecture: "arm64" },
      { platform: "darwin", architecture: "arm64" },
      "/candidate",
    ).target,
  ).toBe("aarch64-apple-darwin");
});

it("captures the exact Tauri Cargo invocation, raw streams, metadata, lock and target shell", async () => {
  const f = await fixture();
  const result = await f.capture();
  expect(result.target).toBe(target);
  expect(result.shell.path).toBe(f.shellPath);
  expect(result.shell.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(
    JSON.parse(
      await readFile(join(f.captureDirectory, "invocation.json"), "utf8"),
    ),
  ).toMatchObject({
    arguments: args,
    cwd: f.tauriDir,
    exitCode: 0,
    rustcVersion: "rustc 1.99.0 fixture",
    cargoVersion: "cargo 1.99.0 fixture",
  });
  expect(
    JSON.parse(
      await readFile(
        join(f.captureDirectory, "metadata-invocation.json"),
        "utf8",
      ),
    ).arguments,
  ).toEqual(metadataArgsForCargo(args, f.tauriDir, target));
  expect(
    JSON.parse(
      await readFile(
        join(f.captureDirectory, "metadata-invocation.json"),
        "utf8",
      ),
    ).cwd,
  ).toBe(f.tauriDir);
  expect(
    JSON.parse(
      await readFile(join(f.captureDirectory, "toolchain.json"), "utf8"),
    ),
  ).toMatchObject({
    rustc: { version: "rustc 1.99.0 fixture" },
    cargo: { version: "cargo 1.99.0 fixture" },
  });
  expect(
    await readFile(join(f.captureDirectory, "compiler-messages.jsonl"), "utf8"),
  ).toContain('"reason":"build-finished","success":true');
  expect(
    await readFile(join(f.captureDirectory, "compiler-stderr.log"), "utf8"),
  ).toBe("fixture cargo stderr\n");
  expect(
    await readFile(join(f.captureDirectory, "metadata.json"), "utf8"),
  ).toContain('"target_directory"');
  expect(await readFile(join(f.captureDirectory, "Cargo.lock"), "utf8")).toBe(
    await readFile(f.lockfile, "utf8"),
  );
  expect(
    await readFile(join(f.captureDirectory, "capture.json"), "utf8"),
  ).toContain('"candidateSha"');
  expect(Buffer.concat(f.stdout).toString()).toBe(
    await readFile(join(f.captureDirectory, "compiler-messages.jsonl"), "utf8"),
  );
  expect(Buffer.concat(f.stderr).toString()).toBe("fixture cargo stderr\n");
  expect(
    await readFile(
      join(
        f.targetDirectory,
        target,
        "release/build/openfilm/out/generated.rs",
      ),
      "utf8",
    ),
  ).toContain("fixture generated input");
  expect(
    await readFile(
      join(
        f.captureDirectory,
        "target-files",
        target,
        "release/build/openfilm/out/generated.rs",
      ),
      "utf8",
    ),
  ).toContain("fixture generated input");
});

it("binds later Cargo replay pins to the same capture, including target path mapping", async () => {
  const f = await fixture();
  const capture = await f.capture();
  const capturePath = "dist/native-evidence/cargo-build/capture.json";
  const capturePin = await pinFile(f.root, capturePath);
  const captureDirectory = "dist/native-evidence/cargo-build";
  const shell = await pinFile(f.root, f.shellPath);
  const input = {
    schemaVersion: 1,
    target,
    targetDirectory: `${captureDirectory}/target-files`,
    metadata: await pinFile(f.root, `${captureDirectory}/metadata.json`),
    messages: await pinFile(
      f.root,
      `${captureDirectory}/compiler-messages.jsonl`,
    ),
    lock: await pinFile(f.root, `${captureDirectory}/Cargo.lock`),
    invocation: await pinFile(f.root, `${captureDirectory}/invocation.json`),
    shell: await pinFile(
      f.root,
      `${captureDirectory}/${capture.targetInputs.find((value) => value.path === `target/${target}/release/openfilm-desktop`)!.capturePath}`,
    ),
    pathMapping: {
      syntax: "posix",
      repositoryRoot: f.root,
      targetDirectory: JSON.parse(
        await readFile(`${f.captureDirectory}/metadata.json`, "utf8"),
      ).target_directory,
      externalRoots: [],
    },
  };
  const identity = {
    candidateSha: "a".repeat(40),
    target: { triple: target },
    shell,
    buildEvidence: capturePin,
  };
  const inputPath = "cargo-replay-inputs.json";
  await writeFile(join(f.root, inputPath), JSON.stringify(input));
  await expect(
    verifyCargoReplayAgainstCapture(
      f.root,
      await pinFile(f.root, inputPath),
      identity as never,
    ),
  ).resolves.toBeUndefined();

  const mismatched = { ...input, invocation: input.metadata };
  await writeFile(join(f.root, inputPath), JSON.stringify(mismatched));
  await expect(
    verifyCargoReplayAgainstCapture(
      f.root,
      await pinFile(f.root, inputPath),
      identity as never,
    ),
  ).rejects.toThrow(
    "Cargo replay invocation pin differs from same-build capture",
  );
});

it.each(["wrong-metadata", "wrong-shell", "failed"])(
  "refuses %s evidence before declaring a successful capture",
  async (mode) => {
    const f = await fixture(mode);
    await expect(f.capture()).rejects.toThrow();
    await expect(
      readFile(join(f.captureDirectory, "capture.json")),
    ).rejects.toThrow();
    if (mode === "failed") {
      const invocation = JSON.parse(
        await readFile(join(f.captureDirectory, "invocation.json"), "utf8"),
      );
      expect(invocation.exitCode).toBe(17);
      expect(invocation.outputLimitExceeded).toBe(false);
      expect(
        await readFile(
          join(f.captureDirectory, "compiler-messages.jsonl"),
          "utf8",
        ),
      ).toContain('"reason":"build-finished","success":false');
      expect(
        await readFile(join(f.captureDirectory, "compiler-stderr.log"), "utf8"),
      ).toBe("fixture cargo stderr\n");
      expect(
        await readFile(join(f.captureDirectory, "metadata.json"), "utf8"),
      ).toContain('"target_directory"');
    }
  },
);

it("copies a Cargo hardlinked shell into evidence without mutating the build output", async () => {
  const f = await fixture("hardlink");
  const alias = join(f.targetDirectory, "shared-shell");
  const result = await f.capture();
  const before = Buffer.from("fixture shell bytes");
  expect((await lstat(f.shell)).nlink).toBe(2);
  expect((await lstat(f.shell)).nlink).toBe(2);
  expect((await lstat(alias)).nlink).toBe(2);
  expect(await readFile(alias)).toEqual(before);
  expect(result.shell.sha256).toMatch(/^[a-f0-9]{64}$/u);
  const copied = result.targetInputs.find(
    (input) => input.path === `target/${target}/release/openfilm-desktop`,
  )!;
  const capturedPath = join(f.captureDirectory, copied.capturePath);
  expect(await readFile(capturedPath)).toEqual(before);
  expect((await lstat(capturedPath)).nlink).toBe(1);
});

it("bounds and cleans target input copies when a source grows after its snapshot", async () => {
  const f = await fixture();
  const originalShellBytes = Buffer.from("fixture shell bytes");
  const shellInput = `target/${target}/release/openfilm-desktop`;
  await expect(
    f.capture({
      maxTargetInputFileBytes: 64,
      maxTargetInputTotalBytes: 64,
      beforeTargetInputCopy: async ({
        path,
        source,
      }: {
        path: string;
        source: string;
      }) => {
        if (path === shellInput)
          await appendFile(source, Buffer.alloc(4096, 0x78));
      },
    }),
  ).rejects.toThrow(
    "Cargo target input exceeded its capture bounds during copy",
  );

  expect(await readFile(f.shell)).toEqual(
    Buffer.concat([originalShellBytes, Buffer.alloc(4096, 0x78)]),
  );
  await expect(
    lstat(join(f.captureDirectory, "target-files")),
  ).rejects.toThrow();
  await expect(
    readFile(join(f.captureDirectory, "capture.json")),
  ).rejects.toThrow();
});

it("rejects an invocation from a different candidate HEAD before running Cargo", async () => {
  const f = await fixture();
  await expect(f.capture({ headSha: "b".repeat(40) })).rejects.toThrow(
    "Candidate checkout SHA mismatch",
  );
  await expect(
    readFile(join(f.captureDirectory, "invocation.json")),
  ).rejects.toThrow();
});

it("bounds compiler stdout and records an incomplete capture instead of retaining oversized output", async () => {
  const f = await fixture();
  await expect(f.capture({ maxBuildStdoutBytes: 8 })).rejects.toThrow(
    "Cargo build output exceeded its capture limit",
  );
  const invocation = JSON.parse(
    await readFile(join(f.captureDirectory, "invocation.json"), "utf8"),
  );
  expect(invocation.outputLimitExceeded).toBe(true);
  expect(
    (await readFile(join(f.captureDirectory, "compiler-messages.jsonl")))
      .length,
  ).toBe(8);
  await expect(
    readFile(join(f.captureDirectory, "capture.json")),
  ).rejects.toThrow();
});

it("mirrors Tauri's exact Cargo feature resolver flags into metadata and rejects unmirrorable selection", () => {
  expect(
    metadataArgsForCargo(args, "/candidate/apps/desktop/src-tauri", target),
  ).toContain("--features");
  expect(
    metadataArgsForCargo(args, "/candidate/apps/desktop/src-tauri", target),
  ).toContain("tauri/custom-protocol");
  expect(() =>
    metadataArgsForCargo(
      [...args, "--package", "openfilm-desktop"],
      "/candidate/apps/desktop/src-tauri",
      target,
    ),
  ).toThrow("Cargo package selectors cannot be mirrored");
});

it("keeps the workflow on one target-specific wrapped Tauri build and existing receipt commands", async () => {
  const workflow = await readFile(
    ".github/workflows/native-installer.yml",
    "utf8",
  );
  const installerDocs = await readFile("docs/native-installer.md", "utf8");
  const config = JSON.parse(
    await readFile("apps/desktop/src-tauri/tauri.bundle.conf.json", "utf8"),
  ) as { build?: { runner?: { cmd?: string; args?: string[] } } };
  const runnerShim = await readFile("apps/desktop/src-tauri/build", "utf8");
  expect(config.build?.runner).toEqual({ cmd: "node" });
  expect(runnerShim).toContain('"build",');
  expect(runnerShim).toContain("...cargoArguments");
  expect(runnerShim).toContain(
    '"../../../scripts/native/capture-cargo-build.mjs"',
  );
  expect(workflow.match(/tauri build/g)).toHaveLength(3);
  expect(
    workflow.match(
      /--target "\$NATIVE_TARGET" -- --locked --message-format=json/g,
    ),
  ).toHaveLength(3);
  expect(workflow).toContain("capture-cargo-build.mjs target");
  expect(workflow).toContain("capture-cargo-build.mjs finalize");
  expect(workflow).toContain('receipt.ts prepare-shell . "$NATIVE_TARGET"');
  expect(workflow).toContain(
    "native-cargo-build-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}",
  );
  expect(workflow).toContain("if: always()");
  const rawCaptureStart = workflow.indexOf(
    "- name: Retain raw Cargo build capture",
  );
  const candidateValidationStart = workflow.indexOf(
    "- name: Validate target-specific bundle",
    rawCaptureStart,
  );
  expect(rawCaptureStart).toBeGreaterThanOrEqual(0);
  expect(candidateValidationStart).toBeGreaterThan(rawCaptureStart);
  const rawCaptureStep = workflow.slice(
    rawCaptureStart,
    candidateValidationStart,
  );
  expect(rawCaptureStep).toContain("dist/native-evidence/cargo-build/");
  expect(rawCaptureStep).toContain("apps/desktop/src-tauri/Cargo.lock");
  expect(installerDocs).toContain(
    "extract them into the candidate checkout root",
  );
  expect(installerDocs).toContain(
    "`apps/desktop/src-tauri/Cargo.lock` as a repository-root anchor",
  );
  expect(workflow).not.toContain("dist/native-evidence/cargo-build/**");
  expect(workflow).toContain(
    "receipt.ts identity . dist/native-evidence/identity-inputs.json",
  );
  expect(workflow).toContain(
    'receipt.ts seal . "$BUNDLE_DIRECTORY/candidate.json"',
  );
  expect(workflow).toContain("${{ steps.native-target.outputs.shellPath }}");
  expect(workflow).toContain(
    "${{ steps.native-target.outputs.bundleDirectory }}/candidate.json",
  );
});
