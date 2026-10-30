// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, link, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const BENCHMARK_LINKS_PER_BANK = 500;
export async function createBenchmarkMediaFiles(
  source: string,
  directory: string,
  count: number,
): Promise<string[]> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000)
    throw new Error("Invalid benchmark asset count.");
  await mkdir(directory);
  const banks = join(dirname(directory), `${basename(directory)}-sources`);
  await mkdir(banks);
  const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  const sourceHash = hash(await readFile(source));
  let backing = source;
  const paths: string[] = [];
  for (let index = 0; index < count; index++) {
    if (index > 0 && index % BENCHMARK_LINKS_PER_BANK === 0) {
      backing = join(banks, `${index}.mp4`);
      await copyFile(source, backing, constants.COPYFILE_EXCL);
      if (hash(await readFile(backing)) !== sourceHash)
        throw new Error("Benchmark source bank changed its synthetic bytes.");
    }
    const path = join(directory, `${String(index).padStart(4, "0")}.mp4`);
    await link(backing, path);
    paths.push(path);
  }
  return paths;
}
