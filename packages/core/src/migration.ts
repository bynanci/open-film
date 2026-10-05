import { PROJECT_SCHEMA_VERSION, type OpenFilmProject } from "./models.js";
import { ProjectValidationError, validateProject } from "./validation.js";

/**
 * Documented draft migration: 0.1.0 has the v1 field names but may omit settings.
 * The only default added is the published 1920x1080 / 30 fps project setting.
 * There are no implicit migrations for unversioned or undocumented formats.
 */
export function migrateProject(value: unknown): OpenFilmProject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return validateProject(value);
  }
  const legacy = value as Record<string, unknown>;
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return validateProject(value);
  if (legacy.schemaVersion === PROJECT_SCHEMA_VERSION)
    return validateProject(value);
  if (legacy.schemaVersion !== "0.1.0") return validateProject(value);
  return validateProject({
    ...legacy,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    settings:
      legacy.settings === undefined
        ? { width: 1920, height: 1080, frameRate: 30 }
        : legacy.settings,
  });
}

/** Reject malformed version declarations separately for migration UI callers. */
export function supportedProjectVersions(): readonly string[] {
  return ["0.1.0", PROJECT_SCHEMA_VERSION];
}

export { ProjectValidationError };
