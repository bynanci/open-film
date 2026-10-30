import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectCargoEvidence } from "../../scripts/native/cargo-attribution.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-cargo-attribution-"));
  roots.push(root);
  const target = "x86_64-unknown-linux-gnu",
    targetDirectory = join(root, "target");
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
