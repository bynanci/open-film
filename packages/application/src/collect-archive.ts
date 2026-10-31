// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import { constants, createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, rm } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP_DESCRIPTOR = 0x08074b50;
const MAX_FILES = 20_100;
const MAX_BYTES = 0xffff_ffff;
const MAX_CENTRAL_BYTES = 16 * 1024 * 1024;
const CRC_TABLE = new Uint32Array(256).map((_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

export interface ArchiveFile {
  path: string;
  size: number;
}

function abort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw Object.assign(new Error("Package operation cancelled."), {
      name: "AbortError",
    });
}

function checkedArchivePath(name: string): string[] {
  if (
    !name ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.includes("\\") ||
    name.includes(":") ||
    name.includes("\0") ||
    [...name].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error("Package archive contains an unsafe path.");
  const parts = name.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.endsWith(".") ||
        part.endsWith(" ") ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(part),
    )
  )
    throw new Error("Package archive contains an unsafe path.");
  return parts;
}

function nestedArchive(path: string): boolean {
  return new Set([".zip", ".tar", ".tgz", ".gz", ".7z", ".rar"]).has(
    extname(path).toLowerCase(),
  );
}

export async function isNestedArchiveFile(path: string): Promise<boolean> {
  if (nestedArchive(path)) return true;
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Package entry is not a regular file.");
    const header = Buffer.alloc(Math.min(info.size, 512));
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const prefix = header.subarray(0, bytesRead);
    const archiveMagic =
      prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
      prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
      prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08])) ||
      prefix.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ||
      prefix
        .subarray(0, 6)
        .equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) ||
      prefix
        .subarray(0, 7)
        .equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])) ||
      prefix.subarray(257, 262).toString("ascii") === "ustar";
    return archiveMagic;
  } finally {
    await file.close();
  }
}

async function packageFiles(root: string): Promise<ArchiveFile[]> {
  const result: ArchiveFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink())
        throw new Error("Package directories cannot contain symbolic links.");
      if (info.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1)
        throw new Error("Package directories can contain regular files only.");
      const name = relative(root, path).split(sep).join("/");
      checkedArchivePath(name);
      if (await isNestedArchiveFile(path))
        throw new Error("Nested archives are not allowed in a package.");
      result.push({ path, size: info.size });
      if (result.length > MAX_FILES)
        throw new Error("Package archive exceeds its file count limit.");
    }
  };
  await visit(root);
  return result;
}

function crcTransform(expectedBytes?: number) {
  let crc = 0xffff_ffff;
  let bytes = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (
        bytes > MAX_BYTES ||
        (expectedBytes !== undefined && bytes > expectedBytes)
      ) {
        callback(new Error("Package entry exceeds its declared size."));
        return;
      }
      for (const value of chunk)
        crc = CRC_TABLE[(crc ^ value) & 0xff]! ^ (crc >>> 8);
      callback(null, chunk);
    },
  });
  return {
    transform,
    result: () => ({ crc: (crc ^ 0xffff_ffff) >>> 0, bytes }),
  };
}

async function writeChunk(stream: NodeJS.WritableStream, buffer: Buffer) {
  await new Promise<void>((resolvePromise, reject) => {
    stream.write(buffer, (error?: Error | null) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

function localHeader(name: Buffer): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_LOCAL, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0808, 6); // UTF-8 plus data descriptor.
  header.writeUInt16LE(0, 8); // Stored entries avoid decompression bombs.
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x0021, 12); // 1980-01-01.
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function dataDescriptor(crc: number, size: number): Buffer {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(ZIP_DESCRIPTOR, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  return descriptor;
}

function centralHeader(
  name: Buffer,
  crc: number,
  size: number,
  offset: number,
): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(ZIP_CENTRAL, 0);
  header.writeUInt16LE((3 << 8) | 20, 4); // Unix regular files only.
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0808, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x0021, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0o100600 * 0x1_0000, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

/** Write a deterministic, stored ZIP. Entries are streamed and atomically renamed by the caller. */
export async function writeStoredZip(
  root: string,
  output: string,
  signal?: AbortSignal,
): Promise<void> {
  const files = (await packageFiles(root)).sort((a, b) =>
    relative(root, a.path).localeCompare(relative(root, b.path)),
  );
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let archiveSize = 22;
  let centralSize = 0;
  for (const file of files) {
    const name = Buffer.from(relative(root, file.path).split(sep).join("/"));
    if (name.length > 0xffff)
      throw new Error("Package archive path exceeds the ZIP filename limit.");
    archiveSize += 30 + name.length + file.size + 16;
    centralSize += 46 + name.length;
  }
  archiveSize += centralSize;
  if (
    total > MAX_BYTES ||
    archiveSize > MAX_BYTES ||
    centralSize > MAX_CENTRAL_BYTES
  )
    throw new Error("Package archive exceeds its size limit.");
  abort(signal);
  const writer = createWriteStream(output, {
    flags: "wx",
    mode: 0o600,
    signal,
  });
  let ownsOutput = false;
  writer.once("open", () => {
    ownsOutput = true;
  });
  const writerClosed = new Promise<void>((closed) => {
    writer.once("close", closed);
  });
  const writerFinished = finished(writer);
  void writerFinished.catch(() => {});
  const central: Buffer[] = [];
  let offset = 0;
  try {
    for (const file of files) {
      abort(signal);
      if (file.size > MAX_BYTES)
        throw new Error("Package file exceeds the ZIP32 file size limit.");
      const name = Buffer.from(relative(root, file.path).split(sep).join("/"));
      checkedArchivePath(name.toString("utf8"));
      const start = offset;
      const header = localHeader(name);
      await writeChunk(writer, header);
      const integrity = crcTransform(file.size);
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          writer.write(chunk, callback);
        },
      });
      await pipeline(createReadStream(file.path), integrity.transform, sink, {
        signal,
      });
      const { crc, bytes } = integrity.result();
      if (bytes !== file.size)
        throw new Error("Package file changed while the archive was written.");
      const descriptor = dataDescriptor(crc, bytes);
      await writeChunk(writer, descriptor);
      offset += header.length + bytes + descriptor.length;
      central.push(centralHeader(name, crc, bytes, start));
    }
    const centralOffset = offset;
    for (const entry of central) {
      await writeChunk(writer, entry);
      offset += entry.length;
    }
    const centralBytes = offset - centralOffset;
    if (offset > MAX_BYTES || centralBytes > MAX_CENTRAL_BYTES)
      throw new Error("Package archive exceeds ZIP32 limits.");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(ZIP_END, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(centralBytes, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);
    await writeChunk(writer, end);
    writer.end();
    await writerFinished;
    const file = await open(output, "r+");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    abort(signal);
  } catch (error) {
    writer.destroy();
    await writerClosed;
    if (ownsOutput) await rm(output, { force: true });
    throw error;
  }
}

interface CentralEntry {
  name: string;
  size: number;
  crc: number;
  rangeStart: number;
  dataOffset: number;
  dataEnd: number;
  rangeEnd: number;
}

async function readAt(
  file: Awaited<ReturnType<typeof open>>,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error("Package archive is truncated.");
  return buffer;
}

function strictUtf8(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function centralEntries(path: string): Promise<CentralEntry[]> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new Error("Package archive must be a regular file.");
  if (info.size < 22 || info.size > MAX_BYTES)
    throw new Error("Package archive has an invalid size.");
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const tailSize = Math.min(info.size, 65_557);
    const tail = await readAt(file, info.size - tailSize, tailSize);
    let endOffset = -1;
    for (let offset = tail.length - 22; offset >= 0; offset--)
      if (tail.readUInt32LE(offset) === ZIP_END) {
        endOffset = offset;
        break;
      }
    if (endOffset < 0) throw new Error("Package archive directory is missing.");
    const end = tail.subarray(endOffset);
    const disk = end.readUInt16LE(4);
    const centralDisk = end.readUInt16LE(6);
    const diskEntries = end.readUInt16LE(8);
    const totalEntries = end.readUInt16LE(10);
    const centralSize = end.readUInt32LE(12);
    const centralOffset = end.readUInt32LE(16);
    const commentLength = end.readUInt16LE(20);
    if (
      disk ||
      centralDisk ||
      diskEntries !== totalEntries ||
      totalEntries > MAX_FILES ||
      centralSize > MAX_CENTRAL_BYTES ||
      end.length !== 22 + commentLength ||
      centralOffset + centralSize !== info.size - tailSize + endOffset
    )
      throw new Error("Package archive has unsupported ZIP features.");
    const directory = await readAt(file, centralOffset, centralSize);
    const entries: CentralEntry[] = [];
    const names = new Set<string>();
    let cursor = 0;
    for (let index = 0; index < totalEntries; index++) {
      if (
        cursor + 46 > directory.length ||
        directory.readUInt32LE(cursor) !== ZIP_CENTRAL
      )
        throw new Error("Package archive directory is corrupt.");
      const madeBy = directory.readUInt16LE(cursor + 4) >>> 8;
      const flags = directory.readUInt16LE(cursor + 8);
      const method = directory.readUInt16LE(cursor + 10);
      const crc = directory.readUInt32LE(cursor + 16);
      const compressed = directory.readUInt32LE(cursor + 20);
      const size = directory.readUInt32LE(cursor + 24);
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const startDisk = directory.readUInt16LE(cursor + 34);
      const external = directory.readUInt32LE(cursor + 38);
      const localOffset = directory.readUInt32LE(cursor + 42);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > directory.length)
        throw new Error("Package archive directory is truncated.");
      if (
        flags !== 0x0808 ||
        method !== 0 ||
        compressed !== size ||
        startDisk !== 0 ||
        size === 0xffff_ffff ||
        compressed === 0xffff_ffff ||
        localOffset === 0xffff_ffff
      )
        throw new Error("Package archive uses unsupported ZIP features.");
      const name = strictUtf8(
        directory.subarray(cursor + 46, cursor + 46 + nameLength),
      );
      const parts = checkedArchivePath(name);
      if (nestedArchive(name))
        throw new Error("Nested archives are not allowed in a package.");
      const folded = parts.join("/").toLowerCase();
      if (names.has(folded))
        throw new Error("Package archive has duplicate paths.");
      names.add(folded);
      const mode = external >>> 16;
      if (madeBy === 3 && mode !== 0 && (mode & 0o170000) !== 0o100000)
        throw new Error(
          "Package archive cannot contain links or special files.",
        );
      if (madeBy !== 3 && madeBy !== 0)
        throw new Error(
          "Package archive has an unsupported file system marker.",
        );
      const local = await readAt(file, localOffset, 30);
      if (
        local.readUInt32LE(0) !== ZIP_LOCAL ||
        local.readUInt16LE(6) !== flags ||
        local.readUInt16LE(8) !== method
      )
        throw new Error("Package archive local header is invalid.");
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      const localName = strictUtf8(
        await readAt(file, localOffset + 30, localNameLength),
      );
      if (localName !== name)
        throw new Error("Package archive path does not match its directory.");
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const rangeEnd = dataOffset + size;
      if (rangeEnd > centralOffset || rangeEnd < dataOffset)
        throw new Error("Package archive entry exceeds its data section.");
      const descriptor = await readAt(file, rangeEnd, 16);
      if (
        descriptor.readUInt32LE(0) !== ZIP_DESCRIPTOR ||
        descriptor.readUInt32LE(4) !== crc ||
        descriptor.readUInt32LE(8) !== size ||
        descriptor.readUInt32LE(12) !== size ||
        rangeEnd + descriptor.length > centralOffset
      )
        throw new Error("Package archive entry descriptor is invalid.");
      entries.push({
        name,
        size,
        crc,
        rangeStart: localOffset,
        dataOffset,
        dataEnd: rangeEnd,
        rangeEnd: rangeEnd + 16,
      });
      cursor = next;
    }
    if (cursor !== directory.length)
      throw new Error("Package archive has trailing directory data.");
    const ranges = entries
      .map(({ rangeStart, rangeEnd }) => ({ start: rangeStart, end: rangeEnd }))
      .sort((a, b) => a.start - b.start);
    for (let index = 1; index < ranges.length; index++)
      if (ranges[index]!.start < ranges[index - 1]!.end)
        throw new Error("Package archive entries overlap.");
    let accountedEnd = 0;
    for (const range of ranges) {
      if (range.start !== accountedEnd)
        throw new Error("Package archive contains unaccounted bytes.");
      accountedEnd = range.end;
    }
    if (accountedEnd !== centralOffset)
      throw new Error("Package archive contains unaccounted bytes.");
    return entries;
  } finally {
    await file.close();
  }
}

/** Extract only validated, uncompressed regular-file entries into a fresh private directory. */
export async function extractStoredZip(
  archive: string,
  destination: string,
  signal?: AbortSignal,
): Promise<ArchiveFile[]> {
  const entries = await centralEntries(archive);
  let total = 0;
  const written: ArchiveFile[] = [];
  try {
    for (const entry of entries) {
      abort(signal);
      total += entry.size;
      if (total > MAX_BYTES)
        throw new Error("Package archive exceeds its expanded size limit.");
      const parts = checkedArchivePath(entry.name);
      const output = resolve(destination, ...parts);
      const relativePath = relative(destination, output);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        relativePath.includes(`..${sep}`)
      )
        throw new Error(
          "Package archive path escapes its extraction directory.",
        );
      await mkdir(dirname(output), { recursive: true, mode: 0o700 });
      const target = createWriteStream(output, { flags: "wx", mode: 0o600 });
      const integrity = crcTransform(entry.size);
      await pipeline(
        entry.size === 0
          ? Readable.from([])
          : createReadStream(archive, {
              start: entry.dataOffset,
              end: entry.dataEnd - 1,
            }),
        integrity.transform,
        target,
        { signal },
      );
      const result = integrity.result();
      if (result.bytes !== entry.size || result.crc !== entry.crc) {
        await rm(output, { force: true });
        throw new Error("Package archive entry failed its checksum.");
      }
      written.push({ path: output, size: result.bytes });
    }
    return written;
  } catch (error) {
    for (const item of written) await rm(item.path, { force: true });
    throw error;
  }
}

export const collectArchiveLimits = {
  files: MAX_FILES,
  bytes: MAX_BYTES,
};
