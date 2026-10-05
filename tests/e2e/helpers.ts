import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateSampleMedia } from "../../fixtures/sample-media/generate.mjs";

export async function createDesktopFixture(extraPhotos = 6) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-desktop-"));
  const media = join(root, "memories");
  await mkdir(media);
  const originals = await generateSampleMedia(media);
  for (let index = 0; index < extraPhotos; index++) {
    const path = join(
      media,
      `${String(index + 6).padStart(2, "0")}-memory.png`,
    );
    await copyFile(
      join(media, index % 2 ? "03-evening.png" : "01-photo.png"),
      path,
    );
    const captured = new Date(Date.UTC(2024, 5, 15, 12, index + 6));
    await utimes(path, captured, captured);
    originals.push(path);
  }
  const broken = join(media, "broken.mp4");
  await writeFile(
    broken,
    "A deliberately invalid media file for import isolation.",
  );
  originals.push(broken);
  const before = await Promise.all(originals.map((path) => readFile(path)));
  return {
    root,
    media,
    project: join(root, "memories.openfilm"),
    originals,
    assertOriginalsUnchanged: async () => {
      const after = await Promise.all(originals.map((path) => readFile(path)));
      return after.every((buffer, index) => buffer.equals(before[index]!));
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
