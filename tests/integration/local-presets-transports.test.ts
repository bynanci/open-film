// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startServer } from "../../apps/server/src/server.js";
import { presetPackage } from "../fixtures/local-presets/package.js";
const exec = promisify(execFile),
  cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
const post = (
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfilm-preset-http-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const user = join(root, "user"),
    file = join(root, "Recipes 記憶.json"),
    document = JSON.stringify(presetPackage());
  await writeFile(file, document);
  const server = await startServer({ port: 0, userDataDirectory: user });
  cleanup.push(() => server.close());
  const base = `http://127.0.0.1:${server.port}`,
    cli = async (args: string[]) =>
      JSON.parse(
        (
          await exec(
            process.execPath,
            [
              "--import",
              "tsx",
              resolve("apps/cli/src/index.ts"),
              "presets",
              ...args,
              "--user-data-dir",
              user,
            ],
            { cwd: resolve("."), maxBuffer: 2 * 1024 * 1024 },
          )
        ).stdout,
      );
  return { root, user, file, document, base, cli };
}
it("shares canonical review/install identity with separate CLI processes and removes exact packages", async () => {
  const { base, cli, file, document } = await fixture();
  expect((await fetch(base + "/api/presets")).status).toBe(200);
  const apiReview = await (
      await post(base, "/api/presets/import/review", { document })
    ).json(),
    cliReview = await cli(["review", "--file", file]);
  expect(cliReview.packageSha256).toBe(apiReview.packageSha256);
  expect(cliReview.reviewSha256).toBe(apiReview.reviewSha256);
  const args = [
    "install",
    "--file",
    file,
    "--package-sha",
    apiReview.packageSha256,
    "--base-revision",
    apiReview.registryRevision,
    "--review-sha",
    apiReview.reviewSha256,
  ];
  await expect(cli(args)).rejects.toThrow();
  const installed = await cli([...args, "--accept-license"]);
  expect(installed.packages).toHaveLength(1);
  expect((await cli([...args, "--accept-license"])).revision).toBe(
    installed.revision,
  );
  const p = installed.packages[0];
  const removal = await post(base, "/api/presets/remove", {
    packageId: p.id,
    packageVersion: p.version,
    packageSha256: p.packageSha256,
    baseRegistryRevision: installed.revision,
  });
  expect(removal.status).toBe(200);
  expect((await removal.json()).packages).toHaveLength(0);
  expect(await readFile(file, "utf8")).toBe(document);
});
it("rejects paths/root overrides, forbidden origins, byte overflow and unknown fields before installing", async () => {
  const { base, document } = await fixture();
  for (const body of [
    { path: "/etc/passwd" },
    { document, userDataDirectory: "/tmp/outside" },
    { document, entry: "run.js" },
  ])
    expect((await post(base, "/api/presets/import/review", body)).status).toBe(
      400,
    );
  expect(
    (
      await post(
        base,
        "/api/presets/import/review",
        { document },
        { Origin: "https://remote.example" },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await post(base, "/api/presets/import/review", {
        document: " ".repeat(1048577),
      })
    ).status,
  ).toBe(413);
  const r = await (
    await post(base, "/api/presets/import/review", { document })
  ).json();
  expect(
    (
      await post(base, "/api/presets/import/accept", {
        document,
        packageSha256: r.packageSha256,
        baseRegistryRevision: r.registryRevision,
        reviewSha256: r.reviewSha256,
      })
    ).status,
  ).toBe(400);
  expect(
    (await (await fetch(base + "/api/presets")).json()).packages,
  ).toHaveLength(0);
});
