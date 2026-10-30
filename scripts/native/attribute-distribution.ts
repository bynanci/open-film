// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
// Native-shell receipts are external to the manifest embedded by that shell.
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import {
  runtimeHash,
  runtimePath,
  verifyRuntimeBundle,
} from "../../apps/server/src/runtime-manifest.js";
import type {
  BuildContributions,
  PackageIdentity,
} from "../build-attribution.mjs";
import {
  createDistributionAttribution,
  type AttributionEvidence,
  type CargoEvidence,
  type LicenseReceipt,
  type NativeRuntimeInput,
} from "./attribution.js";
import {
  readPinnedJson,
  type LinkageEvidence,
  type PinnedReceipt,
} from "./linkage.js";
import { assertRegularInput } from "./input-files.js";
export interface DistributionAttributionInputs {
  repository: string;
  runtimeRoot: string;
  runtimeManifestSha256: string;
  buildContributions: PinnedReceipt;
  cargo: PinnedReceipt;
  licenseReceipts: PinnedReceipt;
  nativeLinkage?: PinnedReceipt;
  nativeRuntimeInputs?: PinnedReceipt;
  targetDirectory?: string;
}
/** Both separator and volume rules must belong to the actual target host. */
export function insideRuntime(
  runtimeRoot: string,
  output: string,
  platform: "win32" | "posix" = process.platform === "win32"
    ? "win32"
    : "posix",
): boolean {
  const paths = platform === "win32" ? win32 : posix;
  const relative = paths.relative(runtimeRoot, output);
  return (
    relative === "" ||
    (!paths.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${paths.sep}`))
  );
}
/** Resolve the nearest existing ancestor even when the output does not exist. */
async function canonicalOutput(output: string): Promise<string> {
  let parent = resolve(output);
  const suffix: string[] = [];
  for (;;) {
    try {
      const details = await lstat(parent);
      const canonical = await realpath(parent);
      if (!details.isDirectory() && !details.isSymbolicLink())
        throw new Error("Attribution output parent must be a directory");
      return resolve(canonical, ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A dangling alias cannot be treated as a missing ordinary directory.
      try {
        if ((await lstat(parent)).isSymbolicLink())
          throw new Error("Attribution output alias cannot be resolved", {
            cause: error,
          });
      } catch (detailsError) {
        if ((detailsError as NodeJS.ErrnoException).code !== "ENOENT")
          throw detailsError;
      }
      const next = dirname(parent);
      if (next === parent) throw error;
      suffix.unshift(basename(parent));
      parent = next;
    }
  }
}
export async function attributeDistribution(
  inputs: DistributionAttributionInputs,
  output: string,
): Promise<AttributionEvidence> {
  const runtimeRoot = await realpath(inputs.runtimeRoot);
  output = await canonicalOutput(output);
  if (insideRuntime(runtimeRoot, output))
    throw new Error("Post-build attribution must be outside the runtime");
  const manifest = await verifyRuntimeBundle(inputs.runtimeRoot, {
    manifestSha256: inputs.runtimeManifestSha256,
  });
  const build = await readPinnedJson<BuildContributions>(
    inputs.buildContributions,
  );
  const cargo = await readPinnedJson<CargoEvidence>(inputs.cargo);
  const receipts = await readPinnedJson<LicenseReceipt[]>(
    inputs.licenseReceipts,
  );
  const runtimeReport = JSON.parse(
    await readFile(
      runtimePath(inputs.runtimeRoot, "receipts/attribution.json"),
      "utf8",
    ),
  ) as AttributionEvidence;
  const runtimePackages: Record<string, PackageIdentity> = {};
  for (const component of manifest.components) {
    const p = runtimeReport.packages.find(
      (p) =>
        p.name === component.id &&
        p.version === component.version &&
        p.source.kind === "npm",
    );
    if (p) {
      const packageFile = manifest.files.find(
        (file) => file.path === `node_modules/${component.id}/package.json`,
      );
      if (
        p.source.lockSha256 !== build.lockSha256 ||
        p.source.packageJsonSha256 !== packageFile?.sha256
      )
        throw new Error("Runtime npm source identity mismatch");
      runtimePackages[component.id] = p;
    }
  }
  const linkage = JSON.parse(
    await readFile(
      runtimePath(inputs.runtimeRoot, "receipts/linkage-evidence.json"),
      "utf8",
    ),
  ) as LinkageEvidence;
  const nativeLinkage = inputs.nativeLinkage
    ? await readPinnedJson<LinkageEvidence>(inputs.nativeLinkage)
    : undefined;
  const nativeRuntimeInputs = inputs.nativeRuntimeInputs
    ? await readPinnedJson<NativeRuntimeInput[]>(inputs.nativeRuntimeInputs)
    : undefined;
  const result = await createDistributionAttribution(
    build,
    cargo,
    manifest,
    receipts,
    {
      repository: inputs.repository,
      runtimePackages,
      linkage,
      nativeLinkage,
      nativeRuntimeInputs,
      targetDirectory: inputs.targetDirectory,
    },
  );
  output = await canonicalOutput(output);
  if (insideRuntime(runtimeRoot, output))
    throw new Error("Post-build attribution must be outside the runtime");
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  for (const notice of result.notices) {
    await assertRegularInput(notice.source, false);
    if ((await runtimeHash(notice.source)) !== notice.sha256)
      throw new Error("Native attribution notice changed before copy");
    const destination = runtimePath(output, notice.destination);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(notice.source, destination, constants.COPYFILE_EXCL);
    if ((await runtimeHash(destination)) !== notice.sha256)
      throw new Error("Native attribution notice changed while copying");
  }
  const receiptFiles = [];
  for (const [path, data] of [
    ["cargo-attribution.json", cargo],
    ["build-contributions.json", build],
    ...(nativeLinkage ? [["native-linkage.json", nativeLinkage]] : []),
  ] as const) {
    await writeFile(
      join(output, path as string),
      JSON.stringify(data, null, 2) + "\n",
      { flag: "wx" },
    );
    receiptFiles.push({
      path,
      sha256: await runtimeHash(join(output, path as string)),
    });
  }
  const { notices, spdx, ...report } = result;
  await writeFile(
    join(output, "attribution.json"),
    JSON.stringify(
      {
        scope: "native-distribution",
        runtimeManifestSha256: inputs.runtimeManifestSha256,
        ...report,
        receiptFiles,
        notices: notices.map(({ source: _source, ...notice }) => notice),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  await writeFile(
    join(output, "sbom.spdx.json"),
    JSON.stringify(spdx, null, 2) + "\n",
    { flag: "wx" },
  );
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error(
      "Usage: attribute-distribution.ts <local-inputs.json> <new-evidence-directory>",
    );
  const inputs = JSON.parse(
    await readFile(input, "utf8"),
  ) as DistributionAttributionInputs;
  const evidence = await attributeDistribution(inputs, output);
  console.log(
    JSON.stringify({
      reviewStatus: evidence.reviewStatus,
      distributionApproved: false,
      blockers: evidence.blockers.length,
    }),
  );
  if (evidence.reviewStatus === "blocked") process.exitCode = 1;
}
