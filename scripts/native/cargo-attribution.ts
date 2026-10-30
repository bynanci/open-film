// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  runtimeHash,
  runtimePath,
} from "../../apps/server/src/runtime-manifest.js";
import { canonicalJson } from "./linkage.js";
import type { CargoEvidence } from "./attribution.js";
import type { PackageIdentity } from "../build-attribution.mjs";
interface CargoPackage {
  id: string;
  name: string;
  version: string;
  license: string | null;
  source: string | null;
  manifest_path: string;
}
interface CargoMessage {
  reason: string;
  package_id?: string;
  target?: { kind: string[] };
  filenames?: string[];
  executable?: string | null;
  success?: boolean;
  out_dir?: string;
  linked_libs?: string[];
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const normalize = (value: string) => value.replaceAll("\\", "/");
function relativePath(root: string, path: string): string {
  const value = normalize(relative(root, path));
  if (!value || value.startsWith("../") || isAbsolute(value))
    throw new Error("Native evidence path outside declared root");
  runtimePath(root, value);
  return value;
}
async function boundedJson<T>(path: string): Promise<T> {
  const bytes = await readFile(path);
  if (bytes.length > 32 * 1024 ** 2)
    throw new Error("Unbounded Cargo evidence");
  return JSON.parse(bytes.toString()) as T;
}
async function tree(
  root: string,
  registry = false,
): Promise<{ path: string; sha256: string }[]> {
  const result: { path: string; sha256: string }[] = [];
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (!registry && ["target", ".git"].includes(entry.name)) continue;
      const path = join(folder, entry.name),
        info = await lstat(path);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
        throw new Error("Link or non-file in compiled source");
      if (
        registry &&
        [".cargo-ok", ".cargo-checksum.json"].includes(entry.name)
      )
        continue;
      if (info.isDirectory()) await walk(path);
      else {
        if (info.size > 1024 ** 3 || result.length >= 20000)
          throw new Error("Unbounded compiled source");
        result.push({
          path: relativePath(root, path),
          sha256: await runtimeHash(path),
        });
      }
    }
  };
  await walk(root);
  return result.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
export async function collectCargoEvidence(options: {
  root: string;
  target: string;
  targetDirectory: string;
  metadata: string;
  messages: string;
  lock: string;
  invocation: string;
  shell: string;
  observationMode?: "executed" | "fixture";
}): Promise<CargoEvidence> {
  const root = await realpath(options.root),
    targetDirectory = await realpath(options.targetDirectory);
  if (
    !/^(?:x86_64|aarch64)-(?:unknown-linux-gnu|apple-darwin|pc-windows-msvc)$/u.test(
      options.target,
    )
  )
    throw new Error("Unsupported native target");
  const invocation = await boundedJson<{
    arguments: string[];
    exitCode: number;
    rustcVersion: string;
  }>(options.invocation);
  const args = invocation.arguments,
    index = args.indexOf("--target");
  if (
    invocation.exitCode !== 0 ||
    args[0] !== "build" ||
    !args.includes("--locked") ||
    !args.includes("--release") ||
    index < 0 ||
    args[index + 1] !== options.target ||
    !args.includes("--message-format=json") ||
    !/^rustc 1\.99\.0(?: |$)/u.test(invocation.rustcVersion)
  )
    throw new Error(
      "Successful locked explicit target/compiler build invocation required",
    );
  const metadata = await boundedJson<{
    packages: CargoPackage[];
    resolve: { nodes: { id: string }[] } | null;
  }>(options.metadata);
  const messageBytes = await readFile(options.messages);
  if (messageBytes.length > 32 * 1024 ** 2)
    throw new Error("Unbounded compiler messages");
  const messages = messageBytes
    .toString()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CargoMessage);
  if (
    messages.filter((x) => x.reason === "build-finished").length !== 1 ||
    !messages.find((x) => x.reason === "build-finished")?.success ||
    !metadata.resolve
  )
    throw new Error("Incomplete or failed Cargo build");
  const lockText = await readFile(options.lock, "utf8"),
    lockSha256 = await runtimeHash(options.lock);
  const lockPackages = lockText
    .split(/^\[\[package\]\]\s*$/mu)
    .slice(1)
    .map((block) =>
      Object.fromEntries(
        [
          ...block.matchAll(
            /^(name|version|source|checksum) = "([^"\n]+)"$/gmu,
          ),
        ].map(([, key, value]) => [key, value]),
      ),
    );
  const packages: PackageIdentity[] = [];
  const packageIdsByRaw = new Map<string, string>();
  if (
    metadata.packages.length > 2000 ||
    new Set(metadata.packages.map((p) => p.id)).size !==
      metadata.packages.length
  )
    throw new Error("Unbounded or duplicate Cargo package identity");
  for (const p of metadata.packages) {
    const manifest = await realpath(p.manifest_path),
      packageRoot = dirname(manifest),
      sourceTree = await tree(packageRoot, p.source !== null);
    let source: PackageIdentity["source"];
    if (p.source) {
      if (!p.source.startsWith("registry+"))
        throw new Error(
          "Non-registry native dependency needs independent source review",
        );
      const rows = lockPackages.filter(
        (x) =>
          x.name === p.name && x.version === p.version && x.source === p.source,
      );
      if (rows.length !== 1 || !/^[a-f0-9]{64}$/u.test(rows[0]!.checksum ?? ""))
        throw new Error("Native registry identity missing from exact lock");
      const checksum = await boundedJson<{
        package: string;
        files: Record<string, string>;
      }>(join(packageRoot, ".cargo-checksum.json"));
      if (
        checksum.package !== rows[0]!.checksum ||
        sourceTree.length !== Object.keys(checksum.files).length ||
        sourceTree.some((file) => checksum.files[file.path] !== file.sha256)
      )
        throw new Error(
          "Compiled registry source differs from Cargo checksum inventory",
        );
      source = {
        kind: "cargo",
        locator: `${p.source}#${p.name}@${p.version}`,
        checksum: rows[0]!.checksum,
        sourceTreeSha256: digest(sourceTree),
        manifestSha256: await runtimeHash(manifest),
        lockSha256,
      };
    } else
      source = {
        kind: "workspace",
        locator: `workspace:${relativePath(root, manifest)}`,
        checksum: digest(sourceTree),
        lockSha256,
      };
    const id =
      p.source === null && p.id.startsWith("path+")
        ? `workspace:${relativePath(root, manifest)}#${p.name}@${p.version}`
        : p.id;
    packageIdsByRaw.set(p.id, id);
    packages.push({
      id,
      resolvedIdentitySha256: digest(p.id),
      name: p.name,
      version: p.version,
      sourceIdentity: digest(source),
      source,
      license: p.license ?? "NOASSERTION",
    });
  }
  const packageIds = new Set(packageIdsByRaw.keys());
  const compilations: CargoEvidence["compilations"] = [],
    generatedOutputs: CargoEvidence["generatedOutputs"] = [],
    linkedLibraries: NonNullable<CargoEvidence["linkedLibraries"]> = [];
  const artifact = async (path: string) => {
    const actual = await realpath(path);
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error("Native compiler artifact is not a regular file");
    return {
      path: `target/${relativePath(targetDirectory, actual)}`,
      sha256: await runtimeHash(actual),
    };
  };
  for (const message of messages) {
    if (
      !["compiler-artifact", "build-script-executed"].includes(message.reason)
    )
      continue;
    if (!message.package_id || !packageIds.has(message.package_id))
      throw new Error("Unknown compiler package");
    const packageId = packageIdsByRaw.get(message.package_id)!;
    if (message.reason === "compiler-artifact") {
      if (!message.target?.kind?.length || !message.filenames?.length)
        throw new Error("Missing target compiler artifact");
      const artifacts = await Promise.all(message.filenames.map(artifact));
      const role = message.target.kind.includes("proc-macro")
        ? "proc-macro"
        : message.target.kind.includes("custom-build")
          ? "build"
          : artifacts.every((x) =>
                x.path.startsWith(`target/${options.target}/release/`),
              )
            ? "target"
            : "build";
      compilations.push({ packageId, role, artifacts });
    } else {
      let role: "target" | "build" | undefined;
      if (message.out_dir) {
        const output = relativePath(
          targetDirectory,
          await realpath(message.out_dir),
        );
        role = output.startsWith(`${options.target}/release/`)
          ? "target"
          : "build";
        for (const file of await tree(message.out_dir))
          generatedOutputs.push({
            packageId,
            path: `target/${relativePath(targetDirectory, join(message.out_dir, file.path))}`,
            sha256: file.sha256,
          });
      }
      if (message.linked_libs?.length && !role)
        throw new Error(
          "Link directives require an observed build output directory",
        );
      for (const name of message.linked_libs ?? [])
        linkedLibraries.push({ packageId, name, role });
    }
  }
  const shell = await artifact(options.shell),
    shellCompilation = compilations.filter(
      (c) =>
        c.role === "target" &&
        c.artifacts.some(
          (a) => a.path === shell.path && a.sha256 === shell.sha256,
        ),
    );
  if (shellCompilation.length !== 1)
    throw new Error("Native shell not bound to one target compiler artifact");
  const evidenceFiles = await Promise.all(
    [options.metadata, options.messages, options.lock, options.invocation].map(
      async (path) => ({
        path: relativePath(root, await realpath(path)),
        sha256: await runtimeHash(path),
      }),
    ),
  );
  return {
    schemaVersion: 1,
    observationMode: options.observationMode ?? "executed",
    target: options.target,
    metadataSha256: await runtimeHash(options.metadata),
    lockSha256,
    packages,
    compilations,
    shell: { ...shell, packageId: shellCompilation[0]!.packageId },
    generatedOutputs,
    evidenceFiles,
    linkedLibraries,
    compiler: {
      rustcVersion: invocation.rustcVersion,
      invocationSha256: await runtimeHash(options.invocation),
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error(
      "Usage: cargo-attribution.ts <local-input-paths.json> <new-evidence.json>",
    );
  const options =
    await boundedJson<Parameters<typeof collectCargoEvidence>[0]>(input);
  const result = await collectCargoEvidence({
    ...options,
    observationMode: "executed",
  });
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
  });
}
