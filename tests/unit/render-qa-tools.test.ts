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
  downloadPinnedBytes,
  verifyPinnedBytes,
} from "../../scripts/ci/render-qa-tools.js";
import pins from "../../fixtures/render-qa/toolchain.json";
import { setupRenderQa } from "../../scripts/ci/setup-render-qa.js";

afterEach(() => vi.unstubAllGlobals());
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
        name: "ffmpeg",
        tap: "homebrew/core",
        versions: { stable: "9.0.2" },
        revision: 1,
        license: "GPL-3.0-or-later",
        bottle: {
          stable: {
            files: {
              arm64_sequoia: { sha256: pins.tools["darwin-arm64"].sha256 },
            },
          },
        },
        installed: [{ version: "9.0.2_1", poured_from_bottle: true }],
      },
    ],
  };
}
it("admits the exact Homebrew formula/bottle and installed identity", () => {
  expect(() => admitBrewFormula(formula(), true)).not.toThrow();
  for (const change of [
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

it("installs the admitted Homebrew formula rather than treating its cache path as a formula", () => {
  const setup = readFileSync("scripts/ci/setup-render-qa.ts", "utf8");
  expect(setup).toContain(
    'await run("brew", ["install", "--force-bottle", "ffmpeg"]);',
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
      if (args[2] === "ffmpeg") return JSON.stringify(metadata);
      return JSON.stringify({
        formulae: [
          {
            name: "libvpx",
            tap: "homebrew/core",
            installed: [{ version: "1.15.2" }],
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
    ["brew", ["info", "--json=v2", "ffmpeg"]],
    ["brew", ["info", "--json=v2", "libvpx"]],
    ["otool", ["-L", "/opt/homebrew/opt/ffmpeg/bin/ffmpeg"]],
    ["otool", ["-L", "/opt/homebrew/opt/ffmpeg/bin/ffprobe"]],
  ]);
  expect(result.local.metadata.map((item) => item.name)).toEqual([
    "ffmpeg",
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
it.each([
  "missing dependencies",
  "empty dependencies",
  "changed dependency inventory",
  "option-shaped dependency",
  "duplicate dependencies",
  "oversized dependency inventory",
  "missing installed metadata",
  "wrong dependency",
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
      args[2] === "ffmpeg"
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
