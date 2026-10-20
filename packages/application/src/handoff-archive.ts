// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import { createReadStream } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { checkAbort } from "@openfilm/media";
/** Bounded USTAR of application-generated filenames; no source paths or links. */
export async function archiveHandoff(
  root: string,
  names: string[],
  signal?: AbortSignal,
): Promise<void> {
  const archive = await open(join(root, "handoff.tar"), "wx", 0o600);
  const write = async (bytes: Buffer) => {
    let offset = 0;
    while (offset < bytes.length) {
      checkAbort(signal);
      const { bytesWritten } = await archive.write(
        bytes,
        offset,
        bytes.length - offset,
      );
      if (!bytesWritten) throw new Error("Archive write failed");
      offset += bytesWritten;
    }
  };
  let total = 0;
  try {
    for (const name of names) {
      checkAbort(signal);
      if (!/^(?:media\/)?[a-z0-9][a-z0-9.-]*$/u.test(name) || name.length > 99)
        throw new Error("Unsafe archive name");
      const path = join(root, name),
        stat = await lstat(path);
      total += stat.size;
      if (!stat.isFile() || stat.isSymbolicLink() || total > 2 * 1024 ** 3)
        throw new Error("Unsafe or oversized archive input");
      const header = Buffer.alloc(512);
      header.write(name, 0, 100, "ascii");
      const oct = (offset: number, length: number, n: number) =>
        header.write(
          n.toString(8).padStart(length - 1, "0") + "\0",
          offset,
          length,
          "ascii",
        );
      oct(100, 8, 0o600);
      oct(108, 8, 0);
      oct(116, 8, 0);
      oct(124, 12, stat.size);
      oct(136, 12, 0);
      header.fill(32, 148, 156);
      header[156] = 48;
      header.write("ustar\0", 257, 6, "ascii");
      header.write("00", 263, 2, "ascii");
      const checksum = header.reduce((sum, b) => sum + b, 0);
      header.write(
        checksum.toString(8).padStart(6, "0") + "\0 ",
        148,
        8,
        "ascii",
      );
      await write(header);
      let bytes = 0;
      for await (const chunk of createReadStream(path, { signal })) {
        const data = chunk as Buffer;
        bytes += data.length;
        await write(data);
      }
      if (bytes !== stat.size) throw new Error("Archive input changed");
      await write(Buffer.alloc((512 - (stat.size % 512)) % 512));
    }
    await write(Buffer.alloc(1024));
    await archive.sync();
  } finally {
    await archive.close();
  }
}
