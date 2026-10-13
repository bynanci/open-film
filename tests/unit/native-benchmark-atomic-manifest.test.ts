import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replaceBenchmarkManifest } from "../../scripts/native-benchmark/atomic-manifest";

const faults = vi.hoisted(() => ({
  write: undefined as Error | undefined,
  close: undefined as Error | undefined,
  rename: undefined as Error | undefined,
  cleanup: undefined as Error | undefined,
  duringWrite: undefined as ((path: string) => Promise<void>) | undefined,
  uuid: undefined as string | undefined,
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: () => faults.uuid ?? actual.randomUUID(),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  async function interruptedWrite(
    path: string,
    contents: string,
    write: (contents: string) => Promise<void>,
    continueFromOffset = false,
  ) {
    if (faults.write || faults.duringWrite) {
      await write(contents.slice(0, 21));
      await faults.duringWrite?.(path);
      if (faults.write) throw faults.write;
      await write(continueFromOffset ? contents.slice(21) : contents);
      return;
    }
    await write(contents);
  }
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      const write = file.writeFile.bind(file);
      const close = file.close.bind(file);
      file.writeFile = async (contents, options) => {
        await interruptedWrite(
          String(args[0]),
          String(contents),
          (value) => write(value, options),
          true,
        );
      };
      file.close = async () => {
        await close();
        if (faults.close) throw faults.close;
      };
      return file;
    },
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      if (typeof args[0] !== "string") return actual.writeFile(...args);
      return interruptedWrite(args[0], String(args[1]), (contents) =>
        actual.writeFile(args[0], contents, args[2]),
      );
    },
    rename: (...args: Parameters<typeof actual.rename>) => {
      if (faults.rename) return Promise.reject(faults.rename);
      return actual.rename(...args);
    },
    unlink: (...args: Parameters<typeof actual.unlink>) => {
      if (faults.cleanup) return Promise.reject(faults.cleanup);
      return actual.unlink(...args);
    },
  };
});

const directories: string[] = [];
const initialManifest = {
  schemaVersion: "1.0.0",
  verification: "measurement-only",
  runId: "atomic-manifest-run",
  ownership: { serverPid: 41 },
  identities: { serverSha256: "a".repeat(64) },
};
const nextManifest = {
  ...initialManifest,
  ownership: { serverPid: 41, nativePid: 42 },
};
const initialContents = JSON.stringify(initialManifest, null, 2) + "\n";
const nextContents = JSON.stringify(nextManifest, null, 2) + "\n";

async function manifestFile() {
  const directory = await mkdtemp(join(tmpdir(), "openfilm-atomic-manifest-"));
  directories.push(directory);
  const path = join(directory, "manifest.json");
  await writeFile(path, initialContents, { flag: "wx" });
  return { directory, path };
}

beforeEach(() => {
  faults.write = undefined;
  faults.close = undefined;
  faults.rename = undefined;
  faults.cleanup = undefined;
  faults.duringWrite = undefined;
  faults.uuid = undefined;
});

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("atomic native benchmark manifest replacement", () => {
  it("publishes the complete new PID manifest after a sibling write completes", async () => {
    const { directory, path } = await manifestFile();

    await replaceBenchmarkManifest(path, nextContents);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(nextManifest);
    expect(await readFile(path, "utf8")).toBe(nextContents);
    expect(await readdir(directory)).toEqual(["manifest.json"]);
  });

  it("keeps readers on the previous complete manifest during a partial temporary write", async () => {
    const { directory, path } = await manifestFile();
    let temporaryPath: string | undefined;
    faults.duringWrite = async (writingPath) => {
      temporaryPath = writingPath;
      expect(dirname(writingPath)).toBe(directory);
      expect(writingPath).not.toBe(path);
      expect(await readFile(writingPath, "utf8")).toBe(
        nextContents.slice(0, 21),
      );
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(initialManifest);
    };

    await replaceBenchmarkManifest(path, nextContents);

    expect(temporaryPath).toBeDefined();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(nextManifest);
    expect(await readdir(directory)).toEqual(["manifest.json"]);
  });

  it("preserves the valid manifest and removes a partial temporary write on ENOSPC", async () => {
    const { directory, path } = await manifestFile();
    const failure = Object.assign(new Error("ENOSPC: partial manifest write"), {
      code: "ENOSPC",
    });
    faults.write = failure;

    await expect(replaceBenchmarkManifest(path, nextContents)).rejects.toBe(
      failure,
    );

    expect(await readFile(path, "utf8")).toBe(initialContents);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(initialManifest);
    expect(await readdir(directory)).toEqual(["manifest.json"]);
  });

  it("preserves the previous manifest when replacement rename is rejected", async () => {
    const { directory, path } = await manifestFile();
    const failure = Object.assign(new Error("EACCES: replacement denied"), {
      code: "EACCES",
    });
    faults.rename = failure;

    await expect(replaceBenchmarkManifest(path, nextContents)).rejects.toBe(
      failure,
    );

    expect(await readFile(path, "utf8")).toBe(initialContents);
    expect(await readdir(directory)).toEqual(["manifest.json"]);
  });

  it("preserves the previous manifest when the completed temporary write cannot close", async () => {
    const { directory, path } = await manifestFile();
    const failure = Object.assign(new Error("EIO: temporary close failed"), {
      code: "EIO",
    });
    faults.close = failure;

    await expect(replaceBenchmarkManifest(path, nextContents)).rejects.toBe(
      failure,
    );

    expect(await readFile(path, "utf8")).toBe(initialContents);
    expect(await readdir(directory)).toEqual(["manifest.json"]);
  });

  it("preserves the original write failure when temporary cleanup also fails", async () => {
    const { directory, path } = await manifestFile();
    const failure = Object.assign(new Error("ENOSPC: partial manifest write"), {
      code: "ENOSPC",
    });
    faults.write = failure;
    faults.cleanup = Object.assign(
      new Error("EACCES: temporary cleanup denied"),
      {
        code: "EACCES",
      },
    );

    await expect(replaceBenchmarkManifest(path, nextContents)).rejects.toBe(
      failure,
    );

    expect(await readFile(path, "utf8")).toBe(initialContents);
    const temporary = (await readdir(directory)).filter(
      (name) => name !== "manifest.json",
    );
    expect(temporary).toHaveLength(1);
    expect(await readFile(join(directory, temporary[0]!), "utf8")).toBe(
      nextContents.slice(0, 21),
    );
  });

  it("refuses a temporary path collision without removing existing artifacts", async () => {
    const { directory, path } = await manifestFile();
    faults.uuid = randomUUID();
    const existingTemporary = `${path}.${faults.uuid}.tmp`;
    const sentinel = "existing sibling artifact";
    await writeFile(existingTemporary, sentinel, { flag: "wx" });

    await expect(
      replaceBenchmarkManifest(path, nextContents),
    ).rejects.toMatchObject({ code: "EEXIST" });

    expect(await readFile(path, "utf8")).toBe(initialContents);
    expect(await readFile(existingTemporary, "utf8")).toBe(sentinel);
    expect((await readdir(directory)).sort()).toEqual(
      ["manifest.json", basename(existingTemporary)].sort(),
    );
  });
});
