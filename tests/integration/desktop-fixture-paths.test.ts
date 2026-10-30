// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, it, vi } from "vitest";
import { OpenFilmApplication } from "@openfilm/application";
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
    app = await OpenFilmApplication.create(
      fixture.project,
      "Synthetic canonical fixture",
    );
    const imported = await app.importFiles(paths);
    expect(imported.job.errors).toEqual([]);
    expect(imported.imported).toBe(2);
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
    app?.close();
    await rm(outer, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
