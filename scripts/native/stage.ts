// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import { createRequire } from "node:module";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  runtimeHash,
  runtimePath,
  validateRuntimeManifest,
  verifyRuntimeBundle,
  type RuntimeComponent,
  type RuntimeFile,
  type RuntimeManifest,
} from "../../apps/server/src/runtime-manifest.js";
interface InputFile {
  source: string;
  sha256: string;
  version: string;
  license: string;
  licenseFile: string;
  licenseSha256: string;
}
export interface RuntimeInputs {
  distributionReview?: {
    source: string;
    sha256: string;
    systemRequirements: string[];
  };
  dependencyLicenses?: Record<string, { source: string; sha256: string }>;
  appVersion: string;
  platform: RuntimeManifest["platform"];
  architecture: RuntimeManifest["architecture"];
  nodeVersion: string;
  tools: Record<"node" | "ffmpeg" | "ffprobe" | "font", InputFile>;
}
export async function stageRuntime(
  inputs: RuntimeInputs,
  output: string,
  repository = resolve(fileURLToPath(new URL("../..", import.meta.url))),
): Promise<RuntimeManifest> {
  if (
    inputs.platform !== process.platform ||
    inputs.architecture !== process.arch
  )
    throw new Error("Stage on the target platform/architecture");
  output = resolve(output);
  if (output === repository || repository.startsWith(`${output}/`))
    throw new Error("Invalid bundle destination");
  await mkdir(dirname(output), { recursive: true });
  try {
    await lstat(output);
    throw new Error("Bundle destination already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const lock = await open(`${output}.lock`, "wx", 0o600);
  const stage = await mkdtemp(
    join(dirname(output), ".openfilm-runtime-"),
  ).catch(async (error) => {
    await lock.close();
    await rm(`${output}.lock`, { force: true });
    throw error;
  });
  const files: RuntimeFile[] = [];
  let stagedBytes = 0;
  const components: RuntimeComponent[] = [];
  const add = async (
    source: string,
    path: string,
    component: string,
    executable = false,
    expected?: string,
  ) => {
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Runtime inputs must be regular files");
    if (
      info.size > 1024 ** 3 ||
      files.length >= 20000 ||
      stagedBytes + info.size > 4 * 1024 ** 3
    )
      throw new Error("Runtime input exceeds resource limits");
    stagedBytes += info.size;
    const sha256 = await runtimeHash(source);
    if (expected && sha256 !== expected)
      throw new Error("Runtime input hash mismatch");
    const target = runtimePath(stage, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target, constants.COPYFILE_EXCL);
    await chmod(target, executable ? 0o755 : 0o644);
    if ((await runtimeHash(target)) !== sha256)
      throw new Error("Runtime input changed while staging");
    files.push({ path, sha256, size: info.size, executable, component });
  };
  try {
    const entries = {} as RuntimeManifest["entries"];
    for (const id of ["node", "ffmpeg", "ffprobe", "font"] as const) {
      const input = inputs.tools[id];
      if (
        !input ||
        !/^[a-f0-9]{64}$/u.test(input.sha256) ||
        !/^[a-f0-9]{64}$/u.test(input.licenseSha256)
      )
        throw new Error(
          "Pinned input hashes and license receipts are required",
        );
      const path =
        id === "font"
          ? "fonts/default.ttf"
          : `bin/${id}${inputs.platform === "win32" ? ".exe" : ""}`;
      const licenseFile = `licenses/${id}.txt`;
      await add(input.source, path, id, id !== "font", input.sha256);
      await add(input.licenseFile, licenseFile, id, false, input.licenseSha256);
      components.push({
        id,
        version: input.version,
        license: input.license,
        licenseFile,
      });
      entries[id] = path;
    }
    components.push({
      id: "openfilm",
      version: inputs.appVersion,
      license: "Apache-2.0",
      licenseFile: "licenses/openfilm.txt",
    });
    await add(join(repository, "LICENSE"), "licenses/openfilm.txt", "openfilm");
    await add(join(repository, "NOTICE"), "NOTICE", "openfilm");
    entries.service = "service/index.mjs";
    entries.launcher = "launcher.mjs";
    await add(
      join(repository, "dist/server/index.mjs"),
      entries.service,
      "openfilm",
    );
    await add(
      join(repository, "dist/native/launcher.mjs"),
      entries.launcher,
      "openfilm",
    );
    const copied = new Map<string, string>();
    const locate = async (require: NodeJS.Require, id: string) => {
      let cursor = dirname(require.resolve(id));
      for (;;) {
        try {
          const data = JSON.parse(
            await readFile(join(cursor, "package.json"), "utf8"),
          ) as { name?: string };
          if (data.name === id) return cursor;
        } catch {
          /* Walk to this resolved package's root. */
        }
        const parent = dirname(cursor);
        if (parent === cursor)
          throw new Error(`Package metadata missing: ${id}`);
        cursor = parent;
      }
    };
    const copyPackage = async (
      require: NodeJS.Require,
      id: string,
    ): Promise<void> => {
      const root = await realpath(await locate(require, id));
      if (copied.has(id)) {
        if (copied.get(id) !== root)
          throw new Error("Conflicting runtime dependency versions");
        return;
      }
      copied.set(id, root);
      const data = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      ) as {
        version: string;
        license: string;
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const names = await readdir(root);
      const license =
        names.find((name) => /^licen[cs]e(?:\..*)?$/iu.test(name)) ??
        names.find((name) => /^copying/iu.test(name));
      const override = inputs.dependencyLicenses?.[id];
      if (!license && !override)
        throw new Error(
          `License inventory missing: ${id}; provide a reviewed, hash-pinned dependencyLicenses receipt`,
        );
      const licensePath = license
        ? `node_modules/${id}/${license}`
        : `licenses/npm-${id.replaceAll("/", "-").replaceAll("@", "")}.txt`;
      if (!license && override) {
        if (!/^[a-f0-9]{64}$/u.test(override.sha256))
          throw new Error("Pinned dependency license hash is required");
        await add(override.source, licensePath, id, false, override.sha256);
      }
      components.push({
        id,
        version: data.version,
        license: data.license,
        licenseFile: licensePath,
      });
      const walk = async (folder: string, relative: string) => {
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          if (entry.name === "node_modules") continue;
          const source = join(folder, entry.name);
          const path = `${relative}/${entry.name}`;
          const info = await lstat(source);
          if (info.isSymbolicLink())
            throw new Error("Symlink in runtime dependency");
          if (info.isDirectory()) await walk(source, path);
          else await add(source, path, id);
        }
      };
      await walk(root, `node_modules/${id}`);
      const dependencyRequire = createRequire(join(root, "package.json"));
      for (const dependency of Object.keys(data.dependencies ?? {}).sort())
        await copyPackage(dependencyRequire, dependency);
      if (id === "@resvg/resvg-js") {
        const native = Object.keys(data.optionalDependencies ?? {}).filter(
          (name) => name.includes(`-${inputs.platform}-${inputs.architecture}`),
        );
        let selected = false;
        for (const name of native) {
          try {
            dependencyRequire(name);
            await copyPackage(dependencyRequire, name);
            selected = true;
            break;
          } catch {
            /* Select only an installed binary that loads on this host. */
          }
        }
        if (!selected)
          throw new Error("Compatible resvg native dependency missing");
      }
    };
    const require = createRequire(join(repository, "package.json"));
    await copyPackage(require, "fontkit");
    await copyPackage(require, "@resvg/resvg-js");
    files.sort((a, b) => a.path.localeCompare(b.path, "en"));
    components.sort((a, b) => a.id.localeCompare(b.id, "en"));
    if (inputs.distributionReview) {
      if (!/^[a-f0-9]{64}$/u.test(inputs.distributionReview.sha256))
        throw new Error("Pinned distribution review receipt is required");
      await add(
        inputs.distributionReview.source,
        "licenses/distribution-review.txt",
        "openfilm",
        false,
        inputs.distributionReview.sha256,
      );
      files.sort((a, b) => a.path.localeCompare(b.path, "en"));
    }
    const manifest = validateRuntimeManifest({
      schemaVersion: 1,
      appVersion: inputs.appVersion,
      nodeVersion: inputs.nodeVersion,
      platform: inputs.platform,
      architecture: inputs.architecture,
      projectSchema: "1.0.0",
      entries,
      components,
      files,
      updates: { mode: "manual", automatic: false, signatureRequired: true },
      optionalCapabilities: { exiftool: false, whisper: false },
      distribution: inputs.distributionReview
        ? {
            status: "reviewed",
            systemRequirements: inputs.distributionReview.systemRequirements,
            receipt: "licenses/distribution-review.txt",
          }
        : {
            status: "test-only",
            systemRequirements: [
              "Unverified host libraries - not for distribution",
            ],
            receipt: null,
          },
    });
    await writeFile(
      join(stage, "runtime-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx", mode: 0o644 },
    );
    await writeFile(
      join(stage, "sbom.spdx.json"),
      `${JSON.stringify({ spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: "OpenFilm-runtime", documentNamespace: `https://openfilm.org/runtime/${await runtimeHash(join(stage, "runtime-manifest.json"))}`, creationInfo: { creators: ["Tool: OpenFilm runtime stage"], created: "1970-01-01T00:00:00Z" }, packages: components.map((component, index) => ({ SPDXID: `SPDXRef-Package-${index}`, name: component.id, versionInfo: component.version, downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: component.license, copyrightText: "NOASSERTION" })), files: files.map((file, index) => ({ SPDXID: `SPDXRef-File-${index}`, fileName: file.path, checksums: [{ algorithm: "SHA256", checksumValue: file.sha256 }], licenseConcluded: "NOASSERTION", copyrightText: "NOASSERTION" })) }, null, 2)}\n`,
      { flag: "wx", mode: 0o644 },
    );
    const sbomPath = join(stage, "sbom.spdx.json");
    files.push({
      path: "sbom.spdx.json",
      sha256: await runtimeHash(sbomPath),
      size: (await lstat(sbomPath)).size,
      executable: false,
      component: "openfilm",
    });
    files.sort((a, b) => a.path.localeCompare(b.path, "en"));
    validateRuntimeManifest(manifest);
    await writeFile(
      join(stage, "runtime-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o644 },
    );
    await verifyRuntimeBundle(stage);
    await rename(stage, output);
    return manifest;
  } finally {
    await rm(stage, { recursive: true, force: true });
    await lock.close();
    await rm(`${output}.lock`, { force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error(
      "Usage: stage.ts <pinned-inputs.json> <new-output-directory>",
    );
  const manifest = await stageRuntime(
    JSON.parse(await readFile(input, "utf8")) as RuntimeInputs,
    output,
  );
  console.log(
    JSON.stringify({
      schemaVersion: manifest.schemaVersion,
      platform: manifest.platform,
      architecture: manifest.architecture,
      files: manifest.files.length,
    }),
  );
}
