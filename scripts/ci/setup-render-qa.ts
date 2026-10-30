// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import pins from "../../fixtures/render-qa/toolchain.json";
import { readPinnedTestFonts } from "../../tests/helpers/render-qa-fonts.js";
import {
  admitBrewFormula,
  admitToolVersion,
  downloadPinnedBytes,
  qaSha256,
  stageLinuxQaBin,
  verifyPinnedBytes,
} from "./render-qa-tools.js";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("../..", import.meta.url));
async function run(command: string, args: string[]) {
  const result = await execute(command, args, {
    encoding: "utf8",
    timeout: 900_000,
    maxBuffer: 4 * 1024 ** 2,
    windowsHide: true,
  });
  return result.stdout.trim();
}
async function boundedFile(path: string, limit = 256 * 1024 ** 2) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > limit)
    throw new Error("Invalid bounded tool input");
  const bytes = await readFile(path);
  if (bytes.length !== info.size)
    throw new Error("Tool input changed while reading");
  return bytes;
}
async function pinnedFile(
  path: string,
  pin: { url: string; sha256: string; maxBytes: number },
) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error("Unexpected cached tool symlink");
    verifyPinnedBytes(
      await boundedFile(path, pin.maxBytes),
      pin.sha256,
      pin.maxBytes,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(
      path,
      await downloadPinnedBytes(pin.url, pin.sha256, pin.maxBytes),
      { flag: "wx" },
    );
  }
}
async function fonts(root: string) {
  const target = join(root, "fonts");
  try {
    await lstat(target);
    return await readPinnedTestFonts(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(root, `.fonts-${randomUUID()}`);
  await mkdir(temporary);
  try {
    const entries = [
      pins.fonts.license,
      ...Object.values(pins.fonts.faces).map((face) => ({
        ...face,
        url: `https://raw.githubusercontent.com/notofonts/noto-cjk/${pins.fonts.sourceCommit}/${face.sourcePath}`,
      })),
    ];
    await Promise.all(
      entries.map(async (entry) =>
        writeFile(
          join(temporary, entry.filename),
          await downloadPinnedBytes(
            entry.url,
            entry.sha256,
            entry.filename.endsWith(".otf") ? 32 * 1024 ** 2 : 64 * 1024,
          ),
          { flag: "wx" },
        ),
      ),
    );
    await readPinnedTestFonts(temporary);
    await rename(temporary, target);
    return await readPinnedTestFonts(target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function findWindowsBin(root: string): Promise<string> {
  const executables: Record<string, string[]> = {
    "ffmpeg.exe": [],
    "ffprobe.exe": [],
  };
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error("Unexpected extracted tool symlink");
      if (entry.isDirectory()) await walk(join(path, entry.name));
      else if (entry.name in executables) executables[entry.name]!.push(path);
    }
  }
  await walk(root);
  if (
    executables["ffmpeg.exe"]!.length !== 1 ||
    executables["ffprobe.exe"]!.length !== 1 ||
    executables["ffmpeg.exe"]![0] !== executables["ffprobe.exe"]![0]
  )
    throw new Error("Expected one matching FFmpeg/FFprobe directory");
  return executables["ffmpeg.exe"]![0]!;
}
export interface RenderQaToolReceipt {
  schemaVersion: 1;
  platformId: string;
  provenanceSha256: string;
  fontSourceCommit: string;
  fontSha256: Record<string, string>;
  fontLicenseSha256: string;
  admittedPackageSha256: string | null;
  tools: Record<
    "ffmpeg" | "ffprobe",
    { version: string; sha256: string; configurationSha256: string }
  > | null;
  dependencies: string[];
}
export async function setupRenderQa(options: {
  root: string;
  platform: NodeJS.Platform;
  architecture: string;
  mode: "fonts-only" | "hosted-tools";
}): Promise<RenderQaToolReceipt> {
  if (
    options.platform !== process.platform ||
    options.architecture !== process.arch ||
    !isAbsolute(options.root) ||
    /[\r\n]/u.test(options.root)
  )
    throw new Error("Unreviewed render QA host, architecture or root");
  const platformId = `${process.platform}-${process.arch}`;
  if (!(platformId in pins.tools))
    throw new Error("Unsupported render QA host architecture");
  await mkdir(options.root, { recursive: true });
  const root = await realpath(options.root);
  const lock = await open(join(root, "setup.lock"), "wx");
  try {
    const faces = await fonts(root);
    const receipt: RenderQaToolReceipt = {
      schemaVersion: 1,
      platformId,
      provenanceSha256: qaSha256(
        await readFile(join(repository, "fixtures/render-qa/toolchain.json")),
      ),
      fontSourceCommit: pins.fonts.sourceCommit,
      fontSha256: Object.fromEntries(
        Object.entries(faces).map(([id, font]) => [id, font.sha256]),
      ),
      fontLicenseSha256: pins.fonts.license.sha256,
      admittedPackageSha256: null,
      tools: null,
      dependencies: [],
    };
    let bin: string | undefined;
    if (options.mode === "hosted-tools") {
      if (process.platform === "win32") {
        const pin = pins.tools["win32-x64"];
        const archive = join(root, "ffmpeg.zip");
        await pinnedFile(archive, pin);
        const extracted = join(root, "tools");
        await run("python", [
          join(repository, "scripts/ci/extract-render-qa-tools.py"),
          archive,
          extracted,
        ]);
        bin = await findWindowsBin(extracted);
        if (!process.env.WINDIR || !isAbsolute(process.env.WINDIR))
          throw new Error(
            "Windows font installation needs the trusted system root",
          );
        for (const face of Object.values(faces)) {
          const name = Object.values(pins.fonts.faces).find(
            (pin) => pin.sha256 === face.sha256,
          )!.filename;
          const target = join(process.env.WINDIR, "Fonts", name);
          await copyFile(face.path, target);
          if (
            qaSha256(await boundedFile(target, 32 * 1024 ** 2)) !== face.sha256
          )
            throw new Error("Installed Windows font hash mismatch");
        }
        receipt.admittedPackageSha256 = pin.sha256;
      } else if (process.platform === "linux") {
        if (
          !/^ID=ubuntu$/mu.test(await readFile("/etc/os-release", "utf8")) ||
          !/^VERSION_ID="24\.04"$/mu.test(
            await readFile("/etc/os-release", "utf8"),
          )
        )
          throw new Error("The fixed APT tool recipe requires Ubuntu24.04");
        const pin = pins.tools["linux-x64"];
        const archive = join(root, "ffmpeg.deb");
        await pinnedFile(archive, pin);
        if (
          (await run("dpkg-deb", ["--field", archive, "Version"])) !==
            pin.packageVersion ||
          (await run("dpkg-deb", ["--field", archive, "Architecture"])) !==
            "amd64"
        )
          throw new Error("Unreviewed Ubuntu tool package");
        await run("sudo", ["-n", "apt-get", "update"]);
        await run("sudo", ["-n", "apt-get", "install", "-y", archive]);
        if (
          (await run("dpkg-query", ["-W", "-f=${Version}", "ffmpeg"])) !==
          pin.packageVersion
        )
          throw new Error("Ubuntu tool package identity changed");
        bin = join(root, "bin");
        await stageLinuxQaBin("/usr/bin", bin);
        receipt.dependencies = (
          await run("dpkg-query", [
            "-W",
            "-f=${Package}=${Version}\n",
            "ffmpeg",
            "libavcodec60",
            "libavdevice60",
            "libavfilter9",
            "libavformat60",
            "libavutil58",
            "libpostproc57",
            "libswresample4",
            "libswscale7",
          ])
        )
          .split("\n")
          .sort();
        receipt.admittedPackageSha256 = pin.sha256;
      } else {
        const pin = pins.tools["darwin-arm64"];
        if (!(await run("sw_vers", ["-productVersion"])).startsWith("15."))
          throw new Error(
            "The fixed Homebrew tool recipe requires macOS15 ARM64",
          );
        await downloadPinnedBytes(
          `https://raw.githubusercontent.com/Homebrew/homebrew-core/${pin.formulaCommit}/Formula/f/ffmpeg.rb`,
          pin.formulaSha256,
          64 * 1024,
        );
        const before = JSON.parse(
          await run("brew", ["info", "--json=v2", "ffmpeg"]),
        );
        admitBrewFormula(before, false);
        await run("brew", ["fetch", "--force-bottle", "ffmpeg"]);
        const cache = await run("brew", ["--cache", "ffmpeg"]);
        if (!isAbsolute(cache) || /[\r\n]/u.test(cache))
          throw new Error("Unexpected Homebrew cache identity");
        verifyPinnedBytes(
          await boundedFile(cache, pin.maxBytes),
          pin.sha256,
          pin.maxBytes,
        );
        admitBrewFormula(
          JSON.parse(await run("brew", ["info", "--json=v2", "ffmpeg"])),
          false,
        );
        await run("brew", ["install", "--force-bottle", cache]);
        const after = JSON.parse(
          await run("brew", ["info", "--json=v2", "ffmpeg"]),
        );
        admitBrewFormula(after, true);
        const prefix = await run("brew", ["--prefix", "ffmpeg"]);
        if (!isAbsolute(prefix) || /[\r\n]/u.test(prefix))
          throw new Error("Unexpected Homebrew prefix");
        bin = join(prefix, "bin");
        for (const dependency of [
          "ffmpeg",
          ...((after.formulae?.[0]?.dependencies ?? []) as string[]),
        ]) {
          if (!/^[a-z0-9+@._-]+$/u.test(dependency))
            throw new Error("Unexpected Homebrew dependency identity");
          receipt.dependencies.push(
            await run("brew", ["list", "--versions", dependency]),
          );
        }
        receipt.admittedPackageSha256 = pin.sha256;
      }
      const pin = pins.tools[platformId as keyof typeof pins.tools];
      const identities = {} as NonNullable<RenderQaToolReceipt["tools"]>;
      for (const tool of ["ffmpeg", "ffprobe"] as const) {
        const path = join(
          bin!,
          `${tool}${process.platform === "win32" ? ".exe" : ""}`,
        );
        const bytes = await boundedFile(path);
        const output = await run(path, ["-version"]);
        admitToolVersion(tool, output, pin.version);
        identities[tool] = {
          version: pin.version,
          sha256: qaSha256(bytes),
          configurationSha256: qaSha256(output),
        };
      }
      receipt.tools = identities;
    }
    await writeFile(
      join(root, "tool-receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    const fontRoot = join(root, "fonts");
    process.env.OPENFILM_TEST_FONT_ROOT = fontRoot;
    process.env.OPENFILM_TITLE_FONT = faces.sansRegular.path;
    if (bin)
      process.env.PATH = `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
    if (process.env.GITHUB_ENV)
      await appendFile(
        process.env.GITHUB_ENV,
        `OPENFILM_TEST_FONT_ROOT=${fontRoot}\nOPENFILM_TITLE_FONT=${faces.sansRegular.path}\nOPENFILM_RENDER_QA_TOOL_RECEIPT=${join(root, "tool-receipt.json")}\n`,
      );
    if (bin && process.env.GITHUB_PATH)
      await appendFile(process.env.GITHUB_PATH, bin + "\n");
    return receipt;
  } finally {
    await lock.close();
    await rm(join(root, "setup.lock"), { force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [mode, root] = process.argv.slice(2);
  if (!root || (mode !== "fonts-only" && mode !== "hosted-tools"))
    throw new Error(
      "Usage: setup-render-qa.ts <fonts-only|hosted-tools> <absolute-root>",
    );
  const receipt = await setupRenderQa({
    root,
    mode,
    platform: process.platform,
    architecture: process.arch,
  });
  console.log(
    JSON.stringify({
      admitted: true,
      platformId: receipt.platformId,
      tools: receipt.tools !== null,
      fontFaces: 4,
      workstationVerified: false,
    }),
  );
}
