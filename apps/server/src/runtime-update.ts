// Disabled by default. Trusted host configuration, never a project/HTTP input,
// must provide an Ed25519 public key before a future updater can stage a bundle.
import { createHash, createPublicKey, verify } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertDistributableRuntime,
  verifyRuntimeBundle,
} from "./runtime-manifest.js";
export async function verifyRuntimeUpdate(
  root: string,
  signature: Buffer,
  trustedPublicKey?: string,
) {
  if (!trustedPublicKey) throw new Error("runtime.updatesDisabled");
  const path = join(root, "runtime-manifest.json");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 ** 2)
    throw new Error("runtime.invalid");
  const key = createPublicKey(trustedPublicKey);
  const bytes = await readFile(path);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    signature.length !== 64 ||
    !verify(null, bytes, key, signature)
  )
    throw new Error("runtime.signature");
  const manifest = await verifyRuntimeBundle(root, {
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
  });
  assertDistributableRuntime(manifest);
  return manifest;
}
