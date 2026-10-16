import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

export interface ServiceNodeRuntime {
  version: string;
  executable: string;
}
export interface ServiceShutdownEvidence {
  method: "private-ipc";
  requestId: string;
  acknowledged: boolean;
}

/** Only the runner's private parent/child channel can request this shutdown. */
export function observeOwnedServiceControl(service: ChildProcess) {
  let runtime: ServiceNodeRuntime | undefined;
  let shutdown: ServiceShutdownEvidence | undefined;
  let closing: Promise<ServiceShutdownEvidence> | undefined;
  let sendRequest: (() => void) | undefined;
  let rejectClose: ((error: Error) => void) | undefined;
  const onMessage = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (message.type === "openfilm.benchmark.control-ready" && !runtime) {
      const reported = message.runtime as Record<string, unknown> | undefined;
      if (
        reported &&
        typeof reported.version === "string" &&
        /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(reported.version) &&
        typeof reported.executable === "string" &&
        isAbsolute(reported.executable)
      ) {
        runtime = {
          version: reported.version,
          executable: reported.executable,
        };
        sendRequest?.();
      }
    }
    if (message.requestId !== shutdown?.requestId) return;
    if (message.type === "openfilm.benchmark.closed" && shutdown)
      shutdown.acknowledged = true;
    if (message.type === "openfilm.benchmark.close-failed")
      rejectClose?.(
        new Error("Owned local service reported a shutdown failure"),
      );
  };
  // Register immediately after spawn, before any asynchronous owner writes.
  service.on("message", onMessage);
  return {
    get runtime() {
      return runtime;
    },
    get shutdown() {
      return shutdown;
    },
    close(timeoutMs = 2000) {
      if (closing) return closing;
      shutdown = {
        method: "private-ipc",
        requestId: randomUUID(),
        acknowledged: false,
      };
      closing = new Promise<ServiceShutdownEvidence>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          service.removeListener("close", onExit);
          service.removeListener("error", onError);
          sendRequest = undefined;
          rejectClose = undefined;
          if (error) reject(error);
          else resolve({ ...shutdown! });
        };
        const onExit = (code: number | null, signal: string | null) => {
          if (code !== 0 || signal !== null || !shutdown?.acknowledged)
            finish(
              new Error(
                "Owned local service exited without an acknowledged graceful shutdown",
              ),
            );
          else finish();
        };
        const onError = (error: Error) => finish(error);
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                `Owned local service did not acknowledge and exit within the shutdown grace period (PID ${service.pid}); cleanup is incomplete`,
              ),
            ),
          timeoutMs,
        );
        rejectClose = finish;
        // Exit can precede draining IPC; close includes the delivered final ACK.
        service.once("close", onExit);
        service.once("error", onError);
        let requested = false;
        sendRequest = () => {
          if (requested || !runtime) return;
          requested = true;
          if (!service.connected) {
            finish(
              new Error("Owned local service shutdown channel is unavailable"),
            );
            return;
          }
          service.send(
            {
              type: "openfilm.benchmark.shutdown",
              requestId: shutdown!.requestId,
            },
            (error) => {
              if (error) finish(error);
            },
          );
        };
        if (service.exitCode !== null || service.signalCode !== null)
          finish(
            new Error("Owned local service exited before shutdown request"),
          );
        else sendRequest();
      });
      return closing;
    },
    dispose() {
      service.removeListener("message", onMessage);
      // A timed-out graceful close may still be saving; do not disconnect or kill it.
      service.channel?.unref();
    },
  };
}
