import { spawn } from "node:child_process";
import { once } from "node:events";

const server = spawn("pnpm", ["server"], { stdio: "inherit" });
const desktop = spawn("pnpm", ["--filter", "@openfilm/desktop", "dev"], {
  stdio: "inherit",
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.kill("SIGTERM");
  desktop.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const [code] = await Promise.race([
  once(server, "exit"),
  once(desktop, "exit"),
]);
stop();
process.exitCode = typeof code === "number" ? code : 0;
