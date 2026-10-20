import { afterEach, expect, it } from "vitest";
import { watch } from "node:fs";
import { mkdtemp, open, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyHandoffSource } from "../../packages/application/src/nle-handoff.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("aborts a real sparse-source copy before completion and closes handles", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-handoff-copy-"));
  roots.push(root);
  const source = join(root, "source.bin"),
    destination = join(root, "destination.bin"),
    size = 64 * 1024 ** 2;
  const file = await open(source, "wx");
  await file.truncate(size);
  await file.close();
  const controller = new AbortController();
  const observer = watch(root, (_, name) => {
    if (name?.toString() === "destination.bin") controller.abort();
  });
  try {
    await expect(
      copyHandoffSource(source, destination, controller.signal),
    ).rejects.toThrow();
  } finally {
    observer.close();
  }
  expect(controller.signal.aborted).toBe(true);
  expect((await stat(destination)).size).toBeLessThan(size);
  expect((await stat(source)).size).toBe(size);
  await rm(destination); // The writer handle is already closed, including on Windows.
});
it("exclusive streaming copy cannot overwrite an existing destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "openfilm-handoff-copy-"));
  roots.push(root);
  const source = join(root, "source"),
    destination = join(root, "destination");
  const input = await open(source, "wx");
  await input.writeFile("source");
  await input.close();
  const output = await open(destination, "wx");
  await output.writeFile("keep");
  await output.close();
  await expect(copyHandoffSource(source, destination)).rejects.toThrow();
  expect(await readFile(destination, "utf8")).toBe("keep");
});
