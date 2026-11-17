// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  admitBrewFormula,
  observeMacQaDependencies,
  admitToolVersion,
  admitRequiredQaFilters,
  downloadPinnedBytes,
  verifyPinnedBytes,
} from "../../scripts/ci/render-qa-tools.js";
import { setupRenderQa } from "../../scripts/ci/setup-render-qa.js";
import { ffmpegExpressionValues } from "../helpers/ffmpeg-expression-log.js";
import { syntheticRenderQaEvidence } from "../fixtures/render-qa-evidence.js";
import { validateRenderQaEvidence } from "../helpers/render-qa-evidence.js";

afterEach(() => vi.unstubAllGlobals());
it("reads complete expression samples from bare and evaluator-prefixed FFmpeg logs only", () => {
  expect(
    ffmpegExpressionValues(
      [
        "Input duration 1.000000",
        "0.000000",
        "[Eval @ 0x1234abcd] 0.250000",
        "[Eval @ 000001C67AB7F080] 0.500000",
        "[Eval @ 0x1234abcd] 1.000000",
        "[Eval @ 0x1234abcd] 1.000000",
        "[other @ 0x1234abcd] 0.750000",
        "[Eval @ invalid] 0.750000",
        "[Eval @ 0x1234abcd] 0.750000 trailing log text",
      ].join("\r\n"),
    ),
  ).toEqual([0, 0.25, 0.5, 1, 1]);
});

it("requires actual HDR filter rows across FFmpeg flag formats and rejects name lookalikes", () => {
  for (const filters of [
    " .SC zscale V->V Resize\n .S. tonemap V->V Tone map",
    " .S zscale V->V Resize\n .S tonemap V->V Tone map",
  ])
    expect(admitRequiredQaFilters(filters).map((row) => row.name)).toEqual([
      "zscale",
      "tonemap",
    ]);
  for (const filters of [
    " .S tonemap V->V Tone map",
    " .S zscale V->V Resize",
    " .S zscale_other V->V Resize\n .S tonemap V->V Tone map",
    " .S other V->V mentions zscale and tonemap",
    " .S zscale A->A Wrong type\n .S tonemap V->V Tone map",
  ])
    expect(() => admitRequiredQaFilters(filters)).toThrow(
      /required.*filters/iu,
    );
});
it("rejects a mismatched setup host or architecture before filesystem/acquisition effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-qa-host-"));
  const fetch = vi.fn(() => {
    throw new Error("Unexpected acquisition");
  });
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(
      setupRenderQa({
        root,
        mode: "fonts-only",
        platform: process.platform === "win32" ? "linux" : "win32",
        architecture: process.arch,
      }),
    ).rejects.toThrow(/host|architecture/u);
    await expect(
      setupRenderQa({
        root,
        mode: "fonts-only",
        platform: process.platform,
        architecture: "unreviewed",
      }),
    ).rejects.toThrow(/host|architecture/u);
    expect(fetch).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const bytes = Buffer.from("generated, non-executable download fixture");
const sha256 = createHash("sha256").update(bytes).digest("hex");
it("admits only bounded bytes matching an independently supplied digest", () => {
  expect(verifyPinnedBytes(bytes, sha256, bytes.length)).toBeUndefined();
  expect(() => verifyPinnedBytes(bytes, "0".repeat(64), bytes.length)).toThrow(
    /hash/u,
  );
  expect(() => verifyPinnedBytes(bytes, sha256, bytes.length - 1)).toThrow(
    /limit/u,
  );
  expect(() => verifyPinnedBytes(Buffer.alloc(0), sha256, 100)).toThrow();
});
it("rejects insecure or unreviewed origins before requesting bytes", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const url of [
    "http://raw.githubusercontent.com/fixture",
    "https://attacker.invalid/fixture",
    "https://user:password@raw.githubusercontent.com/fixture",
  ])
    await expect(downloadPinnedBytes(url, sha256, 100)).rejects.toThrow(
      /origin/u,
    );
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects unpinned GitHub release API paths before requesting bytes", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    downloadPinnedBytes(
      "https://api.github.com/repos/attacker/project/releases/assets/574302090",
      sha256,
      100,
    ),
  ).rejects.toThrow(/origin/u);
  await expect(
    downloadPinnedBytes(
      "https://api.github.com/repos/GyanD/codexffmpeg/releases/assets/other",
      sha256,
      100,
    ),
  ).rejects.toThrow(/origin/u);
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects a redirect to an unreviewed origin without fetching it", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://attacker.invalid/fixture" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    downloadPinnedBytes(
      "https://raw.githubusercontent.com/fixture",
      sha256,
      100,
    ),
  ).rejects.toThrow(/origin/u);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("retries a temporary HTTP failure before accepting pinned bytes", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("temporarily unavailable", { status: 503 }),
    )
    .mockResolvedValueOnce(new Response(bytes));
  vi.stubGlobal("fetch", fetch);
  await expect(
    downloadPinnedBytes(
      "https://raw.githubusercontent.com/fixture",
      sha256,
      100,
    ),
  ).resolves.toEqual(bytes);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("backs off through repeated transient HTTP failures before admitting pinned bytes", async () => {
  const responses = [
    new Response("temporarily unavailable", { status: 503 }),
    new Response("temporarily unavailable", { status: 503 }),
    new Response("temporarily unavailable", { status: 503 }),
    new Response(bytes),
  ];
  const requestTimes: number[] = [];
  const fetch = vi.fn(() => {
    requestTimes.push(Date.now());
    return Promise.resolve(responses.shift()!);
  });
  vi.stubGlobal("fetch", fetch);
  vi.useFakeTimers();

  try {
    const pending = downloadPinnedBytes(
      "https://raw.githubusercontent.com/fixture",
      sha256,
      100,
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ value: bytes });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(requestTimes.map((time) => time - requestTimes[0]!)).toEqual([
      0, 500, 1_500, 3_500,
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("downloads the pinned GitHub release asset through its official API redirect", async () => {
  const assetApiUrl =
    "https://api.github.com/repos/GyanD/codexffmpeg/releases/assets/574302090";
  const releaseAssetUrl =
    "https://release-assets.githubusercontent.com/fixture";
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: releaseAssetUrl },
      }),
    )
    .mockResolvedValueOnce(new Response(bytes));
  vi.stubGlobal("fetch", fetch);

  await expect(downloadPinnedBytes(assetApiUrl, sha256, 100)).resolves.toEqual(
    bytes,
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  const [apiUrl, apiOptions] = fetch.mock.calls[0]!;
  expect(String(apiUrl)).toBe(assetApiUrl);
  expect(new Headers(apiOptions?.headers).get("accept")).toBe(
    "application/octet-stream",
  );
  expect(String(fetch.mock.calls[1]![0])).toBe(releaseAssetUrl);
});
it("reports a permanent HTTP failure without another request", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response("not found", { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    downloadPinnedBytes(
      "https://raw.githubusercontent.com/fixture",
      sha256,
      100,
    ),
  ).rejects.toThrow(/HTTP 404/u);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("bounds retries for a persistently unavailable pinned origin", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("temporarily unavailable", { status: 503 }),
    );
  vi.stubGlobal("fetch", fetch);
  vi.useFakeTimers();

  try {
    const pending = downloadPinnedBytes(
      "https://raw.githubusercontent.com/fixture",
      sha256,
      100,
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    const result = await pending;
    if (!("error" in result))
      throw new Error("Expected persistent HTTP 503 to exhaust retries");
    expect(result.error).toMatchObject({
      message: "Render QA download failed (HTTP 503)",
    });
    expect(fetch).toHaveBeenCalledTimes(5);
  } finally {
    vi.useRealTimers();
  }
});
it("retries a timed-out pinned download before admitting its bytes", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    )
    .mockResolvedValueOnce(new Response(bytes));
  vi.stubGlobal("fetch", fetch);
  await expect(
    downloadPinnedBytes(
      "https://raw.githubusercontent.com/fixture",
      sha256,
      100,
    ),
  ).resolves.toEqual(bytes);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("retries a timed-out response body from the pinned URL without accepting partial bytes", async () => {
  const timedOutBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("partial"));
      controller.error(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      );
    },
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(timedOutBody))
    .mockResolvedValueOnce(new Response(bytes));
  vi.stubGlobal("fetch", fetch);
  await expect(
    downloadPinnedBytes(
      "https://raw.githubusercontent.com/fixture",
      sha256,
      100,
    ),
  ).resolves.toEqual(bytes);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("rejects oversized streamed bodies and tampered downloads", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(bytes)),
  );
  await expect(
    downloadPinnedBytes(
      "https://raw.githubusercontent.com/fixture",
      sha256,
      bytes.length,
    ),
  ).resolves.toEqual(bytes);
  await expect(
    downloadPinnedBytes("https://raw.githubusercontent.com/fixture", sha256, 1),
  ).rejects.toThrow(/limit/u);
  await expect(
    downloadPinnedBytes(
      "https://raw.githubusercontent.com/fixture",
      "0".repeat(64),
      100,
    ),
  ).rejects.toThrow(/hash/u);
});
it("matches exact tool/version boundaries rather than accepting prefix lookalikes", () => {
  expect(
    admitToolVersion(
      "ffmpeg",
      "ffmpeg version 9.0.2-essentials_build\nbuild options",
      "9.0.2",
    ),
  ).toBe("ffmpeg version 9.0.2-essentials_build");
  for (const stdout of [
    "ffmpeg version 9.0.20",
    "ffprobe version 9.0.2",
    "ffmpeg version N-unknown",
  ])
    expect(() => admitToolVersion("ffmpeg", stdout, "9.0.2")).toThrow(
      /version/u,
    );
});
function formula() {
  return {
    formulae: [
      {
        name: "ffmpeg-full",
        tap: "homebrew/core",
        versions: { stable: "9.0.2" },
        revision: 3,
        license: "GPL-3.0-or-later",
        bottle: {
          stable: {
            files: {
              arm64_sequoia: {
                sha256:
                  "64d139fb62d60e85fd92874bbc63a147db212c9db4658e08ca8ec538ef8059f5",
              },
            },
          },
        },
        installed: [{ version: "9.0.2_3", poured_from_bottle: true }],
      },
    ],
  };
}
it("admits the exact Homebrew formula/bottle and installed identity", () => {
  expect(() => admitBrewFormula(formula(), true)).not.toThrow();
  for (const change of [
    (data: ReturnType<typeof formula>) => {
      data.formulae[0]!.name = "ffmpeg";
    },
    (data: ReturnType<typeof formula>) => {
      data.formulae[0]!.revision = 2;
    },
    (data: ReturnType<typeof formula>) => {
      data.formulae[0]!.tap = "unreviewed/tap";
    },
    (data: ReturnType<typeof formula>) => {
      data.formulae[0]!.bottle.stable.files.arm64_sequoia.sha256 = "0".repeat(
        64,
      );
    },
    (data: ReturnType<typeof formula>) => {
      data.formulae[0]!.installed[0]!.version = "9.0.2";
    },
    (data: ReturnType<typeof formula>) => {
      data.formulae[0]!.installed[0]!.poured_from_bottle = false;
    },
  ]) {
    const data = formula();
    change(data);
    expect(() => admitBrewFormula(data, true)).toThrow(/Homebrew/u);
  }
});

it("rejects the historical Homebrew revision even when all its old identities agree", () => {
  const historical = formula();
  historical.formulae[0]!.revision = 1;
  historical.formulae[0]!.installed[0]!.version = "9.0.2_1";
  historical.formulae[0]!.bottle.stable.files.arm64_sequoia.sha256 =
    "ace8d43d3be69e4a2b1203ad584970f63a39eb38e4f842b224991a27f126573c";
  expect(() => admitBrewFormula(historical, false)).toThrow(/Homebrew/u);
  expect(() => admitBrewFormula(historical, true)).toThrow(/Homebrew/u);
});

it("reports rejected Homebrew fields with bounded safe identity diagnostics", () => {
  const data = formula();
  data.formulae[0]!.revision = 2;
  try {
    admitBrewFormula(data, false);
    expect.unreachable("unreviewed revision must fail admission");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(
      /^Homebrew formula, bottle or installed identity is unreviewed; /u,
    );
    const diagnostic = JSON.parse(message.slice(message.indexOf("; ") + 2));
    expect(diagnostic.rejected).toEqual(["revision"]);
    expect(diagnostic.expected).toEqual({
      stable: "9.0.2",
      revision: 3,
      bottle:
        "64d139fb62d60e85fd92874bbc63a147db212c9db4658e08ca8ec538ef8059f5",
    });
    expect(diagnostic.observed).toEqual({
      ...diagnostic.expected,
      revision: 2,
    });
  }
});

it("keeps malformed, oversized and control-bearing Homebrew diagnostics bounded and private", () => {
  const hostile =
    "\u001b[31m\n::error::/private/media/secret\r" + "x".repeat(50_000);
  for (const input of [
    null,
    {},
    { formulae: [] },
    {
      formulae: [
        {
          name: hostile,
          tap: hostile,
          license: hostile,
          versions: { stable: hostile },
          revision: { privatePath: hostile },
          bottle: { stable: { files: { arm64_sequoia: { sha256: hostile } } } },
          installed: [{ version: hostile, poured_from_bottle: false }],
        },
      ],
    },
  ]) {
    try {
      admitBrewFormula(input, true);
      expect.unreachable("malformed identity must fail admission");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message.length).toBeLessThan(1_200);
      expect(
        [...message].every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 && code !== 127;
        }),
      ).toBe(true);
      expect(message).not.toContain("/private");
      expect(message).not.toContain("::error::");
      const diagnostic = JSON.parse(message.slice(message.indexOf("; ") + 2));
      expect(diagnostic.rejected.length).toBeGreaterThan(0);
      expect(diagnostic.observed).toEqual({
        stable: "invalid",
        revision: "invalid",
        bottle: "invalid",
      });
    }
  }
});

it("binds the admitted macOS tool pin to its reviewed static provenance", () => {
  const pin = JSON.parse(
    readFileSync("fixtures/render-qa/toolchain.json", "utf8"),
  ).tools["darwin-arm64"];
  const review = JSON.parse(
    readFileSync("fixtures/render-qa/darwin-ffmpeg-full-review.json", "utf8"),
  );
  expect(pin.version).toBe("9.0.2");
  expect(pin.revision).toBe(3);
  expect(review.formula).toMatchObject({
    name: pin.formula,
    packageVersion: pin.packageVersion,
    revision: pin.revision,
    reviewCommit: pin.formulaCommit,
    reviewSha256: pin.formulaSha256,
    license: "GPL-3.0-or-later",
  });
  expect(review.bottle).toMatchObject({
    tag: pin.bottleTag,
    sha256: pin.sha256,
    manifestSha256:
      "9e342a981161284a92efd02c4d7dc7bfa9947091718bbc1a13e157032bfe0b86",
  });
  expect(review.bottle.bytes).toBeLessThanOrEqual(pin.maxBytes);
  expect(review.runtimeDependencies).toHaveLength(102);
  expect(
    review.runtimeDependencies.filter(
      (dependency: { declaredDirectly: boolean }) =>
        dependency.declaredDirectly,
    ),
  ).toHaveLength(47);
  expect(review.selectedMachO).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "libavfilter.12.1.102.dylib",
        architecture: "arm64",
        minimumMacOS: "15.0.0",
        zscaleNamePresent: true,
        tonemapNamePresent: true,
      }),
    ]),
  );
});

it("installs the admitted Homebrew formula rather than treating its cache path as a formula", () => {
  const setup = readFileSync("scripts/ci/setup-render-qa.ts", "utf8");
  expect(setup).toContain(
    'await run("brew", ["install", "--force-bottle", pin.formula]);',
  );
  expect(setup).not.toContain(
    'await run("brew", ["install", "--force-bottle", cache]);',
  );
});
it("centralizes the Windows pins while preserving its complete recovery/browser selection", () => {
  const workflow = readFileSync(
    ".github/workflows/windows-media-recovery.yml",
    "utf8",
  );
  expect(workflow).toContain("scripts/ci/setup-render-qa.ts hosted-tools");
  expect(workflow).not.toContain("Invoke-WebRequest");
  expect(workflow).not.toContain("60f467265b");
  expect(workflow.indexOf("pnpm install --frozen-lockfile")).toBeLessThan(
    workflow.indexOf("scripts/ci/setup-render-qa.ts"),
  );
  for (const file of [
    "packages/media/tests/verified-source.test.ts",
    "tests/integration/export-profiles.test.ts",
    "tests/integration/low-fps-export.test.ts",
    "tests/e2e/export-profiles.spec.ts",
    "tests/e2e/export-review-followup.spec.ts",
    "tests/e2e/multi-source-review.spec.ts",
    "tests/e2e/interaction-performance.spec.ts",
  ])
    expect(workflow).toContain(file);
});

function macObservationFixture() {
  const metadata = { ...formula(), casks: [] };
  Object.assign(metadata.formulae[0]!, { dependencies: ["libvpx"] });
  const calls: Array<[string, string[]]> = [];
  return {
    metadata,
    calls,
    run: async (command: string, args: string[]) => {
      calls.push([command, args]);
      if (command === "otool")
        return `${args[1]}:\n\t/opt/homebrew/lib/libfixture.dylib (compatibility version 1.0.0, current version 1.2.3)`;
      if (args[2] === "ffmpeg-full") return JSON.stringify(metadata);
      return JSON.stringify({
        formulae: [
          {
            name: "libvpx",
            tap: "homebrew/core",
            installed: [{ version: "1.15.2" }],
            dependencies: [] as string[],
            license: "BSD-3-Clause",
          },
        ],
        casks: [],
      });
    },
  };
}
it("retains bounded local Homebrew JSON and actual otool observations with path-free hashed summaries", async () => {
  const fixture = macObservationFixture();
  const result = await observeMacQaDependencies(
    fixture.metadata,
    "/opt/homebrew/opt/ffmpeg/bin",
    fixture.run,
  );
  expect(fixture.calls).toEqual([
    ["brew", ["info", "--json=v2", "ffmpeg-full"]],
    ["brew", ["info", "--json=v2", "libvpx"]],
    ["otool", ["-L", "/opt/homebrew/opt/ffmpeg/bin/ffmpeg"]],
    ["otool", ["-L", "/opt/homebrew/opt/ffmpeg/bin/ffprobe"]],
  ]);
  expect(result.local.metadata.map((item) => item.name)).toEqual([
    "ffmpeg-full",
    "libvpx",
  ]);
  for (const item of [...result.local.metadata, ...result.local.libraries])
    expect(item.sha256).toBe(
      createHash("sha256").update(item.stdout).digest("hex"),
    );
  expect(result.local.libraries[0]!.stdout).toContain("/opt/homebrew/");
  expect(result.summary).toContain("brew:libvpx=1.15.2");
  expect(JSON.stringify(result.summary)).not.toMatch(/\/opt|\/Users|\.dylib/u);
  expect(
    result.summary.some(
      (item) =>
        item ===
        `otool:ffmpeg:sha256=${result.local.libraries[0]!.sha256}:libraries=1`,
    ),
  ).toBe(true);
});
it("retains the complete observed Homebrew dependency graph and its license declarations", async () => {
  const fixture = macObservationFixture();
  const result = await observeMacQaDependencies(
    fixture.metadata,
    "/opt/homebrew/opt/ffmpeg-full/bin",
    async (command, args) => {
      if (command === "brew" && args[2] === "libvpx") {
        const data = JSON.parse(await fixture.run(command, args));
        data.formulae[0].dependencies = ["libfixture"];
        return JSON.stringify(data);
      }
      if (command === "brew" && args[2] === "libfixture")
        return JSON.stringify({
          formulae: [
            {
              name: "libfixture",
              tap: "homebrew/core",
              installed: [{ version: "1.0.0" }],
              dependencies: [],
              license: "MIT",
            },
          ],
          casks: [],
        });
      return fixture.run(command, args);
    },
  );
  expect(result.local.metadata.map((entry) => entry.name)).toEqual([
    "ffmpeg-full",
    "libvpx",
    "libfixture",
  ]);
  expect(
    result.summary.some((entry) =>
      /^brew-license:libfixture:sha256=[a-f0-9]{64}$/u.test(entry),
    ),
  ).toBe(true);
  expect(JSON.parse(result.local.metadata[2]!.stdout).formulae[0].license).toBe(
    "MIT",
  );
  expect(JSON.parse(result.local.metadata[1]!.stdout).formulae[0].license).toBe(
    "BSD-3-Clause",
  );
});

function activeKegFixture(name = "p11-kit") {
  const fixture = macObservationFixture();
  Object.assign(fixture.metadata.formulae[0]!, { dependencies: [name] });
  const dependency = {
    name,
    tap: "homebrew/core",
    installed: [{ version: "0.26.5" }, { version: "0.26.6" }],
    linked_keg: "0.26.6" as string | null | undefined,
    dependencies: [] as string[],
    license: "BSD-3-Clause",
  };
  const paths = {
    cellar: `/private/openfilm/Cellar/${name}`,
    prefix: `/private/openfilm/opt/${name}`,
    resolvedCellar: `/private/openfilm/Cellar/${name}`,
    resolvedPrefix: `/private/openfilm/Cellar/${name}/0.26.6`,
  };
  const calls: Array<[string, string[]]> = [];
  const resolutions: string[] = [];
  return {
    ...fixture,
    dependency,
    paths,
    calls,
    resolutions,
    run: async (command: string, args: string[]) => {
      calls.push([command, args]);
      if (command === "brew" && args[0] === "--cellar") return paths.cellar;
      if (command === "brew" && args[0] === "--prefix") return paths.prefix;
      if (command === "brew" && args[2] === name)
        return JSON.stringify({ formulae: [dependency], casks: [] });
      return fixture.run(command, args);
    },
    resolvePath: async (path: string) => {
      resolutions.push(path);
      if (path === paths.cellar) return paths.resolvedCellar;
      if (path === paths.prefix) return paths.resolvedPrefix;
      throw new Error("Unexpected private resolution: " + path);
    },
  };
}

it.each([false, true])(
  "proves the active dependency keg independently of installed-list order (reversed=%s)",
  async (reversed) => {
    const fixture = activeKegFixture();
    if (reversed) fixture.dependency.installed.reverse();
    const result = await observeMacQaDependencies(
      fixture.metadata,
      "/opt/homebrew/opt/ffmpeg-full/bin",
      fixture.run,
      fixture.resolvePath,
    );
    expect(result.summary).toContain("brew:p11-kit=0.26.6");
    expect(result.summary).not.toContain("brew:p11-kit=0.26.5");
    expect(fixture.calls).toContainEqual(["brew", ["--cellar", "p11-kit"]]);
    expect(fixture.calls).toContainEqual([
      "brew",
      ["--prefix", "--installed", "p11-kit"],
    ]);
    expect(fixture.resolutions).toEqual([
      fixture.paths.cellar,
      fixture.paths.prefix,
    ]);
    expect(result.local.activeKegs).toHaveLength(1);
    const selection = result.local.activeKegs[0]!;
    expect(selection).toMatchObject({
      name: "p11-kit",
      version: "0.26.6",
      installedCount: 2,
      resolvedCellar: fixture.paths.resolvedCellar,
      resolvedPrefix: fixture.paths.resolvedPrefix,
    });
    expect(result.summary).toContain(
      `brew-active:p11-kit:count=2:sha256=${createHash("sha256").update(JSON.stringify(selection)).digest("hex")}`,
    );
    expect(JSON.stringify(result.summary)).not.toMatch(
      /\/private|\/opt|\/Users|\.dylib/u,
    );
    expect(result.summary.every((entry) => entry.length <= 300)).toBe(true);
    const metadata = result.local.metadata.find(
      (entry) => entry.name === "p11-kit",
    )!;
    expect(JSON.parse(metadata.stdout).formulae[0].installed).toEqual(
      fixture.dependency.installed,
    );
    expect(metadata.sha256).toBe(
      createHash("sha256").update(metadata.stdout).digest("hex"),
    );
  },
);

it("proves a keg-only dependency's active opt target even when linked_keg is null", async () => {
  const fixture = activeKegFixture();
  fixture.dependency.linked_keg = null;
  const result = await observeMacQaDependencies(
    fixture.metadata,
    "/opt/homebrew/opt/ffmpeg-full/bin",
    fixture.run,
    fixture.resolvePath,
  );
  expect(result.summary).toContain("brew:p11-kit=0.26.6");
  expect(result.local.activeKegs[0]!.version).toBe("0.26.6");
});

it("keeps maximum-length active dependency identities within the complete public receipt contract", async () => {
  const fixture = activeKegFixture("a".repeat(100));
  const selected = "A".repeat(100);
  fixture.dependency.installed = [
    { version: "B".repeat(100) },
    { version: selected },
  ];
  fixture.dependency.linked_keg = selected;
  fixture.paths.resolvedPrefix = fixture.paths.resolvedCellar + "/" + selected;
  const result = await observeMacQaDependencies(
    fixture.metadata,
    "/opt/homebrew/opt/ffmpeg-full/bin",
    fixture.run,
    fixture.resolvePath,
  );
  expect(result.summary).toContain(
    `brew:${fixture.dependency.name}=${selected}`,
  );
  expect(result.summary.every((entry) => entry.length <= 300)).toBe(true);
  const evidence = syntheticRenderQaEvidence("darwin-arm64");
  evidence.admission.dependencies = result.summary;
  expect(validateRenderQaEvidence(evidence)).toBe(evidence);
});

it.each([false, true])(
  "selects revision-bearing dependency versions by the actual active target (reversed=%s)",
  async (reversed) => {
    const fixture = activeKegFixture("harfbuzz");
    fixture.dependency.installed = [
      { version: "15.0.0_1" },
      { version: "15.1.0" },
    ];
    if (reversed) fixture.dependency.installed.reverse();
    fixture.dependency.linked_keg = "15.1.0";
    fixture.paths.resolvedPrefix = fixture.paths.resolvedCellar + "/15.1.0";
    const result = await observeMacQaDependencies(
      fixture.metadata,
      "/opt/homebrew/opt/ffmpeg-full/bin",
      fixture.run,
      fixture.resolvePath,
    );
    expect(result.summary).toContain("brew:harfbuzz=15.1.0");
    expect(result.local.activeKegs[0]!.version).toBe("15.1.0");
  },
);

it("bounds installed dependency candidates at sixteen without relaxing root FFmpeg admission", async () => {
  const fixture = activeKegFixture();
  fixture.dependency.installed = Array.from({ length: 16 }, (_, i) => ({
    version: `0.26.${i}`,
  }));
  const result = await observeMacQaDependencies(
    fixture.metadata,
    "/opt/homebrew/opt/ffmpeg-full/bin",
    fixture.run,
    fixture.resolvePath,
  );
  expect(result.local.activeKegs[0]!.installedCount).toBe(16);
  const changedRoot = structuredClone(fixture.metadata);
  changedRoot.formulae[0]!.installed.push({
    version: "9.0.2_2",
    poured_from_bottle: true,
  });
  const run = vi.fn(async () => JSON.stringify(changedRoot));
  await expect(
    observeMacQaDependencies(
      fixture.metadata,
      "/opt/homebrew/opt/ffmpeg-full/bin",
      run,
      fixture.resolvePath,
    ),
  ).rejects.toThrow(/installed\.length/u);
  expect(run).toHaveBeenCalledTimes(1);
});

it.each([
  "outside Cellar",
  "wrong Cellar formula",
  "wrong resolved Cellar formula",
  "unknown version",
  "linked mismatch",
  "malformed linked version",
  "missing linked identity",
  "duplicate versions",
  "zero versions",
  "too many versions",
  "invalid second version",
  "missing prefix",
  "resolver failure",
  "dot path",
  "relative prefix",
  "multiline prefix",
  "oversized prefix",
  "noncanonical resolved prefix",
])("rejects unverifiable active dependency selection: %s", async (mutation) => {
  const fixture = activeKegFixture();
  if (mutation === "outside Cellar")
    fixture.paths.resolvedPrefix = "/private/outside/p11-kit/0.26.6";
  if (mutation === "wrong Cellar formula")
    fixture.paths.cellar = "/private/openfilm/Cellar/other";
  if (mutation === "wrong resolved Cellar formula")
    fixture.paths.resolvedCellar = "/private/openfilm/Cellar/other";
  if (mutation === "unknown version")
    fixture.paths.resolvedPrefix = fixture.paths.resolvedCellar + "/9.9.9";
  if (mutation === "linked mismatch") fixture.dependency.linked_keg = "0.26.5";
  if (mutation === "malformed linked version")
    fixture.dependency.linked_keg = "\u001b[31m\n/private/secret";
  if (mutation === "missing linked identity")
    fixture.dependency.linked_keg = undefined;
  if (mutation === "duplicate versions")
    fixture.dependency.installed = [
      { version: "0.26.6" },
      { version: "0.26.6" },
    ];
  if (mutation === "zero versions") fixture.dependency.installed = [];
  if (mutation === "too many versions")
    fixture.dependency.installed = Array.from({ length: 17 }, (_, i) => ({
      version: `0.26.${i}`,
    }));
  if (mutation === "invalid second version")
    fixture.dependency.installed[1]!.version = "\u001b[31m\n/private/secret";
  if (mutation === "dot path")
    fixture.paths.cellar = "/private/openfilm/Cellar/../Cellar/p11-kit";
  if (mutation === "relative prefix")
    fixture.paths.prefix = "private/opt/p11-kit";
  if (mutation === "multiline prefix")
    fixture.paths.prefix += "\n::error::/private/secret";
  if (mutation === "oversized prefix")
    fixture.paths.prefix = "/" + "x".repeat(4_097);
  if (mutation === "noncanonical resolved prefix")
    fixture.paths.resolvedPrefix += "/../0.26.6";
  try {
    await observeMacQaDependencies(
      fixture.metadata,
      "/opt/homebrew/opt/ffmpeg-full/bin",
      async (command, args) => {
        if (
          mutation === "missing prefix" &&
          command === "brew" &&
          args[0] === "--prefix"
        )
          throw new Error("ENOENT /private/secret");
        return fixture.run(command, args);
      },
      async (path) => {
        if (mutation === "resolver failure")
          throw new Error("EACCES /private/secret");
        return fixture.resolvePath(path);
      },
    );
    expect.unreachable("unverifiable active keg must fail admission");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(
      /^Missing or invalid installed Homebrew dependency identity; /u,
    );
    expect(message.length).toBeLessThan(1_500);
    expect(message).not.toContain("/private");
    expect(message).not.toContain("::error::");
    expect(
      [...message].every(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
    ).toBe(true);
    expect(fixture.calls.some(([command]) => command === "otool")).toBe(false);
  }
});

it("diagnoses rejected installed dependency identities without accepting absent, aliased or multiple kegs", async () => {
  const hostile =
    "\u001b[31m\n::error::/private/media/secret\r" + "x".repeat(50_000);
  const valid = {
    name: "libvpx",
    tap: "homebrew/core",
    installed: [{ version: "1.15.2" }],
    dependencies: [],
    license: "BSD-3-Clause",
  };
  for (const scenario of [
    {
      data: null,
      rejected: "formulae.length",
      count: "invalid",
      versions: [],
      canonical: "invalid",
      truncated: false,
      linked: null,
    },
    {
      data: { formulae: [{ ...valid, installed: [] }] },
      rejected: "installed.length",
      count: 0,
      versions: [],
      canonical: "libvpx",
      truncated: false,
      linked: null,
    },
    {
      data: {
        formulae: [
          {
            ...valid,
            installed: [{ version: "1.15.1" }, { version: "1.15.2" }],
            linked_keg: "1.15.2",
          },
        ],
      },
      rejected: "activeKeg",
      count: 2,
      versions: ["1.15.1", "1.15.2"],
      canonical: "libvpx",
      truncated: false,
      linked: "1.15.2",
    },
    {
      data: { formulae: [{ ...valid, name: "vpx" }] },
      rejected: "name",
      count: 1,
      versions: ["1.15.2"],
      canonical: "vpx",
      truncated: false,
      linked: null,
    },
    {
      data: {
        formulae: [
          {
            ...valid,
            name: hostile,
            installed: [{ version: hostile }],
            linked_keg: hostile,
          },
        ],
      },
      rejected: "name",
      count: 1,
      versions: ["invalid"],
      canonical: "invalid",
      truncated: false,
      linked: "invalid",
    },
    {
      data: {
        formulae: [
          {
            ...valid,
            installed: Array.from({ length: 129 }, () => ({
              version: "1.15.2",
            })),
          },
        ],
      },
      rejected: "installed.length",
      count: 129,
      versions: Array(4).fill("1.15.2"),
      canonical: "libvpx",
      truncated: true,
      linked: null,
    },
    {
      data: {
        formulae: [
          {
            ...valid,
            name: "a".repeat(100),
            installed: Array.from({ length: 129 }, () => ({
              version: "A".repeat(100),
            })),
            linked_keg: "A".repeat(100),
          },
        ],
      },
      rejected: "name",
      count: 129,
      versions: Array(4).fill("A".repeat(100)),
      canonical: "a".repeat(100),
      truncated: true,
      linked: "A".repeat(100),
    },
  ]) {
    const fixture = macObservationFixture();
    const commands: string[] = [];
    try {
      await observeMacQaDependencies(
        fixture.metadata,
        "/opt/homebrew/opt/ffmpeg-full/bin",
        async (command, args) => {
          commands.push(command);
          if (command === "brew" && args[2] === "libvpx")
            return JSON.stringify(scenario.data);
          return fixture.run(command, args);
        },
      );
      expect.unreachable("rejected dependency must fail admission");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(
        /^Missing or invalid installed Homebrew dependency identity; /u,
      );
      expect(message.length).toBeLessThan(1_500);
      expect(
        [...message].every(
          (character) =>
            character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      ).toBe(true);
      expect(message).not.toContain("/private");
      expect(message).not.toContain("::error::");
      const diagnostic = JSON.parse(message.slice(message.indexOf("; ") + 2));
      expect(diagnostic).toMatchObject({
        requested: "libvpx",
        canonicalName: scenario.canonical,
        installedCount: scenario.count,
        versions: scenario.versions,
        versionsTruncated: scenario.truncated,
        linkedKeg: scenario.linked,
        observationSha256: createHash("sha256")
          .update(JSON.stringify(scenario.data))
          .digest("hex"),
        observationBytes: Buffer.byteLength(
          JSON.stringify(scenario.data),
          "utf8",
        ),
      });
      expect(diagnostic.rejected).toContain(scenario.rejected);
      expect(commands).not.toContain("otool");
    }
  }
});
it.each([
  "missing dependencies",
  "empty dependencies",
  "changed dependency inventory",
  "option-shaped dependency",
  "duplicate dependencies",
  "oversized dependency inventory",
  "missing installed metadata",
  "wrong dependency",
  "missing dependency license",
  "missing nested dependency inventory",
  "oversized JSON",
  "empty libraries",
  "malformed libraries",
  "missing command",
])("fails macOS observations closed on %s", async (mutation) => {
  const fixture = macObservationFixture();
  if (mutation === "missing dependencies")
    delete (fixture.metadata.formulae[0] as { dependencies?: string[] })
      .dependencies;
  if (mutation === "empty dependencies")
    Object.assign(fixture.metadata.formulae[0]!, { dependencies: [] });
  if (mutation === "option-shaped dependency")
    Object.assign(fixture.metadata.formulae[0]!, { dependencies: ["--help"] });
  if (mutation === "duplicate dependencies")
    Object.assign(fixture.metadata.formulae[0]!, {
      dependencies: ["libvpx", "libvpx"],
    });
  if (mutation === "oversized dependency inventory")
    Object.assign(fixture.metadata.formulae[0]!, {
      dependencies: Array.from({ length: 65 }, (_, i) => `dep${i}`),
    });
  const run = async (command: string, args: string[]) => {
    if (
      mutation === "changed dependency inventory" &&
      command === "brew" &&
      args[2] === "ffmpeg-full"
    ) {
      const changed = structuredClone(fixture.metadata);
      Object.assign(changed.formulae[0]!, { dependencies: ["other"] });
      return JSON.stringify(changed);
    }
    if (mutation === "missing command" && command === "otool")
      throw new Error("otool missing");
    if (command === "otool" && mutation === "empty libraries")
      return `${args[1]}:`;
    if (command === "otool" && mutation === "malformed libraries")
      return `${args[1]}:\nnot a library record`;
    if (command === "brew" && args[2] === "libvpx") {
      if (
        mutation === "missing dependency license" ||
        mutation === "missing nested dependency inventory"
      ) {
        const data = JSON.parse(await fixture.run(command, args));
        delete data.formulae[0][
          mutation === "missing dependency license" ? "license" : "dependencies"
        ];
        return JSON.stringify(data);
      }
      if (mutation === "missing installed metadata")
        return JSON.stringify({
          formulae: [{ name: "libvpx", tap: "homebrew/core", installed: [] }],
        });
      if (mutation === "wrong dependency")
        return JSON.stringify({
          formulae: [
            {
              name: "impostor",
              tap: "homebrew/core",
              installed: [{ version: "1" }],
            },
          ],
        });
      if (mutation === "oversized JSON") return " ".repeat(256 * 1024 + 1);
    }
    return fixture.run(command, args);
  };
  await expect(
    observeMacQaDependencies(
      fixture.metadata,
      "/opt/homebrew/opt/ffmpeg/bin",
      run,
    ),
  ).rejects.toThrow(/Homebrew|otool|macOS/u);
  if (mutation === "option-shaped dependency")
    expect(fixture.calls).toEqual([]);
});
