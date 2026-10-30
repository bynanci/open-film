export interface PackageIdentity {
  id: string;
  name: string;
  version: string;
  sourceIdentity: string;
  resolvedIdentitySha256?: string;
  license: string;
  source: {
    kind: "workspace" | "npm" | "cargo" | "runtime";
    locator: string;
    packageJsonSha256?: string;
    manifestSha256?: string;
    sourceTreeSha256?: string;
    integrity?: string;
    checksum?: string;
    lockSha256?: string;
  };
  licenseCandidates?: { path: string; sha256: string }[];
}
export interface BuildArtifact {
  path: string;
  sha256: string;
  delivery: "cli" | "service" | "launcher" | "frontend";
  inputs: {
    path: string;
    sha256: string;
    packageId: string;
    bytesInOutput: number | null;
  }[];
  packages: string[];
}
export interface BuildContributions {
  schemaVersion: 1;
  lockSha256: string;
  packages: PackageIdentity[];
  artifacts: BuildArtifact[];
  buildEvidence: { path: string; sha256: string }[];
}
export function identifyPackage(
  repository: string,
  modulePath: string,
): Promise<PackageIdentity>;
export function createBuildContributions(options: {
  repository: string;
  outputs: {
    path: string;
    delivery: BuildArtifact["delivery"];
    inputs: { path: string; bytesInOutput: number }[];
  }[];
  evidence?: string[];
}): Promise<BuildContributions>;
export function verifyBuildContributions(
  contributions: BuildContributions,
  repository: string,
): Promise<void>;
export function recordEsbuildContributions(
  repository: string,
  metafile: unknown,
  delivery: BuildArtifact["delivery"],
  receipt: string,
): Promise<BuildContributions>;
export function buildContributionPlugin(
  repository: string,
): import("vite").Plugin;
export function mergeBuildContributions(
  repository: string,
  paths: string[],
  destination: string,
): Promise<BuildContributions>;
