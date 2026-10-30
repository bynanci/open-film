// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  admitBrewFormula,
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
