import { runtimeEnvironment } from "../../apps/server/src/native-launcher.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  assertDistributableRuntime,
  runtimeHash,
  runtimePath,
  verifyRuntimeBundle,
} from "../../apps/server/src/runtime-manifest.js";
const [bundle, expected] = process.argv.slice(2);
if (!bundle || !expected || !/^[a-f0-9]{64}$/u.test(expected))
  throw new Error(
    "Usage: verify.ts <bundle> <independently-reviewed-manifest-sha256>",
  );
const root = resolve(bundle);
const manifest = await verifyRuntimeBundle(root, { manifestSha256: expected });
assertDistributableRuntime(manifest);
const config = JSON.parse(
  await readFile(resolve("apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
) as { version: string };
const cargo = await readFile(
  resolve("apps/desktop/src-tauri/Cargo.toml"),
  "utf8",
);
const cargoVersion = /^version\s*=\s*"([^"]+)"/mu.exec(cargo)?.[1];
if (
  manifest.appVersion !== config.version ||
  manifest.appVersion !== cargoVersion
)
  throw new Error("Runtime app version does not match the desktop shell");
for (const [entry, source] of [
  ["service", "dist/server/index.mjs"],
  ["launcher", "dist/native/launcher.mjs"],
] as const)
  if (
    (await runtimeHash(runtimePath(root, manifest.entries[entry]))) !==
    (await runtimeHash(resolve(source)))
  )
    throw new Error(
      "Runtime service/launcher does not match this checkout's build",
    );
const temporary = await mkdtemp(join(tmpdir(), "openfilm-runtime-smoke-"));
try {
  const child = spawn(
    runtimePath(root, manifest.entries.node),
    [
      runtimePath(root, manifest.entries.launcher),
      root,
      join(temporary, "data"),
      join(temporary, "projects"),
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: runtimeEnvironment(
        root,
        join(temporary, "data"),
        join(temporary, "projects"),
      ),
    },
  );
  let ready = false;
  let closed = false;
  let pending = "";
  child.stderr.on("data", () => {});
  child.stdout.on("data", (bytes: Buffer) => {
    pending += bytes.toString("utf8");
    if (pending.length > 16384) {
      child.stdin.end();
      return;
    }
    for (;;) {
      const end = pending.indexOf("\n");
      if (end < 0) break;
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      const value = JSON.parse(line) as { state?: string };
      if (value.state === "ready") {
        ready = true;
        child.stdin.write('{"type":"shutdown"}\n');
      }
      if (value.state === "closed") closed = true;
      if (value.state === "blocked") child.stdin.end();
    }
  });
  const timer = setTimeout(() => child.stdin.end(), 60000);
  const code = await new Promise<number | null>((accept, reject) => {
    child.once("exit", accept);
    child.once("error", reject);
  });
  clearTimeout(timer);
  if (code !== 0 || !ready || !closed)
    throw new Error("Owned runtime start/close smoke failed");
  console.log(
    JSON.stringify({
      verified: true,
      files: manifest.files.length,
      platform: manifest.platform,
      architecture: manifest.architecture,
      ready,
      closed,
      automaticUpdates: false,
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
