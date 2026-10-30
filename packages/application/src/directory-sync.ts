// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { platform } from "node:os";

/** File bytes must already be synced before publication. Node/Win32 cannot
 * fsync directory handles: do not turn a completed rename into a failed scan.
 * POSIX directory flush failures remain errors; this does not catch file writes,
 * file flushes, rename/link failures or advertise power-loss certification. */
export async function syncPrivateDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Private durability boundary must be a real directory.");
  if (platform() === "win32") return;
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
