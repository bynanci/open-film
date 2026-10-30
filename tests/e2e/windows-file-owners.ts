// SPDX-License-Identifier: Apache-2.0
import { createRequire } from "node:module";
import { win32 } from "node:path";

/** Read-only failure evidence. Restart Manager never terminates an owner here. */
export function inspectWindowsFileOwners(path: string): object {
  if (process.platform !== "win32")
    return { available: false, reason: "platform" };
  try {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !win32.isAbsolute(systemRoot))
      return { available: false, reason: "system-directory" };
    const koffi = createRequire(import.meta.url)(
      "koffi",
    ) as typeof import("koffi");
    if (koffi.version !== "3.3.3")
      return { available: false, reason: "native-tool-version" };
    const library = koffi.load(
      win32.join(systemRoot, "System32", "rstrtmgr.dll"),
    );
    const start = library.func(
      "uint32_t __stdcall RmStartSession(_Out_ uint32_t *session, uint32_t flags, void *key)",
    );
    const register = library.func(
      "uint32_t __stdcall RmRegisterResources(uint32_t session, uint32_t files, str16 *paths, uint32_t apps, void *processes, uint32_t services, str16 *names)",
    );
    const list = library.func(
      "uint32_t __stdcall RmGetList(uint32_t session, _Out_ uint32_t *needed, _Inout_ uint32_t *count, void *processes, _Out_ uint32_t *reasons)",
    );
    const end = library.func(
      "uint32_t __stdcall RmEndSession(uint32_t session)",
    );
    const session = [0];
    const status = start(session, 0, Buffer.alloc(66));
    if (status !== 0) {
      library.unload();
      return { available: false, reason: "session", status };
    }
    try {
      const registered = register(session[0], 1, [path], 0, null, 0, null);
      if (registered !== 0)
        return { available: false, reason: "resource", status: registered };
      const needed = [0];
      const count = [0];
      const reasons = [0];
      const measured = list(session[0], needed, count, null, reasons);
      if (measured === 0 && needed[0] === 0)
        return { available: true, owners: [] };
      if (measured !== 234 || needed[0]! < 1 || needed[0]! > 64)
        return { available: false, reason: "inventory", status: measured };
      // RM_PROCESS_INFO: RM_UNIQUE_PROCESS(12), WCHAR[256], WCHAR[64], DWORD[4].
      const stride = 668;
      const buffer = Buffer.alloc(needed[0]! * stride);
      count[0] = needed[0]!;
      const resolved = list(session[0], needed, count, buffer, reasons);
      if (resolved !== 0 || count[0]! > buffer.length / stride)
        return {
          available: false,
          reason: "changed-inventory",
          status: resolved,
        };
      return {
        available: true,
        owners: Array.from({ length: count[0]! }, (_, index) => {
          const pid = buffer.readUInt32LE(index * stride);
          return {
            pid,
            testWorker: pid === process.pid,
            applicationType: buffer.readUInt32LE(index * stride + 652),
          };
        }),
      };
    } finally {
      end(session[0]);
      library.unload();
    }
  } catch {
    return { available: false, reason: "native-probe" };
  }
}
