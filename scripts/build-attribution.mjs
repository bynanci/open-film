// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hash = async (path) => digest(await readFile(path));
const normalize = (path) => path.replaceAll("\\", "/");
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
          .join(",")}}`
      : JSON.stringify(value);
function inside(repository, path) {
  const value = normalize(relative(repository, path));
  if (
    !value ||
    value.startsWith("../") ||
    isAbsolute(value) ||
    value.includes("\0")
  )
    throw new Error("Contribution outside repository");
  return value;
}
async function frozenLock(repository) {
  const bytes = await readFile(join(repository, "pnpm-lock.yaml"));
  try {
    const installed = await readFile(
      join(repository, "node_modules/.pnpm/lock.yaml"),
    );
    if (!installed.equals(bytes))
      throw new Error(
        "Installed dependency lock differs from frozen source lock",
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { bytes, sha256: digest(bytes) };
}
function registryIntegrity(lock, name, version) {
  const packages = lock
    .toString()
    .split(/^packages:\s*$/m)[1]
    ?.split(/^snapshots:/m)[0];
  if (!packages) throw new Error("Frozen package inventory missing");
  const blocks = [
    ...packages.matchAll(/^ {2}(.+):\r?\n((?: {4}[^\n]*\n|\s*\n)*)/gm),
  ];
  const matching = blocks.filter(
    ([, key]) => key.replace(/^['"]|['"]$/g, "") === `${name}@${version}`,
  );
  if (matching.length !== 1)
    throw new Error(`Unresolved frozen package: ${name}@${version}`);
  const integrity =
    /^ {4}resolution: \{integrity: (sha(?:256|512)-[A-Za-z0-9+/=]+)\}\s*$/m.exec(
      matching[0][2],
    )?.[1];
  if (!integrity)
    throw new Error(
      `Unsupported or unfrozen package source: ${name}@${version}`,
    );
  return integrity;
}
async function moduleSource(repository, identifier) {
  if (identifier.startsWith("\0")) {
    const owner =
      identifier === "\0esbuild/runtime"
        ? "esbuild"
        : identifier === "\0plugin-vue:export-helper"
          ? "@vitejs/plugin-vue"
          : identifier.startsWith("\0vite/")
            ? "vite"
            : identifier.startsWith("\0rolldown/") ||
                identifier.includes("commonjsHelpers")
              ? "rolldown"
              : null;
    if (!owner)
      throw new Error(
        `Unknown generated contributor: ${JSON.stringify(identifier)}`,
      );
    const require = createRequire(join(repository, "package.json"));
    return {
      absolute: await realpath(require.resolve(owner)),
      path: `generated:${identifier.slice(1)}`,
      generated: true,
    };
  }
  const path = identifier.replace(/\?.*$/u, "");
  const absolute = await realpath(resolve(repository, path));
  const info = await lstat(absolute);
  if (!info.isFile()) throw new Error("Non-file build contributor");
  return { absolute, path: inside(repository, absolute), generated: false };
}
export async function identifyPackage(repository, modulePath) {
  repository = await realpath(repository);
  const absolute = await realpath(resolve(repository, modulePath));
  inside(repository, absolute);
  let cursor = dirname(absolute),
    data,
    bytes;
  for (;;) {
    try {
      bytes = await readFile(join(cursor, "package.json"));
      data = JSON.parse(bytes);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (cursor === repository)
      throw new Error("Build contributor package metadata missing");
    const parent = dirname(cursor);
    if (parent === cursor)
      throw new Error("Build contributor outside package roots");
    cursor = parent;
  }
  if (!data.name || !data.version)
    throw new Error("Unidentified build package");
  const lock = await frozenLock(repository);
  const root = inside(repository, join(cursor, "package.json"));
  const thirdParty = root.includes("node_modules/");
  const source = {
    kind: thirdParty ? "npm" : "workspace",
    locator: `${data.name}@${data.version}`,
    packageJsonSha256: digest(bytes),
    lockSha256: lock.sha256,
  };
  if (thirdParty)
    source.integrity = registryIntegrity(lock.bytes, data.name, data.version);
  else if (data.name !== "openfilm" && !data.name.startsWith("@openfilm/"))
    throw new Error("Unreviewed non-workspace contributor");
  const sourceIdentity = digest(canonical(source));
  const licenseCandidates = [];
  for (const entry of await readdir(cursor, { withFileTypes: true }))
    if (
      entry.isFile() &&
      /^(?:licen[cs]e|copying|notice|copyright)(?:[.-].*)?$/iu.test(entry.name)
    )
      licenseCandidates.push({
        path: inside(repository, join(cursor, entry.name)),
        sha256: await hash(join(cursor, entry.name)),
      });
  return {
    id: `${source.kind}:${data.name}@${data.version}:${sourceIdentity}`,
    name: data.name,
    version: data.version,
    sourceIdentity,
    source,
    license: typeof data.license === "string" ? data.license : "NOASSERTION",
    licenseCandidates,
  };
}
export async function createBuildContributions({
  repository,
  outputs,
  evidence = [],
}) {
  repository = await realpath(repository);
  const lock = await frozenLock(repository),
    packages = new Map(),
    artifacts = [];
  if (!Array.isArray(outputs) || !outputs.length || outputs.length > 2000)
    throw new Error("Missing emitted artifact inventory");
  const paths = new Set();
  for (const output of outputs) {
    const absolute = resolve(repository, output.path),
      path = inside(repository, absolute);
    if (paths.has(path.toLowerCase()))
      throw new Error("Duplicate emitted artifact");
    paths.add(path.toLowerCase());
    const inputs = [];
    for (const input of output.inputs.filter(
      (input) => input.bytesInOutput > 0,
    )) {
      const module = await moduleSource(repository, input.path);
      const owner = await identifyPackage(repository, module.absolute);
      packages.set(owner.id, owner);
      inputs.push({
        path: module.path,
        sha256: await hash(module.absolute),
        packageId: owner.id,
        bytesInOutput:
          module.path === "generated:esbuild/runtime"
            ? null
            : input.bytesInOutput,
      });
    }
    if (!inputs.length)
      throw new Error(
        `Emitted artifact has no attributed contributor: ${path}`,
      );
    artifacts.push({
      path,
      sha256: await hash(absolute),
      delivery: output.delivery,
      inputs: inputs.sort((a, b) => a.path.localeCompare(b.path, "en")),
      packages: [...new Set(inputs.map((x) => x.packageId))].sort(),
    });
  }
  return {
    schemaVersion: 1,
    lockSha256: lock.sha256,
    packages: [...packages.values()].sort((a, b) =>
      a.id.localeCompare(b.id, "en"),
    ),
    artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path, "en")),
    buildEvidence: await Promise.all(
      evidence.map(async (path) => ({
        path: inside(repository, resolve(repository, path)),
        sha256: await hash(resolve(repository, path)),
      })),
    ),
  };
}
export async function verifyBuildContributions(contributions, repository) {
  if (
    contributions.schemaVersion !== 1 ||
    (await frozenLock(repository)).sha256 !== contributions.lockSha256
  )
    throw new Error("Stale build lock identity");
  const packageIds = new Set(contributions.packages.map((x) => x.id));
  if (packageIds.size !== contributions.packages.length)
    throw new Error("Duplicate contribution package identity");
  for (const artifact of contributions.artifacts) {
    inside(repository, resolve(repository, artifact.path));
    if ((await hash(resolve(repository, artifact.path))) !== artifact.sha256)
      throw new Error("Stale emitted artifact hash");
    const found = new Set();
    for (const input of artifact.inputs) {
      let module;
      if (input.path.startsWith("generated:"))
        module = await moduleSource(repository, "\0" + input.path.slice(10));
      else module = await moduleSource(repository, input.path);
      const actual = await identifyPackage(repository, module.absolute),
        declared = contributions.packages.find((x) => x.id === input.packageId);
      if (
        (await hash(module.absolute)) !== input.sha256 ||
        !declared ||
        canonical(actual) !== canonical(declared)
      )
        throw new Error("Changed source/package contribution identity");
      found.add(actual.id);
    }
    if (
      !found.size ||
      canonical([...found].sort()) !== canonical([...artifact.packages].sort())
    )
      throw new Error("Incomplete emitted package mapping");
  }
  const rawOutputs = [];
  for (const file of contributions.buildEvidence) {
    const path = resolve(repository, file.path);
    inside(repository, path);
    if ((await hash(path)) !== file.sha256)
      throw new Error("Changed raw build contribution evidence");
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (file.path.endsWith(".metafile.json")) {
      for (const [output, data] of Object.entries(raw.outputs)) {
        if (output.endsWith(".map")) continue;
        const artifact = contributions.artifacts.find(
          (x) => x.path === normalize(output),
        );
        if (!artifact)
          throw new Error("Missing artifact from raw build evidence");
        const recipe = raw.openfilmAttribution;
        if (
          !recipe ||
          !["cli", "service", "launcher"].includes(recipe.delivery) ||
          recipe.generator?.name !== "esbuild" ||
          recipe.generator.version !==
            createRequire(import.meta.url)("esbuild/package.json").version
        )
          throw new Error("Missing raw esbuild recipe identity");
        rawOutputs.push(
          await esbuildOutput(repository, output, data, recipe.delivery),
        );
      }
    } else if (file.path.endsWith(".modules.json")) rawOutputs.push(...raw);
    else throw new Error("Unknown raw build contribution evidence");
  }
  if (rawOutputs.length) {
    const rebuilt = await createBuildContributions({
      repository,
      outputs: rawOutputs,
    });
    if (
      canonical(rebuilt.artifacts) !== canonical(contributions.artifacts) ||
      canonical(rebuilt.packages) !== canonical(contributions.packages)
    )
      throw new Error(
        "Contribution inventory differs from raw emitted module evidence",
      );
  }
}
async function save(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}
async function esbuildOutput(repository, path, data, delivery) {
  const inputs = Object.entries(data.inputs).map(([path, value]) => ({
    path,
    bytesInOutput: value.bytesInOutput,
  }));
  const preamble = (await readFile(resolve(repository, path), "utf8")).split(
    /^\/\/ /mu,
    1,
  )[0];
  // These builds keep esbuild's unminified source markers. Its injected runtime
  // precedes the first module marker; a presence record has no invented size.
  if (/^var __[A-Za-z][A-Za-z0-9]* =/mu.test(preamble))
    inputs.push({ path: "\0esbuild/runtime", bytesInOutput: 1 });
  return { path, delivery, inputs };
}
export async function recordEsbuildContributions(
  repository,
  metafile,
  delivery,
  receipt,
) {
  const raw = receipt.replace(/\.json$/u, ".metafile.json");
  const version = createRequire(import.meta.url)(
    "esbuild/package.json",
  ).version;
  await save(resolve(repository, raw), {
    ...metafile,
    openfilmAttribution: { delivery, generator: { name: "esbuild", version } },
  });
  const outputs = await Promise.all(
    Object.entries(metafile.outputs)
      .filter(([path]) => !path.endsWith(".map"))
      .map(([path, data]) => esbuildOutput(repository, path, data, delivery)),
  );
  const result = await createBuildContributions({
    repository,
    outputs,
    evidence: [raw],
  });
  await save(resolve(repository, receipt), result);
  return result;
}
/** Records actual emitted chunks, including runtime helpers injected by Vite. */
export function buildContributionPlugin(repository) {
  return {
    name: "openfilm-build-contributions",
    apply: "build",
    async writeBundle(options, bundle) {
      const outputs = [];
      for (const [name, output] of Object.entries(bundle)) {
        const path = normalize(
          relative(repository, resolve(options.dir, name)),
        );
        if (output.type === "chunk")
          outputs.push({
            path,
            delivery: "frontend",
            inputs: Object.entries(output.modules).map(([path, module]) => ({
              path,
              bytesInOutput: module.renderedLength ?? module.code?.length ?? 0,
            })),
          });
        else {
          const originals = output.originalFileNames?.length
            ? output.originalFileNames
            : output.originalFileName
              ? [output.originalFileName]
              : [];
          const inputs = originals.map((path) => ({
            path: resolve(repository, "apps/desktop", path),
            bytesInOutput: 1,
          }));
          // Vite's generated HTML derives from the exact application HTML entry.
          if (!inputs.length && name === "index.html")
            inputs.push({
              path: resolve(repository, "apps/desktop/index.html"),
              bytesInOutput: 1,
            });
          if (!inputs.length)
            throw new Error(`Unknown emitted asset contributors: ${name}`);
          outputs.push({ path, delivery: "frontend", inputs });
        }
      }
      const raw = "dist/attribution/desktop.modules.json";
      await save(resolve(repository, raw), outputs);
      const result = await createBuildContributions({
        repository,
        outputs,
        evidence: [raw],
      });
      await save(resolve(repository, "dist/attribution/desktop.json"), result);
    },
  };
}
export async function mergeBuildContributions(repository, paths, destination) {
  const packages = new Map(),
    artifacts = [],
    buildEvidence = [];
  const lock = await frozenLock(repository);
  for (const path of paths) {
    const data = JSON.parse(await readFile(resolve(repository, path), "utf8"));
    await verifyBuildContributions(data, repository);
    if (data.lockSha256 !== lock.sha256)
      throw new Error("Mixed build lock identities");
    for (const pkg of data.packages) {
      if (
        packages.has(pkg.id) &&
        canonical(packages.get(pkg.id)) !== canonical(pkg)
      )
        throw new Error("Conflicting package identity");
      packages.set(pkg.id, pkg);
    }
    artifacts.push(...data.artifacts);
    buildEvidence.push(...data.buildEvidence);
  }
  if (
    new Set(artifacts.map((x) => x.path.toLowerCase())).size !==
    artifacts.length
  )
    throw new Error("Duplicate merged build artifact");
  const result = {
    schemaVersion: 1,
    lockSha256: lock.sha256,
    packages: [...packages.values()].sort((a, b) =>
      a.id.localeCompare(b.id, "en"),
    ),
    artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path, "en")),
    buildEvidence,
  };
  await save(resolve(repository, destination), result);
  return result;
}
