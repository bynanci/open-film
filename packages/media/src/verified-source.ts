// Modified by OpenFilm contributors on 2026-10-30. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ApplicationError } from "@openfilm/core";

/** A trusted callback consumes only the bytes covered by the expected hash. */
export async function withVerifiedSourceFile<T>(
  path: string,
  expectedHash: string | undefined,
  consume: (snapshot: string, hash: string) => Promise<T>,
  options: {
    signal?: AbortSignal;
    temporaryRoot?: string;
    maximumBytes?: number;
  } = {},
): Promise<T> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (expectedHash !== undefined && !/^[a-f0-9]{64}$/u.test(expectedHash))
    throw new Error("A verified source requires a full SHA-256.");
  const selected = await lstat(path);
  if (selected.isSymbolicLink() || !selected.isFile())
    throw new Error("A verified source must be a regular local file.");
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let temporary: string | undefined;
  try {
    const info = await handle.stat();
    const maximum = options.maximumBytes ?? Number.MAX_SAFE_INTEGER;
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 0 ||
      !info.isFile() ||
      !Number.isSafeInteger(info.size) ||
      info.size > maximum
    )
      throw new Error(
        "The verified source exceeds its temporary storage bound.",
      );
    if (selected.dev !== info.dev || selected.ino !== info.ino)
      throw new ApplicationError(
        "source.changed",
        "Source identity changed before verification.",
        409,
      );
    const root = options.temporaryRoot ?? tmpdir();
    const parent = await lstat(root);
    if (!parent.isDirectory() || parent.isSymbolicLink())
      throw new Error("Verified source storage must be a regular directory.");
    // Work roots already carry project/job identity. Keep this private random
    // child compact enough for Windows paths; ownership and byte guards remain.
    temporary = await mkdtemp(join(root, "src-"));
    const extension = extname(path).toLowerCase();
    const snapshot = join(
      temporary,
      `source${/^\.[a-z0-9]{1,12}$/u.test(extension) ? extension : ".media"}`,
    );
    const hash = createHash("sha256");
    let copied = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        copied += chunk.byteLength;
        if (copied > info.size || copied > maximum)
          return callback(
            new ApplicationError(
              "source.changed",
              "Source grew during verification.",
              409,
            ),
          );
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      handle.createReadStream({ autoClose: false }),
      meter,
      createWriteStream(snapshot, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    const verifiedHash = hash.digest("hex");
    if (
      copied !== info.size ||
      (expectedHash !== undefined && verifiedHash !== expectedHash)
    )
      throw new ApplicationError(
        "source.changed",
        "Source bytes do not match their recorded SHA-256.",
        409,
      );
    signal?.throwIfAborted();
    return await consume(snapshot, verifiedHash);
  } finally {
    try {
      await handle.close();
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
}
