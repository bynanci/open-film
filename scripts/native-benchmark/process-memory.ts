import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";

/** Native process memory, in bytes. RSS sums may count shared pages repeatedly.
 * Linux privateBytes means private resident pages; Windows means private committed
 * bytes. These quantities are deliberately not comparable across platforms.
 * macOS ps exposes RSS only and start identity has one-second precision.
 */
export interface ProcessMemory {
  pid: number;
  parentPid: number;
  identity: string;
  identityPrecision: "kernel-ticks" | "microseconds" | "seconds";
  rssBytes?: number;
  privateBytes?: number;
  pssBytes?: number;
}

type Metric = "rssBytes" | "privateBytes" | "pssBytes";
export interface MemoryUnavailable {
  pid?: number;
  parentPid?: number;
  metric?: Metric;
  operation: "topology" | "identity" | "memory";
  reason: string;
}
export interface MemoryTotal {
  coverage: "complete" | "partial" | "unavailable";
  /** Absent whenever coverage is incomplete: missing data is never zero. */
  value?: number;
}
export interface ProcessMemorySnapshot {
  collectedAt: string;
  platform: string;
  rootPid: number;
  rootIdentity?: string;
  rootState: "available" | "missing" | "identity-mismatch" | "unavailable";
  processes: ProcessMemory[];
  unavailable: MemoryUnavailable[];
  totals: Record<Metric, MemoryTotal>;
  units: "bytes";
  privateBytesDefinition:
    "private-resident" | "private-committed" | "unsupported";
  rssIncludesSharedPages: true;
}
export interface ProcessMemoryOptions {
  platform?: NodeJS.Platform;
  expectedRootIdentity?: string;
  readFile?: (path: string) => Promise<string>;
  readDirectory?: (path: string) => Promise<string[]>;
  execute?: (file: string, args: string[]) => Promise<string>;
  now?: () => Date;
}

interface ProcessNode extends ProcessMemory {
  birth: number;
}
const metrics: Metric[] = ["rssBytes", "privateBytes", "pssBytes"];
const executeFile = promisify(execFile);
const execute = async (file: string, args: string[]) => {
  const result = await executeFile(file, args, {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, LC_ALL: "C" },
  });
  return result.stdout;
};
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validPid = (value: unknown): value is number =>
  nonnegativeInteger(value) && value > 0 && value <= 0xffffffff;

/** /proc/stat's command can contain spaces and parentheses. */
export function parseLinuxStat(text: string): {
  pid: number;
  parentPid: number;
  startTicks: number;
} {
  const end = text.lastIndexOf(")");
  const pid = Number(text.slice(0, text.indexOf("(")).trim());
  const fields = text
    .slice(end + 1)
    .trim()
    .split(/\s+/u);
  const parentPid = Number(fields[1]);
  const startTicks = Number(fields[19]);
  if (
    end < 0 ||
    !validPid(pid) ||
    !nonnegativeInteger(parentPid) ||
    !nonnegativeInteger(startTicks) ||
    fields.length < 20
  )
    throw new Error("Invalid Linux process identity");
  return { pid, parentPid, startTicks };
}

function kilobyteField(text: string, name: string): number | undefined {
  const line = text.split("\n").find((value) => value.startsWith(`${name}:`));
  if (!line) return undefined;
  const match = /^\S+:\s+(\d+)\s+kB\s*$/u.exec(line);
  const bytes = match ? Number(match[1]) * 1024 : NaN;
  return nonnegativeInteger(bytes) ? bytes : undefined;
}
export function parseLinuxStatus(text: string): { rssBytes?: number } {
  return { rssBytes: kilobyteField(text, "VmRSS") };
}
export function parseLinuxSmapsRollup(text: string): {
  privateBytes?: number;
  pssBytes?: number;
} {
  const clean = kilobyteField(text, "Private_Clean");
  const dirty = kilobyteField(text, "Private_Dirty");
  const privateBytes =
    clean !== undefined && dirty !== undefined ? clean + dirty : undefined;
  return {
    privateBytes: nonnegativeInteger(privateBytes) ? privateBytes : undefined,
    pssBytes: kilobyteField(text, "Pss"),
  };
}

// No caller-supplied text is interpolated into this PowerShell program.
// Compare kernel Process.StartTime to CIM creation identity before accepting
// memory: a PID may have exited and been reused since topology enumeration.
export const WINDOWS_MEMORY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$rows = @(Get-CimInstance Win32_Process | ForEach-Object {
  $row = [ordered]@{ pid = [long]$_.ProcessId; parentPid = [long]$_.ParentProcessId; createdAt = $null; workingSetBytes = $null; privateBytes = $null; error = $null }
  $p = $null
  try {
    $birth = $_.CreationDate.ToUniversalTime()
    $row.createdAt = $birth.ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ')
    $p = Get-Process -Id $_.ProcessId -ErrorAction Stop
    $memoryBirth = $p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.ffffffZ')
    if ($memoryBirth -ne $row.createdAt) { throw 'Process identity changed during collection' }
    if ($p.HasExited) { throw 'Process exited during collection' }
    $p.Refresh()
    $row.workingSetBytes = [long]$p.WorkingSet64
    $row.privateBytes = [long]$p.PrivateMemorySize64
    if ($p.HasExited) { throw 'Process exited during collection' }
  } catch { $row.error = 'Process disappeared, changed identity, or memory access was denied' }
  finally { if ($null -ne $p) { $p.Dispose() } }
  [pscustomobject]$row
})
ConvertTo-Json -InputObject $rows -Depth 3 -Compress
`;

export function parseWindowsProcessTable(text: string): {
  nodes: ProcessNode[];
  unavailable: MemoryUnavailable[];
} {
  const decoded: unknown = JSON.parse(text.replace(/^\uFEFF/u, ""));
  const rows = Array.isArray(decoded) ? decoded : [decoded];
  if (rows.length > 65536)
    throw new Error("Process table exceeds collection bound");
  const nodes: ProcessNode[] = [],
    unavailable: MemoryUnavailable[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object")
      throw new Error("Invalid Windows process table");
    const row = raw as Record<string, unknown>;
    // Windows idle PID 0 is not a sampleable root or descendant.
    if (row.pid === 0) continue;
    if (!validPid(row.pid) || !nonnegativeInteger(row.parentPid))
      throw new Error("Invalid Windows process identity");
    if (
      typeof row.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(row.createdAt) ||
      !Number.isFinite(Date.parse(row.createdAt))
    ) {
      unavailable.push({
        pid: row.pid,
        parentPid: row.parentPid,
        operation: "topology",
        reason: "Creation identity is unavailable",
      });
      continue;
    }
    const node: ProcessNode = {
      pid: row.pid,
      parentPid: row.parentPid,
      identity: `win32:${row.pid}:${row.createdAt}`,
      identityPrecision: "microseconds",
      // Preserve CIM's microseconds when comparing parent/child birth order.
      birth:
        Date.parse(row.createdAt) * 1000 + Number(row.createdAt.slice(-4, -1)),
    };
    if (!row.error) {
      if (nonnegativeInteger(row.workingSetBytes))
        node.rssBytes = row.workingSetBytes;
      if (nonnegativeInteger(row.privateBytes))
        node.privateBytes = row.privateBytes;
    } else
      unavailable.push({
        pid: row.pid,
        operation: "memory",
        reason:
          "Process disappeared, changed identity, or memory access was denied",
      });
    nodes.push(node);
  }
  return { nodes, unavailable };
}

export function parseMacProcessTable(text: string): ProcessNode[] {
  const rows = text.split("\n").filter((line) => line.trim());
  if (rows.length > 65536)
    throw new Error("Process table exceeds collection bound");
  return rows.map((line) => {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s*$/u.exec(
        line,
      );
    if (!match) throw new Error("Invalid macOS process table");
    const pid = Number(match[1]),
      parentPid = Number(match[2]);
    const rssBytes = Number(match[3]) * 1024,
      start = match[4]!;
    const birth = Date.parse(start);
    if (
      !validPid(pid) ||
      !nonnegativeInteger(parentPid) ||
      !nonnegativeInteger(rssBytes) ||
      !Number.isFinite(birth)
    )
      throw new Error("Invalid macOS process identity or RSS");
    return {
      pid,
      parentPid,
      rssBytes,
      birth,
      identity: `darwin:${pid}:${start}`,
      identityPrecision: "seconds",
    };
  });
}

async function linuxNodes(options: ProcessMemoryOptions): Promise<{
  nodes: ProcessNode[];
  unavailable: MemoryUnavailable[];
}> {
  const read = options.readFile ?? ((path) => readFile(path, "utf8"));
  const directories = options.readDirectory ?? readdir;
  const entries = (await directories("/proc")).filter((value) =>
    /^\d+$/u.test(value),
  );
  if (entries.length > 65536)
    throw new Error("Process table exceeds collection bound");
  const nodes: ProcessNode[] = [],
    unavailable: MemoryUnavailable[] = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(32, entries.length) }, async () => {
      for (;;) {
        const entry = entries[index++];
        if (entry === undefined) break;
        const pid = Number(entry);
        try {
          const stat = parseLinuxStat(await read(`/proc/${entry}/stat`));
          if (stat.pid !== pid)
            throw new Error("Process identity did not match directory");
          nodes.push({
            pid,
            parentPid: stat.parentPid,
            birth: stat.startTicks,
            identity: `linux:${pid}:${stat.startTicks}`,
            identityPrecision: "kernel-ticks",
          });
        } catch {
          unavailable.push({
            pid,
            operation: "topology",
            reason: "Process disappeared or identity could not be read",
          });
        }
      }
    }),
  );
  return { nodes, unavailable };
}

function processTree(
  nodes: ProcessNode[],
  root: ProcessNode,
  unavailable: MemoryUnavailable[],
): ProcessNode[] {
  const children = new Map<number, ProcessNode[]>();
  const seen = new Set<number>();
  for (const node of nodes) {
    if (seen.has(node.pid))
      throw new Error("Duplicate process identity in snapshot");
    seen.add(node.pid);
    const list = children.get(node.parentPid) ?? [];
    list.push(node);
    children.set(node.parentPid, list);
  }
  const result = [root],
    visited = new Set([root.pid]);
  for (let index = 0; index < result.length; index++) {
    const parent = result[index]!;
    for (const child of (children.get(parent.pid) ?? []).sort(
      (a, b) => a.pid - b.pid,
    )) {
      if (visited.has(child.pid)) continue;
      // A child older than its recorded parent is an orphan whose parent PID
      // has been reused, not a descendant of the current native application.
      if (child.birth < parent.birth) {
        unavailable.push({
          pid: child.pid,
          operation: "topology",
          reason:
            "Parent PID was reused; descendant association is unavailable",
        });
        continue;
      }
      visited.add(child.pid);
      result.push(child);
    }
  }
  return result;
}

export async function sampleProcessMemory(
  rootPid: number,
  options: ProcessMemoryOptions = {},
): Promise<ProcessMemorySnapshot> {
  if (!validPid(rootPid))
    throw new Error("rootPid must be a positive 32-bit integer");
  const platform = options.platform ?? process.platform;
  const snapshot: ProcessMemorySnapshot = {
    collectedAt: (options.now ?? (() => new Date()))().toISOString(),
    platform,
    rootPid,
    rootState: "unavailable",
    processes: [],
    unavailable: [],
    totals: Object.fromEntries(
      metrics.map((metric) => [metric, { coverage: "unavailable" }]),
    ) as Record<Metric, MemoryTotal>,
    units: "bytes",
    privateBytesDefinition:
      platform === "linux"
        ? "private-resident"
        : platform === "win32"
          ? "private-committed"
          : "unsupported",
    rssIncludesSharedPages: true,
  };
  try {
    let nodes: ProcessNode[];
    const run = options.execute ?? execute;
    if (platform === "linux") {
      const result = await linuxNodes(options);
      nodes = result.nodes;
      snapshot.unavailable.push(...result.unavailable);
    } else if (platform === "win32") {
      const result = parseWindowsProcessTable(
        await run("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          WINDOWS_MEMORY_SCRIPT,
        ]),
      );
      nodes = result.nodes;
      snapshot.unavailable.push(...result.unavailable);
    } else if (platform === "darwin") {
      nodes = parseMacProcessTable(
        await run("/bin/ps", ["-axo", "pid=,ppid=,rss=,lstart="]),
      );
    } else throw new Error("Unsupported platform");
    const root = nodes.find((node) => node.pid === rootPid);
    if (!root) {
      snapshot.rootState = snapshot.unavailable.some(
        (entry) => entry.pid === rootPid,
      )
        ? "unavailable"
        : "missing";
      return snapshot;
    }
    snapshot.rootIdentity = root.identity;
    if (
      options.expectedRootIdentity &&
      options.expectedRootIdentity !== root.identity
    ) {
      snapshot.rootState = "identity-mismatch";
      snapshot.unavailable.push({
        pid: rootPid,
        operation: "identity",
        reason: "Root PID belongs to a different process start identity",
      });
      return snapshot;
    }
    const tree = processTree(nodes, root, snapshot.unavailable);
    if (platform === "linux") {
      const read = options.readFile ?? ((path) => readFile(path, "utf8"));
      for (const node of tree) {
        try {
          const before = parseLinuxStat(await read(`/proc/${node.pid}/stat`));
          if (`linux:${before.pid}:${before.startTicks}` !== node.identity)
            throw new Error("Process identity changed");
          const resident = parseLinuxStatus(
            await read(`/proc/${node.pid}/status`),
          );
          let proportional: ReturnType<typeof parseLinuxSmapsRollup> = {};
          try {
            proportional = parseLinuxSmapsRollup(
              await read(`/proc/${node.pid}/smaps_rollup`),
            );
          } catch {
            snapshot.unavailable.push({
              pid: node.pid,
              operation: "memory",
              reason:
                "Private resident and proportional memory are unavailable",
            });
          }
          const after = parseLinuxStat(await read(`/proc/${node.pid}/stat`));
          if (`linux:${after.pid}:${after.startTicks}` !== node.identity)
            throw new Error("Process identity changed");
          Object.assign(node, resident, proportional);
        } catch {
          snapshot.unavailable.push({
            pid: node.pid,
            operation: "identity",
            reason:
              "Process disappeared or changed identity during memory collection",
          });
        }
      }
    }
    snapshot.rootState =
      tree[0]!.rssBytes === undefined ? "unavailable" : "available";
    snapshot.processes = tree.map(({ birth: _birth, ...node }) => node);
    for (const metric of metrics) {
      const values = tree.map((node) => node[metric]);
      const count = values.filter((value) => value !== undefined).length;
      const treePids = new Set(tree.map((node) => node.pid));
      const unknownTopology = snapshot.unavailable.some(
        (entry) =>
          entry.operation === "topology" &&
          (entry.parentPid === undefined || treePids.has(entry.parentPid)),
      );
      const coverage =
        count === 0
          ? "unavailable"
          : count === tree.length && !unknownTopology
            ? "complete"
            : "partial";
      snapshot.totals[metric] = { coverage };
      if (coverage === "complete") {
        const value = values.reduce<number>((sum, value) => sum + value!, 0);
        if (nonnegativeInteger(value)) snapshot.totals[metric].value = value;
        else snapshot.totals[metric].coverage = "unavailable";
      }
      for (const node of tree)
        if (node[metric] === undefined)
          snapshot.unavailable.push({
            pid: node.pid,
            metric,
            operation: "memory",
            reason: "Metric was unavailable; it is not zero",
          });
    }
  } catch {
    snapshot.unavailable.push({
      operation: "topology",
      reason: "Process enumeration failed, timed out, or returned invalid data",
    });
  }
  return snapshot;
}
