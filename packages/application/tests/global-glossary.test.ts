import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlossaryEntry, GlossaryInput } from "@openfilm/core";
import { GlobalGlossaryStore } from "../src/global-glossary.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    linkSync: vi.fn(actual.linkSync),
    openSync: vi.fn(actual.openSync),
  };
});

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) =>
        child.once("close", () => resolve()),
      );
    }
  }
  vi.restoreAllMocks();
  vi.resetAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), "openfilm-global-glossary-"));
  roots.push(root);
  return root;
}

function input(overrides: Partial<GlossaryInput> = {}): GlossaryInput {
  return {
    source: "youtube",
    replacement: "YouTube",
    scope: "global",
    ...overrides,
  };
}

function entry(
  index = 0,
  overrides: Partial<GlossaryEntry> = {},
): GlossaryEntry {
  return {
    id: `term-${index}`,
    source: `source-${index}`,
    replacement: `replacement-${index}`,
    scope: "global",
    enabled: true,
    caseSensitive: true,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

function file(entries: GlossaryEntry[]): string {
  return JSON.stringify({ version: 1, entries });
}

function owner(pid = process.pid, token = randomUUID()) {
  return { version: 1, pid, token, createdAt: new Date().toISOString() };
}

function recoveryPath(store: GlobalGlossaryStore, path: string, token: string) {
  return `${store.lockPath}.recover-${createHash("sha256").update(`${path}\0${token}`).digest("hex").slice(0, 32)}`;
}

function concurrentWriter(root: string, source: string, hold = false) {
  const script = join(root, "writer.mts");
  if (!existsSync(script))
    writeFileSync(
      script,
      `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    import {GlobalGlossaryStore} from ${JSON.stringify(new URL("../src/global-glossary.ts", import.meta.url).href)};
    const [directory,source,mode,releaseFile]=process.argv.slice(2);
    const store=new GlobalGlossaryStore(directory);
    if(mode==='hold'){
      const rename=fs.renameSync;let paused=false;
      fs.renameSync=(from,to)=>{
        if(to===store.backupPath&&!paused){
          paused=true;fs.writeSync(1,'LOCK_HELD\\n');
          const deadline=Date.now()+10000;
          while(!fs.existsSync(releaseFile)&&Date.now()<deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
          if(!fs.existsSync(releaseFile))throw new Error('Fixture release timed out');
        }
        return rename(from,to);
      };
      syncBuiltinESMExports();
    }
    try{const entry=store.upsert({scope:'global',source,replacement:source+' preferred'});console.log(JSON.stringify({ok:true,id:entry.id}));}
    catch(error){console.log(JSON.stringify({ok:false,code:error.code,status:error.status,message:error.message}));process.exitCode=1;}
  `,
    );
  const child = spawn(
    process.execPath,
    [
      "--import",
      createRequire(import.meta.url).resolve("tsx"),
      script,
      join(root, "user-data"),
      source,
      hold ? "hold" : "normal",
      join(root, "release"),
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  let stdout = "",
    stderr = "";
  child.stdout!.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr!.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const finished = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
  const held = async () => {
    await expect
      .poll(() => stdout.includes("LOCK_HELD\n"), { timeout: 5000 })
      .toBe(true);
  };
  return { child, finished, held };
}

async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
  return child.pid!;
}

describe("user-owned global glossary", () => {
  it("does not create a user data directory for construction, list or absent removal", () => {
    const root = directory();
    const userData = join(root, "not-created", "user-data");
    const store = new GlobalGlossaryStore(userData);
    expect(existsSync(userData)).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.remove("absent-entry")).toBe(false);
    expect(existsSync(join(root, "not-created"))).toBe(false);
    store.upsert(input());
    expect(existsSync(userData)).toBe(true);
  });

  it("creates, lists, updates and removes offline terms across reopen", () => {
    const root = directory();
    const userData = join(root, "user data 繁體中文 # &");
    const store = new GlobalGlossaryStore(userData);
    expect(store.list()).toEqual([]);
    expect(existsSync(store.filePath)).toBe(false);
    const created = store.upsert(input());
    expect(created).toMatchObject({
      source: "youtube",
      replacement: "YouTube",
      scope: "global",
      enabled: true,
      caseSensitive: true,
    });
    expect(created.id).toBeTruthy();
    expect(new GlobalGlossaryStore(userData).list()).toEqual([created]);
    const updated = store.upsert(
      input({
        id: created.id,
        source: "YouTube videos",
        replacement: "YouTube",
        enabled: false,
        caseSensitive: false,
      }),
    );
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(store.list()).toEqual([updated]);
    expect(JSON.parse(readFileSync(store.backupPath, "utf8"))).toEqual({
      version: 1,
      entries: [created],
    });
    expect(store.remove(created.id)).toBe(true);
    expect(store.remove(created.id)).toBe(false);
    expect(new GlobalGlossaryStore(userData).list()).toEqual([]);
    expect(readdirSync(userData).sort()).toEqual([
      "global-glossary.json",
      "global-glossary.json.bak",
    ]);
    if (process.platform !== "win32")
      expect(lstatSync(store.filePath).mode & 0o777).toBe(0o600);
  });

  it("updates identical sources without duplicating ids or resetting matching flags", () => {
    const store = new GlobalGlossaryStore(directory());
    const first = store.upsert(input({ enabled: false, caseSensitive: false }));
    const second = store.upsert(input({ replacement: "YOUTUBE" }));
    expect(second).toMatchObject({
      id: first.id,
      createdAt: first.createdAt,
      enabled: false,
      caseSensitive: false,
      replacement: "YOUTUBE",
    });
    expect(store.list()).toHaveLength(1);
    const other = store.upsert(
      input({ source: "vimeo", replacement: "Vimeo" }),
    );
    const before = readFileSync(store.filePath, "utf8");
    expect(() => store.upsert(input({ id: other.id }))).toThrow(/already uses/);
    expect(readFileSync(store.filePath, "utf8")).toBe(before);
    expect(() => store.upsert(input({ id: "unknown-id" }))).toThrow(
      /not found/,
    );
    expect(readFileSync(store.filePath, "utf8")).toBe(before);
  });

  it("reloads between store instances and detaches returned entries", () => {
    const root = directory();
    const first = new GlobalGlossaryStore(root);
    const second = new GlobalGlossaryStore(root);
    const original = first.upsert(input());
    const other = second.upsert(
      input({ source: "insta 360", replacement: "Insta360" }),
    );
    original.replacement = "Do not save this mutation";
    const listed = first.list();
    listed[0]!.source = "Do not save this mutation";
    expect(first.list()).toMatchObject([
      { source: "youtube", replacement: "YouTube" },
      other,
    ]);
    expect(first.remove(other.id)).toBe(true);
    expect(second.list()).toHaveLength(1);
  });

  it("keeps global terms outside portable projects and preserves CJK and empty replacements", () => {
    const root = directory();
    const project = join(root, "Proposal.openfilm");
    mkdirSync(project);
    const store = new GlobalGlossaryStore(join(root, "user-data"));
    const created = store.upsert(
      input({ source: "十河田", replacement: "十和田" }),
    );
    const omitted = store.upsert(input({ source: "冗語", replacement: "" }));
    expect(store.list()).toEqual([created, omitted]);
    expect(readdirSync(project)).toEqual([]);
    expect(() => store.upsert(input({ scope: "project" }))).toThrow(
      /global scope/,
    );
  });

  it.each([
    { source: "" },
    { source: " ", replacement: "valid" },
    { source: "x".repeat(513) },
    { replacement: "x".repeat(4097) },
    { source: "invalid\u0000term" },
    { replacement: "invalid\uD800" },
    { enabled: "true" },
    { enabled: null },
    { caseSensitive: 1 },
    { caseSensitive: null },
    { id: "invalid id" },
  ])("rejects malformed input without writing %j", (override) => {
    const root = directory();
    const store = new GlobalGlossaryStore(root);
    expect(() =>
      store.upsert(input(override as Partial<GlossaryInput>)),
    ).toThrow();
    expect(readdirSync(root)).toEqual([]);
  });

  it.each(["primary", "missing"])(
    "recovers a %s file from its validated backup",
    (state) => {
      const store = new GlobalGlossaryStore(directory());
      const previous = store.upsert(input());
      store.upsert(input({ source: "insta 360", replacement: "Insta360" }));
      if (state === "primary") writeFileSync(store.filePath, "{ damaged JSON");
      else rmSync(store.filePath);
      const reopened = new GlobalGlossaryStore(store.directory);
      expect(reopened.list()).toEqual([previous]);
      expect(JSON.parse(readFileSync(store.filePath, "utf8"))).toEqual({
        version: 1,
        entries: [previous],
      });
      expect(
        reopened.upsert(input({ replacement: "YouTube restored" })).id,
      ).toBe(previous.id);
      expect(
        readdirSync(store.directory).some((name) => name.endsWith(".tmp")),
      ).toBe(false);
    },
  );

  it("refuses unrecoverable corruption without writing an empty file or destroying evidence", () => {
    const store = new GlobalGlossaryStore(directory());
    const corrupt = "{ keep this damaged primary for recovery";
    writeFileSync(store.filePath, corrupt);
    expect(() => store.list()).toThrow(/no valid backup/);
    expect(() => store.upsert(input())).toThrow(/no valid backup/);
    expect(readFileSync(store.filePath, "utf8")).toBe(corrupt);
    expect(existsSync(store.backupPath)).toBe(false);
    writeFileSync(store.backupPath, "invalid backup");
    expect(() => store.list()).toThrow(/recover the global glossary backup/);
    expect(readFileSync(store.filePath, "utf8")).toBe(corrupt);
    expect(readFileSync(store.backupPath, "utf8")).toBe("invalid backup");
  });

  it("refuses an invalid orphaned backup rather than silently starting empty", () => {
    const store = new GlobalGlossaryStore(directory());
    writeFileSync(store.backupPath, "invalid orphaned backup");
    expect(() => store.list()).toThrow(/recover/);
    expect(existsSync(store.filePath)).toBe(false);
  });

  it("does not downgrade a future-version primary using an older backup", () => {
    const store = new GlobalGlossaryStore(directory());
    store.upsert(input());
    const future = JSON.stringify({ version: 2, entries: [entry()] });
    writeFileSync(store.filePath, future);
    expect(() => store.list()).toThrow(/Cannot read the global glossary/);
    expect(readFileSync(store.filePath, "utf8")).toBe(future);
  });

  it.each([
    { version: 1 },
    { version: 1, entries: {} },
    { version: 1, entries: [{ ...entry(), scope: "project" }] },
    { version: 1, entries: [{ ...entry(), enabled: "true" }] },
    { version: 1, entries: [{ ...entry(), createdAt: "invalid" }] },
    { version: 1, entries: [entry(), entry()] },
    { version: 1, entries: [entry(), entry(1, { source: "source-0" })] },
    {
      version: 1,
      entries: Array.from({ length: 1001 }, (_, index) => entry(index)),
    },
  ])(
    "validates persisted data instead of accepting malformed entries %j",
    (value) => {
      const store = new GlobalGlossaryStore(directory());
      const content = JSON.stringify(value);
      writeFileSync(store.filePath, content);
      expect(() => store.list()).toThrow();
      expect(readFileSync(store.filePath, "utf8")).toBe(content);
    },
  );

  it("bounds file and entry counts before any backup or primary mutation", () => {
    const store = new GlobalGlossaryStore(directory());
    const full = file(Array.from({ length: 1000 }, (_, index) => entry(index)));
    writeFileSync(store.filePath, full);
    expect(store.list()).toHaveLength(1000);
    expect(() => store.upsert(input())).toThrow(/1000/);
    expect(readFileSync(store.filePath, "utf8")).toBe(full);
    expect(existsSync(store.backupPath)).toBe(false);
    const large = "x".repeat(1024 * 1024 + 1);
    writeFileSync(store.filePath, large);
    expect(() => store.list()).toThrow();
    expect(readFileSync(store.filePath, "utf8").length).toBe(large.length);
  });

  it("bounds encoded UTF-8 payloads without partially writing an oversized update", () => {
    const store = new GlobalGlossaryStore(directory());
    const initial = file(
      Array.from({ length: 80 }, (_, index) =>
        entry(index, { replacement: "界".repeat(4096) }),
      ),
    );
    writeFileSync(store.filePath, initial);
    expect(store.list()).toHaveLength(80);
    const before = readFileSync(store.filePath, "utf8");
    // Pretty serialization exceeds one MiB before adding a large enough new term.
    writeFileSync(
      store.filePath,
      file(
        Array.from({ length: 84 }, (_, index) =>
          entry(index, { replacement: "界".repeat(4096) }),
        ),
      ),
    );
    const nearLimit = readFileSync(store.filePath, "utf8");
    expect(Buffer.byteLength(nearLimit)).toBeLessThan(1024 * 1024);
    expect(() =>
      store.upsert(input({ replacement: "界".repeat(4096) })),
    ).toThrow();
    expect(readFileSync(store.filePath, "utf8")).toBe(nearLimit);
    expect(existsSync(store.backupPath)).toBe(false);
    expect(Buffer.byteLength(before)).toBeLessThan(1024 * 1024);
  });

  it.each(["primary", "backup", "directory", "ancestor"])(
    "rejects symlinks at the %s path without touching the target",
    (kind) => {
      const root = directory();
      const target = join(root, "target");
      mkdirSync(target);
      const protectedFile = join(target, "protected.json");
      writeFileSync(protectedFile, file([entry()]));
      if (kind === "directory" || kind === "ancestor") {
        const link = join(root, "user-data");
        symlinkSync(target, link, "dir");
        expect(
          () =>
            new GlobalGlossaryStore(
              kind === "ancestor" ? join(link, "nested") : link,
            ),
        ).toThrow(/unsafe/);
        expect(existsSync(join(target, "nested"))).toBe(false);
      } else {
        const store = new GlobalGlossaryStore(join(root, "user-data"));
        mkdirSync(store.directory);
        symlinkSync(
          protectedFile,
          kind === "primary" ? store.filePath : store.backupPath,
        );
        expect(() => store.list()).toThrow(/regular file|Cannot read/);
        expect(() => store.upsert(input())).toThrow();
      }
      expect(readFileSync(protectedFile, "utf8")).toBe(file([entry()]));
    },
  );

  it.each(["primary", "backup"])("rejects nonregular %s paths", (kind) => {
    const store = new GlobalGlossaryStore(directory());
    mkdirSync(kind === "primary" ? store.filePath : store.backupPath);
    expect(() => store.list()).toThrow(/regular file|Cannot read/);
    expect(() => store.upsert(input())).toThrow();
  });

  it("keeps the committed primary and validated backup when a rename fails and cleans the temporary file", () => {
    const store = new GlobalGlossaryStore(directory());
    const original = store.upsert(input());
    const content = readFileSync(store.filePath, "utf8");
    const rename = vi.mocked(fs.renameSync).getMockImplementation()!;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (to === store.filePath) throw new Error("Simulated rename failure");
      return rename(from, to);
    });
    expect(() =>
      store.upsert(input({ replacement: "Failed replacement" })),
    ).toThrow(/rename failure/);
    expect(readFileSync(store.filePath, "utf8")).toBe(content);
    expect(JSON.parse(readFileSync(store.backupPath, "utf8"))).toEqual({
      version: 1,
      entries: [original],
    });
    expect(
      readdirSync(store.directory).some((name) => name.endsWith(".tmp")),
    ).toBe(false);
    expect(store.list()).toEqual([original]);
  });

  it("serializes actual concurrent processes or reports conflict rather than losing a successful term", async () => {
    const root = directory();
    const first = concurrentWriter(root, "first", true);
    await first.held();
    const second = await concurrentWriter(root, "second").finished;
    expect(second.stderr).not.toContain("Error:");
    const result = JSON.parse(second.stdout.trim());
    writeFileSync(join(root, "release"), "continue");
    const completed = await first.finished;
    expect(completed.code, completed.stderr).toBe(0);
    const store = new GlobalGlossaryStore(join(root, "user-data"));
    if (result.ok)
      expect(
        store
          .list()
          .map((term) => term.source)
          .sort(),
      ).toEqual(["first", "second"]);
    else {
      expect(result).toMatchObject({
        code: "glossary.storageBusy",
        status: 409,
      });
      expect(second.code).toBe(1);
      expect(store.list().map((term) => term.source)).toEqual(["first"]);
      store.upsert(
        input({ source: "second", replacement: "second preferred" }),
      );
    }
    expect(
      store
        .list()
        .map((term) => term.source)
        .sort(),
    ).toEqual(["first", "second"]);
    expect(readdirSync(store.directory).sort()).toEqual([
      "global-glossary.json",
      "global-glossary.json.bak",
    ]);
  });

  it("recovers a genuinely crashed writer without losing previously committed terms", async () => {
    const root = directory();
    const store = new GlobalGlossaryStore(join(root, "user-data"));
    const original = store.upsert(input());
    const crashed = concurrentWriter(root, "uncommitted", true);
    await crashed.held();
    const lock = JSON.parse(readFileSync(store.lockPath, "utf8"));
    expect(lock.pid).toBe(crashed.child.pid);
    crashed.child.kill("SIGKILL");
    await crashed.finished;
    // A SIGKILL can leave the writer's uncommitted data temporary behind. It is
    // never read as glossary data; reclaiming the lock must not create new debris.
    const abandoned = readdirSync(store.directory).filter((name) =>
      name.endsWith(".tmp"),
    );
    const restored = store.upsert(
      input({ source: "after-crash", replacement: "After crash" }),
    );
    expect(store.list()).toEqual([original, restored]);
    expect(existsSync(store.lockPath)).toBe(false);
    expect(
      readdirSync(store.directory).some((name) => name.includes("recover-")),
    ).toBe(false);
    expect(
      readdirSync(store.directory).filter((name) => name.endsWith(".tmp")),
    ).toEqual(abandoned);
  });

  it("does not steal a live owner, even when the lock timestamp is old", () => {
    const store = new GlobalGlossaryStore(directory());
    const record = { ...owner(), createdAt: "2000-01-01T00:00:00.000Z" };
    const original = JSON.stringify(record);
    writeFileSync(store.lockPath, original);
    expect(() => store.upsert(input())).toThrowError(
      expect.objectContaining({ code: "glossary.storageBusy", status: 409 }),
    );
    expect(readFileSync(store.lockPath, "utf8")).toBe(original);
    expect(existsSync(store.filePath)).toBe(false);
    expect(readdirSync(store.directory)).toEqual(["global-glossary.json.lock"]);
  });

  it.each([
    "",
    "{",
    JSON.stringify({ ...owner(), version: 2 }),
    JSON.stringify({ ...owner(), pid: -1 }),
    JSON.stringify({ ...owner(), token: "unverified" }),
    "x".repeat(1025),
  ])(
    "leaves incomplete or unverified lock evidence untouched: %j",
    (content) => {
      const store = new GlobalGlossaryStore(directory());
      writeFileSync(store.lockPath, content);
      expect(() => store.upsert(input())).toThrowError(
        expect.objectContaining({ code: "glossary.storageBusy" }),
      );
      expect(readFileSync(store.lockPath, "utf8")).toBe(content);
      expect(existsSync(store.filePath)).toBe(false);
      expect(readdirSync(store.directory)).toEqual([
        "global-glossary.json.lock",
      ]);
    },
  );

  it("recovers a crashed stale-lock recovery owner under a token-specific successor lock", async () => {
    const store = new GlobalGlossaryStore(directory());
    const pid = await exitedPid();
    const stale = owner(pid),
      failedRecovery = owner(pid);
    writeFileSync(store.lockPath, JSON.stringify(stale));
    writeFileSync(
      recoveryPath(store, store.lockPath, stale.token),
      JSON.stringify(failedRecovery),
    );
    const saved = store.upsert(input());
    expect(store.list()).toEqual([saved]);
    expect(readdirSync(store.directory).sort()).toEqual([
      "global-glossary.json",
      "global-glossary.json.bak",
    ]);
  });

  it("leaves a live stale-lock reclaimer untouched rather than racing its ownership check", async () => {
    const store = new GlobalGlossaryStore(directory());
    const stale = owner(await exitedPid());
    const recovery = recoveryPath(store, store.lockPath, stale.token);
    const reclaiming = JSON.stringify(owner());
    writeFileSync(store.lockPath, JSON.stringify(stale));
    writeFileSync(recovery, reclaiming);
    expect(() => store.upsert(input())).toThrowError(
      expect.objectContaining({ code: "glossary.storageBusy" }),
    );
    expect(readFileSync(store.lockPath, "utf8")).toBe(JSON.stringify(stale));
    expect(readFileSync(recovery, "utf8")).toBe(reclaiming);
    expect(existsSync(store.filePath)).toBe(false);
  });

  it("does not reclaim a new live owner when an old contender's stale token becomes obsolete", async () => {
    const store = new GlobalGlossaryStore(directory());
    const stale = owner(await exitedPid());
    const replacement = owner();
    writeFileSync(store.lockPath, JSON.stringify(stale));
    const link = vi.mocked(fs.linkSync).getMockImplementation()!;
    vi.mocked(fs.linkSync).mockImplementation((from, to) => {
      const result = link(from, to);
      if (to === recoveryPath(store, store.lockPath, stale.token))
        writeFileSync(store.lockPath, JSON.stringify(replacement));
      return result;
    });
    expect(() => store.upsert(input())).toThrowError(
      expect.objectContaining({ code: "glossary.storageBusy" }),
    );
    expect(JSON.parse(readFileSync(store.lockPath, "utf8"))).toEqual(
      replacement,
    );
    expect(existsSync(store.filePath)).toBe(false);
    expect(readdirSync(store.directory)).toEqual(["global-glossary.json.lock"]);
  });

  it("retries an uncontended claim when the previous owner releases between stat and open", () => {
    const store = new GlobalGlossaryStore(directory());
    writeFileSync(store.lockPath, JSON.stringify(owner()));
    const open = vi.mocked(fs.openSync).getMockImplementation()!;
    let released = false;
    vi.mocked(fs.openSync).mockImplementation((path, flags, mode) => {
      if (path === store.lockPath && !released) {
        released = true;
        fs.unlinkSync(store.lockPath);
      }
      return open(path, flags, mode);
    });
    const saved = store.upsert(input());
    expect(store.list()).toEqual([saved]);
    expect(existsSync(store.lockPath)).toBe(false);
  });

  it("locks backup recovery without reacquiring an already held mutation lock", async () => {
    const store = new GlobalGlossaryStore(directory());
    const original = store.upsert(input());
    store.upsert(input({ source: "newer", replacement: "Newer" }));
    writeFileSync(store.filePath, "corrupt primary");
    writeFileSync(store.lockPath, JSON.stringify(owner()));
    expect(() => store.list()).toThrowError(
      expect.objectContaining({ code: "glossary.storageBusy" }),
    );
    expect(readFileSync(store.filePath, "utf8")).toBe("corrupt primary");
    writeFileSync(store.lockPath, JSON.stringify(owner(await exitedPid())));
    expect(store.list()).toEqual([original]);
    expect(existsSync(store.lockPath)).toBe(false);
    writeFileSync(store.filePath, "another corrupt primary");
    const restored = store.upsert(
      input({ source: "restore-under-lock", replacement: "Restored" }),
    );
    expect(store.list()).toEqual([original, restored]);
    expect(existsSync(store.lockPath)).toBe(false);
  });

  it.each(["symlink", "directory"])(
    "rejects an unsafe %s lock path without modifying its target",
    (kind) => {
      const store = new GlobalGlossaryStore(directory());
      const target = join(store.directory, "protected.json");
      writeFileSync(target, "protected bytes");
      if (kind === "symlink") symlinkSync(target, store.lockPath);
      else mkdirSync(store.lockPath);
      expect(() => store.upsert(input())).toThrow();
      expect(readFileSync(target, "utf8")).toBe("protected bytes");
      expect(existsSync(store.filePath)).toBe(false);
    },
  );

  it("fails closed on filesystems without exclusive hard links and cleans its prepared owner", () => {
    const store = new GlobalGlossaryStore(directory());
    vi.mocked(fs.linkSync).mockImplementation(() => {
      throw Object.assign(new Error("Hard links unsupported"), {
        code: "EOPNOTSUPP",
      });
    });
    expect(() => store.upsert(input())).toThrowError(
      expect.objectContaining({ code: "operation.failed" }),
    );
    expect(readdirSync(store.directory)).toEqual([]);
  });

  it("compares the owner token before releasing and never unlinks a replacement lock", () => {
    const store = new GlobalGlossaryStore(directory());
    const replacement = owner();
    const rename = vi.mocked(fs.renameSync).getMockImplementation()!;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      const result = rename(from, to);
      if (to === store.filePath)
        writeFileSync(store.lockPath, JSON.stringify(replacement));
      return result;
    });
    expect(() => store.upsert(input())).toThrowError(
      expect.objectContaining({ code: "glossary.storageBusy" }),
    );
    expect(JSON.parse(readFileSync(store.lockPath, "utf8"))).toEqual(
      replacement,
    );
    expect(store.list()[0]?.source).toBe("youtube");
  });
});
