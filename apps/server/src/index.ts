import { startServer } from "./server.js";

const runtime = await startServer({
  port: Number(process.env.OPENFILM_PORT ?? 4310),
  project: process.env.OPENFILM_PROJECT,
});
console.log(
  JSON.stringify({
    event: "server.ready",
    host: "127.0.0.1",
    port: runtime.port,
  }),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void runtime.close().then(() => {
      process.exitCode = 0;
    });
  });
