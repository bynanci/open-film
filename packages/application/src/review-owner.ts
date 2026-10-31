import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { hostname, platform } from "node:os";
import { win32 } from "node:path";
import type { ReviewExecutionOwner } from "@openfilm/core";
import { windowsPowerShellEnvironment } from "./windows-powershell.js";

// A hostname alone is not enough to probe a PID from a portable project. Bind
// owners to a verified local boot/PID scope before checking liveness.
function processScope(): { host: string; verifiable: boolean } {
  try {
    if (platform() === "win32") {
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !win32.isAbsolute(systemRoot))
        throw new Error("No verified Windows system directory.");
      // Windows PIDs are scoped to the local OS. Query its machine identity and
      // kernel boot together, without profiles, user-supplied commands or UI.
      const evidence = JSON.parse(
        execFileSync(
          win32.join(
            systemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          ),
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='Stop'; " +
              "$machine=Get-ItemPropertyValue -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid; " +
              "$boot=(Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('O'); " +
              "ConvertTo-Json -InputObject @{machine=$machine;boot=$boot} -Compress",
          ],
          {
            env: windowsPowerShellEnvironment(systemRoot),
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
            timeout: 5000,
            maxBuffer: 4096,
          },
        ).trim(),
      ) as { machine?: unknown; boot?: unknown } | null;
      const machine = evidence?.machine;
      const boot = evidence?.boot;
      if (
        typeof machine !== "string" ||
        !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(machine) ||
        machine === "00000000-0000-0000-0000-000000000000" ||
        typeof boot !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/u.test(boot) ||
        !Number.isFinite(Date.parse(boot)) ||
        new Date(boot).toISOString() !== boot.slice(0, 23) + "Z"
      )
        throw new Error("No verified Windows machine/boot identity.");
      return {
        // Persist only a digest: portable projects must not disclose MachineGuid.
        host: createHash("sha256")
          .update(
            JSON.stringify([
              platform(),
              hostname(),
              machine.toLowerCase(),
              boot,
            ]),
          )
          .digest("hex"),
        verifiable: true,
      };
    }
    if (platform() === "darwin") {
      const boot = execFileSync(
        "/usr/sbin/sysctl",
        ["-n", "kern.bootsessionuuid"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
          maxBuffer: 4096,
        },
      ).trim();
      if (
        !boot ||
        !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(boot) ||
        boot === "00000000-0000-0000-0000-000000000000"
      )
        throw new Error("No verified Darwin machine/boot identity.");
      return {
        // Persist only a digest: portable projects must not disclose boot UUID directly.
        host: createHash("sha256")
          .update(JSON.stringify([platform(), hostname(), boot.toLowerCase()]))
          .digest("hex"),
        verifiable: true,
      };
    }
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

let scope = processScope();
// A cold Windows CIM/PowerShell or Darwin sysctl query may hit its deadline at module startup.
// One later query can establish proof; failed or foreign evidence never does.
let scopeRetryAvailable =
  !scope.verifiable && (platform() === "win32" || platform() === "darwin");
const localTokens = new Map<string, string>();

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
  localTokens.set(token, scope.host);
  return { host: scope.host, pid: process.pid, token };
}

/** Only this process may consume a queued reservation it actually created. */
export function ownsReviewOwner(value: unknown): value is ReviewExecutionOwner {
  return (
    validOwner(value) &&
    value.pid === process.pid &&
    localTokens.get(value.token) === value.host
  );
}

export function reviewOwnerState(value: unknown): "alive" | "dead" | "unknown" {
  // Keep reservations actually created here alive even if later OS evidence
  // upgrades the scope. Bind each token to its original host, not the new one.
  if (ownsReviewOwner(value)) return "alive";
  if (!validOwner(value)) return "unknown";
  if (scopeRetryAvailable) {
    scopeRetryAvailable = false;
    const verified = processScope();
    if (verified.verifiable) scope = verified;
  }
  if (value.host !== scope.host) return "unknown";
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
