import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNativeBenchmarkFixture,
  type NativeBenchmarkFixtureManifest,
} from "../../scripts/native-benchmark/create-fixture";
import { validateNativeBenchmarkFixture } from "../../scripts/native-benchmark/validate-fixture";

const linkFault = vi.hoisted(() => ({
  attempts: 0,
  successfulLinks: Number.POSITIVE_INFINITY,
  code: "EMLINK",
}));
// Inject only the OS link failure. Source generation, successful links,
// fallback copying, hashing and persistence use the real implementation.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (source: string, destination: string) => {
      if (linkFault.attempts++ >= linkFault.successfulLinks)
        throw Object.assign(
          new Error(`Injected OS link failure: ${linkFault.code}`),
          {
            code: linkFault.code,
          },
        );
      return actual.link(source, destination);
    },
  };
});

const roots: string[] = [];
async function destination() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-link-capacity-"));
  roots.push(root);
  return join(root, "fixture");
}
afterEach(async () => {
  linkFault.attempts = 0;
  linkFault.successfulLinks = Number.POSITIVE_INFINITY;
  linkFault.code = "EMLINK";
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("native fixture filesystem link capacity", () => {
  it("finishes the 2000-asset workload with independent copies after the hardlink ceiling", async () => {
    const directory = await destination();
    linkFault.successfulLinks = 1023;
    const result = await createNativeBenchmarkFixture(directory);
    const manifest = JSON.parse(
      await readFile(result.manifestPath, "utf8"),
    ) as NativeBenchmarkFixtureManifest;
    expect(manifest.counts).toEqual({ assets: 2000, clips: 500, beats: 10 });
    expect(manifest.media).toHaveLength(2000);
    expect(manifest.linkedMediaCount).toBe(1023);
    expect(manifest.copiedMediaCount).toBe(977);
    const source = await stat(join(directory, manifest.source.relativePath), {
      bigint: true,
    });
    expect(source.nlink).toBe(1024n);
    const copyInodes = new Set<bigint>();
    for (const [index, media] of manifest.media.entries()) {
      const path = join(directory, media.relativePath);
      const info = await stat(path, { bigint: true });
      expect(info.size).toBe(BigInt(media.fileSize));
      expect(
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ).toBe(media.sha256);
      if (index < 1023) expect(info.ino).toBe(source.ino);
      else {
        expect(info.ino).not.toBe(source.ino);
        expect(info.nlink).toBe(1n);
        copyInodes.add(info.ino);
      }
    }
    expect(copyInodes.size).toBe(977);
    expect(
      await validateNativeBenchmarkFixture(
        result.manifestPath,
        result.projectPath,
      ),
    ).toEqual(manifest);
  });

  it("preserves unexpected EIO as a failure instead of silently copying", async () => {
    const directory = await destination();
    linkFault.successfulLinks = 0;
    linkFault.code = "EIO";
    await expect(
      createNativeBenchmarkFixture(directory, {
        assets: 2,
        clips: 2,
        beats: 1,
      }),
    ).rejects.toMatchObject({ code: "EIO" });
    expect(await readdir(join(directory, "media"))).toEqual([]);
    await expect(
      stat(join(directory, "fixture-manifest.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
