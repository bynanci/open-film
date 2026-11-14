import type { Writable } from "node:stream";

export type NativePlatform = "linux" | "darwin" | "win32";
export type NativeArchitecture = "x64" | "arm64";

export interface NativeTargetPaths {
  target: string;
  targetDirectory: string;
  shellPath: string;
  bundleDirectory: string;
}

export interface CargoBuildCapture {
  schemaVersion: 1;
  kind: "native-cargo-build-capture";
  candidateSha: string;
  target: string;
  rustcVersion: string;
  cargoVersion: string;
  invocation: { path: string; sha256: string };
  metadata: {
    path: string;
    sha256: string;
    targetDirectory: string;
    recordedTargetDirectory: string;
    recordedWorkspaceRoot: string;
    targetInputsDirectory: string;
  };
  metadataInvocation: { path: string; sha256: string };
  metadataStderr: { path: string; sha256: string };
  compilerMessages: { path: string; sha256: string };
  compilerStderr: { path: string; sha256: string };
  toolchain: { path: string; sha256: string };
  lock: { path: string; sha256: string };
  shell: { path: string; sha256: string; size: number };
  targetInputs: {
    path: string;
    capturePath: string;
    size: number;
    sha256: string;
  }[];
}

export interface CargoBuildCaptureOptions {
  root: string;
  cwd: string;
  target: string;
  targetDirectory: string;
  shellPath: string;
  lockfile: string;
  captureDirectory?: string;
  candidateSha: string;
  headSha: string;
  rustcVersion?: string;
  cargoVersion?: string;
  args: string[];
  command: string;
  commandPrefix?: string[];
  environment?: NodeJS.ProcessEnv;
  stdout?: Writable;
  stderr?: Writable;
  metadataStdout?: Writable;
  metadataStderr?: Writable;
  maxBuildStdoutBytes?: number;
  maxBuildStderrBytes?: number;
  maxMetadataStdoutBytes?: number;
  maxMetadataStderrBytes?: number;
  maxTargetInputFileBytes?: number;
  maxTargetInputTotalBytes?: number;
  beforeTargetInputCopy?: (input: {
    path: string;
    source: string;
    size: number;
  }) => void | Promise<void>;
}

export function resolveNativeTarget(
  runner: { platform: NativePlatform; architecture: NativeArchitecture },
  runtime: { platform: NativePlatform; architecture: NativeArchitecture },
  root: string,
): NativeTargetPaths;

export function metadataArgsForCargo(
  args: string[],
  cwd: string,
  target: string,
): string[];

export function captureCargoBuild(
  options: CargoBuildCaptureOptions,
): Promise<CargoBuildCapture>;
