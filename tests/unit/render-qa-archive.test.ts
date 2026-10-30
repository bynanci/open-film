// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
const roots: string[] = [];
const python = process.platform === "win32" ? "python" : "python3";
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function archive(names: string[]) {
  const root = await mkdtemp(join(tmpdir(), "openfilm-qa-archive-"));
  roots.push(root);
  const path = join(root, "fixture.zip");
  execFileSync(
    python,
    [
      "-c",
      "import sys,json,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for name in json.loads(sys.argv[2]): z.writestr(name,b'generated non-executable fixture')",
      path,
      JSON.stringify(names),
    ],
    { stdio: "pipe" },
  );
  return { root, path, output: join(root, "output") };
}
it("extracts regular files from the verified Windows archive layout", async () => {
  const f = await archive([
    "ffmpeg-9.0.2/bin/ffmpeg.exe",
    "ffmpeg-9.0.2/bin/ffprobe.exe",
    "ffmpeg-9.0.2/LICENSE",
  ]);
  execFileSync(
    python,
    ["scripts/ci/extract-render-qa-tools.py", f.path, f.output],
    { stdio: "pipe" },
  );
  expect(
    await readFile(join(f.output, "ffmpeg-9.0.2/LICENSE"), "utf8"),
  ).toContain("generated non-executable");
});
it.each([
  { names: ["../escape.exe"] },
  { names: ["/absolute.exe"] },
  { names: ["C:/drive.exe"] },
  { names: ["bin/CON.exe"] },
  { names: ["bin/A.exe", "bin/a.exe"] },
  { names: ["bin/ffmpeg.exe", "bin/ffmpeg.exe"] },
])("rejects unsafe or ambiguous ZIP paths $names", async ({ names }) => {
  const f = await archive(names);
  expect(() =>
    execFileSync(
      python,
      ["scripts/ci/extract-render-qa-tools.py", f.path, f.output],
      { stdio: "pipe" },
    ),
  ).toThrow();
});
