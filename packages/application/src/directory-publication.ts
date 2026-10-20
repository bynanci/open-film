// Modified by OpenFilm contributors on 2026-10-20. See LICENSE/NOTICE.
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkAbort } from "@openfilm/media";
import { getExclusiveDirectoryRenamer } from "./exclusive-directory-rename.js";

export class DirectoryPublicationRecoveryError extends Error {
  constructor(
    readonly staging: string,
    readonly destination: string,
    cause: unknown,
  ) {
    super("Directory publication could not recover its owned directory.", {
      cause,
    });
    this.name = "DirectoryPublicationRecoveryError";
  }
}

export function directoryPublicationUnavailable(error: unknown): boolean {
  return ["ENOTSUP", "ENOSYS", "EOPNOTSUPP", "EXDEV", "EINVAL"].includes(
    (error as NodeJS.ErrnoException | undefined)?.code ?? "",
  );
}

function sameDirectory(path: string, identity: Stats): boolean {
  const current = lstatSync(path);
  return (
    current.isDirectory() &&
    !current.isSymbolicLink() &&
    current.dev === identity.dev &&
    current.ino === identity.ino
  );
}

/** Publish a complete, known private stage without replacing any destination. */
export async function publishDirectory(input: {
  staging: string;
  destination: string;
  signal?: AbortSignal;
  assertCurrent: () => void;
}): Promise<void> {
  const identity = lstatSync(input.staging);
  if (!identity.isDirectory() || identity.isSymbolicLink())
    throw new Error(
      "Directory publication requires a private directory stage.",
    );
  const parents = [
    ...new Set([dirname(input.staging), dirname(input.destination)]),
  ].map((path) => ({ path, identity: lstatSync(path) }));
  const assertParents = () => {
    for (const parent of parents)
      if (
        !sameDirectory(parent.path, parent.identity) ||
        realpathSync(parent.path) !== resolve(parent.path)
      )
        throw new Error("Directory publication parent changed.");
  };
  assertParents();
  // Native loading may await; the final source/revision/abort fence must follow it.
  const renameExclusive = await getExclusiveDirectoryRenamer();
  let installed = false;
  try {
    checkAbort(input.signal);
    input.assertCurrent();
    checkAbort(input.signal);
    assertParents();
    if (!sameDirectory(input.staging, identity))
      throw new Error("Directory publication stage changed.");
    renameExclusive(input.staging, input.destination);
    installed = true;
    assertParents();
    if (!sameDirectory(input.destination, identity))
      throw new Error("Directory publication destination ownership changed.");
    input.assertCurrent();
    checkAbort(input.signal);
    assertParents();
    if (!sameDirectory(input.destination, identity))
      throw new Error("Directory publication destination ownership changed.");
  } catch (error) {
    if (installed) {
      try {
        assertParents();
        if (!sameDirectory(input.destination, identity))
          throw new Error(
            "A different owner replaced the published directory.",
            { cause: error },
          );
        // Reclaim the directory into its private stage before any recursive
        // cleanup. The same exclusive primitive preserves a raced stage path.
        renameExclusive(input.destination, input.staging);
        if (!sameDirectory(input.staging, identity)) {
          // A source replacement between the identity check and native rename
          // is preserved and returned to its path, never recursively removed.
          renameExclusive(input.staging, input.destination);
          throw new Error("Rollback encountered a different directory owner.", {
            cause: error,
          });
        }
      } catch (rollback) {
        throw new DirectoryPublicationRecoveryError(
          input.staging,
          input.destination,
          new AggregateError(
            [error, rollback],
            "Directory publication rollback failed.",
          ),
        );
      }
    }
    throw error;
  }
}
