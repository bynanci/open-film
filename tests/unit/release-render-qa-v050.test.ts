// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import pins from "../../fixtures/render-qa/toolchain.json";
import {
  admitReleaseV050BrewFormula,
  admitReleaseV050RequiredFilters,
  releaseV050RenderQaPlatforms,
  releaseV050RenderQaTestFiles,
  summarizeReleaseV050VitestReport,
  validateReleaseV050RenderQaReports,
  verifyReleaseV050PinnedBytes,
  type ReleaseV050RenderQaReport,
} from "../../scripts/ci/release-render-qa-v050.js";
import { downloadPinnedBytes } from "../../scripts/ci/render-qa-tools.js";
import { setupRenderQa } from "../../scripts/ci/setup-render-qa.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const candidateSha = "a".repeat(40);
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const manifestSha256 = hash(
  readFileSync(
    new URL("../../fixtures/render-qa/toolchain.json", import.meta.url),
  ),
);
const policySha256 = hash(
  readFileSync(
    new URL("../../fixtures/render-qa/v050-policy.json", import.meta.url),
  ),
);
const frameIndices = [0, 59, 60, 67, 75, 90, 119, 120, 179];
const ptsSeconds = [
  0, 1.968633, 2.002, 2.235567, 2.5025, 3.003, 3.970633, 4.004, 5.972633,
];
const colors = [
  [255, 0, 0],
  [255, 0, 0],
  [255, 0, 0],
  [136, 119, 0],
  [0, 255, 0],
  [0, 255, 0],
  [0, 255, 0],
  [0, 0, 255],
  [0, 0, 255],
] as const;

function report(
  platformId: (typeof releaseV050RenderQaPlatforms)[number],
): ReleaseV050RenderQaReport {
  const tool = pins.tools[platformId];
  return {
    schemaVersion: 1,
    candidateSha,
    runId: "42370000000",
    runAttempt: "1",
    platformId,
    toolchainManifestSha256: manifestSha256,
    admittedPackageSha256: pins.tools[platformId].sha256,
    dependenciesSha256: "a".repeat(64),
    fontSourceCommit: pins.fonts.sourceCommit,
    policySha256,
    workingTreeDirty: false,
    host: {
      osRelease: "fixture-host-release",
      runnerImage: "ubuntu-24.04:20261107.1.0",
      nodeVersion: "v24.14.0",
      pnpmVersion: "11.11.0",
      pythonVersion: "Python 3.12.12",
    },
    tools: {
      ffmpeg: {
        version: tool.version,
        sha256: "b".repeat(64),
        configurationSha256: "c".repeat(64),
      },
      ffprobe: {
        version: tool.version,
        sha256: "d".repeat(64),
        configurationSha256: "e".repeat(64),
      },
    },
    fonts: {
      sansRegular: pins.fonts.faces.sansRegular.sha256,
      sansBold: pins.fonts.faces.sansBold.sha256,
      serifRegular: pins.fonts.faces.serifRegular.sha256,
      serifBold: pins.fonts.faces.serifBold.sha256,
      license: pins.fonts.license.sha256,
    },
    suite: {
      files: releaseV050RenderQaTestFiles.map((path) => ({
        path,
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        todo: 0,
      })),
    },
    render: {
      sources: [
        {
          id: "source-0",
          beforeSha256: "f".repeat(64),
          afterSha256: "f".repeat(64),
        },
        {
          id: "source-1",
          beforeSha256: "1".repeat(64),
          afterSha256: "1".repeat(64),
        },
        {
          id: "source-2",
          beforeSha256: "2".repeat(64),
          afterSha256: "2".repeat(64),
        },
        {
          id: "overlay-audio",
          beforeSha256: "3".repeat(64),
          afterSha256: "3".repeat(64),
        },
      ],
      outputSha256: "4".repeat(64),
      width: 160,
      height: 90,
      frameRate: { numerator: 30000, denominator: 1001 },
      frameCount: 180,
      pts: frameIndices.map((frame, index) => ({
        frame,
        seconds: ptsSeconds[index]!,
      })),
      rgbSamples: frameIndices.map((frame, index) => ({
        frame,
        expected: [...colors[index]!],
        actual: [...colors[index]!],
      })),
      audio: {
        codec: "aac",
        sampleRate: 48000,
        channels: 1,
        decodedSampleFrames: 288288,
      },
    },
    workstationVerified: false,
  };
}

const expected = {
  candidateSha,
  runId: "42370000000",
  runAttempt: "1",
  toolchainManifestSha256: manifestSha256,
  policySha256,
  jobResults: {
    "linux-x64": "success",
    "win32-x64": "success",
    "darwin-arm64": "success",
  },
};

it("accepts one complete exact-run report for each pinned platform", () => {
  expect(
    validateReleaseV050RenderQaReports(
      releaseV050RenderQaPlatforms.map(report),
      expected,
    ),
  ).toMatchObject({
    verified: true,
    platforms: [...releaseV050RenderQaPlatforms],
    workstationVerified: false,
  });
});

it("rejects a platform report produced from another candidate revision", () => {
  const reports = releaseV050RenderQaPlatforms.map(report);
  reports[1] = { ...reports[1]!, candidateSha: "9".repeat(40) };
  expect(() => validateReleaseV050RenderQaReports(reports, expected)).toThrow(
    /candidate|stale/iu,
  );
});

it("rejects a valid-looking report that is not tied to the pinned package bytes", () => {
  const reports = releaseV050RenderQaPlatforms.map(report);
  reports[0] = { ...reports[0]!, admittedPackageSha256: "0".repeat(64) };
  expect(() => validateReleaseV050RenderQaReports(reports, expected)).toThrow(
    /package|dependency/iu,
  );
});

it("rejects duplicate platform reports and failed matrix prerequisites", () => {
  const reports = releaseV050RenderQaPlatforms.map(report);
  reports[2] = { ...reports[2]!, platformId: reports[1]!.platformId };
  expect(() => validateReleaseV050RenderQaReports(reports, expected)).toThrow(
    /platform|duplicate|inventory/iu,
  );
  expect(() =>
    validateReleaseV050RenderQaReports(
      releaseV050RenderQaPlatforms.map(report),
      {
        ...expected,
        jobResults: { ...expected.jobResults, "win32-x64": "failure" },
      },
    ),
  ).toThrow(/succeed|job/iu);
});

it("rejects skipped tests and missing or substituted decode samples", () => {
  const reports = releaseV050RenderQaPlatforms.map(report);
  reports[0] = {
    ...reports[0]!,
    suite: {
      ...reports[0]!.suite,
      files: reports[0]!.suite.files.map((file, index) =>
        index === 0 ? { ...file, skipped: 1, total: 2 } : file,
      ),
    },
  };
  expect(() => validateReleaseV050RenderQaReports(reports, expected)).toThrow(
    /skip|todo|test/iu,
  );

  const rgbReports = releaseV050RenderQaPlatforms.map(report);
  rgbReports[0] = {
    ...rgbReports[0]!,
    render: {
      ...rgbReports[0]!.render,
      rgbSamples: rgbReports[0]!.render.rgbSamples.slice(1),
    },
  };
  expect(() =>
    validateReleaseV050RenderQaReports(rgbReports, expected),
  ).toThrow(/sample|measurement|inventory/iu);
});

it("rejects incorrect decoded frame count, timing, pixels and source mutation", () => {
  const mutations = [
    (render: ReleaseV050RenderQaReport["render"]) => ({
      ...render,
      frameCount: 179,
    }),
    (render: ReleaseV050RenderQaReport["render"]) => ({
      ...render,
      pts: render.pts.map((point, index) =>
        index === 4 ? { ...point, seconds: point.seconds + 0.01 } : point,
      ),
    }),
    (render: ReleaseV050RenderQaReport["render"]) => ({
      ...render,
      rgbSamples: render.rgbSamples.map((sample, index) =>
        index === 0 ? { ...sample, actual: [0, 0, 0] } : sample,
      ),
    }),
    (render: ReleaseV050RenderQaReport["render"]) => ({
      ...render,
      sources: render.sources.map((source, index) =>
        index === 1 ? { ...source, afterSha256: "0".repeat(64) } : source,
      ),
    }),
  ];
  for (const mutate of mutations) {
    const reports = releaseV050RenderQaPlatforms.map(report);
    reports[0] = { ...reports[0]!, render: mutate(reports[0]!.render) };
    expect(() =>
      validateReleaseV050RenderQaReports(reports, expected),
    ).toThrow();
  }
});

it("requires every declared render regression file exactly once", () => {
  const reports = releaseV050RenderQaPlatforms.map(report);
  reports[0] = {
    ...reports[0]!,
    suite: {
      files: reports[0]!.suite.files.filter(
        (file) => file.path !== releaseV050RenderQaTestFiles[0],
      ),
    },
  };
  expect(() => validateReleaseV050RenderQaReports(reports, expected)).toThrow(
    /suite|file|test/iu,
  );
});

it("reduces the actual Vitest JSON to an exact path-free test inventory", () => {
  const summary = summarizeReleaseV050VitestReport(
    {
      testResults: [
        {
          name: "/checkout/packages/render/tests/audio-quality.test.ts",
          assertionResults: [
            {
              status: "passed",
              failureMessages: ["private output is omitted"],
            },
            { status: "pending" },
            { status: "todo" },
            {
              status: "failed",
              failureMessages: ["private output is omitted"],
            },
          ],
        },
        {
          name: "/another-checkout/packages/render/tests/render.test.ts",
          assertionResults: [{ status: "passed" }],
        },
      ],
    },
    "/checkout",
  );
  expect(summary).toHaveLength(releaseV050RenderQaTestFiles.length);
  expect(summary[0]).toEqual({
    path: "packages/render/tests/audio-quality.test.ts",
    total: 4,
    passed: 1,
    failed: 1,
    skipped: 1,
    todo: 1,
  });
  expect(
    summary.find((file) => file.path.endsWith("render.test.ts")),
  ).toMatchObject({
    total: 0,
    failed: 1,
  });
  expect(JSON.stringify(summary)).not.toContain("private output");
  expect(JSON.stringify(summary)).not.toContain("/checkout");
});

it("admits the candidate FFmpeg feature set without main-only zscale requirements", () => {
  expect(
    admitReleaseV050RequiredFilters(
      " .S tonemap V->V Tone map\n .S scale V->V Scale\n",
    ).map((filter) => filter.name),
  ).toEqual(["tonemap"]);
  for (const output of [
    " .S scale V->V Scale",
    " .S other V->V mentions tonemap",
    " .S tonemap A->A Wrong media type",
  ])
    expect(() => admitReleaseV050RequiredFilters(output)).toThrow(
      /required.*filter/iu,
    );
});

it("admits only the candidate's exact macOS formula and bottle", () => {
  const pin = pins.tools["darwin-arm64"];
  const formula = {
    formulae: [
      {
        name: "ffmpeg",
        tap: "homebrew/core",
        versions: { stable: pin.version },
        revision: 1,
        license: "GPL-3.0-or-later",
        bottle: {
          stable: { files: { arm64_sequoia: { sha256: pin.sha256 } } },
        },
        installed: [{ version: "9.0.2_1", poured_from_bottle: true }],
      },
    ],
  };
  expect(() => admitReleaseV050BrewFormula(formula, true)).not.toThrow();
  expect(() =>
    admitReleaseV050BrewFormula(
      {
        formulae: [
          {
            ...formula.formulae[0],
            bottle: {
              stable: {
                files: { arm64_sequoia: { sha256: "0".repeat(64) } },
              },
            },
          },
        ],
      },
      true,
    ),
  ).toThrow(/formula|bottle|identity/iu);
});

it("rejects pinned tool bytes when size or digest differs", () => {
  const bytes = Buffer.from("fixed ffmpeg fixture");
  expect(() =>
    verifyReleaseV050PinnedBytes(bytes, hash(bytes.toString()), bytes.length),
  ).not.toThrow();
  expect(() =>
    verifyReleaseV050PinnedBytes(bytes, "0".repeat(64), bytes.length),
  ).toThrow(/hash/iu);
  expect(() =>
    verifyReleaseV050PinnedBytes(
      bytes,
      hash(bytes.toString()),
      bytes.length - 1,
    ),
  ).toThrow(/limit|size/iu);
});

it("rejects an unreviewed tool download origin before network access", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    downloadPinnedBytes(
      "https://attacker.invalid/ffmpeg.deb",
      "0".repeat(64),
      1024,
    ),
  ).rejects.toThrow(/origin/iu);
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects an unreviewed setup platform before filesystem or network effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-v050-qa-setup-"));
  roots.push(root);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    setupRenderQa({
      root: join(root, "should-not-exist"),
      mode: "hosted-tools",
      platform: process.platform === "win32" ? "linux" : "win32",
      architecture: process.arch,
    }),
  ).rejects.toThrow(/host|architecture/iu);
  expect(fetch).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual([]);
});
