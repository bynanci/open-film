import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenFilmApplication } from "@openfilm/application";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeBenchmarkFixture } from "../../scripts/native-benchmark/create-fixture";
import {
  copyNativeBenchmarkProject,
  validateNativeBenchmarkFixture,
} from "../../scripts/native-benchmark/validate-fixture";

const directories: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-runtime-copy-"));
  directories.push(root);
  const fixtureRoot = join(root, "immutable-fixture");
  const result = await createNativeBenchmarkFixture(fixtureRoot, {
    assets: 2,
    clips: 2,
    beats: 1,
  });
  const manifest = await validateNativeBenchmarkFixture(
    result.manifestPath,
    result.projectPath,
  );
  return { root, fixtureRoot, manifest, ...result };
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("isolated native benchmark runtime project", () => {
  it("starts two copies with identical declared bytes and keeps real application saves out of the template", async () => {
    const f = await fixture();
    const destinations = [
      join(f.root, "run-1.openfilm"),
      join(f.root, "run-2.openfilm"),
    ];
    const sourceProject = await readFile(
      join(f.projectPath, "project.json"),
      "utf8",
    );
    const sourceManifest = await readFile(f.manifestPath, "utf8");
    for (const destination of destinations) {
      expect(
        await copyNativeBenchmarkProject(
          f.manifestPath,
          f.manifest,
          destination,
        ),
      ).toBe(destination);
      for (const descriptor of f.manifest.files.filter((file) =>
        file.relativePath.startsWith("benchmark.openfilm/"),
      )) {
        const path = join(
          destination,
          descriptor.relativePath.slice("benchmark.openfilm/".length),
        );
        const bytes = await readFile(path);
        expect(bytes.length).toBe(descriptor.fileSize);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          descriptor.sha256,
        );
      }
      await expect(stat(join(destination, "generated"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(join(destination, "media"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }

    const unchanged = await OpenFilmApplication.open(destinations[0]!, {
      userDataDirectory: join(f.root, "run-user-data"),
    });
    try {
      expect(fileURLToPath(unchanged.catalog.getAsset("asset-0000")!.uri)).toBe(
        join(f.fixtureRoot, "media", "0000.mp4"),
      );
    } finally {
      unchanged.close();
    }
    const closedCopy = JSON.parse(
      await readFile(join(destinations[0]!, "project.json"), "utf8"),
    );
    expect(closedCopy.updatedAt).not.toBe(JSON.parse(sourceProject).updatedAt);

    const edited = await OpenFilmApplication.open(destinations[1]!, {
      userDataDirectory: join(f.root, "run-user-data"),
    });
    try {
      edited.project.title = "Run-local manual edits";
      edited.project.timelines[0]!.tracks[0]!.clips[0]!.transform = {
        volume: 0.4,
      };
    } finally {
      edited.close();
    }
    const reopened = await OpenFilmApplication.open(destinations[1]!, {
      userDataDirectory: join(f.root, "run-user-data"),
    });
    try {
      expect(reopened.project.title).toBe("Run-local manual edits");
      expect(
        reopened.project.timelines[0]!.tracks[0]!.clips[0]!.transform,
      ).toEqual({ volume: 0.4 });
    } finally {
      reopened.close();
    }

    expect(await readFile(join(f.projectPath, "project.json"), "utf8")).toBe(
      sourceProject,
    );
    expect(await readFile(f.manifestPath, "utf8")).toBe(sourceManifest);
    expect(
      await validateNativeBenchmarkFixture(f.manifestPath, f.projectPath),
    ).toEqual(f.manifest);
    expect(
      JSON.parse(await readFile(join(destinations[0]!, "project.json"), "utf8"))
        .title,
    ).toBe(JSON.parse(sourceProject).title);
  });

  it("refuses an existing destination without overwriting data", async () => {
    const f = await fixture();
    const destination = join(f.root, "existing.openfilm");
    await mkdir(destination);
    const sentinel = join(destination, "project.json");
    await writeFile(sentinel, "existing project");
    await expect(
      copyNativeBenchmarkProject(f.manifestPath, f.manifest, destination),
    ).rejects.toThrow(/EEXIST|exist/iu);
    expect(await readFile(sentinel, "utf8")).toBe("existing project");
    expect(
      await validateNativeBenchmarkFixture(f.manifestPath, f.projectPath),
    ).toEqual(f.manifest);
  });

  it("rejects source changes after validation instead of silently rehashing the runtime copy", async () => {
    const f = await fixture();
    const path = join(f.projectPath, "project.json");
    const bytes = await readFile(path);
    bytes[0] = bytes[0]! ^ 1;
    await writeFile(path, bytes);
    await expect(
      copyNativeBenchmarkProject(
        f.manifestPath,
        f.manifest,
        join(f.root, "mismatch.openfilm"),
      ),
    ).rejects.toThrow(/hash|SHA256/iu);
    expect(await readFile(f.manifestPath, "utf8")).toBe(
      JSON.stringify(f.manifest, null, 2) + "\n",
    );
  });

  it("copies explicitly declared WAL bytes with their original identity", async () => {
    const f = await fixture();
    const bytes = Buffer.from("declared WAL payload for copy identity test");
    await writeFile(join(f.projectPath, "database.sqlite-wal"), bytes);
    f.manifest.files.push({
      relativePath: "benchmark.openfilm/database.sqlite-wal",
      fileSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await writeFile(f.manifestPath, JSON.stringify(f.manifest, null, 2) + "\n");
    const validated = await validateNativeBenchmarkFixture(
      f.manifestPath,
      f.projectPath,
    );
    const destination = join(f.root, "wal-copy.openfilm");
    await copyNativeBenchmarkProject(f.manifestPath, validated, destination);
    expect(await readFile(join(destination, "database.sqlite-wal"))).toEqual(
      bytes,
    );
  });
});
