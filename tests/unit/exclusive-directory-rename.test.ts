import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  version: "3.3.3",
  load: vi.fn(),
  func: vi.fn(),
  rename: vi.fn(),
  errno: vi.fn(),
  lastError: vi.fn(),
}));
vi.mock("koffi", () => ({
  default: {
    get version() {
      return native.version;
    },
    load: native.load,
    errno: native.errno,
  },
}));
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  native.version = "3.3.3";
  native.load.mockReturnValue({ func: native.func });
  native.func.mockImplementation((_convention: string, name: string) =>
    name === "GetLastError" ? native.lastError : native.rename,
  );
  native.rename.mockReturnValue(0);
  native.errno.mockReturnValue(17);
  native.lastError.mockReturnValue(183);
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
});
afterEach(() => Object.defineProperty(process, "platform", platform));
const loader = async () =>
  (
    await import("../../packages/application/src/exclusive-directory-rename.js")
  ).getExclusiveDirectoryRenamer();

it("loads only the fixed Linux no-replace entrypoint and caches its function", async () => {
  const rename = await loader();
  rename("/private stage", "/public 目錄");
  expect(native.load).toHaveBeenCalledExactlyOnceWith(null);
  expect(native.func).toHaveBeenCalledExactlyOnceWith("renameat2", "int", [
    "int",
    "str",
    "int",
    "str",
    "uint32_t",
  ]);
  expect(native.rename).toHaveBeenCalledExactlyOnceWith(
    -100,
    "/private stage",
    -100,
    "/public 目錄",
    1,
  );
  expect(await loader()).toBe(rename);
});

it.each([38, 95])(
  "fails closed and retains native errno%d when no-replace is unsupported",
  async (errno) => {
    native.rename.mockReturnValue(-1);
    native.errno.mockReturnValue(errno);
    const rename = await loader();
    expect(() => rename("/source", "/destination")).toThrow(
      expect.objectContaining({
        code: "ENOTSUP",
        nativeCode: errno === 38 ? "ENOSYS" : "ENOTSUP",
      }),
    );
    expect(native.rename).toHaveBeenCalledTimes(1);
  },
);

it.each([
  [17, "EEXIST"],
  [18, "EXDEV"],
  [13, "EACCES"],
])("retains native %s as %s", async (errno, code) => {
  native.rename.mockReturnValue(-1);
  native.errno.mockReturnValue(errno);
  const rename = await loader();
  expect(() => rename("/source", "/destination")).toThrow(
    expect.objectContaining({
      code,
      errno: -Number(errno),
      syscall: "renameat2",
      path: "/source",
      dest: "/destination",
    }),
  );
});

it.each(["relative", "/source\0suffix", "/source\ud800", ""])(
  "rejects unsafe native path %j before the syscall",
  async (path) => {
    const rename = await loader();
    expect(() => rename(path, "/destination")).toThrow(
      expect.objectContaining({ code: "EINVAL" }),
    );
    expect(() => rename("/source", path)).toThrow(
      expect.objectContaining({ code: "EINVAL" }),
    );
    expect(native.rename).not.toHaveBeenCalled();
  },
);

it("fails closed for unsupported platforms before loading FFI", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "freebsd" });
  await expect(loader()).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(native.load).not.toHaveBeenCalled();
});
it("fails closed for missing native symbols with the original cause", async () => {
  const cause = new Error("Missing fixed symbol");
  native.func.mockImplementation(() => {
    throw cause;
  });
  await expect(loader()).rejects.toMatchObject({ code: "ENOTSUP", cause });
});
it("refuses a mismatched native module version", async () => {
  native.version = "0.0.0";
  await expect(loader()).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(native.load).not.toHaveBeenCalled();
});

it("binds macOS renamex_np with RENAME_EXCL and UTF-8 strings", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  const rename = await loader();
  rename("/private stage", "/public 目錄");
  expect(native.load).toHaveBeenCalledExactlyOnceWith(null);
  expect(native.func).toHaveBeenCalledExactlyOnceWith("renamex_np", "int", [
    "str",
    "str",
    "uint32_t",
  ]);
  expect(native.rename).toHaveBeenCalledExactlyOnceWith(
    "/private stage",
    "/public 目錄",
    4,
  );
});

it("binds Windows Unicode MoveFileExW with no replacement/copy flags and captures GetLastError", async () => {
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  native.rename.mockReturnValue(0);
  const rename = await loader();
  expect(() => rename("C:\\private stage", "C:\\public 目錄")).toThrow(
    expect.objectContaining({ code: "EEXIST", nativeCode: 183 }),
  );
  expect(native.load).toHaveBeenCalledExactlyOnceWith("kernel32.dll");
  expect(native.func.mock.calls).toEqual([
    ["__stdcall", "MoveFileExW", "int", ["str16", "str16", "uint32_t"]],
    ["__stdcall", "GetLastError", "uint32_t", []],
  ]);
  expect(native.rename).toHaveBeenCalledExactlyOnceWith(
    "\\\\?\\C:\\private stage",
    "\\\\?\\C:\\public 目錄",
    0,
  );
  expect(native.lastError).toHaveBeenCalledTimes(1);
});
