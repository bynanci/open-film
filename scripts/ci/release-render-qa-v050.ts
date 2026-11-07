// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pins from "../../fixtures/render-qa/toolchain.json";
import policy from "../../fixtures/render-qa/v050-policy.json";
import { releaseV050RenderQaTestFiles } from "../../tests/render-qa-v050/test-files.js";
import {
  admitBrewFormula,
  admitRequiredQaFilters,
  verifyPinnedBytes,
} from "./render-qa-tools.js";

export { type RenderQaToolReceipt as ReleaseV050ToolReceipt } from "./setup-render-qa.js";
export {
  admitBrewFormula as admitReleaseV050BrewFormula,
  admitRequiredQaFilters as admitReleaseV050RequiredFilters,
  verifyPinnedBytes as verifyReleaseV050PinnedBytes,
} from "./render-qa-tools.js";

export const releaseV050RenderQaPlatforms = [
  "linux-x64",
  "win32-x64",
  "darwin-arm64",
] as const;
export type ReleaseV050RenderQaPlatform =
  (typeof releaseV050RenderQaPlatforms)[number];

export { releaseV050RenderQaTestFiles };

const sha256Pattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const manifestBytes = readFileSync(
  new URL("../../fixtures/render-qa/toolchain.json", import.meta.url),
);
const policyBytes = readFileSync(
  new URL("../../fixtures/render-qa/v050-policy.json", import.meta.url),
);
export const releaseV050ToolchainSha256 = createHash("sha256")
  .update(manifestBytes)
  .digest("hex");
export const releaseV050PolicySha256 = createHash("sha256")
  .update(policyBytes)
  .digest("hex");

export interface ReleaseV050RenderQaReport {
  schemaVersion: 1;
  candidateSha: string;
  runId: string;
  runAttempt: string;
  platformId: ReleaseV050RenderQaPlatform;
  toolchainManifestSha256: string;
  admittedPackageSha256: string;
  dependenciesSha256: string;
  fontSourceCommit: string;
  policySha256: string;
  workingTreeDirty: boolean;
  host: {
    osRelease: string;
    runnerImage: string;
    nodeVersion: string;
    pnpmVersion: string;
    pythonVersion: string;
  };
  tools: {
    ffmpeg: { version: string; sha256: string; configurationSha256: string };
    ffprobe: { version: string; sha256: string; configurationSha256: string };
  };
  fonts: {
    sansRegular: string;
    sansBold: string;
    serifRegular: string;
    serifBold: string;
    license: string;
  };
  suite: {
    files: Array<{
      path: string;
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      todo: number;
    }>;
  };
  render: {
    sources: Array<{
      id: string;
      beforeSha256: string;
      afterSha256: string;
    }>;
    outputSha256: string;
    width: number;
    height: number;
    frameRate: { numerator: number; denominator: number };
    frameCount: number;
    pts: Array<{ frame: number; seconds: number }>;
    rgbSamples: Array<{
      frame: number;
      expected: number[];
      actual: number[];
    }>;
    audio: {
      codec: string;
      sampleRate: number;
      channels: number;
      decodedSampleFrames: number;
    };
  };
  workstationVerified: false;
}

export interface ReleaseV050RenderQaExpected {
  candidateSha: string;
  runId: string;
  runAttempt: string;
  toolchainManifestSha256: string;
  policySha256: string;
  jobResults: Record<ReleaseV050RenderQaPlatform, string>;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fail(message: string): never {
  throw new Error(`v0.5.0 Render QA evidence ${message}`);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}
function boundedInt(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function expectedColors() {
  return policy.rgbSamples as Array<{ frame: number; expected: number[] }>;
}
function expectedPts() {
  return policy.ptsSamples as Array<{ frame: number; seconds: number }>;
}
function validatePlatformReport(
  value: unknown,
  expected: ReleaseV050RenderQaExpected,
): asserts value is ReleaseV050RenderQaReport {
  if (!object(value)) fail("must be an object");
  if (
    !exactKeys(value, [
      "schemaVersion",
      "candidateSha",
      "runId",
      "runAttempt",
      "platformId",
      "toolchainManifestSha256",
      "admittedPackageSha256",
      "dependenciesSha256",
      "fontSourceCommit",
      "policySha256",
      "workingTreeDirty",
      "host",
      "tools",
      "fonts",
      "suite",
      "render",
      "workstationVerified",
    ])
  )
    fail("contains unexpected fields");
  if (
    value.schemaVersion !== 1 ||
    value.candidateSha !== expected.candidateSha ||
    value.runId !== expected.runId ||
    value.runAttempt !== expected.runAttempt ||
    value.toolchainManifestSha256 !== releaseV050ToolchainSha256 ||
    value.toolchainManifestSha256 !== expected.toolchainManifestSha256 ||
    value.fontSourceCommit !== pins.fonts.sourceCommit ||
    value.policySha256 !== releaseV050PolicySha256 ||
    value.policySha256 !== expected.policySha256 ||
    value.workingTreeDirty !== false ||
    value.workstationVerified !== false
  )
    fail("has stale identity, dirty source or invalid scope");
  if (
    typeof value.candidateSha !== "string" ||
    !commitPattern.test(value.candidateSha) ||
    typeof value.runId !== "string" ||
    !/^[1-9]\d*$/u.test(value.runId) ||
    typeof value.runAttempt !== "string" ||
    !/^[1-9]\d*$/u.test(value.runAttempt)
  )
    fail("has malformed run identity");
  if (
    typeof value.platformId !== "string" ||
    !releaseV050RenderQaPlatforms.includes(
      value.platformId as ReleaseV050RenderQaPlatform,
    )
  )
    fail("has an unsupported platform");
  if (
    !object(value.host) ||
    typeof value.host.osRelease !== "string" ||
    value.host.osRelease.length < 1 ||
    value.host.osRelease.length > 200 ||
    typeof value.host.runnerImage !== "string" ||
    value.host.runnerImage.length < 3 ||
    value.host.runnerImage.length > 200 ||
    value.host.runnerImage.includes("unknown") ||
    value.host.runnerImage === "local-observation" ||
    value.host.nodeVersion !== "v24.14.0" ||
    value.host.pnpmVersion !== "11.11.0" ||
    typeof value.host.pythonVersion !== "string" ||
    !/^Python 3\.12\.\d+$/u.test(value.host.pythonVersion)
  )
    fail("has an unpinned runner or runtime identity");
  const platformId = value.platformId as ReleaseV050RenderQaPlatform;
  const pin = pins.tools[platformId];
  if (
    value.admittedPackageSha256 !== pin.sha256 ||
    typeof value.dependenciesSha256 !== "string" ||
    !sha256Pattern.test(value.dependenciesSha256)
  )
    fail("does not bind its admitted package and dependency inventory");
  if (!object(value.tools)) fail("omits admitted tool identities");
  for (const tool of ["ffmpeg", "ffprobe"] as const) {
    const identity = value.tools[tool];
    if (
      !object(identity) ||
      !exactKeys(identity, ["version", "sha256", "configurationSha256"]) ||
      identity.version !== pin.version ||
      typeof identity.sha256 !== "string" ||
      !sha256Pattern.test(identity.sha256) ||
      typeof identity.configurationSha256 !== "string" ||
      !sha256Pattern.test(identity.configurationSha256)
    )
      fail(`has an unpinned ${tool} identity`);
  }
  if (
    !object(value.fonts) ||
    !exactKeys(value.fonts, [
      "sansRegular",
      "sansBold",
      "serifRegular",
      "serifBold",
      "license",
    ])
  )
    fail("omits the pinned font inventory");
  for (const id of [
    "sansRegular",
    "sansBold",
    "serifRegular",
    "serifBold",
  ] as const)
    if (value.fonts[id] !== pins.fonts.faces[id].sha256)
      fail(`has a substituted ${id} font`);
  if (value.fonts.license !== pins.fonts.license.sha256)
    fail("has a substituted font license");

  if (
    !object(value.suite) ||
    !exactKeys(value.suite, ["files"]) ||
    !Array.isArray(value.suite.files)
  )
    fail("omits its test inventory");
  const files = value.suite.files;
  if (
    files.length !== releaseV050RenderQaTestFiles.length ||
    JSON.stringify(files.map((file) => object(file) && file.path).sort()) !==
      JSON.stringify([...releaseV050RenderQaTestFiles].sort())
  )
    fail("has a missing, duplicate or foreign test file");
  for (const file of files) {
    if (
      !object(file) ||
      !exactKeys(file, [
        "path",
        "total",
        "passed",
        "failed",
        "skipped",
        "todo",
      ]) ||
      !boundedInt(file.total, 1) ||
      !boundedInt(file.passed) ||
      !boundedInt(file.failed) ||
      !boundedInt(file.skipped) ||
      !boundedInt(file.todo) ||
      file.total !== file.passed + file.failed + file.skipped + file.todo ||
      file.failed !== 0 ||
      file.skipped !== 0 ||
      file.todo !== 0
    )
      fail("contains failed, skipped, todo or inconsistent tests");
  }

  if (
    !object(value.render) ||
    !exactKeys(value.render, [
      "sources",
      "outputSha256",
      "width",
      "height",
      "frameRate",
      "frameCount",
      "pts",
      "rgbSamples",
      "audio",
    ])
  )
    fail("omits actual render evidence");
  const render = value.render;
  if (
    !Array.isArray(render.sources) ||
    render.sources.length !== 4 ||
    JSON.stringify(
      render.sources.map((source) => object(source) && source.id).sort(),
    ) !== JSON.stringify(["overlay-audio", "source-0", "source-1", "source-2"])
  )
    fail("has a missing or duplicate synthetic source");
  if (
    render.sources.some(
      (source) =>
        !object(source) ||
        !exactKeys(source, ["id", "beforeSha256", "afterSha256"]) ||
        typeof source.beforeSha256 !== "string" ||
        !sha256Pattern.test(source.beforeSha256) ||
        typeof source.afterSha256 !== "string" ||
        !sha256Pattern.test(source.afterSha256) ||
        source.beforeSha256 !== source.afterSha256,
    ) ||
    typeof render.outputSha256 !== "string" ||
    !sha256Pattern.test(render.outputSha256)
  )
    fail("has an invalid media hash or modified source evidence");
  if (
    render.width !== policy.composition.width ||
    render.height !== policy.composition.height ||
    render.frameCount !== policy.composition.frameCount ||
    !object(render.frameRate) ||
    render.frameRate.numerator !== policy.composition.frameRate.numerator ||
    render.frameRate.denominator !== policy.composition.frameRate.denominator
  )
    fail("has incorrect decoded dimensions, rate or frame count");
  const pts = render.pts;
  if (!Array.isArray(pts) || pts.length !== expectedPts().length)
    fail("has an incomplete PTS sample set");
  expectedPts().forEach((point, index) => {
    const actual = pts[index];
    if (
      !object(actual) ||
      !exactKeys(actual, ["frame", "seconds"]) ||
      actual.frame !== point.frame ||
      typeof actual.seconds !== "number" ||
      !Number.isFinite(actual.seconds) ||
      Math.abs(actual.seconds - point.seconds) >= policy.ptsToleranceSeconds
    )
      fail("has an invalid decoded PTS measurement");
  });
  const rgbSamples = render.rgbSamples;
  if (
    !Array.isArray(rgbSamples) ||
    rgbSamples.length !== expectedColors().length
  )
    fail("has an incomplete decoded RGB sample set");
  expectedColors().forEach((sample, index) => {
    const actual = rgbSamples[index];
    if (
      !object(actual) ||
      !exactKeys(actual, ["frame", "expected", "actual"]) ||
      actual.frame !== sample.frame ||
      JSON.stringify(actual.expected) !== JSON.stringify(sample.expected) ||
      !Array.isArray(actual.actual) ||
      actual.actual.length !== 3 ||
      actual.actual.some(
        (channel, channelIndex) =>
          !boundedInt(channel) ||
          channel > 255 ||
          Math.abs(channel - sample.expected[channelIndex]!) >
            policy.rgbChannelErrorMaximum,
      )
    )
      fail("has an invalid decoded RGB value");
  });
  if (
    !object(render.audio) ||
    !exactKeys(render.audio, [
      "codec",
      "sampleRate",
      "channels",
      "decodedSampleFrames",
    ]) ||
    render.audio.codec !== policy.audio.codec ||
    render.audio.sampleRate !== policy.audio.sampleRate ||
    render.audio.channels !== policy.audio.channels ||
    !boundedInt(render.audio.decodedSampleFrames, 1) ||
    Math.abs(
      render.audio.decodedSampleFrames - policy.audio.expectedSampleFrames,
    ) > policy.audio.sampleFrameTolerance
  )
    fail("has invalid decoded audio evidence");
}

export function validateReleaseV050RenderQaReports(
  reports: unknown[],
  expected: ReleaseV050RenderQaExpected,
) {
  if (
    !commitPattern.test(expected.candidateSha) ||
    !/^[1-9]\d*$/u.test(expected.runId) ||
    !/^[1-9]\d*$/u.test(expected.runAttempt) ||
    expected.toolchainManifestSha256 !== releaseV050ToolchainSha256 ||
    expected.policySha256 !== releaseV050PolicySha256 ||
    reports.length !== releaseV050RenderQaPlatforms.length ||
    !object(expected.jobResults) ||
    JSON.stringify(Object.keys(expected.jobResults).sort()) !==
      JSON.stringify([...releaseV050RenderQaPlatforms].sort()) ||
    releaseV050RenderQaPlatforms.some(
      (platform) => expected.jobResults[platform] !== "success",
    )
  )
    fail("requires all exact-run platform jobs and source fixtures to succeed");
  reports.forEach((report) => validatePlatformReport(report, expected));
  const platforms = reports.map(
    (report) => (report as ReleaseV050RenderQaReport).platformId,
  );
  if (
    new Set(platforms).size !== releaseV050RenderQaPlatforms.length ||
    releaseV050RenderQaPlatforms.some(
      (platform) => !platforms.includes(platform),
    )
  )
    fail("contains duplicate or missing platform reports");
  return {
    verified: true,
    candidateSha: expected.candidateSha,
    runId: expected.runId,
    runAttempt: expected.runAttempt,
    platforms: [...releaseV050RenderQaPlatforms],
    tests: reports.reduce<number>(
      (sum, report) =>
        sum +
        (report as ReleaseV050RenderQaReport).suite.files.reduce(
          (fileTotal, file) => fileTotal + file.total,
          0,
        ),
      0,
    ),
    workstationVerified: false,
  } as const;
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}
function normalizeVitestPath(root: string, name: unknown): string {
  if (typeof name !== "string" || name.length < 1 || name.length > 4096)
    return "";
  const absolute = isAbsolute(name) ? resolve(name) : resolve(root, name);
  const relativePath = relative(root, absolute);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  )
    return "";
  return relativePath.replaceAll("\\", "/");
}
export function summarizeReleaseV050VitestReport(value: unknown, root: string) {
  const results =
    object(value) && Array.isArray(value.testResults) ? value.testResults : [];
  const byPath = new Map<
    string,
    {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      todo: number;
    }
  >();
  for (const result of results) {
    if (!object(result)) continue;
    const path = normalizeVitestPath(root, result.name);
    if (!path || byPath.has(path)) continue;
    const assertions = Array.isArray(result.assertionResults)
      ? result.assertionResults
      : [];
    const counts = { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 };
    for (const assertion of assertions) {
      counts.total += 1;
      const status = object(assertion) ? assertion.status : undefined;
      if (status === "passed") counts.passed += 1;
      else if (status === "todo") counts.todo += 1;
      else if (status === "pending" || status === "skipped")
        counts.skipped += 1;
      else counts.failed += 1;
    }
    byPath.set(path, counts);
  }
  return releaseV050RenderQaTestFiles.map((path) => ({
    path,
    ...(byPath.get(path) ?? {
      total: 0,
      passed: 0,
      failed: 1,
      skipped: 0,
      todo: 0,
    }),
  }));
}
async function createPlatformReport(
  vitestPath: string,
  renderPath: string,
  receiptPath: string,
): Promise<ReleaseV050RenderQaReport> {
  const root = resolve(process.cwd());
  const candidateSha = gitOutput(["rev-parse", "HEAD"]);
  const requestedSha = process.env.OPENFILM_SOURCE_CANDIDATE;
  if (requestedSha && requestedSha !== candidateSha)
    throw new Error("Render QA checkout differs from selected candidate");
  const platformCandidate = `${process.platform}-${process.arch}`;
  if (
    !releaseV050RenderQaPlatforms.includes(
      platformCandidate as ReleaseV050RenderQaPlatform,
    )
  )
    throw new Error("Render QA host or architecture is unsupported");
  const platformId = platformCandidate as ReleaseV050RenderQaPlatform;
  const pnpmVersion = /pnpm\/([0-9.]+)/u.exec(
    process.env.npm_config_user_agent ?? "",
  )?.[1];
  const pythonCommand = process.platform === "win32" ? "python" : "python3";
  const pythonVersion = execFileSync(pythonCommand, ["--version"], {
    encoding: "utf8",
  }).trim();
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
    platformId?: string;
    provenanceSha256?: string;
    fontSourceCommit?: string;
    fontSha256?: Record<string, string>;
    fontLicenseSha256?: string;
    admittedPackageSha256?: string | null;
    dependencies?: string[];
    tools?: ReleaseV050RenderQaReport["tools"] | null;
  };
  if (
    receipt.platformId !== platformId ||
    receipt.provenanceSha256 !== releaseV050ToolchainSha256 ||
    receipt.fontSourceCommit !== pins.fonts.sourceCommit ||
    receipt.admittedPackageSha256 !== pins.tools[platformId].sha256 ||
    !Array.isArray(receipt.dependencies) ||
    !receipt.tools ||
    !receipt.fontSha256 ||
    !pnpmVersion
  )
    throw new Error("Render QA tool receipt is incomplete or stale");
  const rendered = JSON.parse(await readFile(renderPath, "utf8")) as {
    sources: ReleaseV050RenderQaReport["render"]["sources"];
    outputSha256: string;
    width: number;
    height: number;
    frameRate: ReleaseV050RenderQaReport["render"]["frameRate"];
    frameCount: number;
    pts: ReleaseV050RenderQaReport["render"]["pts"];
    rgbSamples: ReleaseV050RenderQaReport["render"]["rgbSamples"];
    audio: ReleaseV050RenderQaReport["render"]["audio"];
  };
  const rawVitest = JSON.parse(await readFile(vitestPath, "utf8")) as unknown;
  const workingTreeDirty = Boolean(gitOutput(["status", "--porcelain"]));
  const image = `${process.env.ImageOS ?? process.env.RUNNER_OS ?? "unknown"}:${process.env.ImageVersion ?? "unknown"}`;
  return {
    schemaVersion: 1,
    candidateSha,
    runId: process.env.GITHUB_RUN_ID ?? "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
    platformId: platformId as ReleaseV050RenderQaPlatform,
    toolchainManifestSha256: releaseV050ToolchainSha256,
    admittedPackageSha256: pins.tools[platformId].sha256,
    dependenciesSha256: createHash("sha256")
      .update(JSON.stringify([...receipt.dependencies].sort()))
      .digest("hex"),
    fontSourceCommit: pins.fonts.sourceCommit,
    policySha256: releaseV050PolicySha256,
    workingTreeDirty,
    host: {
      osRelease: release(),
      runnerImage: image || "local-observation",
      nodeVersion: process.version,
      pnpmVersion,
      pythonVersion,
    },
    tools: receipt.tools,
    fonts: {
      sansRegular: receipt.fontSha256.sansRegular ?? "",
      sansBold: receipt.fontSha256.sansBold ?? "",
      serifRegular: receipt.fontSha256.serifRegular ?? "",
      serifBold: receipt.fontSha256.serifBold ?? "",
      license: receipt.fontLicenseSha256 ?? "",
    },
    suite: { files: summarizeReleaseV050VitestReport(rawVitest, root) },
    render: rendered,
    workstationVerified: false,
  };
}

async function writePlatformReport(
  vitestPath: string,
  renderPath: string,
  outputPath: string,
): Promise<void> {
  if (![vitestPath, renderPath, outputPath].every(isAbsolute))
    throw new Error("Render QA report paths must be absolute");
  const receiptPath = process.env.OPENFILM_RENDER_QA_TOOL_RECEIPT;
  if (!receiptPath || !isAbsolute(receiptPath))
    throw new Error("Render QA tool receipt path is unavailable");
  const report = await createPlatformReport(
    vitestPath,
    renderPath,
    receiptPath,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

async function checkPlatformReports(directory: string): Promise<void> {
  if (!isAbsolute(directory))
    throw new Error("Report directory must be absolute");
  const expectedNames = releaseV050RenderQaPlatforms
    .map((platform) => `${platform}.json`)
    .sort();
  if (
    JSON.stringify((await readdir(directory)).sort()) !==
    JSON.stringify(expectedNames)
  )
    throw new Error("Render QA requires exactly three platform reports");
  const reports = await Promise.all(
    expectedNames.map(async (name) => {
      const path = join(directory, name);
      const metadata = await lstat(path);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size < 1 ||
        metadata.size > 1024 * 1024
      )
        throw new Error("Render QA report must be a bounded regular JSON file");
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    }),
  );
  const jobResult = process.env.RENDER_QA_MATRIX_RESULT;
  const jobResults = Object.fromEntries(
    releaseV050RenderQaPlatforms.map((platform) => [platform, jobResult ?? ""]),
  ) as Record<ReleaseV050RenderQaPlatform, string>;
  const result = validateReleaseV050RenderQaReports(reports, {
    candidateSha: process.env.OPENFILM_SOURCE_CANDIDATE ?? "",
    runId: process.env.GITHUB_RUN_ID ?? "",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
    toolchainManifestSha256: releaseV050ToolchainSha256,
    policySha256: releaseV050PolicySha256,
    jobResults,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "write") {
    if (args.length !== 3)
      throw new Error(
        "Usage: release-render-qa-v050.ts write <vitest-json> <render-json> <platform-report>",
      );
    return writePlatformReport(args[0]!, args[1]!, args[2]!);
  }
  if (command === "check") {
    if (args.length !== 1)
      throw new Error(
        "Usage: release-render-qa-v050.ts check <platform-report-directory>",
      );
    return checkPlatformReports(args[0]!);
  }
  throw new Error(
    "Usage: release-render-qa-v050.ts <write|check> <absolute paths>",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}

export { admitBrewFormula, admitRequiredQaFilters, verifyPinnedBytes };
