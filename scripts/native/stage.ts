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
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
import {
  readPinnedJson,
  verifyLinkageInputs,
  type LinkageInputs,
  type PinnedReceipt,
  type LinkageEvidence,
} from "./linkage.js";
import {
  identifyPackage,
  type BuildContributions,
  type PackageIdentity,
} from "../build-attribution.mjs";
import {
  createDistributionAttribution,
  runtimeComponentIdentity,
  type LicenseReceipt,
} from "./attribution.js";
import { assertBinaryArchitecture, assertRegularInput } from "./input-files.js";
import { getExclusiveDirectoryRenamer } from "../../packages/application/src/exclusive-directory-rename.js";

// Full upstream notices reviewed from the integrity-pinned Koffi3.3.3 tarball.
// The host binary package omits these texts; ship its matching MIT receipt and
// both Node API header notices from the complete core package.
const koffiNotices = [
  [
    "LICENSE.txt",
    "22bcbbbacd739b026a8dc484f62a31484ce4c4e31f3408b60b29b4e41d62b290",
  ],
  [
    "vendor/node-addon-api/LICENSE.md",
    "89024017b88a9f2b763f79b941a4f2db3b4428edfcacdc0b23866b2da633ad0c",
  ],
  [
    "vendor/node-api-headers/LICENSE",
    "a553508f516031c91f3af1148d44970cb81bbae6c4f091be6835d39cc252238c",
  ],
] as const;
export interface ToolSupportFile extends Omit<InputFile, "supportFiles"> {
  id: string;
  /** Relative to the owning tool's bin/ directory. No parent traversal. */
  destination: string;
  executable: boolean;
}
export interface InputFile {
  source: string;
  sha256: string;
  version: string;
  license: string;
  licenseFile: string;
  licenseSha256: string;
  supportFiles?: ToolSupportFile[];
}
export interface RuntimeInputs {
  distributionReview?: {
    source: string;
    sha256: string;
    systemRequirements: string[];
  };
  linkage?: LinkageInputs;
  attribution?: {
    buildContributions: PinnedReceipt;
    licenseReceipts?: PinnedReceipt;
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
  const renameDirectory = await getExclusiveDirectoryRenamer();
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
  const destinations = new Map<string, string>();
  const nativePaths = new Set<string>();
  let stagedBytes = 0;
  const components: RuntimeComponent[] = [];
  const runtimePackages: Record<string, PackageIdentity> = {};
  let hasFrozenLock = false;
  try {
    await lstat(join(repository, "pnpm-lock.yaml"));
    hasFrozenLock = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const add = async (
    source: string,
    path: string,
    component: string,
    executable = false,
    expected?: string,
  ) => {
    runtimePath(stage, path);
    for (
      let cursor = path;
      cursor;
      cursor = cursor.includes("/")
        ? cursor.slice(0, cursor.lastIndexOf("/"))
        : ""
    ) {
      const prior = destinations.get(cursor.toLowerCase());
      if (prior && (prior !== cursor || cursor === path))
        throw new Error("Conflicting runtime destination");
      destinations.set(cursor.toLowerCase(), cursor);
    }
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Runtime inputs must be regular files");
    if (
      info.size > 1024 ** 3 ||
      files.length >= 20000 ||
      stagedBytes + info.size > 4 * 1024 ** 3
    )
      throw new Error("Runtime input exceeds resource limits");
    if (await assertBinaryArchitecture(source, inputs.architecture))
      nativePaths.add(path);
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
      if (id !== "font")
        await assertBinaryArchitecture(input.source, inputs.architecture, true);
      await add(input.source, path, id, id !== "font", input.sha256);
      await add(input.licenseFile, licenseFile, id, false, input.licenseSha256);
      components.push({
        id,
        version: input.version,
        license: input.license,
        licenseFile,
      });
      entries[id] = path;
      if (
        (input.supportFiles?.length ?? 0) > 32 ||
        (id === "font" && input.supportFiles?.length)
      )
        throw new Error("Too many support files or unsupported font sidecars");
      for (const support of input.supportFiles ?? []) {
        if (
          !/^[a-z0-9][a-z0-9._-]{0,39}$/u.test(support.id) ||
          !/^[a-f0-9]{64}$/u.test(support.sha256) ||
          !/^[a-f0-9]{64}$/u.test(support.licenseSha256) ||
          typeof support.executable !== "boolean"
        )
          throw new Error("Invalid pinned tool support file");
        runtimePath("/support", support.destination);
        const owner = `tool:${id}:${support.id}`;
        if (components.some((component) => component.id === owner))
          throw new Error("Duplicate support owner");
        await assertRegularInput(support.source);
        await assertRegularInput(support.licenseFile);
        if ((await lstat(support.licenseFile)).size === 0)
          throw new Error("Missing full support license notice");
        await assertBinaryArchitecture(
          support.source,
          inputs.architecture,
          support.executable,
        );
        const notice = `licenses/tool-${id}-${support.id}.txt`;
        await add(
          support.source,
          `bin/${support.destination}`,
          owner,
          support.executable,
          support.sha256,
        );
        await add(
          support.licenseFile,
          notice,
          owner,
          false,
          support.licenseSha256,
        );
        components.push({
          id: owner,
          version: support.version,
          license: support.license,
          licenseFile: notice,
        });
      }
    }
    components.push({
      id: "openfilm",
      version: inputs.appVersion,
      license: "Apache-2.0",
      licenseFile: "licenses/openfilm.txt",
    });
    await add(join(repository, "LICENSE"), "licenses/openfilm.txt", "openfilm");
    await add(join(repository, "NOTICE"), "NOTICE", "openfilm");
    const copyGrants = async (folder: string, path: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const source = join(folder, entry.name),
          destination = `${path}/${entry.name}`;
        if (entry.isSymbolicLink())
          throw new Error("Link in historical grant inventory");
        if (entry.isDirectory()) await copyGrants(source, destination);
        else await add(source, destination, "openfilm");
      }
    };
    try {
      await copyGrants(join(repository, "LICENSES"), "licenses/historical");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
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
      if (hasFrozenLock)
        runtimePackages[id] = await identifyPackage(
          repository,
          join(root, "package.json"),
        );
      const data = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      ) as {
        version: string;
        license: string;
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const names = await readdir(root);
      const koffiNativeId = `@koromix/koffi-${inputs.platform}-${inputs.architecture}`;
      if (id === "koffi" || id === koffiNativeId) {
        if (data.version !== "3.3.3" || data.license !== "MIT")
          throw new Error("Unreviewed Koffi runtime version or license");
      }
      if (id === "koffi")
        for (const [path, sha256] of koffiNotices)
          if ((await runtimeHash(join(root, path))) !== sha256)
            throw new Error("Reviewed Koffi license notice hash mismatch");
      const license =
        names.find((name) => /^licen[cs]e(?:\..*)?$/iu.test(name)) ??
        names.find((name) => /^copying/iu.test(name));
      const override =
        id === koffiNativeId
          ? {
              source: join(copied.get("koffi")!, "LICENSE.txt"),
              sha256: koffiNotices[0][1],
            }
          : inputs.dependencyLicenses?.[id];
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
          else {
            const expected =
              id === "koffi"
                ? koffiNotices.find(
                    ([name]) => path === `node_modules/koffi/${name}`,
                  )?.[1]
                : undefined;
            await add(source, path, id, false, expected);
          }
        }
      };
      await walk(root, `node_modules/${id}`);
      const dependencyRequire = createRequire(join(root, "package.json"));
      for (const dependency of Object.keys(data.dependencies ?? {}).sort())
        await copyPackage(dependencyRequire, dependency);
      if (id === "koffi") {
        // Require the same fixed host package the audited loader actually used;
        // source-build/resourcesPath fallbacks must not hide an unbundled addon.
        const nativeRoot = await realpath(
          await locate(dependencyRequire, koffiNativeId),
        );
        const koffi = dependencyRequire("koffi") as { version?: string };
        const loaded = Object.keys(dependencyRequire.cache).filter((path) => {
          const rel = relative(nativeRoot, path);
          return (
            path.endsWith(".node") && !isAbsolute(rel) && !rel.startsWith("..")
          );
        });
        if (
          data.optionalDependencies?.[koffiNativeId] !== "3.3.3" ||
          koffi.version !== "3.3.3" ||
          loaded.length !== 1
        )
          throw new Error("Compatible Koffi host native dependency missing");
        await copyPackage(dependencyRequire, koffiNativeId);
      }
      if (id === "@resvg/resvg-js") {
        const native = Object.keys(data.optionalDependencies ?? {}).filter(
          (name) => name.includes(`-${inputs.platform}-${inputs.architecture}`),
        );
        let selected = false;
        for (const name of native) {
          try {
            await locate(dependencyRequire, name);
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
    await copyPackage(require, "koffi");
    files.sort((a, b) => a.path.localeCompare(b.path, "en"));
    components.sort((a, b) => a.id.localeCompare(b.id, "en"));
    if (inputs.distributionReview && !inputs.linkage)
      throw new Error(
        "Executed target linkage evidence required for distribution review",
      );
    let linkage: LinkageEvidence | undefined;
    if (inputs.linkage) {
      linkage = await verifyLinkageInputs(
        inputs.linkage,
        files,
        nativePaths,
        inputs,
        inputs.distributionReview?.sha256,
      );
      await add(
        inputs.linkage.policy.source,
        "receipts/linkage-policy.json",
        "openfilm",
        false,
        inputs.linkage.policy.sha256,
      );
      await add(
        inputs.linkage.evidence.source,
        "receipts/linkage-evidence.json",
        "openfilm",
        false,
        inputs.linkage.evidence.sha256,
      );
    }
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
    let build: BuildContributions | undefined;
    const contributionInput = inputs.attribution?.buildContributions;
    if (contributionInput)
      build = await readPinnedJson<BuildContributions>(contributionInput);
    else {
      const source = join(repository, "dist/build-contributions.json");
      try {
        build = await readPinnedJson<BuildContributions>({
          source,
          sha256: await runtimeHash(source),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const licenses = inputs.attribution?.licenseReceipts
      ? await readPinnedJson<LicenseReceipt[]>(
          inputs.attribution.licenseReceipts,
        )
      : [];
    const firstParty = [
      runtimeComponentIdentity(manifest, "openfilm"),
      ...(build?.packages ?? []).filter((p) => p.source.kind === "workspace"),
    ];
    for (const p of firstParty)
      if (!licenses.some((r) => r.packageId === p.id))
        licenses.push({
          packageId: p.id,
          sourceIdentity: p.sourceIdentity,
          reviewed: true,
          licenseConcluded: "Apache-2.0",
          texts: [
            {
              source: join(repository, "LICENSE"),
              sha256: await runtimeHash(join(repository, "LICENSE")),
              origin: "repository:LICENSE",
            },
          ],
          obligations: [
            {
              kind: "notice",
              file: {
                source: join(repository, "NOTICE"),
                sha256: await runtimeHash(join(repository, "NOTICE")),
                origin: "repository:NOTICE",
              },
            },
          ],
        });
    const attribution = await createDistributionAttribution(
      build,
      undefined,
      manifest,
      licenses,
      { repository, runtimePackages, linkage },
    );
    if (
      inputs.distributionReview &&
      attribution.runtimeReviewStatus !== "ready-for-independent-review"
    )
      throw new Error(
        `Distribution attribution is blocked: ${attribution.blockers.join("; ")}`,
      );
    for (const notice of attribution.notices)
      await add(
        notice.source,
        notice.destination,
        "openfilm",
        false,
        notice.sha256,
      );
    const writeReceipt = async (path: string, data: unknown) => {
      const target = runtimePath(stage, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, {
        flag: "wx",
        mode: 0o644,
      });
      files.push({
        path,
        sha256: await runtimeHash(target),
        size: (await lstat(target)).size,
        executable: false,
        component: "openfilm",
      });
    };
    if (build) await writeReceipt("receipts/build-contributions.json", build);
    const { spdx, notices, ...report } = attribution;
    await writeReceipt("receipts/attribution.json", {
      scope: "runtime",
      ...report,
      notices: notices.map(({ source: _source, ...notice }) => notice),
    });
    await writeFile(
      join(stage, "sbom.spdx.json"),
      `${JSON.stringify(spdx, null, 2)}\n`,
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
    renameDirectory(stage, output);
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
