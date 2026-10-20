// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import { posix, win32 } from "node:path";
import { getSystemErrorName } from "node:util";

export type ExclusiveDirectoryRenamer = (
  source: string,
  destination: string,
) => void;

type RenameError = NodeJS.ErrnoException & {
  dest?: string;
  nativeCode?: string | number;
};

function unavailable(cause?: unknown): RenameError {
  return Object.assign(
    new Error(
      "Atomic no-replace directory rename is unavailable on this platform or filesystem",
      { cause },
    ),
    { code: "ENOTSUP" },
  );
}

function checkedPath(path: string, windows: boolean): string {
  // C strings must identify the same path that JavaScript admitted. Reject
  // embedded terminators and lone surrogates instead of truncating/replacing.
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\0") ||
    /[\uD800-\uDFFF]/u.test(path) ||
    !(windows ? win32.isAbsolute(path) : posix.isAbsolute(path)) ||
    (windows && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/])/iu.test(path))
  )
    throw Object.assign(
      new Error(
        "Exclusive directory rename requires absolute, well-formed paths without NUL",
      ),
      { code: "EINVAL" },
    );
  return windows ? win32.toNamespacedPath(path) : path;
}

function posixFailure(
  errno: number,
  syscall: string,
  source: string,
  destination: string,
): RenameError {
  const code =
    Number.isSafeInteger(errno) && errno > 0
      ? getSystemErrorName(-errno)
      : "EIO";
  const native = Object.assign(new Error(`${syscall} failed: ${code}`), {
    code,
    errno: -errno,
    syscall,
    path: source,
    dest: destination,
    nativeCode: code,
  });
  if (["ENOSYS", "ENOTSUP", "EOPNOTSUPP"].includes(code))
    return Object.assign(unavailable(native), {
      nativeCode: code,
      errno: -errno,
      syscall,
      path: source,
      dest: destination,
    });
  return native;
}

function windowsFailure(
  code: number,
  source: string,
  destination: string,
): RenameError {
  // Win32 error numbers are not POSIX/libuv errno values. Preserve the raw
  // GetLastError result separately and map only documented, fixed codes.
  const name =
    (
      {
        1: "ENOTSUP",
        2: "ENOENT",
        3: "ENOENT",
        5: "EACCES",
        17: "EXDEV",
        32: "EBUSY",
        50: "ENOTSUP",
        80: "EEXIST",
        87: "EINVAL",
        120: "ENOTSUP",
        183: "EEXIST",
        206: "ENAMETOOLONG",
      } as Record<number, string>
    )[code] ?? "EIO";
  const native = Object.assign(
    new Error(`MoveFileExW failed: Win32 error ${code}`),
    {
      code: name,
      nativeCode: code,
      syscall: "MoveFileExW",
      path: source,
      dest: destination,
    },
  );
  return name === "ENOTSUP"
    ? Object.assign(unavailable(native), {
        nativeCode: code,
        syscall: "MoveFileExW",
        path: source,
        dest: destination,
      })
    : native;
}

let loaded: Promise<ExclusiveDirectoryRenamer> | undefined;

/**
 * Resolve only trusted OS symbols once, then publish with one synchronous
 * no-replace operation. Callers retain their private stage/identity fences.
 * There is deliberately no ordinary rename, copy, subprocess or JS fallback.
 */
export function getExclusiveDirectoryRenamer(): Promise<ExclusiveDirectoryRenamer> {
  return (loaded ??= loadRenamer());
}

async function loadRenamer(): Promise<ExclusiveDirectoryRenamer> {
  const platform = process.platform;
  if (!["linux", "darwin", "win32"].includes(platform)) throw unavailable();
  try {
    // Lazy import: a native launcher must verify its complete runtime inventory
    // before this addon is loaded. Project data cannot select a library/symbol.
    const { default: koffi } = await import("koffi");
    if (koffi.version !== "3.3.3")
      throw new Error("Unexpected Koffi native version");
    if (platform === "win32") {
      const library = koffi.load("kernel32.dll");
      const move = library.func("__stdcall", "MoveFileExW", "int", [
        "str16",
        "str16",
        "uint32_t",
      ]);
      const lastError = library.func(
        "__stdcall",
        "GetLastError",
        "uint32_t",
        [],
      );
      return (source, destination) => {
        const from = checkedPath(source, true),
          to = checkedPath(destination, true);
        // Flags0 exclude REPLACE_EXISTING, COPY_ALLOWED and delayed movement.
        if (move(from, to, 0) === 0) {
          const code = lastError() as number;
          throw windowsFailure(code, source, destination);
        }
      };
    }
    const library = koffi.load(null);
    if (platform === "linux") {
      const rename = library.func("renameat2", "int", [
        "int",
        "str",
        "int",
        "str",
        "uint32_t",
      ]);
      return (source, destination) => {
        const from = checkedPath(source, false),
          to = checkedPath(destination, false);
        // Linux AT_FDCWD=-100, RENAME_NOREPLACE=1; no fallback on ENOSYS/EINVAL.
        if (rename(-100, from, -100, to, 1) !== 0) {
          const errno = koffi.errno();
          throw posixFailure(errno, "renameat2", source, destination);
        }
      };
    }
    const rename = library.func("renamex_np", "int", [
      "str",
      "str",
      "uint32_t",
    ]);
    return (source, destination) => {
      const from = checkedPath(source, false),
        to = checkedPath(destination, false);
      // Darwin RENAME_EXCL=0x4 (sys/stdio.h).
      if (rename(from, to, 4) !== 0) {
        const errno = koffi.errno();
        throw posixFailure(errno, "renamex_np", source, destination);
      }
    };
  } catch (cause) {
    throw unavailable(cause);
  }
}
