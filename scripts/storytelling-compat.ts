// SPDX-License-Identifier: Apache-2.0
/** Issue 138 read-only evidence harness. This is not a production SDK client. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const compatibility = Object.freeze({
  openfilm: "08e38b6a63a0b0fbcfd3a073c8bfa5dcc8c08224",
  sdk: "b7fcf869d01727dcf408c457fdd42929dca80c7a",
  sdkVersion: "0.1.0-dev.0",
  exportSchema: "1.0.0",
  catalogSchema: 7,
  profile: "openfilm-finite-v1",
  compiler: "storytelling.planner-otio-visual-ticks.v1",
  executable: false,
});

export interface SdkPin {
  readonly root: string;
  readonly binary: string;
  readonly binarySha256: string;
}
export interface ProbeResult {
  readonly exitCode: 0 | 1;
  /** Preserve the entire SDK line; proposal and OTIO identities bind bytes. */
  readonly stdout: string;
}
export interface ReviewInputs {
  readonly proposal: string;
  readonly snapshot: string;
  readonly context: string;
}

function git(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1_048_576,
  });
  if (result.error || result.status !== 0)
    throw new Error("compat.sdk_revision");
  return result.stdout.trim();
}

/** Explicit binary digest is a local evidence pin, not signed build provenance. */
export function inspectSdk(root: string, binarySha256: string): SdkPin {
  const canonical = resolve(root);
  if (git(canonical, ["rev-parse", "HEAD"]) !== compatibility.sdk)
    throw new Error("compat.sdk_revision");
  if (git(canonical, ["status", "--porcelain", "--untracked-files=no"]))
    throw new Error("compat.sdk_dirty");
  const binary = join(
    canonical,
    "target",
    "debug",
    process.platform === "win32" ? "storytelling.exe" : "storytelling",
  );
  if (
    !/^[a-f0-9]{64}$/u.test(binarySha256) ||
    createHash("sha256").update(readFileSync(binary)).digest("hex") !==
      binarySha256
  )
    throw new Error("compat.binary_identity");
  const version = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024,
    env: { PATH: "" },
  });
  if (
    version.error ||
    version.status !== 0 ||
    version.stdout !== `storytelling ${compatibility.sdkVersion}\n` ||
    version.stderr
  )
    throw new Error("compat.sdk_version");
  return Object.freeze({ root: canonical, binary, binarySha256 });
}

function invoke(pin: SdkPin, args: string[], input: string): ProbeResult {
  // Recheck for changes between probes. No input data becomes an executable argument.
  const checked = inspectSdk(pin.root, pin.binarySha256);
  const output = spawnSync(checked.binary, args, {
    input,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4_292_673,
    env: { PATH: "" },
  });
  if (
    output.error ||
    (output.status !== 0 && output.status !== 1) ||
    output.stderr
  )
    throw new Error("compat.sdk_process");
  const value: unknown = JSON.parse(output.stdout);
  if (
    !value ||
    typeof value !== "object" ||
    !("ok" in value) ||
    typeof value.ok !== "boolean" ||
    output.stdout.split("\n").length !== 2
  )
    throw new Error("compat.sdk_protocol");
  // The SDK returns ok:true with exit 1 for a valid but stale review.
  const stale =
    args[0] === "check-story-review" &&
    value.ok === true &&
    "freshness" in value &&
    value.freshness !== null &&
    typeof value.freshness === "object" &&
    "current" in value.freshness &&
    value.freshness.current === false;
  if (value.ok !== (output.status === 0) && !(output.status === 1 && stale))
    throw new Error("compat.sdk_protocol");
  return { exitCode: output.status, stdout: output.stdout };
}

/** Send the original exporter bytes. Never filter or normalize protected fields. */
export function importProbe(pin: SdkPin, snapshot: string): ProbeResult {
  return invoke(pin, ["import-openfilm", "-"], snapshot);
}

function withReviewFiles<T>(
  inputs: ReviewInputs,
  action: (paths: {
    snapshot: string;
    context: string;
    directory: string;
  }) => T,
): T {
  // Only private copies of caller-supplied declarations are written; no URI is opened.
  const directory = mkdtempSync(
    join(tmpdir(), "openfilm-storytelling-compat-"),
  );
  try {
    const snapshot = join(directory, "snapshot.json");
    const context = join(directory, "context.json");
    writeFileSync(snapshot, inputs.snapshot, { flag: "wx", mode: 0o600 });
    writeFileSync(context, inputs.context, { flag: "wx", mode: 0o600 });
    return action({ snapshot, context, directory });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function checkReviewProbe(
  pin: SdkPin,
  inputs: ReviewInputs & { readonly bundle: string },
): ProbeResult {
  return withReviewFiles(inputs, ({ snapshot, context, directory }) => {
    const bundle = join(directory, "review.json");
    writeFileSync(bundle, inputs.bundle, { flag: "wx", mode: 0o600 });
    return invoke(
      pin,
      ["check-story-review", bundle, "-", snapshot, context],
      inputs.proposal,
    );
  });
}

/** Use the existing SDK planner and pass its complete successful stdout unchanged. */
export function planReviewProbe(
  pin: SdkPin,
  inputs: {
    readonly request: string;
    readonly snapshot: string;
    readonly context: string;
  },
) {
  const proposal = invoke(pin, ["plan-story", "-"], inputs.request);
  if (proposal.exitCode !== 0) throw new Error("compat.planning_rejected");
  const reviewInputs = { ...inputs, proposal: proposal.stdout };
  const review = withReviewFiles(reviewInputs, ({ snapshot, context }) =>
    invoke(
      pin,
      ["prepare-story-review", "-", snapshot, context],
      proposal.stdout,
    ),
  );
  if (review.exitCode !== 0) throw new Error("compat.review_rejected");
  const freshness = checkReviewProbe(pin, {
    ...reviewInputs,
    bundle: review.stdout,
  });
  return { proposal, review, freshness };
}
