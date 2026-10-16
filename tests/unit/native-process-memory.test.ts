import { describe, expect, it, vi } from "vitest";
import {
  parseLinuxSmapsRollup,
  parseLinuxStat,
  parseLinuxStatus,
  parseMacProcessTable,
  parseWindowsProcessTable,
  sampleProcessMemory,
  WINDOWS_MEMORY_SCRIPT,
} from "../../scripts/native-benchmark/process-memory";

function stat(
  pid: number,
  parentPid: number,
  ticks: number,
  name = "openfilm",
) {
  return `${pid} (${name}) S ${parentPid} ${Array(17).fill(0).join(" ")} ${ticks} 0`;
}
function linuxFixture() {
  const files = new Map<string, string>();
  const pids = new Set<string>();
  const add = (pid: number, parentPid: number, start: number, rss = 10) => {
    pids.add(String(pid));
    files.set(`/proc/${pid}/stat`, stat(pid, parentPid, start));
    files.set(`/proc/${pid}/status`, `Name:\topenfilm\nVmRSS:\t${rss} kB\n`);
    files.set(
      `/proc/${pid}/smaps_rollup`,
      "Private_Clean: 2 kB\nPrivate_Dirty: 3 kB\nPss: 8 kB\n",
    );
  };
  add(100, 1, 1000, 100);
  add(101, 100, 1001, 50);
  add(102, 101, 1002, 25);
  add(300, 1, 500, 999);
  const readFile = vi.fn(async (path: string) => {
    const value = files.get(path);
    if (value === undefined) throw new Error("ENOENT");
    return value;
  });
  return {
    files,
    pids,
    add,
    readFile,
    readDirectory: async () => [...pids, "self", "sys"],
  };
}
const windows = [
  {
    pid: 100,
    parentPid: 1,
    createdAt: "2026-10-12T10:00:00.123456Z",
    workingSetBytes: 10000,
    privateBytes: 8000,
  },
  {
    pid: 101,
    parentPid: 100,
    createdAt: "2026-10-12T10:00:01.123456Z",
    workingSetBytes: 5000,
    privateBytes: 4000,
  },
  {
    pid: 300,
    parentPid: 1,
    createdAt: "2026-10-12T09:00:00.123456Z",
    workingSetBytes: 99999,
    privateBytes: 99999,
  },
];

describe("native process memory parsing", () => {
  it("handles Linux command names with parentheses and uses kernel start ticks", () => {
    expect(parseLinuxStat(stat(100, 1, 123456, "Open (Film) # &"))).toEqual({
      pid: 100,
      parentPid: 1,
      startTicks: 123456,
    });
    expect(() => parseLinuxStat("100 broken stat")).toThrow("identity");
  });

  it("converts procfs kB to bytes and does not make a missing metric zero", () => {
    expect(parseLinuxStatus("VmRSS: 123 kB\n")).toEqual({
      rssBytes: 123 * 1024,
    });
    expect(
      parseLinuxSmapsRollup(
        "Private_Clean: 10 kB\nPrivate_Dirty: 20 kB\nPss: 25 kB",
      ),
    ).toEqual({ privateBytes: 30 * 1024, pssBytes: 25 * 1024 });
    expect(parseLinuxSmapsRollup("Private_Clean: 10 kB")).toEqual({
      privateBytes: undefined,
      pssBytes: undefined,
    });
    expect(parseLinuxStatus("VmRSS: -1 kB").rssBytes).toBeUndefined();
    expect(parseLinuxStatus("VmRSS: 12 bytes").rssBytes).toBeUndefined();
  });

  it("parses Windows creation identities and preserves byte units", () => {
    const parsed = parseWindowsProcessTable(`\ufeff${JSON.stringify(windows)}`);
    expect(parsed.nodes[0]).toMatchObject({
      pid: 100,
      rssBytes: 10000,
      privateBytes: 8000,
      identity: "win32:100:2026-10-12T10:00:00.123456Z",
    });
    expect(parsed.unavailable).toEqual([]);
    expect(
      parseWindowsProcessTable(JSON.stringify(windows[0])).nodes,
    ).toHaveLength(1);
  });

  it("rejects Windows memory from a process that vanished or changed identity", () => {
    const result = parseWindowsProcessTable(
      JSON.stringify([
        {
          ...windows[0],
          error: "changed",
          workingSetBytes: 0,
          privateBytes: 0,
        },
      ]),
    );
    expect(result.nodes[0]!.rssBytes).toBeUndefined();
    expect(result.nodes[0]!.privateBytes).toBeUndefined();
    expect(result.unavailable[0]!.operation).toBe("memory");
    expect(() =>
      parseWindowsProcessTable('{"pid":"$(malicious)","parentPid":1}'),
    ).toThrow("identity");
  });

  it("parses macOS ps RSS and lstart without claiming private memory", () => {
    const nodes = parseMacProcessTable(
      " 100 1 12 Mon Oct 12 10:00:00 2026\n101 100 8 Mon Oct 12 10:00:01 2026\n",
    );
    expect(nodes[0]).toMatchObject({
      pid: 100,
      rssBytes: 12 * 1024,
      identityPrecision: "seconds",
    });
    expect(nodes[0]!.privateBytes).toBeUndefined();
    expect(nodes[0]!.pssBytes).toBeUndefined();
    expect(() => parseMacProcessTable("100 1 malformed")).toThrow("table");
  });
});

describe("rooted native process memory sampling", () => {
  it("collects only the current root and descendants, not unrelated processes", async () => {
    const fixture = linuxFixture();
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
      now: () => new Date("2026-10-12T12:00:00Z"),
    });
    expect(snapshot.collectedAt).toBe("2026-10-12T12:00:00.000Z");
    expect(snapshot.rootState).toBe("available");
    expect(snapshot.rootIdentity).toBe("linux:100:1000");
    expect(snapshot.processes.map((item) => item.pid)).toEqual([100, 101, 102]);
    expect(snapshot.totals.rssBytes).toEqual({
      coverage: "complete",
      value: 175 * 1024,
    });
    expect(snapshot.totals.privateBytes).toEqual({
      coverage: "complete",
      value: 15 * 1024,
    });
    expect(snapshot.totals.pssBytes).toEqual({
      coverage: "complete",
      value: 24 * 1024,
    });
    expect(
      fixture.readFile.mock.calls.some(([path]) => path === "/proc/300/status"),
    ).toBe(false);
    expect(snapshot.privateBytesDefinition).toBe("private-resident");
  });

  it("marks the rooted total partial when a new child starts during memory reads", async () => {
    const fixture = linuxFixture();
    const readDirectory = vi.fn(fixture.readDirectory);
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
      readDirectory,
      readFile: async (path) => {
        const result = await fixture.readFile(path);
        if (path === "/proc/102/status") fixture.add(103, 102, 1003, 12);
        return result;
      },
    });
    expect(snapshot.rootState).toBe("available");
    for (const metric of ["rssBytes", "privateBytes", "pssBytes"] as const)
      expect(snapshot.totals[metric]).toEqual({ coverage: "partial" });
    expect(snapshot.unavailable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "topology",
          reason: expect.stringMatching(/changed.*memory collection/iu),
        }),
      ]),
    );
    expect(readDirectory).toHaveBeenCalledTimes(2);
  });

  it.each(["PID reuse", "disappearance", "changed parent"] as const)(
    "invalidates rooted coverage after memory reads detect late child %s",
    async (change) => {
      const fixture = linuxFixture();
      let childMemoryRead = false;
      let changed = false;
      const snapshot = await sampleProcessMemory(100, {
        platform: "linux",
        ...fixture,
        readFile: async (path) => {
          const result = await fixture.readFile(path);
          if (path === "/proc/102/status") childMemoryRead = true;
          // Return the final per-process identity check unchanged, then mutate
          // /proc before the rooted post-read enumeration observes it.
          if (path === "/proc/102/stat" && childMemoryRead && !changed) {
            changed = true;
            if (change === "PID reuse") fixture.add(101, 100, 7777);
            else if (change === "disappearance") fixture.pids.delete("101");
            else fixture.files.set("/proc/102/stat", stat(102, 100, 1002));
          }
          return result;
        },
      });
      expect(changed).toBe(true);
      expect(snapshot.rootState).toBe("available");
      for (const metric of ["rssBytes", "privateBytes", "pssBytes"] as const)
        expect(snapshot.totals[metric]).toEqual({ coverage: "partial" });
      const invalidPid = change === "changed parent" ? 102 : 101;
      expect(
        snapshot.processes.find((process) => process.pid === invalidPid)
          ?.rssBytes,
      ).toBeUndefined();
      expect(
        snapshot.unavailable.some((entry) => entry.operation === "topology"),
      ).toBe(true);
    },
  );

  it("retains complete rooted coverage when unrelated process membership changes", async () => {
    const fixture = linuxFixture();
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
      readFile: async (path) => {
        const result = await fixture.readFile(path);
        if (path === "/proc/102/status") fixture.add(400, 1, 5000, 9999);
        return result;
      },
    });
    expect(snapshot.rootState).toBe("available");
    expect(snapshot.totals.rssBytes).toEqual({
      coverage: "complete",
      value: 175 * 1024,
    });
    expect(snapshot.totals.privateBytes).toEqual({
      coverage: "complete",
      value: 15 * 1024,
    });
    expect(snapshot.totals.pssBytes).toEqual({
      coverage: "complete",
      value: 24 * 1024,
    });
    expect(
      fixture.readFile.mock.calls.some(([path]) => path === "/proc/400/status"),
    ).toBe(false);
  });

  it.each(["PID reuse", "disappearance", "identity unavailable"] as const)(
    "preserves the root state when late root %s follows completed memory reads",
    async (change) => {
      const fixture = linuxFixture();
      let childMemoryRead = false;
      let changed = false;
      const snapshot = await sampleProcessMemory(100, {
        platform: "linux",
        ...fixture,
        expectedRootIdentity: "linux:100:1000",
        readFile: async (path) => {
          const result = await fixture.readFile(path);
          if (path === "/proc/102/status") childMemoryRead = true;
          if (path === "/proc/102/stat" && childMemoryRead && !changed) {
            changed = true;
            if (change === "PID reuse") fixture.add(100, 1, 9999);
            else if (change === "disappearance") fixture.pids.delete("100");
            else fixture.files.delete("/proc/100/stat");
          }
          return result;
        },
      });
      expect(snapshot.rootState).toBe(
        change === "PID reuse"
          ? "identity-mismatch"
          : change === "disappearance"
            ? "missing"
            : "unavailable",
      );
      expect(snapshot.processes).toEqual([]);
      for (const metric of ["rssBytes", "privateBytes", "pssBytes"] as const)
        expect(snapshot.totals[metric]).toEqual({ coverage: "unavailable" });
      if (change === "PID reuse")
        expect(snapshot.rootIdentity).toBe("linux:100:9999");
    },
  );

  it("keeps known per-process samples but withholds totals when final enumeration fails", async () => {
    const fixture = linuxFixture();
    let enumerations = 0;
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
      readDirectory: async () => {
        if (++enumerations === 2)
          throw new Error("EACCES: final /proc enumeration");
        return fixture.readDirectory();
      },
    });
    expect(snapshot.rootState).toBe("available");
    expect(snapshot.processes[0]?.rssBytes).toBe(100 * 1024);
    for (const metric of ["rssBytes", "privateBytes", "pssBytes"] as const)
      expect(snapshot.totals[metric]).toEqual({ coverage: "partial" });
    expect(
      snapshot.unavailable.some((entry) => entry.operation === "topology"),
    ).toBe(true);
  });

  it("preserves unavailable root versus missing root without returning zero totals", async () => {
    const fixture = linuxFixture();
    fixture.files.delete("/proc/100/stat");
    const unavailable = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
    });
    expect(unavailable.rootState).toBe("unavailable");
    expect(unavailable.totals.rssBytes).toEqual({ coverage: "unavailable" });
    const missing = await sampleProcessMemory(999, {
      platform: "linux",
      ...fixture,
    });
    expect(missing.rootState).toBe("missing");
    expect(missing.processes).toEqual([]);
    expect(missing.totals.rssBytes.value).toBeUndefined();
  });

  it("refuses a reused root PID when the caller pins the previous identity", async () => {
    const fixture = linuxFixture();
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
      expectedRootIdentity: "linux:100:999",
    });
    expect(snapshot.rootState).toBe("identity-mismatch");
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.totals.rssBytes.value).toBeUndefined();
    expect(
      fixture.readFile.mock.calls.some(([path]) => path.endsWith("/status")),
    ).toBe(false);
  });

  it("does not collect an old child whose parent PID now belongs to a new process", async () => {
    const fixture = linuxFixture();
    fixture.add(101, 100, 500);
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
    });
    expect(snapshot.processes.map((item) => item.pid)).toEqual([100]);
    expect(snapshot.unavailable).toContainEqual({
      pid: 101,
      operation: "topology",
      reason: "Parent PID was reused; descendant association is unavailable",
    });
    expect(snapshot.totals.rssBytes.coverage).toBe("partial");
    expect(snapshot.totals.rssBytes.value).toBeUndefined();
  });

  it("does not hide missing descendants in an aggregate", async () => {
    const fixture = linuxFixture();
    fixture.files.delete("/proc/101/status");
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
    });
    expect(snapshot.rootState).toBe("available");
    expect(
      snapshot.processes.find((item) => item.pid === 101)!.rssBytes,
    ).toBeUndefined();
    expect(snapshot.totals.rssBytes).toEqual({ coverage: "partial" });
    expect(snapshot.totals.privateBytes).toEqual({ coverage: "partial" });
  });

  it("checks identity after Linux memory reads to detect PID reuse during collection", async () => {
    const fixture = linuxFixture();
    const readFile = async (path: string) => {
      const result = await fixture.readFile(path);
      if (path === "/proc/101/status")
        fixture.files.set("/proc/101/stat", stat(101, 100, 7777));
      return result;
    };
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
      readFile,
    });
    expect(
      snapshot.processes.find((item) => item.pid === 101)!.rssBytes,
    ).toBeUndefined();
    expect(snapshot.totals.rssBytes).toEqual({ coverage: "partial" });
    expect(snapshot.unavailable).toContainEqual({
      pid: 101,
      operation: "identity",
      reason:
        "Process disappeared or changed identity during memory collection",
    });
  });

  it("supports optional Linux PSS failures without hiding RSS", async () => {
    const fixture = linuxFixture();
    fixture.files.delete("/proc/101/smaps_rollup");
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
    });
    expect(snapshot.totals.rssBytes.coverage).toBe("complete");
    expect(snapshot.totals.pssBytes).toEqual({ coverage: "partial" });
    expect(snapshot.totals.privateBytes).toEqual({ coverage: "partial" });
    expect(snapshot.processes.find((item) => item.pid === 101)!.rssBytes).toBe(
      50 * 1024,
    );
  });

  it("marks unknown Linux topology partial instead of inventing a complete tree", async () => {
    const fixture = linuxFixture();
    fixture.files.delete("/proc/300/stat");
    const snapshot = await sampleProcessMemory(100, {
      platform: "linux",
      ...fixture,
    });
    expect(snapshot.totals.rssBytes).toEqual({ coverage: "partial" });
    expect(
      snapshot.unavailable.some(
        (entry) => entry.pid === 300 && entry.operation === "topology",
      ),
    ).toBe(true);
  });

  it("uses a static, noninteractive Windows command and reports private committed bytes", async () => {
    const execute = vi.fn(async () => JSON.stringify(windows));
    const snapshot = await sampleProcessMemory(100, {
      platform: "win32",
      execute,
    });
    expect(execute).toHaveBeenCalledWith("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      WINDOWS_MEMORY_SCRIPT,
    ]);
    expect(snapshot.processes.map((item) => item.pid)).toEqual([100, 101]);
    expect(snapshot.totals.rssBytes).toEqual({
      coverage: "complete",
      value: 15000,
    });
    expect(snapshot.totals.privateBytes).toEqual({
      coverage: "complete",
      value: 12000,
    });
    expect(snapshot.totals.pssBytes).toEqual({ coverage: "unavailable" });
    expect(snapshot.privateBytesDefinition).toBe("private-committed");
  });

  it("rejects a changed Windows root creation identity", async () => {
    const snapshot = await sampleProcessMemory(100, {
      platform: "win32",
      execute: async () => JSON.stringify(windows),
      expectedRootIdentity: "win32:100:previous-start",
    });
    expect(snapshot.rootState).toBe("identity-mismatch");
    expect(snapshot.totals.privateBytes.value).toBeUndefined();
  });

  it("does not hide denied Windows child metrics", async () => {
    const denied = windows.map((row) =>
      row.pid === 101 ? { ...row, error: "access denied" } : row,
    );
    const snapshot = await sampleProcessMemory(100, {
      platform: "win32",
      execute: async () => JSON.stringify(denied),
    });
    expect(snapshot.totals.rssBytes).toEqual({ coverage: "partial" });
    expect(snapshot.totals.privateBytes).toEqual({ coverage: "partial" });
  });

  it("does not let inaccessible unrelated Windows system processes erase valid rooted coverage", async () => {
    const rows = [
      ...windows,
      {
        pid: 4,
        parentPid: 0,
        createdAt: null,
        error: "system identity denied",
      },
    ];
    const snapshot = await sampleProcessMemory(100, {
      platform: "win32",
      execute: async () => JSON.stringify(rows),
    });
    expect(snapshot.totals.rssBytes).toEqual({
      coverage: "complete",
      value: 15000,
    });
    expect(snapshot.unavailable.some((entry) => entry.pid === 4)).toBe(true);
    rows.push({
      pid: 102,
      parentPid: 100,
      createdAt: null,
      error: "child identity denied",
    });
    const partial = await sampleProcessMemory(100, {
      platform: "win32",
      execute: async () => JSON.stringify(rows),
    });
    expect(partial.totals.rssBytes).toEqual({ coverage: "partial" });
  });

  it("uses Windows microsecond birth ordering to detect reused parent PIDs", async () => {
    const rows = [
      windows[0],
      { ...windows[1], createdAt: "2026-10-12T10:00:00.123455Z" },
    ];
    const snapshot = await sampleProcessMemory(100, {
      platform: "win32",
      execute: async () => JSON.stringify(rows),
    });
    expect(snapshot.processes.map((entry) => entry.pid)).toEqual([100]);
    expect(snapshot.totals.rssBytes).toEqual({ coverage: "partial" });
  });

  it("rejects duplicate PID entries instead of double-counting memory", async () => {
    const snapshot = await sampleProcessMemory(100, {
      platform: "win32",
      execute: async () => JSON.stringify([...windows, windows[0]]),
    });
    expect(snapshot.rootState).toBe("unavailable");
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.totals.rssBytes).toEqual({ coverage: "unavailable" });
  });

  it("uses macOS RSS only and preserves one-second identity precision", async () => {
    const execute = vi.fn(
      async () =>
        "100 1 12 Mon Oct 12 10:00:00 2026\n101 100 8 Mon Oct 12 10:00:01 2026\n300 1 100 Mon Oct 12 09:00:00 2026\n",
    );
    const snapshot = await sampleProcessMemory(100, {
      platform: "darwin",
      execute,
    });
    expect(execute).toHaveBeenCalledWith("/bin/ps", [
      "-axo",
      "pid=,ppid=,rss=,lstart=",
    ]);
    expect(snapshot.totals.rssBytes).toEqual({
      coverage: "complete",
      value: 20 * 1024,
    });
    expect(snapshot.totals.privateBytes).toEqual({ coverage: "unavailable" });
    expect(snapshot.privateBytesDefinition).toBe("unsupported");
    expect(
      snapshot.processes.every(
        (entry) => entry.identityPrecision === "seconds",
      ),
    ).toBe(true);
  });

  it("reports enumeration failures and malformed output as unavailable", async () => {
    const snapshot = await sampleProcessMemory(100, {
      platform: "win32",
      execute: async () => {
        throw new Error("timeout");
      },
    });
    expect(snapshot.rootState).toBe("unavailable");
    expect(snapshot.totals.rssBytes.value).toBeUndefined();
    expect(snapshot.unavailable[0]!.operation).toBe("topology");
    const malformed = await sampleProcessMemory(100, {
      platform: "darwin",
      execute: async () => "not ps output",
    });
    expect(malformed.rootState).toBe("unavailable");
    expect(malformed.processes).toEqual([]);
  });

  it("rejects invalid PIDs before running any subprocess", async () => {
    const execute = vi.fn(async () => "[]");
    for (const value of [0, -1, 1.5, Infinity, 0x100000000])
      await expect(
        sampleProcessMemory(value, { platform: "win32", execute }),
      ).rejects.toThrow("rootPid");
    expect(execute).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === "linux")(
    "can read a real Linux process without certifying native workstation performance",
    async () => {
      const snapshot = await sampleProcessMemory(process.pid);
      expect(snapshot.rootState).toBe("available");
      expect(snapshot.rootIdentity).toMatch(
        new RegExp(`^linux:${process.pid}:\\d+$`, "u"),
      );
      expect(snapshot.processes[0]!.rssBytes).toBeGreaterThan(0);
      const pinned = await sampleProcessMemory(process.pid, {
        expectedRootIdentity: snapshot.rootIdentity,
      });
      expect(pinned.rootState).toBe("available");
    },
  );
});
