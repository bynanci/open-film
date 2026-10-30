// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { lstat, open } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

/** Reviewed inputs may not reach their bytes through a link or alias. */
export async function assertRegularInput(
  source: string,
  singleLink = true,
): Promise<void> {
  let cursor = resolve(source);
  const info = await lstat(cursor);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (singleLink && info.nlink !== 1)
  )
    throw new Error("Runtime inputs must be unlinked regular files");
  while (cursor !== parse(cursor).root) {
    cursor = dirname(cursor);
    if ((await lstat(cursor)).isSymbolicLink())
      throw new Error("Symlink in runtime input parent");
  }
}
/** Inspect headers only; no tool/input executable is run during copying. */
export async function assertBinaryArchitecture(
  source: string,
  architecture: "x64" | "arm64",
  required = false,
): Promise<boolean> {
  const handle = await open(source, "r");
  try {
    const bytes = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    let actual: string | undefined;
    if (bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) {
      if (bytesRead < 64 || bytes[4] !== 2 || bytes[5] !== 1)
        throw new Error("Unsupported ELF header");
      actual = ({ 62: "x64", 183: "arm64" } as Record<number, string>)[
        bytes.readUInt16LE(18)
      ];
      if (!actual) throw new Error("Unsupported ELF architecture");
    } else if (bytes.subarray(0, 2).toString() === "MZ") {
      const offset = bytes.readUInt32LE(60);
      if (
        bytesRead < 64 ||
        offset + 6 > bytesRead ||
        bytes.subarray(offset, offset + 4).toString("binary") !== "PE\0\0"
      )
        throw new Error("Invalid PE header");
      actual = ({ 34404: "x64", 43620: "arm64" } as Record<number, string>)[
        bytes.readUInt16LE(offset + 4)
      ];
      if (!actual) throw new Error("Unsupported PE architecture");
    } else if (
      bytes.readUInt32BE(0) === 0xcafebabe ||
      bytes.readUInt32BE(0) === 0xcafebabf
    ) {
      throw new Error(
        "Universal Mach-O needs a separately reviewed architecture slice",
      );
    } else if (bytes.readUInt32LE(0) === 0xfeedfacf) {
      if (bytesRead < 32) throw new Error("Invalid Mach-O header");
      actual = (
        { 16777223: "x64", 16777228: "arm64" } as Record<number, string>
      )[bytes.readUInt32LE(4)];
      if (!actual) throw new Error("Unsupported Mach-O architecture");
    } else if (required && bytes.subarray(0, 2).toString() !== "#!") {
      throw new Error(
        "Executable runtime input has no supported binary header",
      );
    }
    if (actual && actual !== architecture)
      throw new Error("Runtime input architecture mismatch");
    return actual !== undefined;
  } finally {
    await handle.close();
  }
}
