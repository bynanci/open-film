import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";

/** Replace a published manifest only after its complete sibling write closes. */
export async function replaceBenchmarkManifest(path: string, contents: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  // Opening outside the cleanup block protects any pre-existing temp artifact.
  const file = await open(temporary, "wx");
  try {
    await file.writeFile(contents, "utf8");
    await file.close();
    // Never remove the destination first, including when replacement is denied.
    await rename(temporary, path);
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
