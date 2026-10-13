import { startServer } from "./server.js";
import { registerOwnedProcessControl } from "./owned-process-control.js";

const startup = startServer({
  port: Number(process.env.OPENFILM_PORT ?? 4310),
  project: process.env.OPENFILM_PROJECT,
});
const close = registerOwnedProcessControl(startup);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void close().then(
      () => {
        process.exitCode ??= 0;
        if (process.connected) process.disconnect();
      },
      (error: unknown) => {
        process.exitCode = 1;
        console.error(
          JSON.stringify({
            event: "server.shutdown.failed",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        if (process.connected) process.disconnect();
      },
    );
  });
const runtime = await startup;
console.log(
  JSON.stringify({
    event: "server.ready",
    host: "127.0.0.1",
    port: runtime.port,
  }),
);
