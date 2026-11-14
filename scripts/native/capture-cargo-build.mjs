// SPDX-License-Identifier: Apache-2.0
// Modified by OpenFilm contributors on 2026-11-14. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { Transform, Writable } from "node:stream";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { finished, pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const MAX_JSON_BYTES = 32 * 1024 ** 2;
const MAX_CAPTURE_FILE_BYTES = 4 * 1024 ** 3;
const MAX_CAPTURE_TOTAL_BYTES = 8 * 1024 ** 3;
const MAX_CAPTURE_FILES = 20_000;
const RUNTIME_ROOT = "apps/desktop/src-tauri/resources/runtime";
const TARGET_ROOT = "apps/desktop/src-tauri/target";
const LOCK_PATH = "apps/desktop/src-tauri/Cargo.lock";
const EVIDENCE_ROOT = "dist/native-evidence/cargo-build";

const fail = (message) => {
  throw new Error(message);
};
function captureLimit(value, maximum, name) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 0)
    fail(`${name} must be a non-negative safe integer`);
  return Math.min(value, maximum);
}
const isHash = (value) => /^[a-f0-9]{40}$/u.test(value);
const normalized = (value) => value.split(sep).join("/");
const samePath = (left, right) => {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32"
    ? a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US")
    : a === b;
};
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

async function assertNoSymlinkParents(root, path) {
  let cursor = resolve(path);
  if (!inside(root, cursor)) fail("Native evidence path escapes the checkout");
  while (cursor !== root) {
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        fail("Symlink in native evidence path");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    cursor = dirname(cursor);
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function readJson(path, limit = MAX_JSON_BYTES) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > limit
  )
    fail("Native Cargo evidence exceeds its size or file-type limit");
  const bytes = await readFile(path);
  if (bytes.length > limit)
    fail("Native Cargo evidence exceeds its size limit");
  return JSON.parse(bytes.toString("utf8"));
}

async function writeExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { flag: "wx" });
}

function tripleFor(platform, architecture) {
  const arch =
    architecture === "x64"
      ? "x86_64"
      : architecture === "arm64"
        ? "aarch64"
        : undefined;
  if (!arch) fail("Unsupported native architecture");
  const os =
    platform === "linux"
      ? "unknown-linux-gnu"
      : platform === "darwin"
        ? "apple-darwin"
        : platform === "win32"
          ? "pc-windows-msvc"
          : undefined;
  if (!os) fail("Unsupported native platform");
  return `${arch}-${os}`;
}

/** Resolve only a native target that exactly matches the executing runner. */
export function resolveNativeTarget(runner, runtime, _root) {
  if (
    !runner ||
    !runtime ||
    runner.platform !== runtime.platform ||
    runner.architecture !== runtime.architecture
  )
    fail("Runner/runtime target mismatch");
  const target = tripleFor(runtime.platform, runtime.architecture);
  const executable =
    runtime.platform === "win32" ? "openfilm-desktop.exe" : "openfilm-desktop";
  const shellPath = `${TARGET_ROOT}/${target}/release/${executable}`;
  return {
    target,
    targetDirectory: TARGET_ROOT,
    shellPath,
    bundleDirectory: `${TARGET_ROOT}/${target}/release/bundle`,
  };
}

/** Mirror the Cargo resolver flags that are present in the wrapped build argv. */
export function metadataArgsForCargo(args, cwd, target) {
  const result = [
    "metadata",
    "--locked",
    "--format-version",
    "1",
    "--filter-platform",
    target,
    "--manifest-path",
    resolve(cwd, "Cargo.toml"),
  ];
  for (let index = 1; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--features" || argument === "-F") {
      const value = args[++index];
      if (!value || value.startsWith("-"))
        fail("Cargo feature flag has no value");
      result.push("--features", value);
    } else if (argument.startsWith("--features=")) {
      result.push(argument);
    } else if (argument.startsWith("-F") && argument.length > 2) {
      result.push("--features", argument.slice(2));
    } else if (
      [
        "--all-features",
        "--no-default-features",
        "--offline",
        "--frozen",
      ].includes(argument)
    ) {
      result.push(argument);
    } else if (argument === "--config") {
      const value = args[++index];
      if (!value) fail("Cargo config flag has no value");
      result.push("--config", value);
    } else if (argument.startsWith("--config=")) {
      result.push(argument);
    } else if (argument === "--manifest-path") {
      const value = args[++index];
      if (!value || !samePath(resolve(cwd, value), resolve(cwd, "Cargo.toml")))
        fail(
          "Cargo manifest selector cannot be mirrored by the metadata capture",
        );
    } else if (argument.startsWith("--manifest-path=")) {
      const value = argument.slice("--manifest-path=".length);
      if (!value || !samePath(resolve(cwd, value), resolve(cwd, "Cargo.toml")))
        fail(
          "Cargo manifest selector cannot be mirrored by the metadata capture",
        );
    } else if (
      ["--package", "-p", "--workspace", "--exclude"].includes(argument)
    ) {
      fail(
        "Cargo package selectors cannot be mirrored by the metadata capture",
      );
    }
  }
  return result;
}

function hostIdentity() {
  const platform =
    process.platform === "win32"
      ? "win32"
      : process.platform === "darwin"
        ? "darwin"
        : process.platform === "linux"
          ? "linux"
          : undefined;
  const architecture =
    process.arch === "x64"
      ? "x64"
      : process.arch === "arm64"
        ? "arm64"
        : undefined;
  if (!platform || !architecture)
    fail("Unsupported native runner platform/architecture");
  return { platform, architecture };
}

async function regularFile(
  path,
  { singleLink = true, maxBytes = MAX_CAPTURE_FILE_BYTES } = {},
) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink < 1 ||
    (singleLink && info.nlink !== 1) ||
    info.size < 0 ||
    info.size > maxBytes ||
    (info.mode & 0o7000) !== 0
  )
    fail("Native Cargo input must be a bounded, unlinked regular file");
  return info;
}

async function runTee(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdoutFile = createWriteStream(options.stdoutPath, { flags: "wx" });
  const stderrFile = createWriteStream(options.stderrPath, { flags: "wx" });
  const stdoutLimit = { bytes: 0, exceeded: false };
  const stderrLimit = { bytes: 0, exceeded: false };
  const limiter = (state, maximum) =>
    new Transform({
      transform(chunk, _encoding, callback) {
        const remaining = Math.max(0, maximum - state.bytes);
        if (chunk.length > remaining) {
          state.exceeded = true;
          state.bytes += remaining;
          callback(null, remaining ? chunk.subarray(0, remaining) : undefined);
        } else {
          state.bytes += chunk.length;
          callback(null, chunk);
        }
      },
    });
  const stdoutTee = limiter(stdoutLimit, options.maxStdoutBytes);
  const stderrTee = limiter(stderrLimit, options.maxStderrBytes);
  const stdoutFinished = finished(stdoutFile);
  const stderrFinished = finished(stderrFile);
  child.stdout.pipe(stdoutTee);
  stdoutTee.pipe(stdoutFile);
  stdoutTee.pipe(options.stdout);
  child.stderr.pipe(stderrTee);
  stderrTee.pipe(stderrFile);
  stderrTee.pipe(options.stderr);
  let spawnError;
  const result = await new Promise((accept) => {
    child.once("error", (error) => {
      spawnError = error;
      accept({ exitCode: null, signal: null });
    });
    child.once("close", (exitCode, signal) => accept({ exitCode, signal }));
  });
  await Promise.all([stdoutFinished, stderrFinished]);
  return {
    ...result,
    spawnError,
    stdoutBytes: stdoutLimit.bytes,
    stderrBytes: stderrLimit.bytes,
    outputLimitExceeded: stdoutLimit.exceeded || stderrLimit.exceeded,
  };
}

function parseCargoMessages(path) {
  return readFile(path, "utf8").then((text) => {
    if (Buffer.byteLength(text) > MAX_JSON_BYTES)
      fail("Unbounded Cargo compiler stream");
    const lines = text.split(/\r?\n/u).filter(Boolean);
    if (lines.length > MAX_CAPTURE_FILES * 10)
      fail("Unbounded Cargo compiler stream");
    return lines.map((line) => JSON.parse(line));
  });
}

async function copyBoundedTargetInput(
  source,
  destination,
  expectedSize,
  limit,
) {
  const maximumBytes = Math.min(expectedSize, limit);
  const hash = createHash("sha256");
  let copiedBytes = 0;
  const bounded = new Transform({
    transform(chunk, _encoding, callback) {
      if (copiedBytes + chunk.length > maximumBytes) {
        callback(
          new Error(
            "Cargo target input exceeded its capture bounds during copy",
          ),
        );
        return;
      }
      copiedBytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      createReadStream(source),
      bounded,
      createWriteStream(destination, { flags: "wx" }),
    );
    if (copiedBytes !== expectedSize)
      fail("Cargo target input changed while being captured");
  } catch (error) {
    try {
      await rm(destination, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Cargo target input copy failed and partial output cleanup failed",
        { cause: cleanupError },
      );
    }
    throw error;
  }
  return { size: copiedBytes, sha256: hash.digest("hex") };
}

async function copyTargetInputs(
  messages,
  targetDirectory,
  captureDirectory,
  {
    maxFileBytes = MAX_CAPTURE_FILE_BYTES,
    maxTotalBytes = MAX_CAPTURE_TOTAL_BYTES,
    beforeCopy,
  } = {},
) {
  const root = await realpath(targetDirectory);
  const files = new Map();
  const addFile = async (path) => {
    const absolute = resolve(path);
    const actual = await realpath(absolute);
    if (!inside(root, actual))
      fail("Cargo compiler input escapes the selected target directory");
    const info = await regularFile(absolute, {
      singleLink: false,
      maxBytes: maxFileBytes,
    });
    const relativePath = normalized(relative(root, actual));
    const key =
      process.platform === "win32"
        ? relativePath.toLocaleLowerCase("en-US")
        : relativePath;
    const previous = files.get(key);
    if (previous) {
      if (previous.path !== relativePath || previous.source !== actual)
        fail("Ambiguous Cargo target input path");
      return;
    }
    if (files.size >= MAX_CAPTURE_FILES) fail("Too many Cargo target inputs");
    files.set(key, {
      path: relativePath,
      source: actual,
      size: info.size,
      stat: info,
    });
  };
  const addTree = async (directory) => {
    const actualDirectory = await realpath(directory);
    if (!inside(root, actualDirectory))
      fail("Cargo generated output escapes the selected target directory");
    const walk = async (current) => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const child = resolve(current, entry.name);
        const info = await lstat(child);
        if (info.isSymbolicLink()) fail("Link in Cargo generated output");
        if (info.isDirectory()) await walk(child);
        else await addFile(child);
      }
    };
    await walk(actualDirectory);
  };

  for (const message of messages) {
    if (message.reason === "compiler-artifact") {
      if (!Array.isArray(message.filenames))
        fail("Cargo artifact has no filenames");
      for (const filename of message.filenames) await addFile(filename);
    } else if (message.reason === "build-script-executed" && message.out_dir) {
      await addTree(message.out_dir);
    }
  }

  const outputRoot = resolve(captureDirectory, "target-files");
  const orderedFiles = [...files.values()].sort((a, b) =>
    a.path.localeCompare(b.path, "en"),
  );
  let totalBytes = 0;
  for (const file of orderedFiles) {
    totalBytes += file.size;
    if (totalBytes > maxTotalBytes)
      fail("Cargo target inputs exceed the capture size limit");
  }
  const copied = [];
  let copiedBytes = 0;
  try {
    for (const file of orderedFiles) {
      const destination = resolve(outputRoot, file.path);
      if (!inside(outputRoot, destination))
        fail("Invalid Cargo target input path");
      await beforeCopy?.({
        path: `target/${file.path}`,
        source: file.source,
        size: file.size,
      });
      await mkdir(dirname(destination), { recursive: true });
      const limit = Math.min(
        file.size,
        maxFileBytes,
        maxTotalBytes - copiedBytes,
      );
      const copiedInput = await copyBoundedTargetInput(
        file.source,
        destination,
        file.size,
        limit,
      );
      const copiedInfo = await regularFile(destination);
      const after = await sha256(destination);
      const sourceAfter = await lstat(file.source);
      const sourceUnchanged = [
        "dev",
        "ino",
        "size",
        "mode",
        "nlink",
        "mtimeMs",
        "ctimeMs",
      ].every((key) => file.stat[key] === sourceAfter[key]);
      if (
        copiedInfo.size !== file.size ||
        sourceAfter.size !== file.size ||
        !sourceUnchanged ||
        copiedInput.sha256 !== after
      )
        fail("Cargo target input changed while being captured");
      copiedBytes += copiedInfo.size;
      copied.push({
        path: `target/${file.path}`,
        capturePath: normalized(
          relative(resolve(captureDirectory), destination),
        ),
        size: copiedInfo.size,
        sha256: after,
      });
    }
  } catch (error) {
    await rm(outputRoot, { recursive: true, force: true });
    throw error;
  }
  return copied;
}

function verifyArgs(args, target) {
  const targets = [];
  for (let index = 0; index < args.length; index++)
    if (args[index] === "--target") targets.push(args[index + 1]);
  if (
    args[0] !== "build" ||
    targets.length !== 1 ||
    targets[0] !== target ||
    !args.includes("--locked") ||
    !args.includes("--release") ||
    !args.includes("--message-format=json")
  )
    fail("Expected one locked release Cargo build for the exact JSON target");
}

async function checkMetadata(metadataPath, targetDirectory, cwd) {
  const metadata = await readJson(metadataPath);
  const expectedTarget = await realpath(targetDirectory);
  const expectedManifest = await realpath(resolve(cwd, "Cargo.toml"));
  if (
    typeof metadata.target_directory !== "string" ||
    !samePath(await realpath(metadata.target_directory), expectedTarget)
  )
    fail("Cargo metadata target directory mismatch");
  if (
    typeof metadata.workspace_root !== "string" ||
    !samePath(await realpath(metadata.workspace_root), await realpath(cwd))
  )
    fail("Cargo metadata workspace mismatch");
  if (!Array.isArray(metadata.packages) || !metadata.resolve?.nodes)
    fail("Cargo metadata is incomplete");
  const packages = [];
  for (const pkg of metadata.packages) {
    if (pkg.name !== "openfilm-desktop") continue;
    const manifestPath = await realpath(pkg.manifest_path);
    if (samePath(manifestPath, expectedManifest)) packages.push(pkg);
  }
  if (packages.length !== 1)
    fail("Cargo metadata does not identify one native shell package");
  const shellPackage = packages[0];
  if (
    !Array.isArray(shellPackage.targets) ||
    shellPackage.targets.filter(
      (target) =>
        target.name === "openfilm-desktop" && target.kind?.includes("bin"),
    ).length !== 1 ||
    !metadata.resolve.nodes.some((node) => node.id === shellPackage.id)
  )
    fail("Cargo metadata native shell target mismatch");
  return { metadata, shellPackage };
}

async function captureCargoBuild(options) {
  const root = await realpath(options.root);
  const cwd = await realpath(options.cwd);
  if (!isHash(options.candidateSha) || options.headSha !== options.candidateSha)
    fail("Candidate checkout SHA mismatch");
  if (
    !/^(?:x86_64|aarch64)-(?:unknown-linux-gnu|apple-darwin|pc-windows-msvc)$/u.test(
      options.target,
    )
  )
    fail("Unsupported native target");
  const expectedTargetDirectory = resolve(root, TARGET_ROOT);
  if (!samePath(options.targetDirectory, expectedTargetDirectory))
    fail("Selected Cargo target directory mismatch");
  const expectedShellPath = `${TARGET_ROOT}/${options.target}/release/${options.target.endsWith("windows-msvc") ? "openfilm-desktop.exe" : "openfilm-desktop"}`;
  if (normalized(options.shellPath) !== expectedShellPath)
    fail("Selected Cargo shell path mismatch");
  verifyArgs(options.args, options.target);
  const lockfile = resolve(root, LOCK_PATH);
  if (!samePath(await realpath(options.lockfile), await realpath(lockfile)))
    fail("Selected Cargo lockfile mismatch");
  const lockInfo = await regularFile(lockfile, { maxBytes: MAX_JSON_BYTES });
  const lockBytes = await readFile(lockfile);
  const captureDirectory = resolve(
    options.captureDirectory ?? resolve(root, EVIDENCE_ROOT),
  );
  if (!inside(root, captureDirectory))
    fail("Cargo evidence directory escapes checkout");
  await assertNoSymlinkParents(root, dirname(captureDirectory));
  await mkdir(dirname(captureDirectory), { recursive: true });
  await assertNoSymlinkParents(root, captureDirectory);
  await mkdir(captureDirectory);
  await writeExclusive(resolve(captureDirectory, "Cargo.lock"), lockBytes);

  const environment = options.environment ?? process.env;
  const rustcResult = options.rustcVersion
    ? { status: 0, stdout: `${options.rustcVersion}\n`, stderr: "" }
    : spawnSync("rustc", ["--version"], {
        cwd,
        env: environment,
        encoding: "utf8",
        windowsHide: true,
      });
  const cargoResult = options.cargoVersion
    ? { status: 0, stdout: `${options.cargoVersion}\n`, stderr: "" }
    : spawnSync(
        options.command,
        [...(options.commandPrefix ?? []), "--version"],
        {
          cwd,
          env: environment,
          encoding: "utf8",
          windowsHide: true,
        },
      );
  const rustcVersion = rustcResult.stdout?.trim();
  const cargoVersion = cargoResult.stdout?.trim();
  if (
    rustcResult.status !== 0 ||
    !/^rustc 1\.99\.0(?: |$)/u.test(rustcVersion ?? "")
  )
    fail("Cargo capture requires the pinned rustc 1.99.0 toolchain");
  if (
    cargoResult.status !== 0 ||
    !/^cargo 1\.99\.0(?: |$)/u.test(cargoVersion ?? "")
  )
    fail("Cargo capture requires the pinned cargo 1.99.0 toolchain");
  await writeExclusive(
    resolve(captureDirectory, "toolchain.json"),
    jsonBytes({
      rustc: {
        command: "rustc",
        arguments: ["--version"],
        version: rustcVersion,
        stderr: rustcResult.stderr ?? "",
      },
      cargo: {
        command: options.command,
        arguments: [...(options.commandPrefix ?? []), "--version"],
        version: cargoVersion,
        stderr: cargoResult.stderr ?? "",
      },
    }),
  );

  const invocationPath = resolve(captureDirectory, "invocation.json");
  const build = await runTee(
    options.command,
    [...(options.commandPrefix ?? []), ...options.args],
    {
      cwd,
      environment: options.environment ?? process.env,
      stdoutPath: resolve(captureDirectory, "compiler-messages.jsonl"),
      stderrPath: resolve(captureDirectory, "compiler-stderr.log"),
      maxStdoutBytes: options.maxBuildStdoutBytes ?? MAX_JSON_BYTES,
      maxStderrBytes: options.maxBuildStderrBytes ?? MAX_JSON_BYTES,
      stdout: options.stdout ?? process.stdout,
      stderr: options.stderr ?? process.stderr,
    },
  );
  await writeExclusive(
    invocationPath,
    jsonBytes({
      command: options.command,
      arguments: options.args,
      cwd,
      exitCode: build.exitCode,
      signal: build.signal,
      spawnError: build.spawnError?.message,
      stdoutBytes: build.stdoutBytes,
      stderrBytes: build.stderrBytes,
      outputLimitExceeded: build.outputLimitExceeded,
      rustcVersion,
      cargoVersion,
    }),
  );

  const metadataArgs = metadataArgsForCargo(options.args, cwd, options.target);
  const metadata = await runTee(
    options.command,
    [...(options.commandPrefix ?? []), ...metadataArgs],
    {
      cwd,
      environment: options.environment ?? process.env,
      stdoutPath: resolve(captureDirectory, "metadata.json"),
      stderrPath: resolve(captureDirectory, "metadata-stderr.log"),
      maxStdoutBytes: options.maxMetadataStdoutBytes ?? MAX_JSON_BYTES,
      maxStderrBytes: options.maxMetadataStderrBytes ?? MAX_JSON_BYTES,
      stdout:
        options.metadataStdout ??
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
      stderr:
        options.metadataStderr ??
        new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        }),
    },
  );
  await writeExclusive(
    resolve(captureDirectory, "metadata-invocation.json"),
    jsonBytes({
      command: options.command,
      arguments: metadataArgs,
      cwd,
      exitCode: metadata.exitCode,
      signal: metadata.signal,
      stdoutBytes: metadata.stdoutBytes,
      stderrBytes: metadata.stderrBytes,
      outputLimitExceeded: metadata.outputLimitExceeded,
      cargoVersion,
    }),
  );

  const lockAfter = await readFile(lockfile);
  if (
    lockInfo.size !== lockAfter.length ||
    !lockBytes.equals(lockAfter) ||
    !lockBytes.equals(await readFile(resolve(captureDirectory, "Cargo.lock")))
  )
    fail("Cargo.lock changed during the native build capture");
  if (build.exitCode !== 0 || build.spawnError) {
    const error = new Error(
      `Cargo build failed with exit code ${String(build.exitCode)}`,
    );
    error.exitCode =
      Number.isInteger(build.exitCode) && build.exitCode !== 0
        ? build.exitCode
        : 1;
    throw error;
  }
  if (build.outputLimitExceeded)
    fail("Cargo build output exceeded its capture limit");
  if (metadata.exitCode !== 0 || metadata.spawnError)
    fail(`Cargo metadata failed with exit code ${String(metadata.exitCode)}`);
  if (metadata.outputLimitExceeded)
    fail("Cargo metadata output exceeded its capture limit");

  const [{ metadata: metadataValue, shellPackage }, messages] =
    await Promise.all([
      checkMetadata(
        resolve(captureDirectory, "metadata.json"),
        options.targetDirectory,
        cwd,
      ),
      parseCargoMessages(resolve(captureDirectory, "compiler-messages.jsonl")),
    ]);
  const finishes = messages.filter(
    (message) => message.reason === "build-finished",
  );
  if (finishes.length !== 1 || finishes[0]?.success !== true)
    fail(
      "Cargo compiler stream does not contain one successful build-finished record",
    );
  const shell = resolve(root, options.shellPath);
  await assertNoSymlinkParents(root, shell);
  const shellReal = await realpath(shell);
  if (!inside(await realpath(options.targetDirectory), shellReal))
    fail("Native shell is outside the selected Cargo target directory");
  const shellInfo = await regularFile(shell, { singleLink: false });
  const matchingArtifacts = messages.filter(
    (message) =>
      message.reason === "compiler-artifact" &&
      message.package_id === shellPackage.id &&
      message.target?.name === "openfilm-desktop" &&
      message.target?.kind?.includes("bin") &&
      Array.isArray(message.filenames) &&
      message.filenames.some((path) => samePath(path, shellReal)) &&
      typeof message.executable === "string" &&
      samePath(message.executable, shellReal),
  );
  if (matchingArtifacts.length !== 1)
    fail(
      "Cargo compiler stream shell does not match the selected target shell",
    );

  const actualTargetDirectory = await realpath(options.targetDirectory);
  if (!inside(root, actualTargetDirectory))
    fail("Cargo target directory resolves outside the candidate checkout");
  await assertNoSymlinkParents(root, options.targetDirectory);
  const targetInputs = await copyTargetInputs(
    messages,
    options.targetDirectory,
    captureDirectory,
    {
      maxFileBytes: captureLimit(
        options.maxTargetInputFileBytes,
        MAX_CAPTURE_FILE_BYTES,
        "Target input file limit",
      ),
      maxTotalBytes: captureLimit(
        options.maxTargetInputTotalBytes,
        MAX_CAPTURE_TOTAL_BYTES,
        "Target input total limit",
      ),
      beforeCopy: options.beforeTargetInputCopy,
    },
  );
  const capture = {
    schemaVersion: 1,
    kind: "native-cargo-build-capture",
    candidateSha: options.candidateSha,
    target: options.target,
    rustcVersion,
    cargoVersion,
    invocation: {
      path: "invocation.json",
      sha256: await sha256(invocationPath),
    },
    metadata: {
      path: "metadata.json",
      sha256: await sha256(resolve(captureDirectory, "metadata.json")),
      targetDirectory: normalized(
        relative(root, await realpath(options.targetDirectory)),
      ),
      recordedTargetDirectory: metadataValue.target_directory,
      recordedWorkspaceRoot: metadataValue.workspace_root,
      targetInputsDirectory: "target-files",
    },
    metadataInvocation: {
      path: "metadata-invocation.json",
      sha256: await sha256(
        resolve(captureDirectory, "metadata-invocation.json"),
      ),
    },
    metadataStderr: {
      path: "metadata-stderr.log",
      sha256: await sha256(resolve(captureDirectory, "metadata-stderr.log")),
    },
    compilerMessages: {
      path: "compiler-messages.jsonl",
      sha256: await sha256(
        resolve(captureDirectory, "compiler-messages.jsonl"),
      ),
    },
    compilerStderr: {
      path: "compiler-stderr.log",
      sha256: await sha256(resolve(captureDirectory, "compiler-stderr.log")),
    },
    toolchain: {
      path: "toolchain.json",
      sha256: await sha256(resolve(captureDirectory, "toolchain.json")),
    },
    lock: {
      path: "Cargo.lock",
      sha256: createHash("sha256").update(lockBytes).digest("hex"),
    },
    shell: {
      path: normalized(relative(root, shellReal)),
      sha256: await sha256(shell),
      size: shellInfo.size,
    },
    targetInputs,
  };
  await writeExclusive(
    resolve(captureDirectory, "capture.json"),
    jsonBytes(capture),
  );
  return capture;
}

async function loadCheckout(root) {
  const manifest = await readJson(
    resolve(root, `${RUNTIME_ROOT}/runtime-manifest.json`),
  );
  if (
    !manifest ||
    typeof manifest.platform !== "string" ||
    typeof manifest.architecture !== "string"
  )
    fail("Reviewed runtime manifest has no native target identity");
  const target = resolveNativeTarget(hostIdentity(), manifest, root);
  const headSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (headSha.status !== 0) fail("Cannot resolve candidate checkout HEAD");
  const candidateSha = headSha.stdout.trim();
  if (
    !isHash(candidateSha) ||
    (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== candidateSha)
  )
    fail("Candidate checkout SHA mismatch");
  return { manifest, target, candidateSha };
}

async function emitTarget() {
  const root = await realpath(process.cwd());
  const { target } = await loadCheckout(root);
  process.stdout.write(
    `triple=${target.target}\nshellPath=${target.shellPath}\nbundleDirectory=${target.bundleDirectory}\n`,
  );
}

async function listInstallers(root, bundleDirectory) {
  const result = [];
  let count = 0;
  const walk = async (path, depth) => {
    if (depth > 16) fail("Installer directory depth limit");
    for (const entry of await readdir(resolve(root, path), {
      withFileTypes: true,
    })) {
      if (++count > 10_000 || entry.isSymbolicLink())
        fail("Installer inventory limit or symlink");
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.endsWith(".app")) await walk(child, depth + 1);
      } else if (/\.(?:deb|rpm|AppImage|exe|msi|dmg)$/u.test(entry.name)) {
        const file = resolve(root, child);
        await regularFile(file);
        result.push(child);
      }
    }
  };
  await walk(bundleDirectory, 0);
  if (!result.length || result.length > 16)
    fail("Native Tauri build has no supported installer output");
  return result.sort();
}

async function verifyAndWriteIdentity() {
  const root = await realpath(process.cwd());
  const { target, candidateSha } = await loadCheckout(root);
  const captureDirectory = resolve(root, EVIDENCE_ROOT);
  const capture = await readJson(resolve(captureDirectory, "capture.json"));
  if (
    capture.kind !== "native-cargo-build-capture" ||
    capture.candidateSha !== candidateSha ||
    capture.target !== target.target ||
    capture.shell?.path !== target.shellPath
  )
    fail("Cargo capture does not match the current candidate target");
  const lockPath = resolve(root, LOCK_PATH);
  if ((await sha256(lockPath)) !== capture.lock?.sha256)
    fail("Cargo.lock differs from captured build input");
  const shell = resolve(root, target.shellPath);
  await assertNoSymlinkParents(root, shell);
  const shellInfo = await regularFile(shell, { singleLink: false });
  if (
    shellInfo.size !== capture.shell.size ||
    (await sha256(shell)) !== capture.shell.sha256
  )
    fail("Bundler changed or replaced the captured native shell");
  const bundleDirectory = target.bundleDirectory;
  const installers = await listInstallers(root, bundleDirectory);
  const linkage = await readJson(
    resolve(root, `${RUNTIME_ROOT}/receipts/linkage-evidence.json`),
  );
  const abi = linkage?.baseline?.abi;
  if (typeof abi !== "string" || !abi.length || abi.length > 160)
    fail("Reviewed runtime linkage ABI is missing");
  const identityInputs = {
    candidateSha,
    target: {
      platform: target.target.includes("unknown-linux-gnu")
        ? "linux"
        : target.target.includes("apple-darwin")
          ? "darwin"
          : "win32",
      architecture: target.target.startsWith("x86_64-") ? "x64" : "arm64",
      triple: target.target,
      abi,
    },
    runtimeRoot: RUNTIME_ROOT,
    shellPath: target.shellPath,
    installerPaths: installers,
    buildEvidencePath: `${EVIDENCE_ROOT}/capture.json`,
  };
  const output = resolve(root, "dist/native-evidence/identity-inputs.json");
  await assertNoSymlinkParents(root, dirname(output));
  await writeExclusive(output, jsonBytes(identityInputs));
  process.stdout.write(
    `identityInputs=${normalized(relative(root, output))}\n`,
  );
}

async function main() {
  const first = process.argv[2];
  if (first === "target") return emitTarget();
  if (first === "finalize") return verifyAndWriteIdentity();
  const cwd = await realpath(process.cwd());
  const root = await realpath(resolve(cwd, "../../.."));
  const { target, candidateSha } = await loadCheckout(root);
  const expected = resolveNativeTarget(
    hostIdentity(),
    {
      platform: target.target.includes("unknown-linux-gnu")
        ? "linux"
        : target.target.includes("apple-darwin")
          ? "darwin"
          : "win32",
      architecture: target.target.startsWith("x86_64-") ? "x64" : "arm64",
    },
    root,
  );
  const shellInfo = {
    root,
    cwd,
    target: target.target,
    targetDirectory: resolve(root, target.targetDirectory),
    shellPath: target.shellPath,
    lockfile: resolve(root, LOCK_PATH),
    captureDirectory: resolve(root, EVIDENCE_ROOT),
    candidateSha,
    headSha: candidateSha,
    rustcVersion: spawnSync("rustc", ["--version"], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    }).stdout?.trim(),
    args: process.argv.slice(2),
    command: process.env.OPENFILM_CARGO_COMMAND || "cargo",
    environment: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  };
  if (expected.shellPath !== target.shellPath)
    fail("Native target shell resolution mismatch");
  try {
    await captureCargoBuild(shellInfo);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Cargo capture failed"}\n`,
    );
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();

export { captureCargoBuild };
