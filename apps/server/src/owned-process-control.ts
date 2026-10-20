interface CloseableService {
  close(): Promise<void>;
}
interface ShutdownRequest {
  type: "openfilm.benchmark.shutdown";
  requestId: string;
}
function shutdownRequest(message: unknown): message is ShutdownRequest {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return false;
  const value = message as Record<string, unknown>;
  return (
    Object.keys(value).length === 2 &&
    value.type === "openfilm.benchmark.shutdown" &&
    typeof value.requestId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
      value.requestId,
    )
  );
}
function sendControl(message: object): Promise<void> {
  return new Promise((accept, reject) => {
    if (!process.connected || !process.send) {
      reject(new Error("Owned service control channel disconnected"));
      return;
    }
    process.send(message, undefined, undefined, (error: Error | null) =>
      error ? reject(error) : accept(),
    );
  });
}

/** Register before awaiting startup so a private owner's early cancellation is
 * retained. Ordinary servers have no control listener or HTTP shutdown route.
 * Signal and owner shutdown share one awaited close operation.
 */
export function registerOwnedProcessControl(
  startup: Promise<CloseableService>,
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  const closeOnce = () =>
    (closing ??= startup.then((runtime) => runtime.close()));
  const native = process.env.OPENFILM_NATIVE_SERVICE_CONTROL === "1";
  if (
    (!native && process.env.OPENFILM_BENCHMARK_SERVICE_CONTROL !== "1") ||
    !process.connected ||
    !process.send
  )
    return closeOnce;

  let requested = false;
  const shutdown = async (requestId: string) => {
    try {
      await closeOnce();
      // A closed ACK is evidence of successful application/SQLite shutdown,
      // not merely receipt of a request or an OS process termination signal.
      await sendControl({ type: "openfilm.benchmark.closed", requestId });
      process.exitCode ??= 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.exitCode = 1;
      console.error(
        JSON.stringify({ event: "server.shutdown.failed", message }),
      );
      try {
        await sendControl({
          type: "openfilm.benchmark.close-failed",
          requestId,
          message,
        });
      } catch {
        // A disconnected owner cannot receive failure evidence; stderr and
        // nonzero exit still distinguish it from successful shutdown.
      }
    } finally {
      process.removeListener("message", onMessage);
      process.removeListener("disconnect", onDisconnect);
      if (process.connected) process.disconnect();
    }
  };
  const onMessage = (message: unknown) => {
    if (requested || !shutdownRequest(message)) return;
    requested = true;
    void shutdown(message.requestId);
  };
  const onDisconnect = () => {
    // Native parent disappearance closes only the service it owns. Benchmark
    // observers retain the historical non-owning disconnect behavior.
    process.removeListener("message", onMessage);
    if (native && !requested)
      void closeOnce().catch(() => {
        process.exitCode = 1;
      });
  };
  process.on("message", onMessage);
  process.once("disconnect", onDisconnect);
  void sendControl({
    type: "openfilm.benchmark.control-ready",
    runtime: { version: process.version, executable: process.execPath },
  }).catch((error: unknown) => {
    process.exitCode = 1;
    console.error(
      JSON.stringify({
        event: "server.control.failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  return closeOnce;
}
