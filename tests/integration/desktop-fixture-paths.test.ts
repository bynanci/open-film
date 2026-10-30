// SPDX-License-Identifier: Apache-2.0
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  statfs,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, it, vi } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
import * as media from "@openfilm/media";
import { createDesktopFixture } from "../e2e/helpers.js";

it("canonicalizes only owned temporary fixtures while keeping alias import guards intact", async () => {
  const outer = await realpath(
    await mkdtemp(join(tmpdir(), "openfilm-fixture-paths-")),
  );
  const directory = join(outer, "owned");
  const alias = join(outer, "alias");
  await mkdir(directory);
  await symlink(directory, alias, "dir");
  let fixture: Awaited<ReturnType<typeof createDesktopFixture>> | undefined;
  let app: OpenFilmApplication | undefined;
  try {
    for (const name of ["TMPDIR", "TMP", "TEMP"]) vi.stubEnv(name, alias);
    fixture = await createDesktopFixture(0);
    expect(fixture.root).toBe(await realpath(fixture.root));
    const paths = ["01-photo.png", "04-motion.mp4"].map((name) =>
      join(fixture!.media, name),
    );
    const generation: Record<string, unknown> = {};
    const verifiedSource = media.withVerifiedSourceFile;
    const observedSource: typeof verifiedSource = async (
      path,
      hash,
      consume,
      options,
    ) => {
      generation.sourceReached = true;
      try {
        return await verifiedSource(path, hash, consume, options);
      } catch (error) {
        generation.sourceFailure = String(error).slice(0, 2000);
        throw error;
      }
    };
    vi.spyOn(media, "withVerifiedSourceFile").mockImplementation(
      observedSource,
    );
    app = await OpenFilmApplication.create(
      fixture.project,
      "Synthetic canonical fixture",
      {},
      {
        proxyGenerator: async (asset, output, signal, options) => {
          generation.started = true;
          generation.expectedDuration = asset.duration;
          try {
            await media.createProxy(asset, output, signal, options);
            generation.completed = true;
          } catch (error) {
            generation.failure = String(error).slice(0, 2000);
            throw error;
          }
          try {
            const probe = JSON.parse(
              (
                await media.runProcess(
                  "ffprobe",
                  [
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration:stream=codec_type,width,height,duration",
                    "-of",
                    "json",
                    output,
                  ],
                  { signal },
                )
              ).stdout.toString(),
            );
            generation.decoded = probe;
          } catch {
            generation.probeFailed = true;
          }
        },
      },
    );
    const space = await statfs(app.directory);
    generation.space = { bsize: space.bsize, bavail: space.bavail };
    const imported = await app.importFiles(paths);
    expect(imported.job.errors, JSON.stringify(generation)).toEqual([]);
    expect(imported.imported).toBe(2);
    expect(generation.sourceReached).toBe(true);
    const aliasedSource = join(alias, relative(directory, paths[0]!));
    const rejected = await app.importFiles([aliasedSource]);
    expect(rejected.imported).toBe(0);
    expect(rejected.failed).toBe(1);
    expect(rejected.job.errors).toEqual([
      expect.objectContaining({ code: "request.invalid", stage: "discover" }),
    ]);
    expect(app.catalog.listAssets()).toHaveLength(2);
    expect(await fixture.assertOriginalsUnchanged()).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    app?.close();
    await rm(outer, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
