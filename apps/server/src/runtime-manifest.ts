// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { access, lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const RUNTIME_ENTRIES = [
  "node",
  "launcher",
  "service",
  "ffmpeg",
  "ffprobe",
  "font",
] as const;
export interface RuntimeFile {
  path: string;
  sha256: string;
  size: number;
  executable: boolean;
  component: string;
}
export interface RuntimeComponent {
  id: string;
  version: string;
  license: string;
  licenseFile: string;
}
export interface RuntimeManifest {
  schemaVersion: 1;
  appVersion: string;
  nodeVersion: string;
  platform: "linux" | "darwin" | "win32";
  architecture: "x64" | "arm64";
  projectSchema: "1.0.0";
  entries: Record<(typeof RUNTIME_ENTRIES)[number], string>;
  components: RuntimeComponent[];
  files: RuntimeFile[];
  updates: { mode: "manual"; automatic: false; signatureRequired: true };
  optionalCapabilities: { exiftool: false; whisper: false };
  distribution: {
    status: "test-only" | "reviewed";
    systemRequirements: string[];
    receipt: string | null;
  };
}
function invalid(): never {
  throw new Error("runtime.invalid");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !(key in value))
  )
    invalid();
}
export function runtimePath(root: string, path: string): string {
  if (
    typeof path !== "string" ||
    path.length > 240 ||
    !path ||
    path.includes("\\") ||
    path.includes(":")
  )
    invalid();
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        [...part].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        /[. ]$/u.test(part) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part),
    )
  )
    invalid();
  const target = resolve(root, ...parts);
  const rel = relative(resolve(root), target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) invalid();
  return target;
}
export function assertUpdatePolicy(value: unknown): void {
  const policy = object(value);
  keys(policy, ["mode", "automatic", "signatureRequired"]);
  if (
    policy.mode !== "manual" ||
    policy.automatic !== false ||
    policy.signatureRequired !== true
  )
    invalid();
}
export function validateRuntimeManifest(input: unknown): RuntimeManifest {
  const value = object(input);
  keys(value, [
    "schemaVersion",
    "appVersion",
    "nodeVersion",
    "platform",
    "architecture",
    "projectSchema",
    "entries",
    "components",
    "files",
    "updates",
    "optionalCapabilities",
    "distribution",
  ]);
  if (
    value.schemaVersion !== 1 ||
    value.projectSchema !== "1.0.0" ||
    !/^\d+\.\d+\.\d+$/u.test(String(value.appVersion)) ||
    !/^24\.(?:1[4-9]|[2-9]\d)\.\d+$/u.test(String(value.nodeVersion)) ||
    !["linux", "darwin", "win32"].includes(String(value.platform)) ||
    !["x64", "arm64"].includes(String(value.architecture))
  )
    invalid();
  assertUpdatePolicy(value.updates);
  const optional = object(value.optionalCapabilities);
  keys(optional, ["exiftool", "whisper"]);
  if (optional.exiftool !== false || optional.whisper !== false) invalid();
  const distribution = object(value.distribution);
  keys(distribution, ["status", "systemRequirements", "receipt"]);
  if (
    !["test-only", "reviewed"].includes(String(distribution.status)) ||
    !Array.isArray(distribution.systemRequirements) ||
    distribution.systemRequirements.length < 1 ||
    distribution.systemRequirements.length > 100 ||
    distribution.systemRequirements.some(
      (item) =>
        typeof item !== "string" ||
        !item.trim() ||
        item.length > 200 ||
        [...item].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    ) ||
    (distribution.status === "test-only" && distribution.receipt !== null) ||
    (distribution.status === "reviewed" &&
      typeof distribution.receipt !== "string")
  )
    invalid();
  const entries = object(value.entries);
  keys(entries, [...RUNTIME_ENTRIES]);
  if (
    !Array.isArray(value.files) ||
    value.files.length < 6 ||
    value.files.length > 20000 ||
    !Array.isArray(value.components) ||
    value.components.length > 200
  )
    invalid();
  const components = new Set<string>();
  for (const raw of value.components) {
    const component = object(raw);
    keys(component, ["id", "version", "license", "licenseFile"]);
    if (
      typeof component.id !== "string" ||
      !(
        /^[a-z0-9@/._-]{1,100}$/u.test(component.id) ||
        /^tool:(?:node|ffmpeg|ffprobe):[a-z0-9][a-z0-9._-]{0,39}$/u.test(
          component.id,
        )
      ) ||
      components.has(component.id) ||
      typeof component.version !== "string" ||
      !/^[a-zA-Z0-9.+_-]{1,100}$/u.test(component.version) ||
      typeof component.license !== "string" ||
      !/^[a-zA-Z0-9 .()+-]{1,100}$/u.test(component.license) ||
      /unknown|nonfree|unlicensed/iu.test(component.license)
    )
      invalid();
    runtimePath("/bundle", component.licenseFile as string);
    components.add(component.id);
  }
  const paths = new Set<string>();
  let total = 0;
  for (const raw of value.files) {
    const file = object(raw);
    keys(file, ["path", "sha256", "size", "executable", "component"]);
    runtimePath("/bundle", file.path as string);
    if (
      typeof file.path !== "string" ||
      paths.has(file.path.toLowerCase()) ||
      !/^[a-f0-9]{64}$/u.test(String(file.sha256)) ||
      !Number.isSafeInteger(file.size) ||
      Number(file.size) < 0 ||
      Number(file.size) > 1024 ** 3 ||
      typeof file.executable !== "boolean" ||
      !components.has(String(file.component)) ||
      /(?:^|\/)(?:\.env.*|credentials|id_rsa|id_ed25519)$/iu.test(file.path)
    )
      invalid();
    paths.add(file.path.toLowerCase());
    total += Number(file.size);
  }
  if (total > 4 * 1024 ** 3) invalid();
  const files = value.files as unknown as RuntimeFile[];
  if (
    distribution.status === "reviewed" &&
    !files.some(
      (file) =>
        file.path === distribution.receipt &&
        file.size > 0 &&
        file.component === "openfilm",
    )
  )
    invalid();
  const declaredComponents = value.components as unknown as RuntimeComponent[];
  const nodeComponent = declaredComponents.find(
    (component) => component.id === "node",
  );
  const appComponent = declaredComponents.find(
    (component) => component.id === "openfilm",
  );
  if (
    nodeComponent?.version !== value.nodeVersion ||
    appComponent?.version !== value.appVersion
  )
    invalid();

  for (const entry of RUNTIME_ENTRIES) {
    runtimePath("/bundle", entries[entry] as string);
    const file = files.find((file) => file.path === entries[entry]);
    if (
      !file ||
      file.component !==
        (["service", "launcher"].includes(entry) ? "openfilm" : entry) ||
      (["node", "ffmpeg", "ffprobe"].includes(entry) && !file.executable)
    )
      invalid();
  }
  for (const component of value.components as unknown as RuntimeComponent[])
    if (
      !files.some(
        (file) => file.path === component.licenseFile && file.size > 0,
      )
    )
      invalid();
  return value as unknown as RuntimeManifest;
}
export async function runtimeHash(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path, { signal }))
    hash.update(bytes);
  return hash.digest("hex");
}
export async function verifyRuntimeBundle(
  root: string,
  options: {
    platform?: string;
    architecture?: string;
    signal?: AbortSignal;
    manifestSha256?: string;
  } = {},
): Promise<RuntimeManifest> {
  if ((await lstat(root)).isSymbolicLink()) invalid();
  root = await realpath(root);
  const manifestPath = join(root, "runtime-manifest.json");
  const manifestInfo = await lstat(manifestPath);
  if (
    !manifestInfo.isFile() ||
    manifestInfo.isSymbolicLink() ||
    manifestInfo.size > 8 * 1024 ** 2
  )
    invalid();
  const bytes = await readFile(manifestPath);
  if (
    options.manifestSha256 &&
    createHash("sha256").update(bytes).digest("hex") !== options.manifestSha256
  )
    throw new Error("runtime.hash");
  const manifest = validateRuntimeManifest(JSON.parse(bytes.toString("utf8")));
  if (
    manifest.platform !== (options.platform ?? process.platform) ||
    manifest.architecture !== (options.architecture ?? process.arch)
  )
    throw new Error("runtime.platform");
  const expected = new Set(manifest.files.map((file) => file.path));
  const found: string[] = [];
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      options.signal?.throwIfAborted();
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await lstat(runtimePath(root, path));
      if (
        info.isSymbolicLink() ||
        (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))
      )
        invalid();
      if (info.isDirectory()) await walk(join(dir, entry.name), path);
      else found.push(path);
    }
  };
  await walk(root, "");
  if (
    found.some(
      (path) => !expected.has(path) && path !== "runtime-manifest.json",
    )
  )
    invalid();
  for (const file of manifest.files) {
    options.signal?.throwIfAborted();
    const path = runtimePath(root, file.path);
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      (info.mode & 0o6000) !== 0 ||
      info.size !== file.size ||
      (await runtimeHash(path, options.signal)) !== file.sha256
    )
      throw new Error("runtime.hash");
    if (file.executable && process.platform !== "win32")
      await access(path, constants.X_OK);
  }
  return manifest;
}

export function assertDistributableRuntime(manifest: RuntimeManifest): void {
  if (manifest.distribution.status !== "reviewed")
    throw new Error("runtime.distributionReviewRequired");
}
