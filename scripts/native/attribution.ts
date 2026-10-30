// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import {
  verifyBuildContributions,
  type BuildContributions,
  type PackageIdentity,
} from "../build-attribution.mjs";
import {
  runtimeHash,
  runtimePath,
  type RuntimeManifest,
} from "../../apps/server/src/runtime-manifest.js";
import { canonicalJson, type LinkageEvidence } from "./linkage.js";
export interface EvidenceFile {
  source: string;
  sha256: string;
  origin: string;
}
export interface LicenseReceipt {
  packageId: string;
  sourceIdentity: string;
  reviewed: boolean;
  licenseConcluded: string;
  texts: EvidenceFile[];
  obligations: {
    kind:
      | "notice"
      | "notice-not-present"
      | "bundled-notices"
      | "build-configuration"
      | "corresponding-source"
      | "source-offer"
      | "modified-source"
      | "reserved-font-names"
      | "relinking"
      | "other-obligations"
      | "generated-output-review";
    file: EvidenceFile;
    artifactSha256?: string[];
    contributesToTarget?: boolean;
  }[];
}
export interface NativeRuntimeInput {
  family: "rust-sysroot" | "static-native";
  identity: PackageIdentity;
  artifactSha256: string[];
  inventory: EvidenceFile;
}
export interface CargoEvidence {
  schemaVersion: 1;
  observationMode: "executed" | "fixture";
  target: string;
  metadataSha256: string;
  lockSha256: string;
  packages: PackageIdentity[];
  compilations: {
    packageId: string;
    role: "target" | "build" | "proc-macro";
    artifacts: { path: string; sha256: string }[];
  }[];
  shell: { path: string; sha256: string; packageId: string };
  generatedOutputs: { packageId: string; path: string; sha256: string }[];
  evidenceFiles?: { path: string; sha256: string }[];
  linkedLibraries?: { packageId: string; name: string }[];
  compiler?: { rustcVersion: string; invocationSha256: string };
}
export interface AttributedPackage extends PackageIdentity {
  uses: string[];
  licenseConcluded: string;
  licenseFiles: string[];
  artifactSha256: string[];
}
export interface AttributionEvidence {
  schemaVersion: 1;
  reviewStatus: "blocked" | "ready-for-independent-review";
  runtimeReviewStatus: "blocked" | "ready-for-independent-review";
  distributionApproved: false;
  buildContributionsSha256: string | null;
  cargoEvidenceSha256: string | null;
  packages: AttributedPackage[];
  artifacts: {
    path: string;
    sha256: string;
    delivery: string;
    packages: string[];
  }[];
  systemDependencies: unknown[];
  blockers: string[];
  notices: {
    source: string;
    destination: string;
    sha256: string;
    origin: string;
    packageId: string;
  }[];
  spdx: {
    spdxVersion: string;
    dataLicense: string;
    SPDXID: string;
    name: string;
    documentNamespace: string;
    creationInfo: { creators: string[]; created: string };
    packages: {
      SPDXID: string;
      name: string;
      versionInfo: string;
      downloadLocation: string;
      filesAnalyzed: boolean;
      licenseConcluded: string;
      licenseDeclared: string;
      copyrightText: string;
      sourceInfo: string;
    }[];
    files: {
      SPDXID: string;
      fileName: string;
      checksums: { algorithm: string; checksumValue: string }[];
      licenseConcluded: string;
      copyrightText: string;
    }[];
    relationships: {
      spdxElementId: string;
      relationshipType: string;
      relatedSpdxElement: string;
    }[];
  };
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const spdxId = (kind: string, value: string) =>
  `SPDXRef-${kind}-${digest(value)}`;
const isHash = (value: string) => /^[a-f0-9]{64}$/u.test(value);
export function runtimeComponentIdentity(
  manifest: RuntimeManifest,
  id: string,
): PackageIdentity {
  const component = manifest.components.find((x) => x.id === id)!;
  const source = {
    kind: "runtime" as const,
    locator: id,
    checksum: digest(
      manifest.files
        .filter(
          (x) =>
            x.component === id &&
            !x.path.startsWith("receipts/") &&
            !x.path.startsWith("licenses/attribution/") &&
            x.path !== "sbom.spdx.json",
        )
        .map((x) => ({ path: x.path, sha256: x.sha256 }))
        .sort((a, b) => a.path.localeCompare(b.path, "en")),
    ),
  };
  return {
    id,
    name: id,
    version: component.version,
    license: component.license,
    sourceIdentity: digest(source),
    source,
  };
}
export async function createDistributionAttribution(
  build: BuildContributions | undefined,
  cargo: CargoEvidence | undefined,
  manifest: RuntimeManifest,
  receipts: LicenseReceipt[],
  options: {
    repository: string;
    runtimePackages?: Record<string, PackageIdentity>;
    linkage?: LinkageEvidence;
    nativeLinkage?: LinkageEvidence;
    nativeRuntimeInputs?: NativeRuntimeInput[];
    targetDirectory?: string;
  },
): Promise<AttributionEvidence> {
  const blockers: string[] = [],
    packages = new Map<string, AttributedPackage>(),
    artifacts: AttributionEvidence["artifacts"] = [],
    notices: AttributionEvidence["notices"] = [];
  const add = (
    identity: PackageIdentity,
    use: string,
    hashes: string[] = [],
  ) => {
    const previous = packages.get(identity.id);
    if (previous && previous.sourceIdentity !== identity.sourceIdentity)
      throw new Error("Conflicting package source identity");
    const value = previous ?? {
      ...identity,
      uses: [],
      licenseConcluded: "NOASSERTION",
      licenseFiles: [],
      artifactSha256: [],
    };
    if (!value.uses.includes(use)) value.uses.push(use);
    value.artifactSha256 = [
      ...new Set([...value.artifactSha256, ...hashes]),
    ].sort();
    packages.set(value.id, value);
  };
  if (build) {
    await verifyBuildContributions(build, options.repository);
    if (!build.buildEvidence.length)
      blockers.push("raw-build-contribution-evidence-missing");
    for (const artifact of build.artifacts) {
      if (artifact.delivery === "cli") continue;
      artifacts.push({
        path: artifact.path,
        sha256: artifact.sha256,
        delivery: artifact.delivery,
        packages: artifact.packages,
      });
      for (const id of artifact.packages) {
        const p = build.packages.find((x) => x.id === id);
        if (!p) throw new Error("Unknown emitted contributor");
        add(p, "bundled-javascript", [artifact.sha256]);
      }
    }
    for (const p of build.packages)
      if (!packages.has(p.id)) add(p, "unshipped-artifact");
    for (const [delivery, entry] of [
      ["service", "service"],
      ["launcher", "launcher"],
    ] as const) {
      const artifact = build.artifacts.find((x) => x.delivery === delivery),
        payload = manifest.files.find(
          (x) => x.path === manifest.entries[entry],
        );
      if (!artifact || !payload || payload.sha256 !== artifact.sha256)
        blockers.push(`runtime-${delivery}-contribution-mismatch`);
    }
    if (!build.artifacts.some((x) => x.delivery === "frontend"))
      blockers.push("frontend-contributions-missing");
  } else blockers.push("build-contributions-missing");
  for (const component of manifest.components) {
    const identity =
      options.runtimePackages?.[component.id] ??
      runtimeComponentIdentity(manifest, component.id);
    const payload = manifest.files.filter((x) => x.component === component.id);
    add(
      identity,
      "copied-runtime",
      payload
        .filter(
          (x) =>
            x.path !== component.licenseFile &&
            !x.path.startsWith("licenses/") &&
            !x.path.startsWith("receipts/") &&
            x.path !== "sbom.spdx.json",
        )
        .map((x) => x.sha256),
    );
    if (
      identity.source.kind === "runtime" &&
      payload.some((x) => x.path.startsWith("node_modules/"))
    )
      blockers.push(`${identity.id}: frozen-runtime-package-identity-missing`);
  }
  if (cargo) {
    const expectedTarget = `${manifest.architecture === "x64" ? "x86_64" : "aarch64"}-${manifest.platform === "linux" ? "unknown-linux-gnu" : manifest.platform === "darwin" ? "apple-darwin" : "pc-windows-msvc"}`;
    if (
      cargo.schemaVersion !== 1 ||
      cargo.target !== expectedTarget ||
      !isHash(cargo.metadataSha256) ||
      !isHash(cargo.lockSha256)
    )
      throw new Error("Native target identity mismatch");
    if (cargo.observationMode !== "executed")
      blockers.push("native-build-evidence-is-fixture");
    else {
      if (!cargo.evidenceFiles?.length)
        blockers.push("native-raw-build-evidence-missing");
      for (const file of [
        ...(cargo.evidenceFiles ?? []),
        cargo.shell,
        ...cargo.compilations.flatMap((x) => x.artifacts),
        ...cargo.generatedOutputs,
      ]) {
        const targetRoot =
          file.path.startsWith("target/") && options.targetDirectory
            ? options.targetDirectory
            : options.repository;
        const path =
          targetRoot === options.targetDirectory
            ? file.path.slice(7)
            : file.path;
        if (
          !isHash(file.sha256) ||
          (await runtimeHash(runtimePath(targetRoot, path))) !== file.sha256
        )
          throw new Error("Stale native build artifact/evidence hash");
      }
    }
    const compiledIds = new Set(cargo.compilations.map((x) => x.packageId));
    for (const compilation of cargo.compilations) {
      const p = cargo.packages.find((x) => x.id === compilation.packageId);
      if (!p) throw new Error("Unidentified compiled Rust input");
      add(
        p,
        compilation.role === "target" ? "compiled-target" : "build-only",
        compilation.role === "target" ? [cargo.shell.sha256] : [],
      );
      if (compilation.role === "proc-macro") {
        const review = receipts
          .find(
            (r) =>
              r.packageId === p.id &&
              r.sourceIdentity === p.sourceIdentity &&
              r.reviewed,
          )
          ?.obligations.find(
            (r) =>
              r.kind === "generated-output-review" &&
              typeof r.contributesToTarget === "boolean" &&
              [
                cargo.shell.sha256,
                ...compilation.artifacts.map((a) => a.sha256),
              ].every((hash) => r.artifactSha256?.includes(hash)),
          );
        if (
          !review ||
          !(await lstat(review.file.source)).isFile() ||
          !review.file.origin ||
          (await runtimeHash(review.file.source)) !== review.file.sha256
        )
          blockers.push(
            `native-proc-macro-generated-code-review-required:${p.id}`,
          );
        else {
          if (review.contributesToTarget)
            add(p, "generated-target-input", [cargo.shell.sha256]);
          const destination = `licenses/attribution/${digest(p.id)}/${review.file.sha256}.txt`;
          notices.push({
            source: review.file.source,
            destination,
            sha256: review.file.sha256,
            origin: review.file.origin,
            packageId: p.id,
          });
          packages.get(p.id)!.licenseFiles.push(destination);
        }
      }
    }
    for (const p of cargo.packages)
      if (!compiledIds.has(p.id)) add(p, "platform-inactive");
    if (
      !cargo.compilations.some(
        (x) =>
          x.packageId === cargo.shell.packageId &&
          x.role === "target" &&
          x.artifacts.some((x) => x.sha256 === cargo.shell.sha256),
      )
    )
      blockers.push("native-shell-compiler-artifact-binding-missing");
    artifacts.push({
      ...cargo.shell,
      delivery: "native-shell",
      packages: [
        ...new Set(
          cargo.compilations
            .filter((x) => x.role === "target")
            .map((x) => x.packageId),
        ),
      ],
    });
    for (const output of cargo.generatedOutputs) {
      const owner = cargo.packages.find((p) => p.id === output.packageId);
      const review = receipts
        .find(
          (r) =>
            r.packageId === output.packageId &&
            r.sourceIdentity === owner?.sourceIdentity &&
            r.reviewed,
        )
        ?.obligations.find(
          (r) =>
            r.kind === "generated-output-review" &&
            r.artifactSha256?.includes(output.sha256) &&
            typeof r.contributesToTarget === "boolean",
        );
      const reviewFileValid =
        review &&
        (await lstat(review.file.source)).isFile() &&
        (await runtimeHash(review.file.source)) === review.file.sha256 &&
        !!review.file.origin;
      if (!review || !owner || !reviewFileValid)
        blockers.push(
          `native-generated-output-review-required:${output.packageId}:${output.sha256}`,
        );
      else if (review.contributesToTarget)
        add(owner, "generated-target-input", [cargo.shell.sha256]);
    }
    let sysrootCovered = false;
    for (const input of options.nativeRuntimeInputs ?? []) {
      if (
        !input.artifactSha256.includes(cargo.shell.sha256) ||
        input.identity.source.checksum !== input.inventory.sha256 ||
        !isHash(input.inventory.sha256) ||
        !input.inventory.origin ||
        (await runtimeHash(input.inventory.source)) !== input.inventory.sha256
      ) {
        blockers.push(
          `native-runtime-input-source-or-artifact-mismatch:${input.identity.id}`,
        );
        continue;
      }
      add(input.identity, "compiled-target", [cargo.shell.sha256]);
      if (input.family === "rust-sysroot") sysrootCovered = true;
      const destination = `licenses/attribution/${digest(input.identity.id)}/${input.inventory.sha256}.txt`;
      notices.push({
        source: input.inventory.source,
        destination,
        sha256: input.inventory.sha256,
        origin: input.inventory.origin,
        packageId: input.identity.id,
      });
      packages.get(input.identity.id)!.licenseFiles.push(destination);
    }
    if (!sysrootCovered)
      blockers.push("native-rust-sysroot-contribution-review-required");
    const shellAttribution = artifacts.find(
      (artifact) => artifact.delivery === "native-shell",
    )!;
    shellAttribution.packages = [...packages.values()]
      .filter((p) =>
        p.uses.some((use) =>
          ["compiled-target", "generated-target-input"].includes(use),
        ),
      )
      .map((p) => p.id)
      .sort();
    if (
      !options.nativeLinkage ||
      options.nativeLinkage.observationMode !== "executed" ||
      options.nativeLinkage.platform !== manifest.platform ||
      options.nativeLinkage.architecture !== manifest.architecture ||
      !options.nativeLinkage.binaries.some(
        (binary) => binary.sha256 === cargo.shell.sha256,
      )
    )
      blockers.push("native-shell-linkage-evidence-missing");
  } else blockers.push("native-build-evidence-missing");
  const shipped = (p: AttributedPackage) =>
    p.uses.some((x) =>
      [
        "bundled-javascript",
        "copied-runtime",
        "compiled-target",
        "generated-target-input",
      ].includes(x),
    );
  for (const p of packages.values()) {
    if (!shipped(p)) continue;
    const matching = receipts.filter((x) => x.packageId === p.id);
    if (matching.length !== 1) {
      blockers.push(`${p.id}: reviewed-license-receipt-missing-or-duplicate`);
      continue;
    }
    const r = matching[0]!;
    if (
      r.sourceIdentity !== p.sourceIdentity ||
      r.reviewed !== true ||
      !r.licenseConcluded ||
      /NOASSERTION|unknown|unlicensed|nonfree/iu.test(r.licenseConcluded) ||
      !r.texts.length
    ) {
      blockers.push(`${p.id}: incomplete-license-or-source-identity`);
      continue;
    }
    if (
      r.licenseConcluded !== p.license &&
      !p.license
        .replace(/[()]/gu, "")
        .split(" OR ")
        .includes(r.licenseConcluded)
    ) {
      blockers.push(`${p.id}: license-conclusion-does-not-match-declaration`);
      continue;
    }
    const required: string[][] = [];
    if (/Apache-/u.test(r.licenseConcluded))
      required.push(["notice", "notice-not-present"]);
    if (/(?:^|\W)(?:L?GPL)-/u.test(r.licenseConcluded))
      required.push(["corresponding-source", "source-offer"]);
    if (/LGPL-/u.test(r.licenseConcluded)) required.push(["relinking"]);
    if (/MPL-/u.test(r.licenseConcluded))
      required.push(["corresponding-source", "modified-source"]);
    if (/OFL-/u.test(r.licenseConcluded))
      required.push(["reserved-font-names"]);
    if (p.name === "node") required.push(["bundled-notices"]);
    if (/^(?:ffmpeg|ffprobe)$/u.test(p.name))
      required.push(["build-configuration"]);
    if (
      !/^(?:(?:MIT|ISC|0BSD|BSD-[23]-Clause|Apache-2\.0|MPL-2\.0|OFL-1\.1|GPL-[23]\.0-(?:only|or-later)|LGPL-(?:2\.1|3\.0)-(?:only|or-later)|Unicode-(?:3\.0|DFS-2016)|CC0-1\.0)(?: (?:OR|AND) )?)+$/u.test(
        r.licenseConcluded,
      )
    )
      required.push(["other-obligations"]);
    let complete = true;
    for (const alternatives of required)
      if (!r.obligations.some((x) => alternatives.includes(x.kind))) {
        blockers.push(
          `${p.id}: missing-${alternatives.join("-or-")}-obligation`,
        );
        complete = false;
      }
    if (p.name === "koffi" || p.name.startsWith("@koromix/koffi-"))
      for (const expected of [
        "22bcbbbacd739b026a8dc484f62a31484ce4c4e31f3408b60b29b4e41d62b290",
        "89024017b88a9f2b763f79b941a4f2db3b4428edfcacdc0b23866b2da633ad0c",
        "a553508f516031c91f3af1148d44970cb81bbae6c4f091be6835d39cc252238c",
      ])
        if (!r.texts.some((x) => x.sha256 === expected)) {
          blockers.push(`${p.id}: full-koffi-notices-missing`);
          complete = false;
        }
    const sourceKinds = [
      "corresponding-source",
      "source-offer",
      "modified-source",
      "build-configuration",
      "relinking",
    ];
    for (const obligation of r.obligations)
      if (
        sourceKinds.includes(obligation.kind) &&
        !p.artifactSha256.every((hash) =>
          obligation.artifactSha256?.includes(hash),
        )
      ) {
        blockers.push(`${p.id}: source-obligation-not-bound-to-artifacts`);
        complete = false;
      }
    const evidence = [...r.texts, ...r.obligations.map((x) => x.file)];
    if (evidence.length > 40) throw new Error("Unbounded license evidence");
    const hashes = new Set<string>();
    for (const text of evidence) {
      const info = await lstat(text.source);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        !info.size ||
        info.size > 8 * 1024 ** 2 ||
        !text.origin?.trim() ||
        !isHash(text.sha256) ||
        (await runtimeHash(text.source)) !== text.sha256
      ) {
        blockers.push(`${p.id}: missing-full-or-stale-notice`);
        complete = false;
        continue;
      }
      if (hashes.has(text.sha256)) continue;
      hashes.add(text.sha256);
      const destination = `licenses/attribution/${digest(p.id)}/${text.sha256}.txt`;
      notices.push({
        source: text.source,
        destination,
        sha256: text.sha256,
        origin: text.origin,
        packageId: p.id,
      });
      p.licenseFiles.push(destination);
    }
    if (complete) p.licenseConcluded = r.licenseConcluded;
  }
  const uniqueNotices = [
    ...new Map(notices.map((notice) => [notice.destination, notice])).values(),
  ];
  notices.splice(0, notices.length, ...uniqueNotices);
  for (const p of packages.values())
    p.licenseFiles = [...new Set(p.licenseFiles)].sort();
  const systemDependencies = options.linkage
    ? [
        {
          baseline: options.linkage.baseline,
          imports: [
            ...new Set(
              options.linkage.binaries.flatMap((x) =>
                x.resolved
                  .filter((x) => x.kind === "system")
                  .map((x) => x.baselineImport),
              ),
            ),
          ],
        },
      ]
    : [];
  if (
    !options.linkage ||
    options.linkage.observationMode !== "executed" ||
    !options.linkage.verified ||
    options.linkage.platform !== manifest.platform ||
    options.linkage.architecture !== manifest.architecture
  )
    blockers.push("executed-linkage-evidence-missing");
  const packageList = [...packages.values()].sort((a, b) =>
    a.id.localeCompare(b.id, "en"),
  );
  const files = new Map<string, { path: string; sha256: string }>();
  for (const file of [
    ...manifest.files,
    ...artifacts,
    ...notices.map((x) => ({ path: x.destination, sha256: x.sha256 })),
  ]) {
    const previous = files.get(file.path);
    if (previous && previous.sha256 !== file.sha256)
      throw new Error("Conflicting artifact attribution hash");
    files.set(file.path, file);
  }
  for (const linkage of [options.linkage, options.nativeLinkage].filter(
    (value): value is LinkageEvidence => value !== undefined,
  ))
    for (const binary of linkage.binaries) {
      const path =
        artifacts.find((artifact) => artifact.sha256 === binary.sha256)?.path ??
        binary.path;
      const previous = files.get(path);
      if (previous && previous.sha256 !== binary.sha256)
        throw new Error("Conflicting linked native artifact hash");
      files.set(path, { path, sha256: binary.sha256 });
    }
  const spdx: AttributionEvidence["spdx"] = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "OpenFilm distribution inputs",
    documentNamespace: `https://openfilm.org/attribution/${digest([...files.values()].sort((a, b) => a.path.localeCompare(b.path, "en")))}`,
    creationInfo: {
      creators: ["Tool: OpenFilm emitted distribution attribution"],
      created: "1970-01-01T00:00:00Z",
    },
    packages: [],
    files: [],
    relationships: [],
  };
  for (const p of packageList.filter(shipped)) {
    const id = spdxId("Package", p.id);
    spdx.packages.push({
      SPDXID: id,
      name: p.name,
      versionInfo: p.version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: p.licenseConcluded,
      licenseDeclared: p.license,
      copyrightText: "NOASSERTION",
      sourceInfo: canonicalJson({
        identity: p.sourceIdentity,
        source: p.source,
        uses: p.uses,
      }),
    });
    spdx.relationships.push({
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: id,
    });
    for (const notice of p.licenseFiles)
      spdx.relationships.push({
        spdxElementId: id,
        relationshipType: "CONTAINS",
        relatedSpdxElement: spdxId("File", notice),
      });
  }
  for (const file of [...files.values()].sort((a, b) =>
    a.path.localeCompare(b.path, "en"),
  ))
    spdx.files.push({
      SPDXID: spdxId("File", file.path),
      fileName: file.path,
      checksums: [{ algorithm: "SHA256", checksumValue: file.sha256 }],
      licenseConcluded: "NOASSERTION",
      copyrightText: "NOASSERTION",
    });
  for (const linkage of [options.linkage, options.nativeLinkage].filter(
    (value): value is LinkageEvidence => value !== undefined,
  )) {
    const baseline = digest(linkage.baseline);
    for (const binary of linkage.binaries)
      for (const imported of binary.resolved) {
        const filePath =
          artifacts.find((artifact) => artifact.sha256 === binary.sha256)
            ?.path ?? binary.path;
        if (imported.kind === "bundled" && imported.path)
          spdx.relationships.push({
            spdxElementId: spdxId("File", filePath),
            relationshipType: "DEPENDS_ON",
            relatedSpdxElement: spdxId(
              "File",
              artifacts.find(
                (artifact) =>
                  artifact.sha256 ===
                  linkage.binaries.find(
                    (binary) => binary.path === imported.path,
                  )?.sha256,
              )?.path ?? imported.path,
            ),
          });
        else if (imported.baselineImport) {
          const id = spdxId("System", `${baseline}:${imported.baselineImport}`);
          if (!spdx.packages.some((p) => p.SPDXID === id))
            spdx.packages.push({
              SPDXID: id,
              name: imported.baselineImport,
              versionInfo: linkage.baseline.build,
              downloadLocation: "NOASSERTION",
              filesAnalyzed: false,
              licenseConcluded: "NOASSERTION",
              licenseDeclared: "NOASSERTION",
              copyrightText: "NOASSERTION",
              sourceInfo: canonicalJson({
                externalSystemDependency: true,
                baseline: linkage.baseline,
              }),
            });
          spdx.relationships.push({
            spdxElementId: spdxId("File", filePath),
            relationshipType: "DEPENDS_ON",
            relatedSpdxElement: id,
          });
        }
      }
  }
  for (const artifact of artifacts)
    for (const id of artifact.packages)
      spdx.relationships.push({
        spdxElementId: spdxId("File", artifact.path),
        relationshipType: "GENERATED_FROM",
        relatedSpdxElement: spdxId("Package", id),
      });
  for (const file of manifest.files) {
    const p = packageList.find(
      (x) =>
        options.runtimePackages?.[file.component]?.id === x.id ||
        file.component === x.id,
    );
    if (p)
      spdx.relationships.push({
        spdxElementId: spdxId("Package", p.id),
        relationshipType: "CONTAINS",
        relatedSpdxElement: spdxId("File", file.path),
      });
  }
  if (options.linkage?.baseline.reviewed !== true)
    blockers.push("reviewed-os-baseline-missing");
  const runtimeBlockers = blockers.filter(
    (message) =>
      !message.startsWith("native-") &&
      !packageList.some(
        (p) =>
          !p.uses.some((x) =>
            ["copied-runtime", "bundled-javascript"].includes(x),
          ) && message.startsWith(`${p.id}:`),
      ),
  );
  return {
    schemaVersion: 1,
    reviewStatus: blockers.length ? "blocked" : "ready-for-independent-review",
    runtimeReviewStatus: runtimeBlockers.length
      ? "blocked"
      : "ready-for-independent-review",
    distributionApproved: false,
    buildContributionsSha256: build ? digest(build) : null,
    cargoEvidenceSha256: cargo ? digest(cargo) : null,
    packages: packageList,
    artifacts,
    systemDependencies,
    blockers: [...new Set(blockers)].sort(),
    notices,
    spdx,
  };
}
