import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Optional filesystem operations allow deterministic real-I/O failure tests. */
export interface RenderPublicationOperations {
  lstat: (path: string) => Promise<Stats>;
  rename: (source: string, destination: string) => Promise<void>;
  rm: (path: string, options: { force: true }) => Promise<void>;
}

const defaults: RenderPublicationOperations = { lstat, rename, rm };

export class RenderPublicationRecoveryError extends Error {
  override name = "RenderPublicationRecoveryError";
  readonly retainWork = true as const;

  constructor(
    readonly workDirectory: string,
    readonly recoveryPaths: string[],
    cause: unknown,
  ) {
    super(
      `Render publication failed and the previous files could not be fully restored. Keep the recovery directory "${workDirectory}" and restore the retained original files before rendering again. Recovery paths: ${recoveryPaths.join(", ")}.`,
      { cause },
    );
  }
}

async function regularOrAbsent(
  path: string,
  io: RenderPublicationOperations,
): Promise<boolean> {
  try {
    const file = await io.lstat(path);
    if (file.isSymbolicLink() || !file.isFile())
      throw new Error(
        `Render destination must be a regular file, not a directory or symbolic link: ${path}`,
      );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Validate both output destinations before any original is replaced or decoded. */
export async function validateRenderTargets(
  output: string,
  operations: Partial<RenderPublicationOperations> = {},
): Promise<void> {
  const io = { ...defaults, ...operations };
  await regularOrAbsent(output, io);
  await regularOrAbsent(`${output}.manifest.json`, io);
}

interface Target {
  destination: string;
  temporary: string;
  backup: string;
  backedUp: boolean;
  installed: boolean;
}

/**
 * Publish a fully staged MP4/receipt pair. File renames are individually atomic;
 * the pair is not crash-atomic. Existing originals remain in the caller-owned
 * work directory until both publications succeed and the caller cleans work.
 * An incomplete rollback explicitly tells that caller to retain all work.
 */
export async function publishRenderPair(
  temporaryOutput: string,
  temporaryManifest: string,
  output: string,
  work: string,
  operations: Partial<RenderPublicationOperations> = {},
): Promise<void> {
  const io = { ...defaults, ...operations };
  const paths = [
    temporaryOutput,
    temporaryManifest,
    output,
    `${output}.manifest.json`,
  ];
  if (new Set(paths.map((path) => resolve(path))).size !== paths.length)
    throw new Error(
      "Staged render files and publication destinations must be distinct.",
    );
  await validateRenderTargets(output, io);
  // Validate staging before moving either existing original into a backup.
  for (const temporary of [temporaryOutput, temporaryManifest])
    if (!(await regularOrAbsent(temporary, io)))
      throw new Error(`The staged render file is missing: ${temporary}`);
  const token = randomUUID();
  const targets: Target[] = [
    {
      destination: output,
      temporary: temporaryOutput,
      backup: join(work, `previous-video-${token}.mp4`),
      backedUp: false,
      installed: false,
    },
    {
      destination: `${output}.manifest.json`,
      temporary: temporaryManifest,
      backup: join(work, `previous-manifest-${token}.json`),
      backedUp: false,
      installed: false,
    },
  ];
  try {
    for (const target of targets) {
      // Recheck immediately before moving each destination: a sidecar that
      // changed since early render preflight must not move an entire directory.
      if (await regularOrAbsent(target.destination, io)) {
        await io.rename(target.destination, target.backup);
        target.backedUp = true;
      }
    }
    for (const target of targets) {
      await io.rename(target.temporary, target.destination);
      target.installed = true;
    }
  } catch (failure) {
    const rollbackErrors: unknown[] = [];
    const retained = new Set<string>();
    const blocked = new Set<Target>();
    // Remove only files this transaction installed, never unrelated outputs.
    // Restore the other target even if one cleanup/restore operation fails.
    for (const target of [...targets].reverse()) {
      if (target.installed) {
        try {
          await io.rm(target.destination, { force: true });
          target.installed = false;
        } catch (error) {
          blocked.add(target);
          rollbackErrors.push(error);
          retained.add(target.destination);
        }
      }
    }
    for (const target of [...targets].reverse()) {
      if (!target.backedUp) continue;
      if (!blocked.has(target)) {
        try {
          await io.rename(target.backup, target.destination);
          target.backedUp = false;
        } catch (error) {
          rollbackErrors.push(error);
          retained.add(target.backup);
        }
      } else retained.add(target.backup);
    }
    if (rollbackErrors.length)
      throw new RenderPublicationRecoveryError(
        work,
        [...retained],
        new AggregateError(
          [failure, ...rollbackErrors],
          "Render publication rollback failed.",
        ),
      );
    throw failure;
  }
}
