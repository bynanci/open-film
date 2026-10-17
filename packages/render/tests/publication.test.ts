import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishRenderPair,
  RenderPublicationRecoveryError,
  validateRenderTargets,
} from "../src/publication.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(existing = true) {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-publication-"));
  directories.push(directory);
  const work = join(directory, ".render-work");
  await mkdir(work);
  const output = join(directory, "film.mp4");
  const manifest = `${output}.manifest.json`;
  const temporaryOutput = join(work, "new.mp4");
  const temporaryManifest = join(work, "new.manifest.json");
  await writeFile(temporaryOutput, "new video");
  await writeFile(temporaryManifest, "new receipt");
  if (existing) {
    await writeFile(output, "original video");
    await writeFile(manifest, "original receipt");
  }
  return {
    directory,
    work,
    output,
    manifest,
    temporaryOutput,
    temporaryManifest,
  };
}

describe("MP4 and manifest publication", () => {
  it("publishes the complete staged pair over regular existing files", async () => {
    const f = await fixture();
    await publishRenderPair(
      f.temporaryOutput,
      f.temporaryManifest,
      f.output,
      f.work,
    );
    expect(await readFile(f.output, "utf8")).toBe("new video");
    expect(await readFile(f.manifest, "utf8")).toBe("new receipt");
  });

  it("rejects a sidecar directory before replacing an existing video", async () => {
    const f = await fixture();
    await rm(f.manifest);
    await mkdir(f.manifest);
    const sentinel = join(f.manifest, "keep.txt");
    await writeFile(sentinel, "do not change");
    await expect(validateRenderTargets(f.output)).rejects.toThrow(
      /regular file/iu,
    );
    await expect(
      publishRenderPair(
        f.temporaryOutput,
        f.temporaryManifest,
        f.output,
        f.work,
      ),
    ).rejects.toThrow(/regular file/iu);
    expect(await readFile(f.output, "utf8")).toBe("original video");
    expect(await readFile(sentinel, "utf8")).toBe("do not change");
    expect(await readFile(f.temporaryOutput, "utf8")).toBe("new video");
  });

  it("rejects a sidecar symlink without touching its target", async () => {
    const f = await fixture();
    await rm(f.manifest);
    const target = join(f.directory, "unrelated.json");
    await writeFile(target, "private target");
    await symlink(target, f.manifest);
    await expect(
      publishRenderPair(
        f.temporaryOutput,
        f.temporaryManifest,
        f.output,
        f.work,
      ),
    ).rejects.toThrow(/regular file/iu);
    expect(await readFile(target, "utf8")).toBe("private target");
    expect(await readFile(f.output, "utf8")).toBe("original video");
  });

  it.each([true, false])(
    "restores original state if the manifest rename fails (existing=%s)",
    async (existing) => {
      const f = await fixture(existing);
      const failure = new Error("disk refused the manifest rename");
      await expect(
        publishRenderPair(
          f.temporaryOutput,
          f.temporaryManifest,
          f.output,
          f.work,
          {
            rename: async (source, destination) => {
              if (source === f.temporaryManifest) throw failure;
              await rename(source, destination);
            },
          },
        ),
      ).rejects.toBe(failure);
      if (existing) {
        expect(await readFile(f.output, "utf8")).toBe("original video");
        expect(await readFile(f.manifest, "utf8")).toBe("original receipt");
      } else {
        await expect(readFile(f.output)).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(readFile(f.manifest)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
      expect(await readFile(f.temporaryManifest, "utf8")).toBe("new receipt");
    },
  );

  it("restores the video if moving the existing manifest into a backup fails", async () => {
    const f = await fixture();
    const failure = new Error("original receipt is locked");
    await expect(
      publishRenderPair(
        f.temporaryOutput,
        f.temporaryManifest,
        f.output,
        f.work,
        {
          rename: async (source, destination) => {
            if (source === f.manifest) throw failure;
            await rename(source, destination);
          },
        },
      ),
    ).rejects.toBe(failure);
    expect(await readFile(f.output, "utf8")).toBe("original video");
    expect(await readFile(f.manifest, "utf8")).toBe("original receipt");
    expect(await readFile(f.temporaryOutput, "utf8")).toBe("new video");
  });

  it("restores a legacy video without inventing an old sidecar", async () => {
    const f = await fixture();
    await rm(f.manifest);
    const failure = new Error("new receipt cannot be published");
    await expect(
      publishRenderPair(
        f.temporaryOutput,
        f.temporaryManifest,
        f.output,
        f.work,
        {
          rename: async (source, destination) => {
            if (source === f.temporaryManifest) throw failure;
            await rename(source, destination);
          },
        },
      ),
    ).rejects.toBe(failure);
    expect(await readFile(f.output, "utf8")).toBe("original video");
    await expect(readFile(f.manifest)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retains recovery data when restoring an original fails", async () => {
    const f = await fixture();
    let error: unknown;
    try {
      await publishRenderPair(
        f.temporaryOutput,
        f.temporaryManifest,
        f.output,
        f.work,
        {
          rename: async (source, destination) => {
            if (source === f.temporaryManifest)
              throw new Error("manifest publication failed");
            if (destination === f.output && source !== f.temporaryOutput)
              throw new Error("restoration failed");
            await rename(source, destination);
          },
        },
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RenderPublicationRecoveryError);
    const recovery = error as RenderPublicationRecoveryError;
    expect(recovery.retainWork).toBe(true);
    expect(recovery.workDirectory).toBe(f.work);
    expect(recovery.message).toContain(f.work);
    const retained = await Promise.all(
      (await readdir(f.work)).map((name) =>
        readFile(join(f.work, name), "utf8"),
      ),
    );
    expect(retained).toContain("original video");
    expect(await readFile(f.manifest, "utf8")).toBe("original receipt");
    expect(recovery.recoveryPaths.length).toBeGreaterThan(0);
  });

  it("retains the original backup if removing a partially published file fails", async () => {
    const f = await fixture();
    let error: unknown;
    try {
      await publishRenderPair(
        f.temporaryOutput,
        f.temporaryManifest,
        f.output,
        f.work,
        {
          rename: async (source, destination) => {
            if (source === f.temporaryManifest)
              throw new Error("manifest publication failed");
            await rename(source, destination);
          },
          rm: async (path, options) => {
            if (path === f.output)
              throw new Error("published file is still open");
            await rm(path, options);
          },
        },
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RenderPublicationRecoveryError);
    expect((error as RenderPublicationRecoveryError).retainWork).toBe(true);
    const retained = await Promise.all(
      (await readdir(f.work)).map((name) =>
        readFile(join(f.work, name), "utf8"),
      ),
    );
    expect(retained).toContain("original video");
    expect(await readFile(f.output, "utf8")).toBe("new video");
    expect(await readFile(f.manifest, "utf8")).toBe("original receipt");
  });
});
