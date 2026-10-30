// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, writeFile, readFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  BENCHMARK_LINKS_PER_BANK,
  createBenchmarkMediaFiles,
} from "../e2e/benchmark-media.js";

it("preserves all2000 unique asset paths and bytes below the NTFS hardlink ceiling", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-benchmark-media-"));
  const source = join(root, "source.mp4");
  const bytes = Buffer.from("Synthetic benchmark topology fixture");
  try {
    await writeFile(source, bytes);
    const paths = await createBenchmarkMediaFiles(
      source,
      join(root, "media"),
      2000,
    );
    expect(paths).toHaveLength(2000);
    expect(new Set(paths).size).toBe(2000);
    expect((await lstat(source)).nlink).toBeLessThanOrEqual(
      BENCHMARK_LINKS_PER_BANK + 1,
    );
    for (let offset = 0; offset < paths.length; offset += 32)
      await Promise.all(
        paths.slice(offset, offset + 32).map(async (path) => {
          expect(await readFile(path)).toEqual(bytes);
          expect((await lstat(path)).nlink).toBeLessThanOrEqual(
            BENCHMARK_LINKS_PER_BANK + 1,
          );
        }),
      );
    expect(await readFile(source)).toEqual(bytes);
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

it.each([0, -1, 0.5, 10_001, Infinity])(
  "rejects an unbounded or invalid fixture count%s",
  async (count) => {
    await expect(
      createBenchmarkMediaFiles("unused-source", "unused-directory", count),
    ).rejects.toThrow(/count/u);
  },
);
