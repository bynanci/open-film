// SPDX-License-Identifier: Apache-2.0
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { stageLinuxQaBin } from "../../scripts/ci/render-qa-tools.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("copies only the two admitted Linux executables into a bin that cannot shadow Node", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-qa-bin-"));
  roots.push(root);
  const source = join(root, "platform-bin"),
    target = join(root, "qa-bin");
  await mkdir(source);
  for (const name of ["ffmpeg", "ffprobe", "node"])
    await writeFile(join(source, name), `synthetic bytes for ${name}`);
  await stageLinuxQaBin(source, target);
  expect((await readdir(target)).sort()).toEqual(["ffmpeg", "ffprobe"]);
  expect(await readFile(join(target, "ffmpeg"), "utf8")).toBe(
    "synthetic bytes for ffmpeg",
  );
  await expect(stageLinuxQaBin(source, target)).rejects.toThrow();
  expect(await readFile(join(target, "ffmpeg"), "utf8")).toBe(
    "synthetic bytes for ffmpeg",
  );
});
