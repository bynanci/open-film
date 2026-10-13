import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep, win32 } from "node:path";
import type { NativeBenchmarkFixtureManifest } from "./create-fixture";

type FixtureFile = NativeBenchmarkFixtureManifest["files"][number];
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonblank = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && !value.includes("\0");
const count = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= 10000;
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function relativePath(value: unknown): asserts value is string {
  if (
    !nonblank(value) ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    /^[a-z]:/iu.test(value) ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(
      "Fixture paths must be unambiguous relative paths within its root",
    );
}
function fileDescriptor(
  value: unknown,
): asserts value is FixtureFile & Record<string, unknown> {
  if (!record(value)) throw new Error("Invalid fixture file descriptor");
  relativePath(value.relativePath);
  if (
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(value.sha256) ||
    !nonnegativeInteger(value.fileSize)
  )
    throw new Error(`Invalid SHA256 or file size: ${value.relativePath}`);
}
function withinRoot(root: string, path: string) {
  const child = relative(root, path);
  if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`))
    throw new Error(`Fixture path escapes its root: ${path}`);
}
async function resolveWithinRoot(root: string, path: string) {
  const canonical = await realpath(path);
  withinRoot(root, canonical);
  return canonical;
}
async function verifyFile(root: string, descriptor: FixtureFile) {
  const path = await resolveWithinRoot(
    root,
    join(root, descriptor.relativePath),
  );
  const info = await stat(path);
  if (!info.isFile() || info.size !== descriptor.fileSize)
    throw new Error(
      `Fixture file size/type mismatch: ${descriptor.relativePath}`,
    );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest("hex") !== descriptor.sha256.toLowerCase())
    throw new Error(`Fixture SHA256 mismatch: ${descriptor.relativePath}`);
}

/** Verify immutable generated input identities before starting owned processes.
 * A matching clip count cannot substitute for matching project/media bytes.
 */
export async function validateNativeBenchmarkFixture(
  fixtureManifestPath: string,
  project?: string,
): Promise<NativeBenchmarkFixtureManifest> {
  if (!isAbsolute(fixtureManifestPath))
    throw new Error("Fixture manifest must be an absolute file path");
  const root = await realpath(dirname(fixtureManifestPath));
  const manifestPath = await resolveWithinRoot(root, fixtureManifestPath);
  if (!(await stat(manifestPath)).isFile())
    throw new Error("Fixture manifest must be a regular file");
  const data: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    !record(data) ||
    data.fixtureVersion !== "1.0.0" ||
    !record(data.counts) ||
    !count(data.counts.assets) ||
    !count(data.counts.clips) ||
    !count(data.counts.beats) ||
    data.counts.clips > data.counts.assets ||
    data.counts.beats > data.counts.clips
  )
    throw new Error(
      "Invalid fixture manifest version or asset/clip/beat counts",
    );
  if (data.projectRelativePath !== "benchmark.openfilm")
    throw new Error(
      "Fixture manifest projectRelativePath must identify benchmark.openfilm",
    );
  if (
    !nonblank(data.createdAt) ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    !record(data.generator) ||
    !nonblank(data.generator.ffmpegVersion) ||
    !nonblank(data.generator.nodeVersion) ||
    data.durationSeconds !== data.counts.clips * 3 ||
    !nonnegativeInteger(data.linkedMediaCount) ||
    !nonnegativeInteger(data.copiedMediaCount) ||
    data.linkedMediaCount + data.copiedMediaCount !== data.counts.assets ||
    !Array.isArray(data.limitations) ||
    !data.limitations.every(nonblank) ||
    !Array.isArray(data.files) ||
    !Array.isArray(data.media) ||
    data.media.length !== data.counts.assets
  )
    throw new Error(
      "Invalid fixture manifest metadata, media declarations or counts",
    );
  fileDescriptor(data.source);
  const source = data.source;
  if (
    source.durationSeconds !== 3 ||
    source.width !== 320 ||
    source.height !== 180 ||
    source.frameRate !== 24 ||
    source.videoCodec !== "h264" ||
    source.audioCodec !== "aac"
  )
    throw new Error("Invalid version 1.0.0 fixture source metadata");

  const paths = new Set<string>();
  const assetIds = new Set<string>();
  const declared = new Map<string, FixtureFile>();
  for (const file of data.files) {
    fileDescriptor(file);
    if (paths.has(file.relativePath))
      throw new Error(`Duplicate fixture path: ${file.relativePath}`);
    paths.add(file.relativePath);
    declared.set(file.relativePath, file);
  }
  for (const media of data.media) {
    fileDescriptor(media);
    const assetId = media.assetId;
    if (!nonblank(assetId)) throw new Error("Invalid fixture media asset ID");
    if (assetIds.has(assetId))
      throw new Error(`Duplicate fixture asset ID: ${assetId}`);
    if (paths.has(media.relativePath))
      throw new Error(`Duplicate fixture path: ${media.relativePath}`);
    assetIds.add(assetId);
    paths.add(media.relativePath);
  }
  for (const required of ["project.json", "database.sqlite"])
    if (!declared.has(`${data.projectRelativePath}/${required}`))
      throw new Error(
        `Fixture manifest is missing required declaration: ${required}`,
      );
  const declaredSource = declared.get(source.relativePath);
  if (
    !declaredSource ||
    declaredSource.sha256.toLowerCase() !== source.sha256.toLowerCase() ||
    declaredSource.fileSize !== source.fileSize
  )
    throw new Error("Fixture source identity must match its file declaration");

  const expectedProject = await resolveWithinRoot(
    root,
    join(root, data.projectRelativePath),
  );
  if (!(await stat(expectedProject)).isDirectory())
    throw new Error("Fixture project must be an existing directory");
  if (project !== undefined) {
    if (!isAbsolute(project) || (await realpath(project)) !== expectedProject)
      throw new Error(
        "Configured project does not match the fixture manifest project",
      );
  }
  // WAL payload changes SQLite's visible state even when the main file's hash
  // is unchanged. Closed generated fixtures have no payload; an explicit WAL
  // declaration is validated with all other immutable file identities below.
  const walRelativePath = `${data.projectRelativePath}/database.sqlite-wal`;
  if (!declared.has(walRelativePath)) {
    try {
      const walPath = await resolveWithinRoot(
        root,
        join(root, walRelativePath),
      );
      const info = await stat(walPath);
      if (!info.isFile() || info.size !== 0)
        throw new Error("Fixture contains an undeclared nonempty SQLite WAL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // Sequential streamed hashing bounds memory, including copy-based fixtures.
  for (const file of [...data.files, ...data.media])
    await verifyFile(root, file);
  return data as unknown as NativeBenchmarkFixtureManifest;
}

/** Make a fresh run-local project without changing the immutable fixture.
 * SQLite/catalog source URIs continue to reference the original generated media.
 * Only declared project files are copied, and copied bytes retain their original
 * hash contract; a concurrent source change fails rather than becoming a baseline.
 */
export async function copyNativeBenchmarkProject(
  fixtureManifestPath: string,
  validatedManifest: NativeBenchmarkFixtureManifest,
  destinationProject: string,
): Promise<string> {
  if (
    !isAbsolute(fixtureManifestPath) ||
    !isAbsolute(destinationProject) ||
    validatedManifest.projectRelativePath !== "benchmark.openfilm"
  )
    throw new Error(
      "Project copy requires absolute paths and a validated fixture",
    );
  const sourceRoot = await realpath(dirname(fixtureManifestPath));
  const prefix = `${validatedManifest.projectRelativePath}/`;
  const files = validatedManifest.files.filter((file) => {
    fileDescriptor(file);
    return file.relativePath.startsWith(prefix);
  });
  for (const required of ["project.json", "database.sqlite"])
    if (!files.some((file) => file.relativePath === `${prefix}${required}`))
      throw new Error(
        `Fixture project copy is missing a declaration: ${required}`,
      );
  // Exclusive creation deliberately rejects even an existing empty destination.
  await mkdir(destinationProject);
  const destinationRoot = await realpath(destinationProject);
  for (const file of files) {
    const source = await resolveWithinRoot(
      sourceRoot,
      join(sourceRoot, file.relativePath),
    );
    const relativePath = file.relativePath.slice(prefix.length);
    const destination = join(destinationRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await resolveWithinRoot(destinationRoot, dirname(destination));
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await verifyFile(destinationRoot, { ...file, relativePath });
  }
  return destinationRoot;
}
