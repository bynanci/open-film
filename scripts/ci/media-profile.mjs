// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";

export class StageRecorder {
  observations = [];
  constructor(context = {}) {
    this.context = context;
  }
  begin(name) {
    const startedAt = Date.now();
    const start = performance.now();
    const cpu = process.cpuUsage();
    let peak = process.memoryUsage.rss();
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage.rss());
    }, 10);
    return (error) => {
      clearInterval(timer);
      const used = process.cpuUsage(cpu);
      const record = {
        ...this.context,
        name,
        pid: process.pid,
        startedAt,
        endedAt: Date.now(),
        wallMs: performance.now() - start,
        nodeCpuMs: (used.user + used.system) / 1000,
        nodePeakRssKiB: Math.max(peak, process.memoryUsage.rss()) / 1024,
        status: error ? "failed" : "succeeded",
        ...(error ? { error: String(error.message ?? error) } : {}),
      };
      this.observations.push(record);
      if (process.env.OPENFILM_PROFILE_STAGES)
        appendFileSync(
          process.env.OPENFILM_PROFILE_STAGES,
          JSON.stringify(record) + "\n",
        );
    };
  }
  async measure(name, operation) {
    const end = this.begin(name);
    try {
      const value = await operation();
      end();
      return value;
    } catch (error) {
      end(error);
      throw error;
    }
  }
  measureSync(name, operation) {
    const end = this.begin(name);
    try {
      const value = operation();
      end();
      return value;
    } catch (error) {
      end(error);
      throw error;
    }
  }
}
export function summarizeStages(observations) {
  const result = {};
  for (const name of new Set(observations.map((row) => row.name))) {
    const rows = observations.filter((row) => row.name === name);
    const times = rows
      .filter((row) => row.status === "succeeded")
      .map((row) => row.wallMs)
      .sort((a, b) => a - b);
    result[name] = {
      count: times.length,
      failed: rows.length - times.length,
      minWallMs: times[0] ?? null,
      medianWallMs: times.length
        ? (times[Math.floor((times.length - 1) / 2)] +
            times[Math.floor(times.length / 2)]) /
          2
        : null,
      maxWallMs: times.at(-1) ?? null,
    };
  }
  return result;
}

export function assertEquivalentSources(baseline, candidate) {
  const manifest = (commands) =>
    commands
      .filter((row) => row.syntheticSource)
      .map((row) => ({
        // Fixture destination paths differ because every test has its own project.
        args: row.args.slice(0, -1),
        sha256: row.syntheticSource.sha256,
        bytes: row.syntheticSource.bytes,
      }))
      .map((row) => JSON.stringify(row))
      .sort();
  const expected = manifest(baseline);
  if (!expected.length)
    throw new Error("No synthetic source observations were recorded.");
  if (JSON.stringify(expected) !== JSON.stringify(manifest(candidate)))
    throw new Error("Synthetic source workload changed between repetitions.");
}

export async function observerIdentity(script, env = process.env) {
  // Execute the actual shebang entry point, independent of PATH python3.
  const identity = JSON.parse(
    execFileSync(script, ["--observer-identity"], { env, encoding: "utf8" }),
  );
  return {
    ...identity,
    sha256: createHash("sha256")
      .update(await readFile(identity.realPath))
      .digest("hex"),
  };
}
