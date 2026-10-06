import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { hostname, platform } from "node:os";
import type { ReviewExecutionOwner } from "@openfilm/core";

// A hostname alone is not enough to probe a PID from a portable project. Bind
// Linux owners to the kernel boot and PID namespace before checking liveness.
function processScope(): { host: string; verifiable: boolean } {
  try {
    if (platform() !== "linux") throw new Error("No verified local PID scope.");
    const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const namespace = readlinkSync("/proc/self/ns/pid");
    if (!boot || !/^pid:\[\d+\]$/u.test(namespace))
      throw new Error("No verified local PID scope.");
    return {
      host: createHash("sha256")
        .update(JSON.stringify([platform(), hostname(), boot, namespace]))
        .digest("hex"),
      verifiable: true,
    };
  } catch {
    // Missing platform evidence must not turn another process's work into a
    // crashed job. This process can still own its own newly queued reservation.
    return { host: randomUUID(), verifiable: false };
  }
}

const scope = processScope();
const localTokens = new Set<string>();

function validOwner(value: unknown): value is ReviewExecutionOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const owner = value as Record<string, unknown>;
  return (
    typeof owner.host === "string" &&
    Boolean(owner.host.trim()) &&
    Number.isSafeInteger(owner.pid) &&
    Number(owner.pid) > 0 &&
    Number(owner.pid) <= 2147483647 &&
    typeof owner.token === "string" &&
    Boolean(owner.token.trim())
  );
}

/** Each initial reservation or retry gets a distinct, durable execution token. */
export function createReviewOwner(): ReviewExecutionOwner {
  const token = randomUUID();
  localTokens.add(token);
  return { host: scope.host, pid: process.pid, token };
}

/** Only this process may consume a queued reservation it actually created. */
export function ownsReviewOwner(value: unknown): value is ReviewExecutionOwner {
  return (
    validOwner(value) &&
    value.host === scope.host &&
    value.pid === process.pid &&
    localTokens.has(value.token)
  );
}

export function reviewOwnerState(value: unknown): "alive" | "dead" | "unknown" {
  if (!validOwner(value) || value.host !== scope.host) return "unknown";
  if (value.pid === process.pid) return "alive";
  if (!scope.verifiable) return "unknown";
  try {
    process.kill(value.pid, 0);
    return "alive";
  } catch (error) {
    // EPERM, unavailable process probes, and reused live PIDs cannot prove a
    // dead execution owner. A changed boot/namespace is likewise unknown.
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "dead"
      : "unknown";
  }
}
