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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlossaryEntry, GlossaryInput } from "@openfilm/core";
import { GlobalGlossaryStore } from "../src/global-glossary.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const roots: string[] = [];
afterEach(() => {
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
});
