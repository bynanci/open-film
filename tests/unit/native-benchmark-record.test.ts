import { describe, expect, it } from "vitest";
import { sampleProcessMemory } from "../../scripts/native-benchmark/process-memory";
import {
  parseNativeEvents,
  summarizeNativeEvents,
  mergeMemorySnapshots,
} from "../../scripts/native-benchmark/record";

const event = (kind: string, ms: number, extra = {}) => ({
  runId: "run-1",
  pid: 42,
  kind,
  nativeElapsedMs: ms,
  unixMs: 1000 + ms,
  clientElapsedMs: ms,
  clientTimeOriginMs: 1000,
  ...extra,
});
describe("native measurement evidence", () => {
  it("ignores an unfinished append but refuses foreign process and malformed evidence", () => {
    expect(
      parseNativeEvents(
        JSON.stringify(event("welcome-ready", 10)) + "\n{",
        "run-1",
        42,
      ),
    ).toHaveLength(1);
    expect(() =>
      parseNativeEvents(
        JSON.stringify(event("edit-ready", 20, { pid: 43 })) + "\n",
        "run-1",
        42,
      ),
    ).toThrow(/identity/);
    expect(() =>
      parseNativeEvents(
        JSON.stringify(event("edit-ready", -1)) + "\n",
        "run-1",
        42,
      ),
    ).toThrow(/time/);
    expect(() =>
      parseNativeEvents(
        JSON.stringify(event("edit-ready", 10, { clipCount: 1.5 })) + "\n",
        "run-1",
        42,
      ),
    ).toThrow(/clip/);
  });
  it("uses one native clock and excludes human navigation time from Edit cost", () => {
    const events = parseNativeEvents(
      [
        event("welcome-ready", 20),
        event("edit-enter", 8000),
        event("edit-ready", 8120, { clipCount: 500 }),
        event("edit-leave", 9000),
        event("edit-enter", 10000),
        event("edit-ready", 10050, { clipCount: 500 }),
      ]
        .map((value) => JSON.stringify(value))
        .join("\n") + "\n",
      "run-1",
      42,
    );
    const summary = summarizeNativeEvents(events);
    expect(summary.firstUiReady?.nativeElapsedMs).toBe(20);
    expect(summary.editVisits.map((visit) => visit.durationMs)).toEqual([
      120, 50,
    ]);
    expect(summary.editVisits[0]?.clipCount).toBe(500);
    expect(summary.incompleteEditVisits).toBe(0);
  });
  it("includes render before IPC enter receipt and refuses cross-document clock pairing", () => {
    const start = event("edit-enter", 1000, { clientElapsedMs: 100 });
    const ready = event("edit-ready", 1010, {
      clientElapsedMs: 200,
      clipCount: 500,
    });
    const result = summarizeNativeEvents([start, ready] as never);
    expect(result.editVisits[0]?.durationMs).toBe(100);
    expect(result.editVisits[0]?.nativeReceiptDurationMs).toBe(10);
    const reloaded = summarizeNativeEvents([
      start,
      { ...ready, clientTimeOriginMs: 2000 },
    ] as never);
    expect(reloaded.editVisits).toEqual([]);
    expect(reloaded.invalidEditVisits).toBe(1);
  });
  it("does not credit ready without enter, stale ready after leave, or non-monotonic events", () => {
    expect(
      summarizeNativeEvents([
        event("edit-ready", 50, { clipCount: 500 }),
      ] as never).editVisits,
    ).toEqual([]);
    expect(
      summarizeNativeEvents([
        event("edit-enter", 10),
        event("edit-leave", 11),
        event("edit-ready", 12, { clipCount: 500 }),
      ] as never).editVisits,
    ).toEqual([]);
    expect(() =>
      parseNativeEvents(
        [event("edit-enter", 10), event("edit-ready", 9)]
          .map((value) => JSON.stringify(value))
          .join("\n") + "\n",
        "run-1",
        42,
      ),
    ).toThrow(/monotonic/);
  });
  it("deduplicates an overlapping owned tree and never sums missing metrics as zero", () => {
    const process = {
      pid: 42,
      parentPid: 1,
      identity: "42:123",
      rssBytes: 100,
    };
    const snapshot = {
      collectedAt: new Date().toISOString(),
      platform: "linux",
      rootPid: 42,
      rootState: "available",
      processes: [process],
      unavailable: [],
      totals: {
        rssBytes: { coverage: "complete", value: 100 },
        privateBytes: { coverage: "unavailable" },
        pssBytes: { coverage: "unavailable" },
      },
    };
    const union = mergeMemorySnapshots([snapshot, snapshot] as never);
    expect(union.processes).toHaveLength(1);
    expect(union.totals.rssBytes).toEqual({ coverage: "complete", value: 100 });
    expect(union.totals.privateBytes.value).toBeUndefined();
    expect(union.totals.pssBytes.value).toBeUndefined();
    const partial = mergeMemorySnapshots([
      {
        ...snapshot,
        totals: { ...snapshot.totals, rssBytes: { coverage: "partial" } },
        unavailable: [
          { pid: 9, operation: "topology", reason: "access denied" },
        ],
      },
    ] as never);
    expect(partial.totals.rssBytes.value).toBeUndefined();
  });
  it("preserves rooted Windows coverage when an unrelated system process denies identity access", async () => {
    const snapshot = await sampleProcessMemory(100, {
      platform: "win32",
      execute: async () =>
        JSON.stringify([
          {
            pid: 100,
            parentPid: 1,
            createdAt: "2026-10-12T12:00:00.000000Z",
            workingSetBytes: 10000,
            privateBytes: 8000,
          },
          {
            pid: 101,
            parentPid: 100,
            createdAt: "2026-10-12T12:00:01.000000Z",
            workingSetBytes: 5000,
            privateBytes: 4000,
          },
          {
            pid: 4,
            parentPid: 0,
            createdAt: null,
            workingSetBytes: null,
            privateBytes: null,
            error: "access denied",
          },
        ]),
    });
    expect(snapshot.totals.rssBytes).toEqual({
      coverage: "complete",
      value: 15000,
    });
    expect(mergeMemorySnapshots([snapshot]).totals.rssBytes).toEqual({
      coverage: "complete",
      value: 15000,
    });
  });
  it("does not total two creation identities sharing a reused PID", () => {
    const root = {
      rootState: "available",
      processes: [{ pid: 42, identity: "old", rssBytes: 100 }],
      unavailable: [],
      totals: { rssBytes: { coverage: "complete", value: 100 } },
    };
    const newer = {
      ...root,
      processes: [{ pid: 42, identity: "new", rssBytes: 200 }],
    };
    expect(
      mergeMemorySnapshots([root, newer] as never).totals.rssBytes.value,
    ).toBeUndefined();
  });
});
