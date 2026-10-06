import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ApplicationError } from "@openfilm/core";

/** Trusted runtime configuration, never a project field or an HTTP request path. */
export function resolveUserDataDirectory(explicit?: string): string {
  const configured = explicit ?? process.env.OPENFILM_USER_DATA_DIR;
  if (configured !== undefined) {
    if (typeof configured !== "string" || !configured.trim())
      throw new ApplicationError(
        "request.invalid",
        "User data directory must be a nonempty path.",
      );
    return resolve(configured);
  }
  if (process.platform === "win32")
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "OpenFilm",
    );
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "OpenFilm");
  return join(
    process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    "openfilm",
  );
}
