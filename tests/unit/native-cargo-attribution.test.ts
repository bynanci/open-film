import { afterEach, expect, it } from "vitest";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { collectCargoEvidence } from "../../scripts/native/cargo-attribution.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture(target = "x86_64-unknown-linux-gnu") {
  const root = await mkdtemp(join(tmpdir(), "openfilm-cargo-attribution-"));
  roots.push(root);
  const targetDirectory = join(root, "target");
  const packages: {
    id: string;
    name: string;
    version: string;
    license: string;
    source: null;
    manifest_path: string;
  }[] = [];
  for (const name of ["compiled", "build-tool", "macro", "inactive"]) {
    await mkdir(join(root, "crates", name, "src"), { recursive: true });
    await writeFile(
      join(root, "crates", name, "Cargo.toml"),
      `[package]\nname="${name}"\nversion="1.0.0"\nlicense="MIT"\n`,
    );
    await writeFile(
      join(root, "crates", name, "src/lib.rs"),
      "pub const ANSWER:u32=42;\n",
    );
    packages.push({
      id: name,
      name,
      version: "1.0.0",
      license: "MIT",
      source: null,
      manifest_path: join(root, "crates", name, "Cargo.toml"),
    });
  }
  const paths = [
    join(targetDirectory, target, "release/openfilm"),
    join(targetDirectory, "release/build-tool"),
    join(targetDirectory, "release/macro.so"),
  ];
  for (const path of paths) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "compiler artifact fixture");
  }
  const lock = join(root, "Cargo.lock");
  await writeFile(lock, "version = 4\n");
  const metadata = join(root, "metadata.json");
  await writeFile(
    metadata,
    JSON.stringify({
      packages,
      resolve: {
        root: "compiled",
        nodes: packages.map((p) => ({ id: p.id, dependencies: [] })),
      },
      workspace_members: packages.map((p) => p.id),
    }),
  );
  const messages = join(root, "messages.jsonl");
  await writeFile(
    messages,
    [
      ...paths.map((path, i) => ({
        reason: "compiler-artifact",
        package_id: packages[i]!.id,
        target: {
          kind: [i === 0 ? "bin" : i === 1 ? "custom-build" : "proc-macro"],
        },
        filenames: [path],
        executable: i === 0 ? path : null,
      })),
      { reason: "build-finished", success: true },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n"),
  );
  const invocation = join(root, "invocation.json");
  await writeFile(
    invocation,
    JSON.stringify({
      arguments: [
        "build",
        "--locked",
        "--release",
        "--target",
        target,
        "--message-format=json",
      ],
      exitCode: 0,
      rustcVersion: "rustc 1.99.0 fixture",
    }),
  );
  return {
    root,
    target,
    targetDirectory,
    metadata,
    messages,
    lock,
    invocation,
    shell: paths[0]!,
    observationMode: "fixture" as const,
  };
}
it("classifies actual target artifacts, host build/proc-macro inputs and uncompiled packages separately", async () => {
  const f = await fixture();
  const e = await collectCargoEvidence(f);
  expect(e.compilations.map((x) => [x.packageId, x.role])).toEqual([
    ["compiled", "target"],
    ["build-tool", "build"],
    ["macro", "proc-macro"],
  ]);
  expect(e.packages.map((x) => x.id)).toContain("inactive");
  expect(e.compilations.some((x) => x.packageId === "inactive")).toBe(false);
  expect(e.shell.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(e.observationMode).toBe("fixture");
});
it.each([
  "failed",
  "missing-target",
  "missing-shell",
  "outside-target",
  "unknown-package",
  "unlocked",
  "source-link",
])("refuses %s compiler evidence", async (fault) => {
  const f = await fixture();
  if (fault === "failed")
    await writeFile(
      f.messages,
      JSON.stringify({ reason: "build-finished", success: false }),
    );
  if (fault === "missing-target" || fault === "unlocked") {
    const data = JSON.parse(await readFile(f.invocation, "utf8"));
    data.arguments = data.arguments.filter(
      (v: string) => v !== (fault === "unlocked" ? "--locked" : "--target"),
    );
    await writeFile(f.invocation, JSON.stringify(data));
  }
  if (fault === "missing-shell") await rm(f.shell);
  if (fault === "outside-target") f.shell = f.metadata;
  if (fault === "unknown-package")
    await writeFile(
      f.messages,
      (await readFile(f.messages, "utf8")).replace(
        '"package_id":"compiled"',
        '"package_id":"absent"',
      ),
    );
  if (fault === "source-link") {
    const { symlink } = await import("node:fs/promises");
    await symlink(f.metadata, join(f.root, "crates/compiled/src/link.rs"));
  }
  await expect(collectCargoEvidence(f)).rejects.toThrow();
});
it("keeps exact Cargo identity hashed while removing host paths from portable receipts", async () => {
  const f = await fixture();
  const metadata = JSON.parse(await readFile(f.metadata, "utf8"));
  const original = `path+file://${f.root}/crates/compiled#compiled@1.0.0`;
  metadata.packages[0].id = original;
  metadata.resolve.nodes[0].id = original;
  await writeFile(f.metadata, JSON.stringify(metadata));
  await writeFile(
    f.messages,
    (await readFile(f.messages, "utf8")).replace(
      '"package_id":"compiled"',
      `"package_id":${JSON.stringify(original)}`,
    ),
  );
  const e = await collectCargoEvidence(f);
  const p = e.packages.find((p) => p.name === "compiled")!;
  expect(p.id).toBe("workspace:crates/compiled/Cargo.toml#compiled@1.0.0");
  expect(p.resolvedIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(JSON.stringify(e)).not.toContain(f.root);
});
it("binds Cargo link directives to observed target or host output directories", async () => {
  const f = await fixture();
  const messages = [];
  for (const [packageId, role] of [
    ["compiled", "target"],
    ["build-tool", "build"],
  ] as const) {
    const out = join(
      f.targetDirectory,
      ...(role === "target" ? [f.target] : []),
      "release/build",
      packageId,
      "out",
    );
    await mkdir(out, { recursive: true });
    messages.push({
      reason: "build-script-executed",
      package_id: packageId,
      out_dir: out,
      linked_libs: ["static=external_codec"],
    });
  }
  const previous = await readFile(f.messages, "utf8");
  await writeFile(
    f.messages,
    messages.map((v) => JSON.stringify(v)).join("\n") + "\n" + previous,
  );
  const e = await collectCargoEvidence(f);
  expect(e.linkedLibraries).toEqual([
    { packageId: "compiled", name: "static=external_codec", role: "target" },
    { packageId: "build-tool", name: "static=external_codec", role: "build" },
  ]);
});

import { pinFile } from "../../scripts/native/receipt-contract.js";
import { verifyCandidateCargo } from "../../scripts/native/receipt-cargo.js";
async function replayFixture() {
  const f = await fixture();
  const cargo = await collectCargoEvidence({
    ...f,
    observationMode: "executed",
  });
  const inputs = {
    schemaVersion: 1,
    target: f.target,
    targetDirectory: "target",
    metadata: await pinFile(f.root, "metadata.json"),
    messages: await pinFile(f.root, "messages.jsonl"),
    lock: await pinFile(f.root, "Cargo.lock"),
    invocation: await pinFile(f.root, "invocation.json"),
    shell: await pinFile(f.root, `target/${f.target}/release/openfilm`),
  };
  await writeFile(join(f.root, "cargo-inputs.json"), JSON.stringify(inputs));
  return { f, cargo, inputs, pin: await pinFile(f.root, "cargo-inputs.json") };
}
it("reconstructs the complete Cargo receipt from explicit original input roles", async () => {
  const { f, cargo, pin } = await replayFixture();
  await expect(verifyCandidateCargo(f.root, pin, cargo)).resolves.toEqual(
    cargo,
  );
});
it.each([
  "omitted-compilation",
  "changed-messages-coherent-hashes",
  "generated-output",
  "static-link",
])("rejects %s in derived Cargo inventory", async (fault) => {
  const { f, cargo, inputs } = await replayFixture();
  if (fault === "omitted-compilation") cargo.compilations.pop();
  else {
    const lines = (await readFile(f.messages, "utf8"))
      .split("\n")
      .map((line) => JSON.parse(line));
    if (fault === "changed-messages-coherent-hashes") lines.splice(1, 1);
    else {
      const out = join(f.targetDirectory, f.target, "release/build/generated");
      await mkdir(out, { recursive: true });
      await writeFile(
        join(out, "generated.rs"),
        "pub const GENERATED: bool = true;",
      );
      lines.splice(-1, 0, {
        reason: "build-script-executed",
        package_id: "compiled",
        out_dir: out,
        linked_libs: fault === "static-link" ? ["static=review-required"] : [],
      });
    }
    await writeFile(
      f.messages,
      lines.map((line) => JSON.stringify(line)).join("\n"),
    );
    inputs.messages = await pinFile(f.root, "messages.jsonl");
    cargo.evidenceFiles!.find(
      (file) => file.path === "messages.jsonl",
    )!.sha256 = inputs.messages.sha256;
  }
  await writeFile(join(f.root, "cargo-inputs.json"), JSON.stringify(inputs));
  await expect(
    verifyCandidateCargo(
      f.root,
      await pinFile(f.root, "cargo-inputs.json"),
      cargo,
    ),
  ).rejects.toThrow("Reconstructed Cargo inventory mismatch");
});

it("bounds original compiler references even when the derived inventory omits them", async () => {
  const { f, cargo, inputs } = await replayFixture();
  const lines = (await readFile(f.messages, "utf8"))
    .split("\n")
    .map((line) => JSON.parse(line));
  lines[0].filenames.push(join(f.root, "Cargo.lock"));
  await writeFile(
    f.messages,
    lines.map((line) => JSON.stringify(line)).join("\n"),
  );
  inputs.messages = await pinFile(f.root, "messages.jsonl");
  cargo.evidenceFiles!.find((file) => file.path === "messages.jsonl")!.sha256 =
    inputs.messages.sha256;
  await writeFile(join(f.root, "cargo-inputs.json"), JSON.stringify(inputs));
  await expect(
    verifyCandidateCargo(
      f.root,
      await pinFile(f.root, "cargo-inputs.json"),
      cargo,
    ),
  ).rejects.toThrow("runtime.invalid");
});

import { createHash } from "node:crypto";
import { runtimeHash } from "../../apps/server/src/runtime-manifest.js";
async function portableFixture(
  style: "windows-backslash" | "windows-slash" | "posix",
  external = false,
) {
  const windows = style !== "posix";
  const f = await fixture(
    windows ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu",
  );
  const originalRoot = windows
    ? "C:/agent/open-film"
    : "/original/agent/open-film";
  const registryRoot = windows
    ? "D:/cache/registry"
    : "/original/cache/registry";
  const localRegistry = "retained-registry";
  const stylePath = (path: string) =>
    style === "windows-backslash" ? path.replaceAll("/", "\\") : path;
  const original = (path: string) => {
    const rel = relative(f.root, path).replaceAll("\\", "/");
    return stylePath(
      rel.startsWith(`${localRegistry}/`)
        ? `${registryRoot}/${rel.slice(localRegistry.length + 1)}`
        : `${originalRoot}/${rel}`,
    );
  };
  const metadata = JSON.parse(await readFile(f.metadata, "utf8"));
  const ids = new Map<string, string>();
  for (const p of metadata.packages) {
    const id = `path+file://${windows ? "/" : ""}${originalRoot}/crates/${p.id}#${p.id}@1.0.0`;
    ids.set(p.id, id);
    p.id = id;
  }
  if (external) {
    const location = join(f.root, localRegistry, "compiled");
    await cp(join(f.root, "crates/compiled"), location, { recursive: true });
    const p = metadata.packages[0];
    p.source = "registry+https://github.com/rust-lang/crates.io-index";
    p.id = `${p.source}#compiled@1.0.0`;
    ids.set("compiled", p.id);
    p.manifest_path = join(location, "Cargo.toml");
    const files = Object.fromEntries(
      await Promise.all(
        ["Cargo.toml", "src/lib.rs"].map(async (path) => [
          path,
          await runtimeHash(join(location, path)),
        ]),
      ),
    );
    await writeFile(
      join(location, ".cargo-checksum.json"),
      JSON.stringify({ package: "a".repeat(64), files }),
    );
    await writeFile(
      f.lock,
      `version = 4\n[[package]]\nname = "compiled"\nversion = "1.0.0"\nsource = "${p.source}"\nchecksum = "${"a".repeat(64)}"\n`,
    );
  }
  metadata.resolve.root = ids.get("compiled");
  metadata.workspace_members = [ids.get("compiled")];
  for (const node of metadata.resolve.nodes) node.id = ids.get(node.id);
  metadata.target_directory = f.targetDirectory;
  await writeFile(f.metadata, JSON.stringify(metadata));
  const messages = (await readFile(f.messages, "utf8"))
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const message of messages)
    if (message.package_id) message.package_id = ids.get(message.package_id);
  const generated = join(
    f.targetDirectory,
    f.target,
    "release/build/compiled/out",
  );
  await mkdir(generated, { recursive: true });
  await writeFile(
    join(generated, "generated.rs"),
    "pub const FROM_BUILD: bool = true;",
  );
  messages.splice(-1, 0, {
    reason: "build-script-executed",
    package_id: ids.get("compiled"),
    out_dir: generated,
    linked_libs: ["static=observed"],
  });
  await writeFile(
    f.messages,
    messages.map((line) => JSON.stringify(line)).join("\n"),
  );
  // Construct the platform-neutral expected inventory using the existing
  // collector. These are newly generated synthetic Windows/POSIX fixtures,
  // never modified authentic observations or distribution approval.
  const cargo = await collectCargoEvidence({
    ...f,
    observationMode: "executed",
  });
  for (const p of metadata.packages)
    p.manifest_path = original(p.manifest_path);
  metadata.target_directory = original(f.targetDirectory);
  for (const message of messages) {
    if (message.filenames) message.filenames = message.filenames.map(original);
    if (message.executable) message.executable = original(message.executable);
    if (message.out_dir) message.out_dir = original(message.out_dir);
  }
  await writeFile(f.metadata, JSON.stringify(metadata));
  await writeFile(
    f.messages,
    messages.map((line) => JSON.stringify(line)).join("\n"),
  );
  for (const file of cargo.evidenceFiles!)
    file.sha256 = await runtimeHash(join(f.root, file.path));
  cargo.metadataSha256 = await runtimeHash(f.metadata);
  const inputs = {
    schemaVersion: 1,
    target: f.target,
    targetDirectory: "target",
    metadata: await pinFile(f.root, "metadata.json"),
    messages: await pinFile(f.root, "messages.jsonl"),
    lock: await pinFile(f.root, "Cargo.lock"),
    invocation: await pinFile(f.root, "invocation.json"),
    shell: await pinFile(f.root, `target/${f.target}/release/openfilm`),
    pathMapping: {
      syntax: windows ? "win32" : "posix",
      repositoryRoot: stylePath(originalRoot),
      targetDirectory: original(f.targetDirectory),
      externalRoots: external
        ? [{ originalRoot: stylePath(registryRoot), localRoot: localRegistry }]
        : [],
    },
  };
  const save = async () => {
    await writeFile(join(f.root, "cargo-inputs.json"), JSON.stringify(inputs));
    return pinFile(f.root, "cargo-inputs.json");
  };
  return { f, cargo, inputs, save, ids, metadata, messages, originalRoot };
}
it.each(["windows-backslash", "windows-slash", "posix"] as const)(
  "replays portable %s originals without changing their bytes or raw IDs",
  async (style) => {
    const { f, cargo, save, ids } = await portableFixture(style, true);
    const before = await Promise.all(
      [f.metadata, f.messages].map((path) => readFile(path)),
    );
    const result = await verifyCandidateCargo(f.root, await save(), cargo);
    expect(result).toEqual(cargo);
    expect(result.generatedOutputs).toHaveLength(1);
    expect(result.linkedLibraries).toContainEqual({
      packageId: cargo.shell.packageId,
      name: "static=observed",
      role: "target",
    });
    const rawId = ids.get("macro")!;
    expect(
      result.packages.find((p) => p.name === "macro")!.resolvedIdentitySha256,
    ).toBe(createHash("sha256").update(JSON.stringify(rawId)).digest("hex"));
    expect(
      await Promise.all([f.metadata, f.messages].map((path) => readFile(path))),
    ).toEqual(before);
  },
);

it.each([
  "unknown-root",
  "traversal",
  "metadata-target",
  "symbolic-parent",
  "registry-alias",
  "misbound-original",
  "changed-retained-source",
])(
  "rejects portable replay %s with raw identities still pinned",
  async (fault) => {
    const { f, cargo, inputs, save, metadata } = await portableFixture(
      "windows-backslash",
      true,
    );
    if (
      fault === "unknown-root" ||
      fault === "traversal" ||
      fault === "metadata-target"
    ) {
      if (fault === "unknown-root")
        metadata.packages[1].manifest_path = "Z:/unknown/crate/Cargo.toml";
      if (fault === "traversal")
        metadata.packages[1].manifest_path =
          "C:/agent/open-film/crates/../crates/build-tool/Cargo.toml";
      if (fault === "metadata-target")
        metadata.target_directory = "C:/agent/open-film/other-target";
      await writeFile(f.metadata, JSON.stringify(metadata));
      inputs.metadata = await pinFile(f.root, "metadata.json");
      cargo.metadataSha256 = inputs.metadata.sha256;
      cargo.evidenceFiles!.find((p) => p.path === "metadata.json")!.sha256 =
        inputs.metadata.sha256;
    }
    if (fault === "symbolic-parent") {
      await rename(join(f.root, "crates/macro"), join(f.root, "macro-real"));
      await symlink(
        join(f.root, "macro-real"),
        join(f.root, "crates/macro"),
        "dir",
      );
    }
    if (fault === "registry-alias") {
      await rename(
        join(f.root, "retained-registry"),
        join(f.root, "registry-real"),
      );
      await symlink(
        join(f.root, "registry-real"),
        join(f.root, "retained-registry"),
        "dir",
      );
    }
    if (fault === "misbound-original") await writeFile(f.metadata, "{}");
    if (fault === "changed-retained-source")
      await writeFile(
        join(f.root, "retained-registry/compiled/src/lib.rs"),
        "changed",
      );
    const before = await Promise.all(
      [f.metadata, f.messages].map((path) => readFile(path)),
    );
    const errors: Record<string, RegExp> = {
      "unknown-root": /outside original repository/u,
      traversal: /runtime.invalid/u,
      "metadata-target": /outside original target/u,
      "symbolic-parent": /Symlink in runtime input parent/u,
      "registry-alias": /Symlink in runtime input parent/u,
      "misbound-original": /Pinned evidence hash\/size mismatch/u,
      "changed-retained-source": /Compiled registry source differs/u,
    };
    await expect(
      verifyCandidateCargo(f.root, await save(), cargo),
    ).rejects.toThrow(errors[fault]);
    expect(
      await Promise.all([f.metadata, f.messages].map((path) => readFile(path))),
    ).toEqual(before);
  },
);

it("preserves the default collector's original out-directory alias containment", async () => {
  const f = await fixture();
  const out = join(f.targetDirectory, f.target, "release/build/compiled/out");
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "generated.rs"), "pub const VALUE: u32 = 1;");
  const alias = join(f.root, "out-alias");
  await symlink(out, alias, "dir");
  const lines = (await readFile(f.messages, "utf8"))
    .split("\n")
    .map((line) => JSON.parse(line));
  lines.splice(-1, 0, {
    reason: "build-script-executed",
    package_id: "compiled",
    out_dir: alias,
    linked_libs: [],
  });
  await writeFile(
    f.messages,
    lines.map((line) => JSON.stringify(line)).join("\n"),
  );
  await expect(collectCargoEvidence(f)).rejects.toThrow(
    "Native evidence path outside declared root",
  );
});

it("replays an external Windows build target with the same original derived inventory", async () => {
  const { f, cargo, inputs, metadata, messages, save } = await portableFixture(
    "windows-slash",
    true,
  );
  const originalTarget = "E:/build/output";
  metadata.target_directory = originalTarget;
  inputs.pathMapping.targetDirectory = originalTarget;
  inputs.pathMapping.externalRoots.push({
    originalRoot: originalTarget,
    localRoot: "target",
  });
  const relocate = (path: string) =>
    path.replace("C:/agent/open-film/target", originalTarget);
  for (const message of messages) {
    if (message.filenames) message.filenames = message.filenames.map(relocate);
    if (message.executable) message.executable = relocate(message.executable);
    if (message.out_dir) message.out_dir = relocate(message.out_dir);
  }
  await writeFile(f.metadata, JSON.stringify(metadata));
  await writeFile(
    f.messages,
    messages.map((line) => JSON.stringify(line)).join("\n"),
  );
  inputs.metadata = await pinFile(f.root, "metadata.json");
  inputs.messages = await pinFile(f.root, "messages.jsonl");
  cargo.metadataSha256 = inputs.metadata.sha256;
  for (const pin of [inputs.metadata, inputs.messages])
    cargo.evidenceFiles!.find((file) => file.path === pin.path)!.sha256 =
      pin.sha256;
  const before = await Promise.all(
    [f.metadata, f.messages].map((path) => readFile(path)),
  );
  await expect(
    verifyCandidateCargo(f.root, await save(), cargo),
  ).resolves.toEqual(cargo);
  expect(
    await Promise.all([f.metadata, f.messages].map((path) => readFile(path))),
  ).toEqual(before);
});
